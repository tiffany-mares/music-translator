"""Phase 2.4 done-when helpers: manifest arithmetic and per-chunk metadata."""
import importlib.util
from pathlib import Path

_SPEC = importlib.util.spec_from_file_location(
    "verify_chunks", Path(__file__).resolve().parents[1] / "scripts" / "verify_chunk_outputs.py"
)
vc = importlib.util.module_from_spec(_SPEC)
_SPEC.loader.exec_module(vc)


def _manifest():
    starts = [0.0, 37.5, 75.0, 112.5, 150.0, 187.5]
    return {"chunkCount": 6, "songDurationSeconds": 215.4,
            "chunks": [{"chunkId": f"chunk-{i:03d}", "chunkStartOffset": s,
                        "chunkLengthSeconds": 40.0 if i < 5 else 27.9}
                       for i, s in enumerate(starts)]}


def test_check_manifest_accepts_correct_arithmetic():
    assert vc.check_manifest(_manifest()) == []


def test_check_manifest_catches_gap_and_short_coverage():
    m = _manifest()
    m["chunks"][2]["chunkStartOffset"] = 80.0            # breaks the stride
    assert any("stride" in p for p in vc.check_manifest(m))
    m2 = _manifest()
    m2["chunks"] = m2["chunks"][:-1]                     # last 27.9 s uncovered
    m2["chunkCount"] = 5
    assert any("coverage" in p for p in vc.check_manifest(m2))


def test_check_chunk_meta_matches_offsets():
    item = _manifest()["chunks"][1]
    good_t = {"chunkStartOffset": 37.5, "lines": [{"originalText": "x"}]}
    good_p = {"chunkStartOffset": 37.5, "notes": [1, 2]}
    assert vc.check_chunk_meta(item, good_t, good_p) == []
    bad_t = {"chunkStartOffset": 0.0, "lines": []}
    problems = vc.check_chunk_meta(item, bad_t, good_p)
    assert any("transcript offset" in p for p in problems)
