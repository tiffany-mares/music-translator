"""Transcription stage: faster-whisper with word-level timestamps (Phase 1.2).

Produces the line/word structure the MongoDB songLyrics document expects
(architecture.md section 6.2) so later phases consume it without reshaping.
"""
from faster_whisper import WhisperModel


def transcribe(
    vocal_stem_path: str,
    model_size: str = "medium",
    language: str = "ro",
    device: str | None = None,
) -> dict:
    if device is None:
        import torch

        device = "cuda" if torch.cuda.is_available() else "cpu"
    compute_type = "float16" if device == "cuda" else "int8"
    model = WhisperModel(model_size, device=device, compute_type=compute_type)
    segments, info = model.transcribe(
        vocal_stem_path, language=language, word_timestamps=True
    )
    # faster-whisper returns a generator that only yields once; materialize
    # immediately so the timing data can be read more than once.
    return {"segments": list(segments)}


def to_lines(whisper_result: dict) -> list[dict]:
    lines = []
    for i, segment in enumerate(whisper_result["segments"]):
        lines.append(
            {
                "lineNumber": i + 1,
                "originalText": segment.text.strip(),
                "translatedText": None,  # filled in during Phase 1.3
                "startTime": segment.start,
                "endTime": segment.end,
                "words": [
                    {"text": w.word.strip(), "start": w.start, "end": w.end}
                    for w in (segment.words or [])
                ],
            }
        )
    return lines
