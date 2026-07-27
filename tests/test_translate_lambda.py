"""RunTranslation Lambda handler: S3 in -> translated section 6.2 doc -> S3 out."""
import importlib.util
import io
import json
from pathlib import Path

_SPEC = importlib.util.spec_from_file_location(
    "translate_handler", Path(__file__).resolve().parents[1] / "lambda" / "translate" / "handler.py"
)
handler_mod = importlib.util.module_from_spec(_SPEC)
_SPEC.loader.exec_module(handler_mod)


class FakeS3:
    def __init__(self, transcript: dict):
        self._transcript = transcript
        self.put_calls = []

    def get_object(self, Bucket, Key):
        return {"Body": io.BytesIO(json.dumps(self._transcript, ensure_ascii=False).encode("utf-8"))}

    def put_object(self, **kwargs):
        self.put_calls.append(kwargs)
        return {}


def _fake_translate_lines(lines, tokenizer, model):
    for line in lines:
        line["translatedText"] = f"EN:{line['originalText']}"
    return lines


def _transcript():
    return {"songId": "test-song-001", "sourceLanguage": "ro",
            "lines": [{"lineNumber": 1, "originalText": "Noapte bună", "translatedText": None,
                       "startTime": 0.0, "endTime": 1.0,
                       "words": [{"text": "Noapte", "start": 0.0, "end": 0.5}]}]}


def _wire(monkeypatch, fake_s3):
    monkeypatch.setattr(handler_mod, "_s3", lambda: fake_s3)
    monkeypatch.setattr(handler_mod, "_translator", lambda: (None, None))
    monkeypatch.setattr(handler_mod, "translate_lines", _fake_translate_lines)


def test_handler_writes_section_6_2_doc_and_returns_key(monkeypatch):
    fake_s3 = FakeS3(_transcript())
    _wire(monkeypatch, fake_s3)

    result = handler_mod.handler(
        {"songId": "test-song-001", "bucket": "b", "transcriptKey": "songs/test-song-001/ml-output/x/transcript.json"},
        None,
    )

    assert result == {"lyricsKey": "songs/test-song-001/lyrics/song_lyrics.json", "lineCount": 1}
    put = fake_s3.put_calls[0]
    assert put["Bucket"] == "b"
    assert put["Key"] == "songs/test-song-001/lyrics/song_lyrics.json"
    doc = json.loads(put["Body"].decode("utf-8"))
    assert doc["songId"] == "test-song-001"
    assert doc["sourceLanguage"] == "ro"
    assert doc["targetLanguage"] == "en"
    assert doc["lines"][0]["translatedText"] == "EN:Noapte bună"
    assert doc["lines"][0]["words"][0]["text"] == "Noapte"


def test_handler_preserves_diacritics_unescaped(monkeypatch):
    fake_s3 = FakeS3(_transcript())
    _wire(monkeypatch, fake_s3)
    handler_mod.handler({"songId": "s", "bucket": "b", "transcriptKey": "k"}, None)
    assert "Noapte bună".encode("utf-8") in fake_s3.put_calls[0]["Body"]


def test_handler_requires_event_keys(monkeypatch):
    _wire(monkeypatch, FakeS3(_transcript()))
    try:
        handler_mod.handler({"songId": "s"}, None)
        assert False, "expected KeyError"
    except KeyError:
        pass


class FakeCollection:
    def __init__(self, fail=False):
        self.fail = fail
        self.calls = []

    def replace_one(self, flt, doc, upsert=False):
        if self.fail:
            raise RuntimeError("atlas down")
        self.calls.append((flt, doc, upsert))


def _wire_mongo(monkeypatch, coll):
    monkeypatch.setattr(handler_mod, "MONGODB_SECRET_ARN", "arn:fake")
    monkeypatch.setattr(handler_mod, "_mongo",
                        lambda: {handler_mod.MONGO_DB: {handler_mod.MONGO_COLLECTION: coll}})


def test_dual_write_upserts_the_same_6_2_doc_keyed_on_song_id(monkeypatch):
    fake_s3 = FakeS3(_transcript())
    _wire(monkeypatch, fake_s3)
    coll = FakeCollection()
    _wire_mongo(monkeypatch, coll)
    result = handler_mod.handler(
        {"songId": "test-song-001", "bucket": "b", "transcriptKey": "k"}, None)
    assert result == {"lyricsKey": "songs/test-song-001/lyrics/song_lyrics.json", "lineCount": 1}
    (flt, doc, upsert), = coll.calls
    assert flt == {"songId": "test-song-001"} and upsert is True
    assert doc == json.loads(fake_s3.put_calls[0]["Body"].decode("utf-8"))


def test_mongo_failure_is_best_effort_and_never_fails_the_pipeline(monkeypatch):
    fake_s3 = FakeS3(_transcript())
    _wire(monkeypatch, fake_s3)
    _wire_mongo(monkeypatch, FakeCollection(fail=True))
    result = handler_mod.handler({"songId": "s", "bucket": "b", "transcriptKey": "k"}, None)
    assert result["lyricsKey"] == "songs/s/lyrics/song_lyrics.json"
    assert fake_s3.put_calls  # S3 write of record is intact


def test_no_secret_configured_skips_mongo_entirely(monkeypatch):
    fake_s3 = FakeS3(_transcript())
    _wire(monkeypatch, fake_s3)
    monkeypatch.setattr(handler_mod, "MONGODB_SECRET_ARN", "")
    monkeypatch.setattr(handler_mod, "_mongo",
                        lambda: (_ for _ in ()).throw(AssertionError("must not construct client")))
    assert handler_mod.handler({"songId": "s", "bucket": "b", "transcriptKey": "k"}, None)["lineCount"] == 1
