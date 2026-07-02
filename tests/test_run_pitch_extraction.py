import json

import numpy as np

from scripts.run_pitch_extraction import build_preview_html, midi_to_freq, to_native_notes


def test_midi_to_freq_concert_a():
    assert midi_to_freq(69) == 440.0


def test_midi_to_freq_octave_up_doubles():
    assert abs(midi_to_freq(81) - 880.0) < 1e-9


def test_midi_to_freq_middle_c():
    assert abs(midi_to_freq(60) - 261.6255653005986) < 1e-6


def test_build_preview_html_embeds_notes_json():
    notes = [{"pitch": 62, "start": 1.0, "end": 1.5, "velocity": 0.8}]
    html = build_preview_html(notes)
    assert json.dumps(notes) in html or json.dumps(notes, separators=(",", ":")) in html or '"pitch": 62' in html
    assert "vocals.wav" in html  # audio element points at the stem
    assert "<canvas" in html     # piano-roll present


def test_build_preview_html_empty_notes_still_renders():
    html = build_preview_html([])
    assert "<audio" in html


def test_to_native_notes_coerces_numpy_scalars_to_json_serializable():
    # basic-pitch 0.3.3 note_events carry numpy scalars; json.dump chokes on
    # them (TypeError: Object of type int64 is not JSON serializable).
    notes = [{
        "pitch": np.int64(62),
        "start": np.float64(1.0),
        "end": np.float64(1.5),
        "velocity": np.float64(0.8),
    }]
    out = to_native_notes(notes)
    assert out == [{"pitch": 62, "start": 1.0, "end": 1.5, "velocity": 0.8}]
    assert isinstance(out[0]["pitch"], int)
    assert isinstance(out[0]["start"], float)
    json.dumps(out)  # must not raise
