# Phase 2.1 consolidated ML container (architecture.md section 5.3).
# Deliberately omitted AT THIS PHASE - do not "fix" without reading section 10:
#   - model-weight baking RUN layers  -> Phase 2.2 (its done-when measures the
#     start-to-first-inference drop versus THIS image's cold run)
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

COPY ml_stages.py /opt/ml/code/ml_stages.py
COPY stages/ /opt/ml/code/stages/
COPY container/process.py /opt/ml/code/process.py
ENV PYTHONPATH=/opt/ml/code
# The conda base ships MKL; its default INTEL threading layer aborts numpy import
# in the demucs child process ("MKL_THREADING_LAYER=INTEL is incompatible with
# libgomp.so.1") when spawned from the loaded entrypoint. GNU layer resolves it.
ENV MKL_THREADING_LAYER=GNU
# The base image's cuDNN 8 lives inside torch's private lib dir (torch finds it
# via rpath) and LD_LIBRARY_PATH is empty, so ctranslate2's dlopen of
# libcudnn_ops_infer.so.8 aborts (exit 134) on GPU. Expose torch's copy.
ENV LD_LIBRARY_PATH=/opt/conda/lib/python3.10/site-packages/torch/lib
ENTRYPOINT ["python", "/opt/ml/code/process.py"]
