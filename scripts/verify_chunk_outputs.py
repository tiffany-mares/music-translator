"""Phase 2.4 done-when gate: did all chunks complete and land in S3 with
correct chunk_start_offset metadata?

Usage: python scripts/verify_chunk_outputs.py <bucket> <songId> <execName>
Reads songs/{songId}/chunks/{execName}/manifest.json, then every chunk's
transcript.json/pitch.json under songs/{songId}/ml-output/{execName}/{chunkId}/.
"""
import json
import sys

CHUNK_SECONDS = 40.0
OVERLAP_SECONDS = 2.5
EPS = 1e-3


def check_manifest(manifest: dict) -> list[str]:
    problems = []
    chunks = manifest["chunks"]
    if len(chunks) != manifest["chunkCount"]:
        problems.append(f"chunkCount {manifest['chunkCount']} != len(chunks) {len(chunks)}")
    stride = CHUNK_SECONDS - OVERLAP_SECONDS
    for i, c in enumerate(chunks):
        expected = i * stride
        if abs(c["chunkStartOffset"] - expected) > EPS:
            problems.append(f"{c['chunkId']}: stride broken - offset {c['chunkStartOffset']} != {expected}")
    last = chunks[-1]
    end = last["chunkStartOffset"] + last["chunkLengthSeconds"]
    if abs(end - manifest["songDurationSeconds"]) > EPS:
        problems.append(f"coverage: chunks end at {end:.3f}s but song is "
                        f"{manifest['songDurationSeconds']:.3f}s")
    return problems


def check_chunk_meta(item: dict, transcript: dict, pitch: dict) -> list[str]:
    problems = []
    if abs(transcript.get("chunkStartOffset", -1) - item["chunkStartOffset"]) > EPS:
        problems.append(f"{item['chunkId']}: transcript offset {transcript.get('chunkStartOffset')} "
                        f"!= manifest {item['chunkStartOffset']}")
    if abs(pitch.get("chunkStartOffset", -1) - item["chunkStartOffset"]) > EPS:
        problems.append(f"{item['chunkId']}: pitch offset {pitch.get('chunkStartOffset')} "
                        f"!= manifest {item['chunkStartOffset']}")
    return problems


def main() -> int:
    import boto3
    bucket, song_id, exec_name = sys.argv[1], sys.argv[2], sys.argv[3]
    s3 = boto3.client("s3")

    def get_json(key):
        return json.loads(s3.get_object(Bucket=bucket, Key=key)["Body"].read())

    manifest = get_json(f"songs/{song_id}/chunks/{exec_name}/manifest.json")
    problems = check_manifest(manifest)

    for item in manifest["chunks"]:
        prefix = f"songs/{song_id}/ml-output/{exec_name}/{item['chunkId']}"
        try:
            transcript = get_json(f"{prefix}/transcript.json")
            pitch = get_json(f"{prefix}/pitch.json")
        except s3.exceptions.NoSuchKey:
            problems.append(f"{item['chunkId']}: output missing under {prefix}/")
            continue
        problems += check_chunk_meta(item, transcript, pitch)
        print(f"  {item['chunkId']}: offset {item['chunkStartOffset']:>6.1f}s, "
              f"{len(transcript['lines'])} lines, {len(pitch['notes'])} notes")

    if problems:
        print("FAIL - Phase 2.4 done-when NOT met:")
        for p in problems:
            print(f"  - {p}")
        return 1
    print(f"PASS - all {manifest['chunkCount']} chunks complete with correct chunk_start_offset metadata.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
