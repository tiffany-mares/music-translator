"""Stem-separation stage: wraps the Demucs CLI validated in Phase 1.1.

Runs Demucs in a child process using the venv interpreter (sys.executable -
NEVER bare "python", which resolves to the system Python 3.13 that cannot
run this stack). Child-process isolation also keeps Demucs's torch runtime
out of the pipeline process while it does its heaviest work.
"""
import subprocess
import sys
from pathlib import Path


def stem_paths(input_path: str, output_dir: str, model: str = "htdemucs") -> dict:
    """Demucs writes stems to {output_dir}/{model}/{input stem name}/."""
    song_name = Path(input_path).stem
    stem_dir = Path(output_dir) / model / song_name
    return {
        "vocals": str(stem_dir / "vocals.wav"),
        "no_vocals": str(stem_dir / "no_vocals.wav"),
    }


def separate(input_path: str, output_dir: str, model: str = "htdemucs") -> dict:
    subprocess.run(
        [
            sys.executable, "-m", "demucs.separate",
            "-n", model, "--two-stems", "vocals",
            "-o", str(output_dir), input_path,
        ],
        check=True,
    )
    return stem_paths(input_path, output_dir, model)
