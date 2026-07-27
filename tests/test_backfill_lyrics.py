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
