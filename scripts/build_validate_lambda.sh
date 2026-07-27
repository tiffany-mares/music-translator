#!/usr/bin/env bash
# Phase 3.3: build the Rust validation Lambda zip via the cargo-lambda image.
# Run from repo root. Output: lambda/validate/target/lambda/bootstrap/bootstrap.zip
set -euo pipefail
MSYS_NO_PATHCONV=1 docker run --rm \
  -v "$(pwd -W 2>/dev/null || pwd)/lambda/validate:/code" -w /code \
  ghcr.io/cargo-lambda/cargo-lambda:latest \
  cargo lambda build --release --output-format zip
ls -la lambda/validate/target/lambda/bootstrap/bootstrap.zip
