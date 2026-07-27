"""StitchResults Lambda (Phase 2.5): reassemble per-chunk outputs into
whole-song artifacts (architecture.md section 5.3a).

Audio: normalized linear overlap-add across the 2.5 s overlaps - complementary
ramps sum to 1, so identical overlap content passes through exactly; the
normalization keeps it robust if lengths are ever off by a few samples.

Transcript/pitch: shift each chunk's timestamps by chunkStartOffset, then the
"simple de-duplication pass" (5.3a): every chunk owns the timeline
[chunkStartOffset + overlap/2, next chunkStartOffset + overlap/2) and an item
survives iff its midpoint falls inside its chunk's window - so a word/note the
overlap made two chunks capture survives exactly once. Items much longer than
the overlap that the two chunks segmented differently can still duplicate or
drop at seams - that is section 5.3's stated chunking tradeoff, measured and
documented in notes/phase2.md section 2.5, not hidden here.
"""
import json
import math

import numpy as np

CHUNK_SECONDS = 40.0
OVERLAP_SECONDS = 2.5


def stitch_audio(chunks: list, offsets_samples: list, total_samples: int,
                 overlap_samples: int) -> "np.ndarray":
    first = np.asarray(chunks[0], dtype=np.float64)
    out_shape = (total_samples,) if first.ndim == 1 else (total_samples, first.shape[1])
    acc = np.zeros(out_shape, dtype=np.float64)
    wsum = np.zeros(total_samples, dtype=np.float64)

    for i, (chunk, off) in enumerate(zip(chunks, offsets_samples)):
        chunk = np.asarray(chunk, dtype=np.float64)
        n = len(chunk)
        env = np.ones(n)
        if i > 0:
            m = min(overlap_samples, n)
            env[:m] = np.linspace(0.0, 1.0, m)
        if i < len(chunks) - 1:
            m = min(overlap_samples, n)
            # np.minimum guards a chunk shorter than two overlaps (head and tail
            # ramps intersecting); normalization below absorbs any ramp asymmetry.
            env[n - m:] = np.minimum(env[n - m:], np.linspace(1.0, 0.0, m))
        weighted = chunk * (env if chunk.ndim == 1 else env[:, None])
        acc[off:off + n] += weighted
        wsum[off:off + n] += env

    wsum = np.maximum(wsum, 1e-12)
    return acc / (wsum if acc.ndim == 1 else wsum[:, None])


def _own_windows(offsets: list, overlap_seconds: float) -> list:
    windows = []
    for i, off in enumerate(offsets):
        start = 0.0 if i == 0 else off + overlap_seconds / 2
        end = math.inf if i == len(offsets) - 1 else offsets[i + 1] + overlap_seconds / 2
        windows.append((start, end))
    return windows


def merge_lines(chunk_transcripts: list, overlap_seconds: float = OVERLAP_SECONDS) -> list:
    offsets = [t["chunkStartOffset"] for t in chunk_transcripts]
    windows = _own_windows(offsets, overlap_seconds)
    merged = []
    for t, (lo, hi) in zip(chunk_transcripts, windows):
        off = t["chunkStartOffset"]
        for line in t["lines"]:
            start, end = line["startTime"] + off, line["endTime"] + off
            mid = (start + end) / 2
            if lo <= mid < hi:
                merged.append({
                    "lineNumber": 0,
                    "originalText": line["originalText"],
                    "translatedText": line.get("translatedText"),
                    "startTime": start,
                    "endTime": end,
                    "words": [{"text": w["text"], "start": w["start"] + off,
                               "end": w["end"] + off} for w in line["words"]],
                })
    merged.sort(key=lambda l: l["startTime"])
    for i, line in enumerate(merged):
        line["lineNumber"] = i + 1
    return merged


