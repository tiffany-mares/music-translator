#!/usr/bin/env bash
# Phase 5.1: build the Java learning Lambda jar via the maven+temurin-21 image
# (host JDK is 26/OpenJ9 - wrong target; no host maven). Runs unit tests too.
# Run from repo root. Output: lambda/learning/target/learning-lambda.jar
# Maven deps cache in lambda/learning/.m2/ (gitignored) so rebuilds are fast.
set -euo pipefail
MSYS_NO_PATHCONV=1 docker run --rm \
  -v "$(pwd -W 2>/dev/null || pwd)/lambda/learning:/code" -w /code \
  maven:3.9-eclipse-temurin-21 \
  mvn -q -Dmaven.repo.local=/code/.m2/repository package
ls -la lambda/learning/target/learning-lambda.jar
