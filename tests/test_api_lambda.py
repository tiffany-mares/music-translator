"""API Lambda router: the four section 5.2 Python routes (Phase 3.2)."""
import importlib.util
import io
import json
from pathlib import Path

_SPEC = importlib.util.spec_from_file_location(
    "api_handler", Path(__file__).resolve().parents[1] / "lambda" / "api" / "handler.py"
)
api = importlib.util.module_from_spec(_SPEC)
_SPEC.loader.exec_module(api)


class FakeDdb:
    def __init__(self, items=None):
        self.items = items or {}
        self.put_calls = []

    def put_item(self, TableName, Item):
        self.put_calls.append(Item)
        return {}

    def get_item(self, TableName, Key):
        k = (Key["PK"]["S"], Key["SK"]["S"])
        return {"Item": self.items[k]} if k in self.items else {}


class FakeS3:
    class exceptions:
        class NoSuchKey(Exception):
            pass

    def __init__(self, objects=None):
        self.objects = objects or {}

    def generate_presigned_url(self, op, Params, ExpiresIn):
        return f"https://signed.example/{op}/{Params['Key']}?X-Amz-Signature=fake&ttl={ExpiresIn}"

    def get_object(self, Bucket, Key):
        if Key not in self.objects:
            raise FakeS3.exceptions.NoSuchKey()
        return {"Body": io.BytesIO(self.objects[Key].encode("utf-8"))}


def _event(route_key, path_id=None, body=None, sub="user-abc"):
    ev = {"routeKey": route_key,
          "requestContext": {"authorizer": {"jwt": {"claims": {"sub": sub}}}}}
    if path_id is not None:
        ev["pathParameters"] = {"id": path_id}
    if body is not None:
        ev["body"] = json.dumps(body)
    return ev


def _wire(monkeypatch, ddb=None, s3=None):
    monkeypatch.setattr(api, "_ddb", lambda: ddb or FakeDdb())
    monkeypatch.setattr(api, "_s3", lambda: s3 or FakeS3())
    monkeypatch.setattr(api, "BUCKET", "test-bucket")


def test_post_songs_creates_item_and_returns_upload_url(monkeypatch):
    ddb = FakeDdb()
    _wire(monkeypatch, ddb=ddb)
    resp = api.handler(_event("POST /songs", body={"title": "Emotii", "artist": "3 Sud Est"}), None)
    assert resp["statusCode"] == 201
    out = json.loads(resp["body"])
    assert len(out["songId"]) == 12
    assert "X-Amz-Signature" in out["uploadUrl"]
    item = ddb.put_calls[0]
    assert item["SK"]["S"] == "METADATA"
    assert item["status"]["S"] == "AWAITING_UPLOAD"
    assert item["GSI1PK"]["S"] == "USER#user-abc"
    assert item["audioKeys"]["M"]["raw"]["S"].endswith("/raw/input.mp3")


def test_get_job_parses_composite_id(monkeypatch):
    items = {("SONG#s1", "JOB#job-9"): {"status": {"S": "COMPLETE"}, "chunkCount": {"N": "6"},
                                        "stage": {"S": "ChunkAudio"}}}
    _wire(monkeypatch, ddb=FakeDdb(items))
    resp = api.handler(_event("GET /jobs/{id}", path_id="s1.job-9"), None)
    out = json.loads(resp["body"])
    assert (resp["statusCode"], out["status"], out["chunkCount"]) == (200, "COMPLETE", 6)
    assert out["songId"] == "s1"


def test_get_job_bad_format_and_missing(monkeypatch):
    _wire(monkeypatch)
    assert api.handler(_event("GET /jobs/{id}", path_id="nodots"), None)["statusCode"] == 400
    assert api.handler(_event("GET /jobs/{id}", path_id="s1.gone"), None)["statusCode"] == 404


def test_get_lyrics_proxies_s3_doc(monkeypatch):
    doc = json.dumps({"songId": "s1", "lines": [{"originalText": "Și te rog"}]}, ensure_ascii=False)
    s3 = FakeS3({"songs/s1/lyrics/song_lyrics.json": doc})
    _wire(monkeypatch, s3=s3)
    resp = api.handler(_event("GET /songs/{id}/lyrics", path_id="s1"), None)
    assert resp["statusCode"] == 200
    assert json.loads(resp["body"])["lines"][0]["originalText"] == "Și te rog"
    assert api.handler(_event("GET /songs/{id}/lyrics", path_id="missing"), None)["statusCode"] == 404


def test_get_audio_urls_presigns_each_key(monkeypatch):
    items = {("SONG#s1", "METADATA"): {"audioKeys": {"M": {
        "raw": {"S": "songs/s1/raw/input.mp3"},
        "vocals": {"S": "songs/s1/stems/vocals.wav"}}}}}
    _wire(monkeypatch, ddb=FakeDdb(items))
    resp = api.handler(_event("GET /songs/{id}/audio-urls", path_id="s1"), None)
    out = json.loads(resp["body"])
    assert resp["statusCode"] == 200
    assert out["expiresInSeconds"] == 900
    assert set(out["urls"]) == {"raw", "vocals"}
    assert "X-Amz-Signature" in out["urls"]["raw"]


def test_unknown_route_404(monkeypatch):
    _wire(monkeypatch)
    assert api.handler({"routeKey": "GET /nope", "requestContext": {}}, None)["statusCode"] == 404
