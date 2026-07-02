"""Confirms GPU visibility before running Demucs (Phase 1.1, outline Step 2)."""
import torch


def main() -> None:
    available = torch.cuda.is_available()
    print(f"CUDA available: {available}")
    if available:
        print(f"Device: {torch.cuda.get_device_name(0)}")
    else:
        print(
            "No GPU detected. Demucs will run on CPU — slower, but this "
            "does not block Phase 1.1, since the goal here is separation "
            "quality, not speed. If running on Colab, check Runtime > "
            "Change runtime type > GPU is selected."
        )


if __name__ == "__main__":
    main()
