"""SageMaker Processing Job entrypoint (Phase 2.1 - whole song, one job, no chunking).

SageMaker downloads the ProcessingInput to /opt/ml/processing/input before this
runs, and uploads everything under /opt/ml/processing/output to S3 at job end
(S3UploadMode=EndOfJob). SM_INPUT_DIR/SM_OUTPUT_DIR env overrides exist for
local docker runs and tests.

Writes transcript.json (section 6.2 line shape, translatedText left null) -
translation is the RunTranslation Lambda's job in the deployed design, not
this container's.
"""
import json
import os
import time
from pathlib import Path

from ml_stages import run_ml_stages  # load-bearing import order - see ml_stages docstring
from stages.extract_pitch import save_midi

AUDIO_SUFFIXES = {".mp3", ".wav", ".flac", ".m4a", ".ogg"}


def find_input_song(input_dir: Path) -> Path:
    candidates = sorted(
        p for p in Path(input_dir).iterdir()
        if p.is_file() and p.suffix.lower() in AUDIO_SUFFIXES
    )
    if not candidates:
        raise FileNotFoundError(f"no audio file ({sorted(AUDIO_SUFFIXES)}) in {input_dir}")
    return candidates[0]


def write_outputs(result: dict, output_dir: Path, song_id: str, source_language: str) -> None:
    output_dir = Path(output_dir)

    def dump(name: str, payload: dict) -> None:
        (output_dir / name).write_text(
            json.dumps(payload, indent=2, ensure_ascii=False), encoding="utf-8"
        )

    dump("transcript.json", {"songId": song_id, "sourceLanguage": source_language,
                             "lines": result["lines"]})
    dump("pitch.json", {"songId": song_id, "notes": result["pitch_data"]["notes"]})
    dump("timings.json", result["timings"])
    save_midi(result["pitch_data"]["midi"], str(output_dir / "melody.mid"))


def main() -> None:
    input_dir = Path(os.environ.get("SM_INPUT_DIR", "/opt/ml/processing/input"))
    output_dir = Path(os.environ.get("SM_OUTPUT_DIR", "/opt/ml/processing/output"))
    song_id = os.environ.get("SONG_ID", "unknown-song")
    source_language = os.environ.get("SOURCE_LANGUAGE", "ro")

    song = find_input_song(input_dir)
    print(f"Processing {song.name} as songId={song_id} (language={source_language})")

    t0 = time.perf_counter()
    result = run_ml_stages(str(song), output_dir, source_language=source_language)
    result["timings"]["total"] = time.perf_counter() - t0

    write_outputs(result, output_dir, song_id, source_language)
    print(f"Done. Timings: {json.dumps(result['timings'], indent=2)}")


if __name__ == "__main__":
    main()
