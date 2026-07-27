"""LyraLearn core API Lambda (Phase 3.2): the four Python routes of the
section 5.2 contract, behind the HTTP API's Cognito JWT authorizer.

Thin read/proxy layer (architecture.md section 3): DynamoDB item reads/writes,
S3 pre-signing, S3 lyrics proxy. Lyrics are S3-backed until Phase 3.5 moves
them to MongoDB (user decision 2026-07-27) - the response body is the same
section 6.2 doc either way.

jobId is the opaque composite "{songId}.{jobKey}" because jobs are keyed
SONG#{songId}/JOB#{jobKey} (section 6.1); split on the LAST dot.
"""
import datetime
import json
import os
import uuid

BUCKET = os.environ.get("AUDIO_BUCKET", "")
TABLE = os.environ.get("TABLE_NAME", "LyraLearnTable")
URL_TTL_SECONDS = 900  # section 5.2: 15-minute TTL

_DDB = None
_S3 = None


def _ddb():
    global _DDB
    if _DDB is None:
        import boto3
        _DDB = boto3.client("dynamodb")
    return _DDB


def _s3():
    global _S3
    if _S3 is None:
        import boto3
        from botocore.client import Config
        # SigV4 explicitly: the default can emit legacy SigV2 presigned URLs
        _S3 = boto3.client("s3", config=Config(signature_version="s3v4"))
    return _S3


def _resp(status, payload):
    return {"statusCode": status, "headers": {"Content-Type": "application/json"},
            "body": json.dumps(payload, ensure_ascii=False)}


def post_songs(event, claims):
    body = json.loads(event.get("body") or "{}")
    song_id = uuid.uuid4().hex[:12]
    created = datetime.datetime.now(datetime.timezone.utc).isoformat()
    user = claims.get("sub", "unknown")
    raw_key = f"songs/{song_id}/raw/input.mp3"
    _ddb().put_item(TableName=TABLE, Item={
        "PK": {"S": f"SONG#{song_id}"}, "SK": {"S": "METADATA"},
        "title": {"S": body.get("title", "")}, "artist": {"S": body.get("artist", "")},
        "uploadedBy": {"S": user}, "status": {"S": "AWAITING_UPLOAD"},
        "createdAt": {"S": created},
        "GSI1PK": {"S": f"USER#{user}"}, "GSI1SK": {"S": created},
        "audioKeys": {"M": {"raw": {"S": raw_key}}},
    })
    url = _s3().generate_presigned_url(
        "put_object", Params={"Bucket": BUCKET, "Key": raw_key}, ExpiresIn=URL_TTL_SECONDS)
    return _resp(201, {"songId": song_id, "uploadUrl": url})


def get_job(event, claims):
    composite = event["pathParameters"]["id"]
    if "." not in composite:
        return _resp(400, {"error": "jobId format is {songId}.{jobKey}"})
    song_id, job_key = composite.rsplit(".", 1)
    got = _ddb().get_item(TableName=TABLE, Key={
        "PK": {"S": f"SONG#{song_id}"}, "SK": {"S": f"JOB#{job_key}"}})
    item = got.get("Item")
    if not item:
        return _resp(404, {"error": "job not found"})
    out = {"jobId": composite, "songId": song_id, "status": item["status"]["S"]}
    if "stage" in item:
        out["stage"] = item["stage"]["S"]
    if "chunkCount" in item:
        out["chunkCount"] = int(item["chunkCount"]["N"])
    if "errorInfo" in item:
        out["error"] = item["errorInfo"]["S"][:500]
    return _resp(200, out)


def get_lyrics(event, claims):
    song_id = event["pathParameters"]["id"]
    try:
        obj = _s3().get_object(Bucket=BUCKET, Key=f"songs/{song_id}/lyrics/song_lyrics.json")
    except _s3().exceptions.NoSuchKey:
        return _resp(404, {"error": "lyrics not available"})
    return {"statusCode": 200, "headers": {"Content-Type": "application/json"},
            "body": obj["Body"].read().decode("utf-8")}


def get_audio_urls(event, claims):
    song_id = event["pathParameters"]["id"]
    got = _ddb().get_item(TableName=TABLE, Key={
        "PK": {"S": f"SONG#{song_id}"}, "SK": {"S": "METADATA"}})
    item = got.get("Item")
    if not item:
        return _resp(404, {"error": "song not found"})
    keys = item.get("audioKeys", {}).get("M", {})
    urls = {name: _s3().generate_presigned_url(
        "get_object", Params={"Bucket": BUCKET, "Key": ref["S"]}, ExpiresIn=URL_TTL_SECONDS)
        for name, ref in keys.items()}
    return _resp(200, {"urls": urls, "expiresInSeconds": URL_TTL_SECONDS})


ROUTES = {
    "POST /songs": post_songs,
    "GET /jobs/{id}": get_job,
    "GET /songs/{id}/lyrics": get_lyrics,
    "GET /songs/{id}/audio-urls": get_audio_urls,
}


def handler(event, context):
    claims = (event.get("requestContext", {}).get("authorizer", {})
              .get("jwt", {}).get("claims", {}))
    fn = ROUTES.get(event.get("routeKey", ""))
    if fn is None:
        return _resp(404, {"error": "route not found"})
    return fn(event, claims)
