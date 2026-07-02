from types import SimpleNamespace

from stages.transcribe import to_lines


def make_word(word: str, start: float, end: float) -> SimpleNamespace:
    return SimpleNamespace(word=word, start=start, end=end)


def make_segment(text: str, start: float, end: float, words) -> SimpleNamespace:
    return SimpleNamespace(text=text, start=start, end=end, words=words)


def test_to_lines_maps_segments_to_numbered_lines():
    result = {
        "segments": [
            make_segment(" Prima linie ", 1.0, 3.5, [
                make_word(" Prima", 1.0, 1.8),
                make_word(" linie", 1.9, 3.4),
            ]),
            make_segment(" A doua ", 4.0, 6.0, [
                make_word(" A", 4.0, 4.2),
                make_word(" doua", 4.3, 5.9),
            ]),
        ]
    }

    lines = to_lines(result)

    assert len(lines) == 2
    assert lines[0]["lineNumber"] == 1
    assert lines[1]["lineNumber"] == 2
    assert lines[0]["originalText"] == "Prima linie"
    assert lines[0]["translatedText"] is None
    assert lines[0]["startTime"] == 1.0
    assert lines[0]["endTime"] == 3.5
    assert lines[0]["words"] == [
        {"text": "Prima", "start": 1.0, "end": 1.8},
        {"text": "linie", "start": 1.9, "end": 3.4},
    ]


def test_to_lines_handles_segment_with_no_words():
    # word_timestamps can yield words=None on rare segments; must not crash
    result = {"segments": [make_segment(" Doar text ", 0.0, 2.0, None)]}

    lines = to_lines(result)

    assert lines[0]["words"] == []
    assert lines[0]["originalText"] == "Doar text"


def test_to_lines_empty_result():
    assert to_lines({"segments": []}) == []
