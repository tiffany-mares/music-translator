from scripts.run_translation import format_review


def make_line(n, ro, en):
    return {"lineNumber": n, "originalText": ro, "translatedText": en,
            "startTime": 0.0, "endTime": 1.0, "words": []}


def test_format_review_renders_numbered_ro_en_pairs():
    lines = [make_line(1, "Prima linie", "First line")]
    text = format_review(lines)
    assert "  1  RO: Prima linie" in text
    assert "     EN: First line" in text


def test_format_review_flags_inconsistent_repeated_lines():
    lines = [
        make_line(1, "Nu ma, nu ma iei", "You don't take me"),
        make_line(2, "Alt vers", "Another verse"),
        make_line(3, "Nu ma, nu ma iei", "You won't, won't take me"),
    ]
    text = format_review(lines)
    assert "INCONSISTENT" in text
    assert "lines 1, 3" in text


def test_format_review_confirms_consistent_repeated_lines():
    lines = [
        make_line(1, "Refren", "Chorus"),
        make_line(2, "Refren", "Chorus"),
    ]
    text = format_review(lines)
    assert "CONSISTENT" in text
    assert "INCONSISTENT" not in text


def test_format_review_notes_when_no_repeats():
    lines = [make_line(1, "Unic", "Unique")]
    assert "(no repeated lines in this song)" in format_review(lines)
