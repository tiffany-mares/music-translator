# RunTranslation Lambda (Phase 2.3). Model baked at build time (2.2 lesson):
# saved to a plain directory via save_pretrained and loaded by path, which
# sidesteps the HF cache entirely - Lambda's filesystem is read-only outside
# /tmp, and cache machinery wants lock files.
FROM public.ecr.aws/lambda/python:3.11

COPY lambda/translate/requirements-lambda.txt /tmp/requirements-lambda.txt
RUN pip install --no-cache-dir -r /tmp/requirements-lambda.txt

# safe_serialization=False: safetensors loads via mmap, which fails with a
# spurious FileNotFoundError on Lambda's lazily-chunk-loaded image filesystem;
# the .bin format uses regular reads and loads fine.
RUN python -c "from transformers import MarianMTModel, MarianTokenizer; n='Helsinki-NLP/opus-mt-ROMANCE-en'; MarianTokenizer.from_pretrained(n).save_pretrained('/opt/model'); MarianMTModel.from_pretrained(n).save_pretrained('/opt/model', safe_serialization=False)"
RUN python -c "import pathlib; p=pathlib.Path('/opt/model'); assert any(p.glob('*.safetensors')) or any(p.glob('*.bin')), 'model weights missing'; print('baked model OK')"

COPY stages/translate.py ${LAMBDA_TASK_ROOT}/stages/translate.py
COPY lambda/translate/handler.py ${LAMBDA_TASK_ROOT}/handler.py
CMD ["handler.handler"]
