#!/usr/bin/env bash
# Phase 6.1/6.2: build all three Go WebSocket Lambda zips via the golang:1.24
# image (no host Go, per the no-host-toolchains convention; 1.24 = current AWS
# SDK v2 floor). Runs go mod tidy (keeps go.sum complete) and the unit tests
# first — a red test fails the build.
# Run from repo root. Outputs: lambda/ws/dist/{connect,disconnect,push}.zip
# Caches in lambda/ws/.gocache/ (gitignored) keep rebuilds fast. Zips are
# byte-reproducible (-trimpath, stripped, fixed metadata via tools/buildzip)
# so the terraform hash only churns on real code changes.
set -euo pipefail
MSYS_NO_PATHCONV=1 docker run --rm \
  -v "$(pwd -W 2>/dev/null || pwd)/lambda/ws:/code" -w /code \
  -e GOMODCACHE=/code/.gocache/mod -e GOCACHE=/code/.gocache/build \
  golang:1.24 \
  bash -c '
    set -euo pipefail
    go mod tidy
    go vet ./...
    go test ./...
    mkdir -p dist
    for fn in connect disconnect push; do
      CGO_ENABLED=0 GOOS=linux GOARCH=amd64 \
        go build -trimpath -ldflags "-s -w" -o "dist/$fn/bootstrap" "./cmd/$fn"
      go run ./tools/buildzip "dist/$fn/bootstrap" "dist/$fn.zip"
    done
  '
ls -la lambda/ws/dist/connect.zip lambda/ws/dist/disconnect.zip lambda/ws/dist/push.zip
