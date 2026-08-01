"""LyraLearn core API Lambda (Phase 3.2): the four Python routes of the
section 5.2 contract, behind the HTTP API's Cognito JWT authorizer.

Thin read/proxy layer (architecture.md section 3): DynamoDB item reads/writes,
S3 pre-signing, S3 lyrics proxy. Phase 3.5: lyrics are Mongo-primary with an
S3 fallback (user decision 2026-07-27) - the response body is the same
section 6.2 doc either way; the `X-Lyrics-Source` header says which store
served it.

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

MONGODB_SECRET_ARN = os.environ.get("MONGODB_SECRET_ARN", "")
MONGO_DB, MONGO_COLLECTION = "lyralearn", "lyrics"

_DDB = None
_S3 = None
_MONGO = None


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


def _mongo():
    global _MONGO
    if _MONGO is None:
        import boto3
        from pymongo import MongoClient
        uri = boto3.client("secretsmanager").get_secret_value(
            SecretId=MONGODB_SECRET_ARN)["SecretString"]
        _MONGO = MongoClient(uri, serverSelectionTimeoutMS=5000,
                             connectTimeoutMS=5000, maxPoolSize=5)
    return _MONGO


def _resp(status, payload):
    return {"statusCode": status, "headers": {"Content-Type": "application/json"},
            "body": json.dumps(payload, ensure_ascii=False)}


# Anonymous uploads trigger paid GPU processing; a per-IP daily counter caps
# the worst case (signed-in uploads are attributable and exempt). Item:
# RATE#{ip}/DAY#{yyyymmdd}, expiresAt TTL two days out so counters self-clean.
ANON_DAILY_UPLOAD_LIMIT = 10


def _anon_over_quota(event):
    ip = (event.get("requestContext", {}).get("http", {}) or {}).get("sourceIp", "unknown")
    now = datetime.datetime.now(datetime.timezone.utc)
    resp = _ddb().update_item(
        TableName=TABLE,
        Key={"PK": {"S": f"RATE#{ip}"}, "SK": {"S": f"DAY#{now:%Y%m%d}"}},
        UpdateExpression="ADD uploads :one SET expiresAt = :ttl",
        ExpressionAttributeValues={
            ":one": {"N": "1"},
            ":ttl": {"N": str(int(now.timestamp()) + 2 * 86400)},
        },
        ReturnValues="ALL_NEW")
    return int(resp["Attributes"]["uploads"]["N"]) > ANON_DAILY_UPLOAD_LIMIT


def post_songs(event, claims):
    body = json.loads(event.get("body") or "{}")
    song_id = uuid.uuid4().hex[:12]
    created = datetime.datetime.now(datetime.timezone.utc).isoformat()
    # Public route (Phase 7): uploads need no account. Signed-in users still
    # arrive with claims via the frontend's optional auth header.
    user = claims.get("sub", "anonymous")
    if user == "anonymous" and _anon_over_quota(event):
        return _resp(429, {"error": "Daily upload limit reached — sign in or try again tomorrow."})
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


def _lyrics_response(body, source):
    return {"statusCode": 200,
            "headers": {"Content-Type": "application/json", "X-Lyrics-Source": source},
            "body": body}


def get_lyrics(event, claims):
    song_id = event["pathParameters"]["id"]
    # Phase 3.5: Mongo primary, S3 fallback (logged). Same section 6.2 body
    # either way; X-Lyrics-Source says which store served it.
    if MONGODB_SECRET_ARN:
        try:
            doc = _mongo()[MONGO_DB][MONGO_COLLECTION].find_one(
                {"songId": song_id}, {"_id": 0})
            if doc is not None:
                return _lyrics_response(json.dumps(doc, ensure_ascii=False), "mongo")
            print(f"MONGO MISS for {song_id}, falling back to S3")
        except Exception as e:  # noqa: BLE001 - availability over strictness here
            print(f"MONGO READ FAILED for {song_id}, falling back to S3: {e!r}")
    try:
        obj = _s3().get_object(Bucket=BUCKET, Key=f"songs/{song_id}/lyrics/song_lyrics.json")
    except _s3().exceptions.ClientError:
        # Without s3:ListBucket, a GET on a missing key surfaces as AccessDenied,
        # not NoSuchKey - both mean the same thing to the caller: no lyrics yet.
        return _resp(404, {"error": "lyrics not available"})
    return _lyrics_response(obj["Body"].read().decode("utf-8"), "s3-fallback")


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


# Statuses that never belong in the public catalog: not-yet-uploaded shells,
# rejected files, and LINKED duplicates (the canonical original is already
# listed - fingerprint dedup is what keeps the shared library duplicate-free).
CATALOG_HIDDEN_STATUSES = {"AWAITING_UPLOAD", "REJECTED", "LINKED", "ARCHIVED"}


def get_songs(event, claims):
    """Public site-wide song catalog, newest first (Phase 7 shared library).

    A paginated Scan is deliberate at the current catalog size; revisit with a
    static-PK GSI ("all songs by createdAt") if the table outgrows it.
    """
    items = []
    kwargs = {"TableName": TABLE,
              "FilterExpression": "SK = :m",
              "ExpressionAttributeValues": {":m": {"S": "METADATA"}}}
    while True:
        page = _ddb().scan(**kwargs)
        items.extend(page.get("Items", []))
        if "LastEvaluatedKey" not in page:
            break
        kwargs["ExclusiveStartKey"] = page["LastEvaluatedKey"]
    songs = [{
        "songId": it["PK"]["S"].removeprefix("SONG#"),
        "title": it.get("title", {}).get("S", ""),
        "artist": it.get("artist", {}).get("S", ""),
        "status": it.get("status", {}).get("S", ""),
        "createdAt": it.get("createdAt", {}).get("S", ""),
        "sourceLanguage": it["sourceLanguage"]["S"] if "sourceLanguage" in it else None,
    } for it in items if it.get("status", {}).get("S") not in CATALOG_HIDDEN_STATUSES]
    songs.sort(key=lambda s: s["createdAt"], reverse=True)
    return _resp(200, {"songs": songs})


ROUTES = {
    "POST /songs": post_songs,
    "GET /songs": get_songs,
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
