from scripts.run_transcription import format_srt_timestamp, to_srt


def test_format_srt_timestamp_zero():
    assert format_srt_timestamp(0.0) == "00:00:00,000"


def test_format_srt_timestamp_minutes_and_millis():
    assert format_srt_timestamp(61.5) == "00:01:01,500"


def test_format_srt_timestamp_hours():
    assert format_srt_timestamp(3661.007) == "01:01:01,007"


def test_format_srt_timestamp_clamps_negative():
    # Whisper occasionally emits a tiny negative start on the first word
    assert format_srt_timestamp(-0.02) == "00:00:00,000"


def test_to_srt_renders_numbered_blocks():
    entries = [(1.0, 2.5, "Prima linie"), (3.0, 4.0, "A doua")]
    expected = (
        "1\n00:00:01,000 --> 00:00:02,500\nPrima linie\n"
        "\n"
        "2\n00:00:03,000 --> 00:00:04,000\nA doua\n"
    )
    assert to_srt(entries) == expected
