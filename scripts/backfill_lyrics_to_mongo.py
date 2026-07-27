"""Phase 3.5: backfill pre-existing S3 lyrics docs into MongoDB Atlas.

S3 stays the write of record; this copies every songs/{id}/lyrics/
song_lyrics.json into lyralearn.lyrics (upsert on songId) and creates the
unique songId index. Idempotent - safe to rerun any time (also reconciles
any songs whose best-effort dual-write failed).

Usage: [MONGODB_URI=...] AWS_REGION=us-east-1 BUCKET=lyralearn-audio-503233513399 \
       python scripts/backfill_lyrics_to_mongo.py
"""
import json
import os
import re
import sys

LYRICS_RE = re.compile(r"^songs/[^/]+/lyrics/song_lyrics\.json$")


def is_lyrics_key(key: str) -> bool:
    return bool(LYRICS_RE.match(key))


def backfill(s3, coll, bucket: str) -> tuple[int, int]:
    coll.create_index("songId", unique=True)  # idempotent
    done = skipped = 0
    for page in s3.get_paginator("list_objects_v2").paginate(Bucket=bucket, Prefix="songs/"):
        for obj in page.get("Contents", []):
            key = obj["Key"]
            if not is_lyrics_key(key):
                continue
            doc = json.loads(s3.get_object(Bucket=bucket, Key=key)["Body"].read())
            if "songId" not in doc:
                print(f"SKIP {key}: no songId field")
                skipped += 1
                continue
            coll.replace_one({"songId": doc["songId"]}, doc, upsert=True)
            print(f"backfilled {doc['songId']} <- {key}")
            done += 1
    return done, skipped


def mongo_uri() -> str:
    uri = os.environ.get("MONGODB_URI")
    if uri:
        return uri
    import boto3
    sm = boto3.client("secretsmanager", region_name=os.environ.get("AWS_REGION", "us-east-1"))
    return sm.get_secret_value(
        SecretId=os.environ.get("MONGODB_SECRET_ID", "lyralearn/mongodb"))["SecretString"]


def main() -> int:
    import boto3
    from pymongo import MongoClient
    bucket = os.environ["BUCKET"]
    s3 = boto3.client("s3", region_name=os.environ.get("AWS_REGION", "us-east-1"))
    coll = MongoClient(mongo_uri(), serverSelectionTimeoutMS=10000)["lyralearn"]["lyrics"]
    done, skipped = backfill(s3, coll, bucket)
    print(f"backfill complete: {done} upserted, {skipped} skipped, "
          f"{coll.count_documents({})} docs total in lyralearn.lyrics")
    return 0


if __name__ == "__main__":
    sys.exit(main())
