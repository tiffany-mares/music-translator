"""ML-only stage chain shared by the local pipeline and the SageMaker container.

Demucs separation -> faster-whisper transcription and Basic Pitch extraction
concurrently. Translation is deliberately NOT here: in the deployed design it
runs in the RunTranslation Lambda (architecture.md section 4), so the Phase 2
container must be able to import this module without transformers installed.

IMPORT ORDER IS LOAD-BEARING (same constraint as pipeline.py): stages.extract_pitch
must be imported before anything that could load TensorFlow, and stages.transcribe
before anything loading torch/ctranslate2. Do not reorder.
"""
import concurrent.futures
import time
from pathlib import Path

from stages.extract_pitch import extract_pitch  # must stay first - see docstring
from stages.transcribe import to_lines, transcribe
from stages.separate import separate


def run_ml_stages(input_song: str, output_dir: str | Path, source_language: str = "ro") -> dict:
    output_dir = Path(output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    timings = {}

    t0 = time.perf_counter()
    print("Stage 1/3: separating stems...")
    stems = separate(str(input_song), str(output_dir / "stems"))
    timings["demucs"] = time.perf_counter() - t0

    t1 = time.perf_counter()
    print("Stages 2+3/3: transcribing and extracting pitch concurrently...")
    with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
        whisper_future = pool.submit(transcribe, stems["vocals"], language=source_language)
        pitch_future = pool.submit(extract_pitch, stems["vocals"])
        whisper_result = whisper_future.result()
        pitch_data = pitch_future.result()
    timings["whisper_and_pitch_concurrent"] = time.perf_counter() - t1

    return {
        "stems": stems,
        "lines": to_lines(whisper_result),
        "pitch_data": pitch_data,
        "timings": timings,
    }
