"""Pitch/melody extraction stage: Basic Pitch (Phase 1.4).

Extracts note-level melody data from the Demucs vocal stem - the data the
client-side sing-along pitch matching (architecture.md section 5.1) compares
a user's singing against. pitch is a MIDI note number (0-127).

Basic Pitch and its TensorFlow backend are imported lazily inside
extract_pitch() so unit tests of the pure reshaping logic don't pay the
multi-second TensorFlow import (mirrors the lazy torch import in
stages/transcribe.py).
"""
import os

# TensorFlow's oneDNN kernels hard-crash silently (no traceback) on this
# Windows setup when processing full-length audio; a 20s slice works.
# Disabling oneDNN before TF loads makes the full run complete. Revisit on
# a TensorFlow upgrade.
os.environ.setdefault("TF_ENABLE_ONEDNN_OPTS", "0")


def to_notes(note_events) -> list[dict]:
    """Reshape Basic Pitch note_events - (start, end, pitch, amplitude,
    pitch_bend) tuples - into the note dicts downstream phases consume.

    Casts to native Python types: basic-pitch 0.3.3 emits numpy scalars,
    which json.dump rejects."""
    return [
        {"pitch": int(note[2]), "start": float(note[0]), "end": float(note[1]), "velocity": float(note[3])}
        for note in note_events
    ]


def extract_pitch(audio_path: str) -> dict:
    from basic_pitch import ICASSP_2022_MODEL_PATH
    from basic_pitch.inference import predict

    model_output, midi_data, note_events = predict(audio_path, ICASSP_2022_MODEL_PATH)
    return {"notes": to_notes(note_events), "midi": midi_data}


def save_midi(midi_data, output_path: str) -> None:
    midi_data.write(output_path)
