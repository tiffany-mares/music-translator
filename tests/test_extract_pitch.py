import numpy as np

from stages.extract_pitch import to_notes


def test_to_notes_maps_note_event_tuples_to_dicts():
    note_events = [
        (1.0, 1.5, 62, 0.8, None),
        (1.6, 2.4, 65, 0.6, [0, 0, 1]),
    ]

    notes = to_notes(note_events)

    assert notes == [
        {"pitch": 62, "start": 1.0, "end": 1.5, "velocity": 0.8},
        {"pitch": 65, "start": 1.6, "end": 2.4, "velocity": 0.6},
    ]


def test_to_notes_preserves_input_order():
    # Basic Pitch does not guarantee sorted output; to_notes must not reorder
    note_events = [(2.0, 2.5, 70, 0.5, None), (0.5, 1.0, 60, 0.9, None)]

    notes = to_notes(note_events)

    assert [n["start"] for n in notes] == [2.0, 0.5]


def test_to_notes_empty_input():
    assert to_notes([]) == []


def test_to_notes_coerces_numpy_scalars_to_native_types():
    # basic-pitch 0.3.3 note_events carry numpy scalars; json.dump rejects
    # them ("Object of type int64 is not JSON serializable"), so to_notes
    # must hand every consumer native Python types.
    note_events = [
        (np.float64(1.0), np.float64(1.5), np.int64(62), np.float32(0.8), None),
    ]

    notes = to_notes(note_events)

    assert type(notes[0]["pitch"]) is int
    assert type(notes[0]["start"]) is float
    assert type(notes[0]["end"]) is float
    assert type(notes[0]["velocity"]) is float
    assert notes[0]["pitch"] == 62
    assert notes[0]["start"] == 1.0
    assert notes[0]["end"] == 1.5
    assert abs(notes[0]["velocity"] - 0.8) < 1e-6
