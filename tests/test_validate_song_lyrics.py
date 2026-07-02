from scripts.validate_song_lyrics import validate


def valid_doc():
    return {
        "songId": "test-song-001",
        "sourceLanguage": "ro",
        "targetLanguage": "en",
        "lines": [
            {
                "lineNumber": 1,
                "originalText": "Prima linie",
                "translatedText": "First line",
                "startTime": 1.0,
                "endTime": 2.5,
                "words": [{"text": "Prima", "start": 1.0, "end": 1.4}],
            }
        ],
    }


def test_valid_doc_returns_no_problems():
    assert validate(valid_doc()) == []


def test_missing_top_level_field_flagged():
    doc = valid_doc()
    del doc["sourceLanguage"]
    problems = validate(doc)
    assert any("sourceLanguage" in p for p in problems)


def test_line_missing_key_flagged():
    doc = valid_doc()
    del doc["lines"][0]["translatedText"]
    problems = validate(doc)
    assert any("translatedText" in p and "line 1" in p for p in problems)


def test_null_translation_flagged():
    doc = valid_doc()
    doc["lines"][0]["translatedText"] = None
    problems = validate(doc)
    assert any("translatedText" in p for p in problems)


def test_word_missing_key_flagged():
    doc = valid_doc()
    del doc["lines"][0]["words"][0]["end"]
    problems = validate(doc)
    assert any("end" in p for p in problems)


def test_lines_not_a_list_flagged():
    doc = valid_doc()
    doc["lines"] = "oops"
    problems = validate(doc)
    assert any("lines" in p for p in problems)
