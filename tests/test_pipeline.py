from pipeline import build_song_lyrics_doc


def make_line(n):
    return {
        "lineNumber": n,
        "originalText": f"linia {n}",
        "translatedText": f"line {n}",
        "startTime": float(n),
        "endTime": float(n) + 1.0,
        "words": [{"text": f"linia", "start": float(n), "end": float(n) + 0.4}],
    }


def test_build_song_lyrics_doc_shape():
    lines = [make_line(1), make_line(2)]

    doc = build_song_lyrics_doc("test-song-001", "ro", "en", lines)

    assert doc == {
        "songId": "test-song-001",
        "sourceLanguage": "ro",
        "targetLanguage": "en",
        "lines": lines,
    }


def test_build_song_lyrics_doc_does_not_copy_lines():
    lines = [make_line(1)]
    doc = build_song_lyrics_doc("s", "ro", "en", lines)
    assert doc["lines"] is lines  # same list; the pipeline fills lines in place upstream
