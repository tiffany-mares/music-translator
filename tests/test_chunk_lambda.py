"""ChunkAudio Lambda: chunk-boundary math and manifest assembly."""
import importlib.util
from pathlib import Path

_SPEC = importlib.util.spec_from_file_location(
    "chunk_handler", Path(__file__).resolve().parents[1] / "lambda" / "chunk_audio" / "handler.py"
)
chunk_mod = importlib.util.module_from_spec(_SPEC)
_SPEC.loader.exec_module(chunk_mod)


def test_compute_chunks_covers_the_phase1_test_song():
    chunks = chunk_mod.compute_chunks(215.4)
    assert [c["start"] for c in chunks] == [0.0, 37.5, 75.0, 112.5, 150.0, 187.5]
    assert [c["chunkId"] for c in chunks] == [f"chunk-{i:03d}" for i in range(6)]
    assert all(c["length"] == 40.0 for c in chunks[:-1])
    assert abs(chunks[-1]["length"] - 27.9) < 1e-6
    # consecutive chunks overlap by exactly OVERLAP_SECONDS
    for a, b in zip(chunks, chunks[1:]):
        assert abs((a["start"] + a["length"]) - (b["start"] + 2.5)) < 1e-6


def test_compute_chunks_short_song_is_one_chunk():
    assert chunk_mod.compute_chunks(30.0) == [{"chunkId": "chunk-000", "start": 0.0, "length": 30.0}]
    assert chunk_mod.compute_chunks(40.0) == [{"chunkId": "chunk-000", "start": 0.0, "length": 40.0}]


def test_build_manifest_items_shape():
    items = chunk_mod.build_manifest_items(
        chunk_mod.compute_chunks(215.4), song_id="test-song-001",
        bucket="b", exec_name="run-1",
    )
    first = items[0]
    assert first["jobName"] == "lyralearn-sfn-run-1-chunk-000"
    assert first["inputPrefix"] == "s3://b/songs/test-song-001/chunks/run-1/chunk-000/"
    assert first["outputPrefix"] == "s3://b/songs/test-song-001/ml-output/run-1/chunk-000/"
    assert first["chunkStartOffset"] == 0.0
    assert first["songId"] == "test-song-001"
    assert items[-1]["chunkStartOffset"] == 187.5
