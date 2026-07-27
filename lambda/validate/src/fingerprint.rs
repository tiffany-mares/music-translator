//! Phase 3.4 (section 5.2a): chromaprint acoustic fingerprint + GSI3 dedup key.
//! Pure compute - main.rs feeds bytes and does all I/O.
//!
//! Two-stage dedup: GSI3PK is a 32-bit SimHash of the fingerprint (exact-match
//! candidate filter, stable across re-encodes because it is a majority vote
//! over ~900 items and order-invariant); is_duplicate() then verifies the
//! candidate acoustically. A simhash collision is therefore harmless; a split
//! only costs a duplicate pipeline run.

use rusty_chromaprint::{match_fingerprints, Configuration, Fingerprinter};
use symphonia::core::audio::SampleBuffer;
use symphonia::core::codecs::{DecoderOptions, CODEC_TYPE_NULL};
use symphonia::core::errors::Error as SymError;
use symphonia::core::formats::FormatOptions;
use symphonia::core::io::MediaSourceStream;
use symphonia::core::meta::MetadataOptions;
use symphonia::core::probe::Hint;

pub const MAX_FINGERPRINT_SECONDS: u64 = 120; // AcoustID convention; bounds CPU
pub const MAX_SEGMENT_SCORE: f64 = 10.0; // Segment.score is 0..32 bit-error, lower = more similar
pub const MIN_MATCH_COVERAGE: f32 = 0.8; // matched duration / shorter fp duration

pub fn config() -> Configuration {
    Configuration::preset_test2() // chromaprint ALGORITHM_DEFAULT (fpcalc/AcoustID)
}

/// Decode up to MAX_FINGERPRINT_SECONDS of `bytes` (detected format `ext` as
/// probe hint) and fingerprint the PCM.
pub fn fingerprint_bytes(bytes: Vec<u8>, ext: &str) -> Result<Vec<u32>, String> {
    let mss = MediaSourceStream::new(Box::new(std::io::Cursor::new(bytes)), Default::default());
    let mut hint = Hint::new();
    hint.with_extension(ext);
    let probed = symphonia::default::get_probe()
        .format(&hint, mss, &FormatOptions::default(), &MetadataOptions::default())
        .map_err(|e| format!("probe failed: {e}"))?;
    let mut format = probed.format;
    let track = format
        .tracks()
        .iter()
        .find(|t| t.codec_params.codec != CODEC_TYPE_NULL)
        .ok_or("no audio track")?;
    let track_id = track.id;
    let sample_rate = track.codec_params.sample_rate.ok_or("unknown sample rate")?;
    let channels = track.codec_params.channels.ok_or("unknown channel layout")?.count() as u32;
    let mut decoder = symphonia::default::get_codecs()
        .make(&track.codec_params, &DecoderOptions::default())
        .map_err(|e| format!("unsupported codec: {e}"))?;

    let mut printer = Fingerprinter::new(&config());
    printer
        .start(sample_rate, channels)
        .map_err(|e| format!("fingerprinter start: {e:?}"))?; // crate resamples/downmixes internally
    let max_frames = sample_rate as u64 * MAX_FINGERPRINT_SECONDS;
    let mut frames: u64 = 0;
    let mut sample_buf: Option<SampleBuffer<i16>> = None;
    loop {
        let packet = match format.next_packet() {
            Ok(p) => p,
            Err(_) => break, // EOF / end of stream
        };
        if packet.track_id() != track_id {
            continue;
        }
        match decoder.decode(&packet) {
            Ok(audio) => {
                let buf = sample_buf.get_or_insert_with(|| {
                    SampleBuffer::<i16>::new(audio.capacity() as u64, *audio.spec())
                });
                buf.copy_interleaved_ref(audio);
                printer.consume(buf.samples());
                frames += buf.samples().len() as u64 / channels as u64;
                if frames >= max_frames {
                    break;
                }
            }
            Err(SymError::DecodeError(_)) => continue, // skip corrupt packet, keep going
            Err(_) => break,
        }
    }
    printer.finish();
    let fp = printer.fingerprint().to_vec();
    if fp.len() < 16 {
        return Err(format!("audio too short to fingerprint ({} items)", fp.len()));
    }
    Ok(fp)
}