def merge_notes(chunk_pitches: list, overlap_seconds: float = OVERLAP_SECONDS) -> list:
    offsets = [p["chunkStartOffset"] for p in chunk_pitches]
    windows = _own_windows(offsets, overlap_seconds)
    merged = []
    for p, (lo, hi) in zip(chunk_pitches, windows):
        off = p["chunkStartOffset"]
        for note in p["notes"]:
            start, end = note["start"] + off, note["end"] + off
            if lo <= (start + end) / 2 < hi:
                merged.append({**note, "start": start, "end": end})
    merged.sort(key=lambda n: (n["start"], n["pitch"]))
    return merged


def build_midi(notes: list):
    import pretty_midi
    midi = pretty_midi.PrettyMIDI()
    instrument = pretty_midi.Instrument(program=0)
    for n in notes:
        instrument.notes.append(pretty_midi.Note(
            velocity=int(n.get("velocity", 0.8) * 127),
            pitch=n["pitch"], start=n["start"], end=n["end"]))
    midi.instruments.append(instrument)
    return midi


_S3 = None


def _s3():
    global _S3
    if _S3 is None:
        import boto3
        _S3 = boto3.client("s3")
    return _S3


def _key_of(prefix_uri: str, bucket: str, rest: str) -> str:
    return prefix_uri.split(f"s3://{bucket}/", 1)[1] + rest


def handler(event, context):
    import soundfile as sf

    song_id = event["songId"]
    bucket = event["bucket"]
    exec_name = event["execName"]

    manifest_key = f"songs/{song_id}/chunks/{exec_name}/manifest.json"
    manifest = json.loads(_s3().get_object(Bucket=bucket, Key=manifest_key)["Body"].read())
    items = manifest["chunks"]

    transcripts, pitches = [], []
    stem_arrays = {"vocals": [], "no_vocals": []}
    offsets_samples, sr = [], None

    for item in items:
        for name, target in (("transcript.json", transcripts), ("pitch.json", pitches)):
            key = _key_of(item["outputPrefix"], bucket, name)
            target.append(json.loads(_s3().get_object(Bucket=bucket, Key=key)["Body"].read()))
        for stem in stem_arrays:
            key = _key_of(item["outputPrefix"], bucket, f"stems/htdemucs/audio/{stem}.wav")
            local = f"/tmp/{stem}.wav"
            _s3().download_file(bucket, key, local)
            data, sr = sf.read(local)
            stem_arrays[stem].append(data)
        offsets_samples.append(int(item["chunkStartOffset"] * sr))

    total_samples = offsets_samples[-1] + len(stem_arrays["vocals"][-1])
    overlap_samples = int(OVERLAP_SECONDS * sr)

    lines = merge_lines(transcripts)
    notes = merge_notes(pitches)
    prefix = f"songs/{song_id}/stitched/{exec_name}/"

    def put_json(name, payload):
        _s3().put_object(Bucket=bucket, Key=prefix + name,
                         Body=json.dumps(payload, indent=2, ensure_ascii=False).encode("utf-8"),
                         ContentType="application/json")

    put_json("transcript.json", {"songId": song_id,
                                 "sourceLanguage": transcripts[0].get("sourceLanguage", "ro"),
                                 "chunkStartOffset": 0.0, "lines": lines})
    put_json("pitch.json", {"songId": song_id, "chunkStartOffset": 0.0, "notes": notes})

    build_midi(notes).write("/tmp/melody.mid")
    _s3().upload_file("/tmp/melody.mid", bucket, prefix + "melody.mid")

    for stem, arrays in stem_arrays.items():
        stitched = stitch_audio(arrays, offsets_samples, total_samples, overlap_samples)
        sf.write("/tmp/stitched.wav", stitched, sr, subtype="PCM_16")
        _s3().upload_file("/tmp/stitched.wav", bucket,
                          prefix + f"stems/htdemucs/input_song/{stem}.wav")

    print(f"stitched {len(items)} chunks: {len(lines)} lines, {len(notes)} notes")
    return {"stitchedPrefix": prefix, "transcriptKey": prefix + "transcript.json",
            "lineCount": len(lines), "noteCount": len(notes)}
