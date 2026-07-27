# StitchResults Lambda (Phase 2.5): numpy overlap-add + soundfile WAV I/O +
# pretty_midi for the merged melody.mid. Pure CPU array work (section 5.3a).
FROM public.ecr.aws/lambda/python:3.11

COPY lambda/stitch_results/requirements-stitch.txt /tmp/requirements-stitch.txt
RUN pip install --no-cache-dir -r /tmp/requirements-stitch.txt
RUN python -c "import numpy, soundfile, pretty_midi; print('stitch deps OK')"

COPY lambda/stitch_results/handler.py ${LAMBDA_TASK_ROOT}/handler.py
CMD ["handler.handler"]
