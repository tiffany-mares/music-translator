"""Boundary report helpers (Phase 2.5 mid-word documentation)."""
import importlib.util
from pathlib import Path

_SPEC = importlib.util.spec_from_file_location(
    "boundary_report", Path(__file__).resolve().parents[1] / "scripts" / "boundary_report.py"
)
br = importlib.util.module_from_spec(_SPEC)
_SPEC.loader.exec_module(br)


def test_cut_points_match_chunk_math():
    assert br.cut_points(215.4) == [38.75, 76.25, 113.75, 151.25, 188.75]
    assert br.cut_points(40.0) == []          # single chunk, no interior boundary


def test_window_lines_selects_intersecting_spans():
    # window is [35.75, 41.75]: "before" ends at 35.0 (outside), "after" starts 45.0
    lines = [{"startTime": 30.0, "endTime": 35.0, "originalText": "before"},
             {"startTime": 37.0, "endTime": 40.0, "originalText": "spans"},
             {"startTime": 45.0, "endTime": 50.0, "originalText": "after"}]
    got = br.window_lines(lines, 38.75, 3.0)
    assert [l["originalText"] for l in got] == ["spans"]
