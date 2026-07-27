# Consolidated ML container (architecture.md section 5.3): Phase 2.1 base
# plus Phase 2.2 baked model weights.
# Deliberately omitted AT THIS PHASE - do not "fix" without reading section 10:
#   - dsp_core / pybind11             -> Phase 6.5, open decision (not speculative)
#   - chunking                        -> Phase 2.4; whole song in one job here
#   - translation (transformers)      -> RunTranslation Lambda, never this container
FROM pytorch/pytorch:2.3.0-cuda12.1-cudnn8-runtime

# ffmpeg: demucs needs it to decode the mp3 input; libsndfile: wav I/O
RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg libsndfile1 \
    && rm -rf /var/lib/apt/lists/*

COPY container/requirements-container.txt /tmp/requirements-container.txt
RUN pip install --no-cache-dir -r /tmp/requirements-container.txt

# The base image must supply torch/torchaudio 2.3.0+cu121; fail the build loudly if not.
RUN python -c "import torch, torchaudio; assert torch.__version__.startswith('2.3.0'), torch.__version__; assert torchaudio.__version__.startswith('2.3.0'), torchaudio.__version__; print('torch OK:', torch.__version__)"
# Every runtime import must resolve at build time, not at $0.74/hr job time.
RUN python -c "from faster_whisper import WhisperModel; from basic_pitch.inference import predict; import demucs.separate; import pretty_midi; print('imports OK')"

# Phase 2.2: bake model weights into image layers - no download on job start.
# Both Demucs AND Whisper (section 5.3 notes an earlier doc version missed Demucs).
# Basic Pitch ships its weights inside the wheel (basic_pitch/saved_models) - confirmed, no baking needed.
RUN python -c "from demucs.pretrained import get_model; get_model('htdemucs')"
# download_model instead of section 5.3's WhisperModel('large-v3', device='cpu'):
# instantiating would load the ~3 GB model into RAM at build time; only the
# cached download is needed. Same files, same HF cache location.
RUN python -c "from faster_whisper import download_model; download_model('large-v3')"
# Fail the build loudly if the caches didn't land where the runtime will look.
RUN python -c "import pathlib; d=pathlib.Path('/root/.cache/torch/hub/checkpoints'); w=pathlib.Path('/root/.cache/huggingface/hub'); assert any(d.glob('*.th')), 'demucs checkpoint missing'; assert any(w.glob('models--Systran--faster-whisper-large-v3/**/model.bin')), 'whisper model missing'; print('baked weights OK')"

COPY ml_stages.py /opt/ml/code/ml_stages.py
COPY stages/ /opt/ml/code/stages/
COPY container/process.py /opt/ml/code/process.py
ENV PYTHONPATH=/opt/ml/code
# The conda base ships MKL; its default INTEL threading layer aborts numpy import
# in the demucs child process ("MKL_THREADING_LAYER=INTEL is incompatible with
# libgomp.so.1") when spawned from the loaded entrypoint. GNU layer resolves it.
ENV MKL_THREADING_LAYER=GNU
ENTRYPOINT ["python", "/opt/ml/code/process.py"]
