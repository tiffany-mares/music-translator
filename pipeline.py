"""LyraLearn Phase 1 pipeline: one command from song file to song_lyrics.json.

Chains the four independently-validated stages (architecture.md section 10,
Phases 1.1-1.4): Demucs separation -> faster-whisper transcription and
Basic Pitch extraction concurrently -> MarianMT translation. Output matches
the MongoDB songLyrics document shape (section 6.2) exactly, with songId -
the join key across DynamoDB/MongoDB/S3 in the deployed architecture -
threaded through from the start.

IMPORT ORDER IS LOAD-BEARING: stages.extract_pitch must be imported before
anything that could load TensorFlow (its TF_ENABLE_ONEDNN_OPTS=0 setdefault
runs at import time; TF loads at call time), and stages.transcribe before
anything loading torch/ctranslate2 (KMP_DUPLICATE_LIB_OK). Do not reorder.
"""
import json
import sys
import time
from pathlib import Path

# ml_stages must stay first: it triggers the stages' env-var setdefaults in the
# load-bearing order (see its docstring and the original note below).
from ml_stages import run_ml_stages
from stages.extract_pitch import save_midi
from stages.translate import load_translator, translate_lines

PIPELINE_ROOT = Path(__file__).resolve().parent


def build_song_lyrics_doc(song_id: str, source_language: str, target_language: str, lines: list) -> dict:
    return {
        "songId": song_id,
        "sourceLanguage": source_language,
        "targetLanguage": target_language,
        "lines": lines,
    }


def run_pipeline(
    input_song: str,
    song_id: str,
    source_language: str = "ro",
    target_language: str = "en",
    output_dir: str | None = None,
) -> dict:
    output_dir = Path(output_dir) if output_dir else PIPELINE_ROOT / "output"
    output_dir.mkdir(parents=True, exist_ok=True)

    t0 = time.perf_counter()
    ml = run_ml_stages(input_song, output_dir, source_language=source_language)
    stems, lines, pitch_data, timings = ml["stems"], ml["lines"], ml["pitch_data"], ml["timings"]

    t2 = time.perf_counter()
    print("Stage 3/3: translating...")
    # The translator model is the ROMANCE-en group model (no direct ro-en pair
    # exists on the Hub - Phase 1.3 finding); source_language describes the
    # song/doc, not the translator.
    tokenizer, model = load_translator()
    lines = translate_lines(lines, tokenizer, model)
    timings["translation"] = time.perf_counter() - t2

    song_lyrics_doc = build_song_lyrics_doc(song_id, source_language, target_language, lines)
    (output_dir / "song_lyrics.json").write_text(
        json.dumps(song_lyrics_doc, indent=2, ensure_ascii=False), encoding="utf-8"
    )

    save_midi(pitch_data["midi"], str(output_dir / "melody.mid"))
    (output_dir / "pitch.json").write_text(
        json.dumps({"songId": song_id, "notes": pitch_data["notes"]}, indent=2, ensure_ascii=False),
        encoding="utf-8",
    )

    timings["total"] = time.perf_counter() - t0
    (output_dir / "timings.json").write_text(
        json.dumps(timings, indent=2, ensure_ascii=False), encoding="utf-8"
    )

    print(f"Done. Output written to {output_dir}/")
    print(f"Timings: {json.dumps(timings, indent=2)}")
    return {"stems": stems, "lyrics": song_lyrics_doc, "pitch": pitch_data["notes"], "timings": timings}


if __name__ == "__main__":
    run_pipeline(
        input_song=sys.argv[1] if len(sys.argv) > 1 else str(PIPELINE_ROOT / "test_data" / "input_song.mp3"),
        song_id=sys.argv[2] if len(sys.argv) > 2 else "test-song-001",
        output_dir=sys.argv[3] if len(sys.argv) > 3 else None,
    )