/// 32-bit SimHash: bit b of the result is the majority vote of bit b across
/// all fp items. Ties (and empty input) resolve to 0.
/// THE ONLY place key material is derived - swap to banded LSH here if the
/// re-encode test ever fails (see plan: 4 time bands, 4 keys FP2B{n}#<hex>).
pub fn simhash32(fp: &[u32]) -> u32 {
    let mut counts = [0i64; 32];
    for &item in fp {
        for (b, c) in counts.iter_mut().enumerate() {
            *c += if item >> b & 1 == 1 { 1 } else { -1 };
        }
    }
    counts
        .iter()
        .enumerate()
        .fold(0u32, |acc, (b, &c)| if c > 0 { acc | 1 << b } else { acc })
}

pub fn gsi3_key(fp: &[u32]) -> String {
    format!("FP1#{:08x}", simhash32(fp))
}

/// Acoustic verification of a GSI3 candidate (guards simhash collisions):
/// duplicate iff segments scoring <= MAX_SEGMENT_SCORE cover >=
/// MIN_MATCH_COVERAGE of the shorter fingerprint.
pub fn is_duplicate(fp_a: &[u32], fp_b: &[u32]) -> bool {
    let cfg = config();
    let Ok(segments) = match_fingerprints(fp_a, fp_b, &cfg) else {
        return false;
    };
    let matched: f32 = segments
        .iter()
        .filter(|s| s.score <= MAX_SEGMENT_SCORE)
        .map(|s| s.duration(&cfg))
        .sum();
    let shorter = fp_a.len().min(fp_b.len()) as f32 * cfg.item_duration_in_seconds();
    shorter > 0.0 && matched / shorter >= MIN_MATCH_COVERAGE
}

pub fn fp_to_bytes(fp: &[u32]) -> Vec<u8> {
    fp.iter().flat_map(|v| v.to_le_bytes()).collect()
}

pub fn fp_from_bytes(b: &[u8]) -> Vec<u32> {
    b.chunks_exact(4)
        .map(|c| u32::from_le_bytes(c.try_into().unwrap()))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    // Fixtures live in tests/data/ as data only (no .rs files there - this
    // crate is bin-only, so an integration-test target couldn't import us).
    const SMOKE_128K: &[u8] = include_bytes!("../tests/data/smoke_30s.mp3");
    const SMOKE_64K: &[u8] = include_bytes!("../tests/data/smoke_30s_64k.mp3");
    const OTHER_64K: &[u8] = include_bytes!("../tests/data/other_30s_64k.mp3");

    #[test]
    fn simhash_majority_votes() {
        // All items identical -> hash equals that item; empty input -> 0.
        assert_eq!(simhash32(&[0xf0f0_1234; 9]), 0xf0f0_1234);
        assert_eq!(simhash32(&[]), 0);
    }

    #[test]
    fn gsi3_key_versioned_hex() {
        assert_eq!(gsi3_key(&[0xf0f0_1234; 9]), "FP1#f0f01234");
    }

    #[test]
    fn bytes_roundtrip() {
        let fp = vec![0u32, 1, 0xdead_beef, u32::MAX];
        assert_eq!(fp_from_bytes(&fp_to_bytes(&fp)), fp);
    }

    #[test]
    fn fingerprints_real_mp3() {
        let fp = fingerprint_bytes(SMOKE_128K.to_vec(), "mp3").unwrap();
        // ~30s clip at ~0.12s/item -> a couple hundred items.
        assert!(fp.len() > 100, "unexpectedly short fingerprint: {}", fp.len());
    }

    #[test]
    fn reencode_same_simhash_key() {
        // THE load-bearing test: the whole GSI3 exact-match design hinges on
        // a 128k->64k re-encode producing the same key. If this fails, switch
        // gsi3_key to the banded-LSH fallback BEFORE any AWS work.
        let a = fingerprint_bytes(SMOKE_128K.to_vec(), "mp3").unwrap();
        let b = fingerprint_bytes(SMOKE_64K.to_vec(), "mp3").unwrap();
        assert_eq!(gsi3_key(&a), gsi3_key(&b));
        assert!(is_duplicate(&a, &b));
    }

    #[test]
    fn different_song_not_duplicate() {
        let a = fingerprint_bytes(SMOKE_128K.to_vec(), "mp3").unwrap();
        let c = fingerprint_bytes(OTHER_64K.to_vec(), "mp3").unwrap();
        // Do NOT assert the keys differ - a simhash collision is legal; the
        // verification stage is what must reject it.
        assert!(!is_duplicate(&a, &c));
    }

    #[test]
    fn garbage_bytes_err() {
        assert!(fingerprint_bytes(vec![0x42; 100_000], "mp3").is_err());
    }
}
