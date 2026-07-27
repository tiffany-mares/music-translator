"""StitchResults: crossfade + merge/dedupe math (Phase 2.5).

The clean-boundary tests here ARE the done-when's first condition (user
decision 2026-07-27): with no content near the seam, stitching must be an
exact pass-through - measured on the real song, no such boundary exists.
"""
import importlib.util
from pathlib import Path

import numpy as np

_SPEC = importlib.util.spec_from_file_location(
    "stitch_handler", Path(__file__).resolve().parents[1] / "lambda" / "stitch_results" / "handler.py"
)
stitch = importlib.util.module_from_spec(_SPEC)
_SPEC.loader.exec_module(stitch)


def test_stitch_audio_identical_content_is_exact_passthrough():
    # Two chunks cut from one signal with overlap: stitching must reproduce it.
    sr, overlap = 100, 50                      # 0.5 s overlap at 100 Hz for the test
    signal = np.sin(np.linspace(0, 40 * np.pi, 400)).astype(np.float64)
    a, b = signal[:250], signal[200:]          # offsets 0 and 200, overlap 50
    out = stitch.stitch_audio([a, b], [0, 200], 400, overlap)
    assert out.shape == (400,)
    assert np.allclose(out, signal, atol=1e-9)


def test_stitch_audio_stereo_and_short_tail():
    sig = np.ones((300, 2))
    a, b = sig[:250], sig[200:]                # tail chunk shorter than a full chunk
    out = stitch.stitch_audio([a, b], [0, 200], 300, 50)
    assert out.shape == (300, 2)
    assert np.allclose(out, 1.0)               # no amplitude dip at the seam


def _t(offset, lines):
    return {"chunkStartOffset": offset, "lines": lines}


def _line(n, start, end, text="la"):
    return {"lineNumber": n, "originalText": text, "translatedText": None,
            "startTime": start, "endTime": end,
            "words": [{"text": text, "start": start, "end": end}]}


def test_merge_lines_clean_boundary_is_exact_passthrough():
    # Nothing within the overlap window around the 37.5s boundary (cut at 38.75).
    merged = stitch.merge_lines([
        _t(0.0, [_line(1, 5.0, 10.0, "unu")]),
        _t(37.5, [_line(1, 2.5, 7.5, "doi")]),   # absolute 40.0-45.0
    ])
    assert [(l["originalText"], l["startTime"], l["endTime"]) for l in merged] == \
        [("unu", 5.0, 10.0), ("doi", 40.0, 45.0)]
    assert [l["lineNumber"] for l in merged] == [1, 2]
    assert merged[1]["words"][0]["start"] == 40.0    # word times shifted too


def test_merge_lines_dedupes_overlap_capture():
    # The same word heard by both chunks in the 37.5-40.0 overlap survives once.
    merged = stitch.merge_lines([
        _t(0.0, [_line(1, 36.0, 39.0, "dublu")]),    # abs midpoint 37.5 < cut 38.75 -> kept
        _t(37.5, [_line(1, 0.0, 1.5, "dublu")]),     # abs 37.5-39.0, mid 38.25 < 38.75 -> dropped
    ])
    assert len(merged) == 1
    assert merged[0]["startTime"] == 36.0


def test_merge_notes_offsets_and_dedupes():
    merged = stitch.merge_notes([
        {"chunkStartOffset": 0.0, "notes": [
            {"pitch": 60, "start": 5.0, "end": 6.0, "velocity": 0.5},
            {"pitch": 62, "start": 38.0, "end": 39.0, "velocity": 0.5}]},   # mid 38.5 kept
        {"chunkStartOffset": 37.5, "notes": [
            {"pitch": 62, "start": 0.5, "end": 1.5, "velocity": 0.5},       # abs mid 38.5 dropped
            {"pitch": 64, "start": 5.0, "end": 6.0, "velocity": 0.5}]},     # abs 42.5-43.5 kept
    ])
    assert [(n["pitch"], n["start"]) for n in merged] == [(60, 5.0), (62, 38.0), (64, 42.5)]


def test_build_midi_round_trip():
    midi = stitch.build_midi([{"pitch": 60, "start": 0.0, "end": 1.0, "velocity": 0.5}])
    assert len(midi.instruments) == 1
    note = midi.instruments[0].notes[0]
    assert (note.pitch, note.velocity) == (60, 63)


def test_artifact_keys_point_at_the_written_stem_paths():
    keys = stitch.artifact_keys("songs/s1/stitched/exec-1/")
    assert keys["stitchedPrefix"] == "songs/s1/stitched/exec-1/"
    assert keys["transcriptKey"] == "songs/s1/stitched/exec-1/transcript.json"
    assert keys["vocalsKey"] == "songs/s1/stitched/exec-1/stems/htdemucs/input_song/vocals.wav"
    assert keys["noVocalsKey"] == "songs/s1/stitched/exec-1/stems/htdemucs/input_song/no_vocals.wav"
