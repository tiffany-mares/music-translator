"""RunTranslation Lambda (Phase 2.3): transcript.json in S3 -> translated
section 6.2 song_lyrics.json in S3.

Runs as a container-image Lambda with the MarianMT ROMANCE-en model baked
into the image at /opt/model (same weight-baking lesson as Phase 2.2 - no
Hub download at invoke time). Reuses stages/translate.py's translate_lines
verbatim; the model is loaded once per execution environment and reused
across warm invokes.

Lyrics land in S3 only at this phase - the MongoDB Atlas write is the Phase 3
API layer's concern (user decision, 2026-07-27).
"""
import json
import os

import boto3
from transformers import MarianMTModel, MarianTokenizer

from stages.translate import translate_lines

MODEL_DIR = os.environ.get("TRANSLATE_MODEL_DIR", "/opt/model")

_S3 = None
_TRANSLATOR = None


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
    return {"lyricsKey": lyrics_key, "lineCount": len(lines)}
