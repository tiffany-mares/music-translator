"""RunTranslation Lambda (Phase 2.3): transcript.json in S3 -> translated
section 6.2 song_lyrics.json in S3.

Runs as a container-image Lambda with the MarianMT ROMANCE-en model baked
into the image at /opt/model (same weight-baking lesson as Phase 2.2 - no
Hub download at invoke time). Reuses stages/translate.py's translate_lines
verbatim; the model is loaded once per execution environment and reused
across warm invokes.

Phase 3.5: after the S3 write of record, this handler also best-effort
dual-writes the same section 6.2 doc to MongoDB Atlas (user decision,
2026-07-27) so the API Lambda's lyrics route can go Mongo-primary. S3 stays
authoritative - a Mongo failure here is logged and swallowed, never raised.
"""
import json
import os

import boto3
from transformers import MarianMTModel, MarianTokenizer

from stages.translate import translate_lines

MODEL_DIR = os.environ.get("TRANSLATE_MODEL_DIR", "/opt/model")
MONGODB_SECRET_ARN = os.environ.get("MONGODB_SECRET_ARN", "")
MONGO_DB, MONGO_COLLECTION = "lyralearn", "lyrics"

_S3 = None
_TRANSLATOR = None
_MONGO = None


def _s3():
    global _S3
    if _S3 is None:
        _S3 = boto3.client("s3")
    return _S3


def _translator():
    global _TRANSLATOR
    if _TRANSLATOR is None:
        _TRANSLATOR = (
            MarianTokenizer.from_pretrained(MODEL_DIR),
            MarianMTModel.from_pretrained(MODEL_DIR),
        )
    return _TRANSLATOR


def _mongo():
    """MongoClient cached across warm invokes; the secret is read once at
    first use (cold start) per architecture.md section 9."""
    global _MONGO
    if _MONGO is None:
        from pymongo import MongoClient
        uri = boto3.client("secretsmanager").get_secret_value(
            SecretId=MONGODB_SECRET_ARN)["SecretString"]
        _MONGO = MongoClient(uri, serverSelectionTimeoutMS=5000,
                             connectTimeoutMS=5000, maxPoolSize=5)
    return _MONGO


def _mongo_upsert(doc):
    """Best-effort dual-write (Phase 3.5). S3 stays the write of record: a
    Mongo failure logs LOUDLY and returns False - it must never fail the
    pipeline; the backfill script reconciles later."""
    if not MONGODB_SECRET_ARN:
        print("MONGO DUAL-WRITE SKIPPED: MONGODB_SECRET_ARN not set")
        return False
    try:
        _mongo()[MONGO_DB][MONGO_COLLECTION].replace_one(
            {"songId": doc["songId"]}, doc, upsert=True)
        return True
    except Exception as e:  # noqa: BLE001 - best-effort by design
        print(f"MONGO DUAL-WRITE FAILED for {doc.get('songId')} "
              f"(S3 copy intact, backfill later): {e!r}")
        return False


def handler(event, context):
    song_id = event["songId"]
    bucket = event["bucket"]
    transcript_key = event["transcriptKey"]

    body = _s3().get_object(Bucket=bucket, Key=transcript_key)["Body"].read()
    transcript = json.loads(body)

    tokenizer, model = _translator()
    lines = translate_lines(transcript["lines"], tokenizer, model)

    doc = {
        "songId": song_id,
        "sourceLanguage": transcript.get("sourceLanguage", "ro"),
        "targetLanguage": "en",
        "lines": lines,
    }
    lyrics_key = f"songs/{song_id}/lyrics/song_lyrics.json"
    _s3().put_object(
        Bucket=bucket,
        Key=lyrics_key,
        Body=json.dumps(doc, ensure_ascii=False).encode("utf-8"),
        ContentType="application/json",
    )
    _mongo_upsert(doc)
    return {"lyricsKey": lyrics_key, "lineCount": len(lines)}
