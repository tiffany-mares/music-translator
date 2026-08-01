"""Phase 7 (lovable-reskin): backfill sourceLanguage/targetLanguage onto
DynamoDB METADATA items from the MongoDB lyrics docs.

The public catalog (GET /songs) reads language off METADATA for its filter;
songs completed before the translate lambda started threading it need this
one-off copy. Idempotent - safe to rerun (it just re-SETs the same values).

Usage: [MONGODB_URI=...] AWS_REGION=us-east-1 [TABLE_NAME=LyraLearnTable] \
       python scripts/backfill_source_language.py
MONGODB_URI falls back to the lyralearn/mongodb secret via Secrets Manager.
"""
import os
import sys


def backfill(coll, ddb, table: str) -> tuple[int, int]:
    done = skipped = 0
    for doc in coll.find({}, {"songId": 1, "sourceLanguage": 1, "targetLanguage": 1}):
        song_id = doc.get("songId")
        source = doc.get("sourceLanguage")
        if not song_id or not source:
            print(f"SKIP {song_id or '<no songId>'}: no sourceLanguage in doc")
            skipped += 1
            continue
        values = {":sl": {"S": source}}
        expr = "SET sourceLanguage = :sl"
        if doc.get("targetLanguage"):
            expr += ", targetLanguage = :tl"
            values[":tl"] = {"S": doc["targetLanguage"]}
        ddb.update_item(
            TableName=table,
            Key={"PK": {"S": f"SONG#{song_id}"}, "SK": {"S": "METADATA"}},
            # Only touch items that actually exist - never create shells.
            ConditionExpression="attribute_exists(PK)",
            UpdateExpression=expr,
            ExpressionAttributeValues=values,
        )
        print(f"backfilled {song_id}: {source}")
        done += 1
    return done, skipped


def main() -> int:
    import boto3
    from pymongo import MongoClient

    uri = os.environ.get("MONGODB_URI")
    if not uri:
        uri = boto3.client("secretsmanager").get_secret_value(
            SecretId="lyralearn/mongodb")["SecretString"]
    coll = MongoClient(uri, serverSelectionTimeoutMS=5000)["lyralearn"]["lyrics"]
    ddb = boto3.client("dynamodb")
    table = os.environ.get("TABLE_NAME", "LyraLearnTable")

    done, skipped = backfill(coll, ddb, table)
    print(f"done: {done} backfilled, {skipped} skipped")
    return 0 if done or not skipped else 1


if __name__ == "__main__":
    sys.exit(main())
