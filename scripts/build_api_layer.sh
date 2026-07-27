#!/usr/bin/env bash
# Phase 3.5: build the pymongo layer for the python3.12 api Lambda. bson is a
# C extension, so pip runs inside the matching Lambda runtime image (no host
# pip - same no-host-toolchain rule as build_validate_lambda.sh).
# Run from repo root. Output: lambda/api-layer/api-deps-layer.zip
set -euo pipefail
rm -rf lambda/api-layer/python lambda/api-layer/api-deps-layer.zip
mkdir -p lambda/api-layer/python
MSYS_NO_PATHCONV=1 docker run --rm --entrypoint pip \
  -v "$(pwd -W 2>/dev/null || pwd)/lambda/api-layer:/out" \
  public.ecr.aws/lambda/python:3.12 \
  install --no-cache-dir pymongo==4.8.0 dnspython==2.6.1 -t /out/python
python -c "import shutil; shutil.make_archive('lambda/api-layer/api-deps-layer', 'zip', 'lambda/api-layer', 'python'); print('wrote lambda/api-layer/api-deps-layer.zip')"
ls -la lambda/api-layer/api-deps-layer.zip
