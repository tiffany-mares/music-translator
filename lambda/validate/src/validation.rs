//! Pure upload-validation checks (Phase 3.3): size bounds and magic-byte
//! format detection for the five formats the ML container accepts
//! (container/process.py AUDIO_SUFFIXES). No I/O here - main.rs feeds bytes.

pub const MIN_BYTES: i64 = 50_000;
pub const MAX_BYTES: i64 = 25_000_000;

pub fn validate_size(len: i64) -> Result<(), String> {
    if len < MIN_BYTES {
        return Err(format!("file too small: {len} bytes (min {MIN_BYTES})"));
    }
    if len > MAX_BYTES {
        return Err(format!("file too large: {len} bytes (max {MAX_BYTES})"));
    }
    Ok(())
}

pub fn detect_format(header: &[u8]) -> Result<&'static str, String> {
    if header.len() < 12 {
        return Err(format!("header too short to identify ({} bytes)", header.len()));
    }
    if &header[0..3] == b"ID3" {
        return Ok("mp3");
    }
    if header[0] == 0xFF && (header[1] & 0xE0) == 0xE0 {
        return Ok("mp3"); // raw MPEG frame sync, no ID3 tag
    }
    if &header[0..4] == b"RIFF" && &header[8..12] == b"WAVE" {
        return Ok("wav");
    }
    if &header[0..4] == b"fLaC" {
        return Ok("flac");
    }
    if &header[0..4] == b"OggS" {
        return Ok("ogg");
    }
    if &header[4..8] == b"ftyp" {
        return Ok("m4a");
    }
    Err("unrecognized audio header (not mp3/wav/flac/ogg/m4a)".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn size_bounds() {
        assert!(validate_size(50_000).is_ok());
        assert!(validate_size(25_000_000).is_ok());
        assert!(validate_size(49_999).unwrap_err().contains("too small"));
        assert!(validate_size(25_000_001).unwrap_err().contains("too large"));
    }

    #[test]
    fn detects_mp3_id3_and_frame_sync() {
        assert_eq!(detect_format(b"ID3\x04\x00\x00\x00\x00\x00\x00\x00\x00"), Ok("mp3"));
        let frame = [0xFFu8, 0xFB, 0x90, 0, 0, 0, 0, 0, 0, 0, 0, 0];
        assert_eq!(detect_format(&frame), Ok("mp3"));
    }

    #[test]
    fn detects_containers() {
        assert_eq!(detect_format(b"RIFF\x00\x00\x00\x00WAVEfmt "), Ok("wav"));
        assert_eq!(detect_format(b"fLaC\x00\x00\x00\x22aaaa"), Ok("flac"));
        assert_eq!(detect_format(b"OggS\x00\x02\x00\x00\x00\x00\x00\x00"), Ok("ogg"));
        assert_eq!(detect_format(b"\x00\x00\x00\x20ftypM4A "), Ok("m4a"));
    }

    #[test]
    fn rejects_garbage() {
        assert!(detect_format(b"this is not audio at all!").is_err());
        assert!(detect_format(b"{\"json\":true} nope nope").is_err());
    }

    #[test]
    fn rejects_short_header() {
        assert!(detect_format(b"ID3").unwrap_err().contains("too short"));
    }
}
