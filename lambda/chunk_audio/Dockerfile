# ChunkAudio Lambda (Phase 2.4). soundfile's bundled libsndfile decodes mp3
# (>= 1.1) - no ffmpeg needed, and slicing the sample array is sample-accurate.
FROM public.ecr.aws/lambda/python:3.11

COPY lambda/chunk_audio/requirements-chunk.txt /tmp/requirements-chunk.txt
RUN pip install --no-cache-dir -r /tmp/requirements-chunk.txt
# Fail the build if this libsndfile can't read mp3 (the whole point).
RUN python -c "import soundfile as sf; fmts=sf.available_formats(); assert 'MP3' in fmts or 'MPEG' in fmts, fmts; print('libsndfile mp3 OK:', sf.__libsndfile_version__)"

COPY lambda/chunk_audio/handler.py ${LAMBDA_TASK_ROOT}/handler.py
CMD ["handler.handler"]
