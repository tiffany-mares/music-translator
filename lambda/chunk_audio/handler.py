"""ChunkAudio Lambda (Phase 2.4): split the raw song into overlapping chunks.

Decodes the mp3 with soundfile (libsndfile >= 1.1 reads mp3; sample-accurate
slicing, no ffmpeg), writes one WAV per chunk plus a manifest.json to S3, and
returns the chunk list the Step Functions Map state fans out over.

Chunk length / overlap follow architecture.md section 4 (~40 s, 2-3 s overlap);
OVERLAP_SECONDS is section 11's open tuning knob. The math guarantees the tail
chunk is always longer than the overlap (stride = chunk - overlap), so no
tiny-tail merging is needed.

Job names are precomputed here as lyralearn-sfn-{execName}-{chunkId}: they must
match the SFN role's sagemaker resource prefix, and they must NOT be derived
inside a Retry-ing task (see notes/phase2.md section 2.3 - retries self-collide
on deterministic names, so the chunk task has no Retry).
"""
import json
import os
from pathlib import Path

import boto3
import soundfile as sf

CHUNK_SECONDS = 40.0
OVERLAP_SECONDS = 2.5

_S3 = None


def _s3():
    global _S3
    if _S3 is None:
        _S3 = boto3.client("s3")
    return _S3


def compute_chunks(duration_seconds: float, chunk_seconds: float = CHUNK_SECONDS,
                   overlap_seconds: float = OVERLAP_SECONDS) -> list[dict]:
    stride = chunk_seconds - overlap_seconds
    chunks, start = [], 0.0
    while start + chunk_seconds < duration_seconds:
        chunks.append({"chunkId": f"chunk-{len(chunks):03d}", "start": start,
                       "length": chunk_seconds})
        start += stride
    # tail is in (overlap, chunk]: the loop only advances while a full chunk fits
    chunks.append({"chunkId": f"chunk-{len(chunks):03d}", "start": start,
                   "length": round(duration_seconds - start, 6)})
    return chunks


def build_manifest_items(chunks: list[dict], song_id: str, bucket: str,
                         exec_name: str) -> list[dict]:
    items = []
    for c in chunks:
        items.append({
            "chunkId": c["chunkId"],
            "songId": song_id,
            "jobName": f"lyralearn-sfn-{exec_name}-{c['chunkId']}",
            "inputPrefix": f"s3://{bucket}/songs/{song_id}/chunks/{exec_name}/{c['chunkId']}/",
            "outputPrefix": f"s3://{bucket}/songs/{song_id}/ml-output/{exec_name}/{c['chunkId']}/",
            "chunkStartOffset": c["start"],
            "chunkLengthSeconds": c["length"],
        })
    return items


def _find_raw_key(bucket: str, song_id: str) -> str:
    resp = _s3().list_objects_v2(Bucket=bucket, Prefix=f"songs/{song_id}/raw/")
    keys = [o["Key"] for o in resp.get("Contents", []) if not o["Key"].endswith("/")]
    if not keys:
        raise FileNotFoundError(f"no raw audio under songs/{song_id}/raw/")
    return sorted(keys)[0]


def handler(event, context):
    song_id = event["songId"]
    bucket = event["bucket"]
    exec_name = event["execName"]

    raw_key = _find_raw_key(bucket, song_id)
    local = "/tmp/input" + Path(raw_key).suffix
    _s3().download_file(bucket, raw_key, local)

    data, sr = sf.read(local)
    duration = len(data) / sr
    chunks = compute_chunks(duration)
    items = build_manifest_items(chunks, song_id, bucket, exec_name)

    for c, item in zip(chunks, items):
        lo = int(c["start"] * sr)
        hi = min(int((c["start"] + c["length"]) * sr), len(data))
        sf.write("/tmp/chunk.wav", data[lo:hi], sr, subtype="PCM_16")
        # inputPrefix is "s3://{bucket}/{key-prefix}/"; strip scheme+bucket for the key
        key = item["inputPrefix"].split(f"s3://{bucket}/", 1)[1] + "audio.wav"
        _s3().upload_file("/tmp/chunk.wav", bucket, key)

    result = {"chunkCount": len(items), "songDurationSeconds": duration, "chunks": items}
    _s3().put_object(
        Bucket=bucket,
        Key=f"songs/{song_id}/chunks/{exec_name}/manifest.json",
        Body=json.dumps(result, indent=2).encode("utf-8"),
        ContentType="application/json",
    )
    print(f"chunked {song_id} ({duration:.1f}s) into {len(items)} chunks for {exec_name}")
    return result
