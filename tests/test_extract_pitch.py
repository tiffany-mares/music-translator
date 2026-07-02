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
