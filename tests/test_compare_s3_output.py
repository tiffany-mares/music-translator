"""Pure comparison helpers for the Phase 2.1 done-when check."""
import importlib.util
from pathlib import Path

_SPEC = importlib.util.spec_from_file_location(
    "compare_s3_output", Path(__file__).resolve().parents[1] / "scripts" / "compare_s3_output.py"
)
cmp_mod = importlib.util.module_from_spec(_SPEC)
_SPEC.loader.exec_module(cmp_mod)


def test_within_relative_tolerance():
    assert cmp_mod.within(100.0, 110.0, rel=0.20)
    assert not cmp_mod.within(100.0, 130.0, rel=0.20)
    assert cmp_mod.within(0.0, 0.0, rel=0.20)


def test_text_similarity_orders_sensibly():
    a = "ma ia hu ma ia ho vrei sa pleci dar nu ma iei"
    close = "ma ia hu ma ia ho vrei sa pleci dar nu ma ei"
    far = "completely different words with nothing shared here"
    assert cmp_mod.text_similarity(a, close) > 0.9
    assert cmp_mod.text_similarity(a, far) < 0.5


def _lines(n, words_per_line=7):
    return [{"lineNumber": i + 1, "originalText": "la " * words_per_line,
             "startTime": float(i), "endTime": float(i + 1),
             "words": [{"text": "la", "start": float(i), "end": float(i) + 0.1}] * words_per_line}
            for i in range(n)]


def test_compare_transcripts_passes_close_and_fails_model_sized_gap():
    assert cmp_mod.compare_transcripts(_lines(35), _lines(33)) == []
    problems = cmp_mod.compare_transcripts(_lines(35), _lines(25))  # medium-vs-large-v3 sized gap
    assert any("line count" in p for p in problems)


def test_compare_pitch_notes():
    local = [{"pitch": 60}] * 697
    assert cmp_mod.compare_pitch_notes(local, [{"pitch": 61}] * 650) == []
    problems = cmp_mod.compare_pitch_notes(local, [{"pitch": 61}] * 300)
    assert any("note count" in p for p in problems)
