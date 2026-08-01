"""Backfill: S3 lyrics discovery + Mongo upsert wiring (Phase 3.5)."""
import io
import json

from scripts.backfill_lyrics_to_mongo import backfill, is_lyrics_key


class FakeColl:
    def __init__(self):
        self.docs, self.indexes = {}, []

    def create_index(self, key, unique=False):
        self.indexes.append((key, unique))

    def replace_one(self, flt, doc, upsert=False):
        assert upsert
        self.docs[flt["songId"]] = doc


class FakeS3:
    def __init__(self, objects):
        self.objects = objects

    def get_paginator(self, name):
        objects = self.objects

        class P:
            def paginate(self, Bucket, Prefix):
                yield {"Contents": [{"Key": k} for k in objects]}
        return P()

    def get_object(self, Bucket, Key):
        return {"Body": io.BytesIO(json.dumps(self.objects[Key]).encode("utf-8"))}


def test_is_lyrics_key():
    assert is_lyrics_key("songs/abc/lyrics/song_lyrics.json")
    assert not is_lyrics_key("songs/abc/raw/input.mp3")
    assert not is_lyrics_key("songs/abc/lyrics/other.json")
    assert not is_lyrics_key("songs/a/b/lyrics/song_lyrics.json")


def test_backfill_upserts_each_doc_and_creates_unique_index():
    s3 = FakeS3({
        "songs/s1/lyrics/song_lyrics.json": {"songId": "s1", "lines": []},
        "songs/s2/lyrics/song_lyrics.json": {"songId": "s2", "lines": []},
        "songs/s3/raw/input.mp3": {},
        "songs/s4/lyrics/song_lyrics.json": {"lines": []},
    })
    coll = FakeColl()
    assert backfill(s3, coll, "bucket") == (2, 1)
    assert set(coll.docs) == {"s1", "s2"}
    assert coll.indexes == [("songId", True)]


# --- Phase 7: sourceLanguage -> METADATA backfill ----------------------------

import importlib.util as _ilu
from pathlib import Path as _Path

_BF_SPEC = _ilu.spec_from_file_location(
    "backfill_source_language",
    _Path(__file__).resolve().parents[1] / "scripts" / "backfill_source_language.py")
bf_lang = _ilu.module_from_spec(_BF_SPEC)
_BF_SPEC.loader.exec_module(bf_lang)


class _FakeColl:
    def __init__(self, docs):
        self._docs = docs

    def find(self, _filter, _proj):
        return iter(self._docs)


class _FakeDdbClient:
    class exceptions:
        class ConditionalCheckFailedException(Exception):
            pass

    def __init__(self, missing=()):
        self.missing = set(missing)
        self.update_calls = []

    def update_item(self, **kwargs):
        if kwargs["Key"]["PK"]["S"].removeprefix("SONG#") in self.missing:
            raise self.exceptions.ConditionalCheckFailedException()
        self.update_calls.append(kwargs)
        return {}


def test_backfill_source_language_updates_metadata_and_skips_docs_without_language():
    coll = _FakeColl([
        {"songId": "s1", "sourceLanguage": "ro", "targetLanguage": "en"},
        {"songId": "s2"},  # no language -> skipped
        {"songId": "s3", "sourceLanguage": "fr"},  # no target -> only :sl
    ])
    ddb = _FakeDdbClient()
    done, skipped = bf_lang.backfill(coll, ddb, "TestTable")
    assert (done, skipped) == (2, 1)
    first = ddb.update_calls[0]
    assert first["Key"]["PK"]["S"] == "SONG#s1"
    assert first["ConditionExpression"] == "attribute_exists(PK)"
    assert first["ExpressionAttributeValues"][":sl"] == {"S": "ro"}
    assert first["ExpressionAttributeValues"][":tl"] == {"S": "en"}
    assert ":tl" not in ddb.update_calls[1]["ExpressionAttributeValues"]


def test_backfill_skips_mongo_docs_with_no_metadata_item():
    coll = _FakeColl([
        {"songId": "test-song-001", "sourceLanguage": "ro"},  # pre-API: no METADATA
        {"songId": "s9", "sourceLanguage": "ro"},
    ])
    ddb = _FakeDdbClient(missing={"test-song-001"})
    done, skipped = bf_lang.backfill(coll, ddb, "TestTable")
    assert (done, skipped) == (1, 1)
    assert ddb.update_calls[0]["Key"]["PK"]["S"] == "SONG#s9"
