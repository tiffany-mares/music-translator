#!/usr/bin/env bash
# Phase 2.4: build + push the ChunkAudio Lambda image and create/update the function.
# Usage: AWS_REGION=... ACCOUNT_ID=... BUCKET=... scripts/aws/deploy_chunk_lambda.sh
set -euo pipefail
: "${AWS_REGION:?}" "${ACCOUNT_ID:?}" "${BUCKET:?}"

FN=lyralearn-chunk-audio
URI="$ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com/lyralearn-chunk-audio:2.4"

aws ecr create-repository --repository-name lyralearn-chunk-audio --region "$AWS_REGION" >/dev/null 2>&1 || true
aws ecr get-login-password --region "$AWS_REGION" | docker login --username AWS --password-stdin "$ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com"
# --provenance=false: Lambda rejects OCI attestation indexes (Phase 2.3 finding)
docker buildx build --platform linux/amd64 --provenance=false --sbom=false \
  -f lambda/chunk_audio/Dockerfile -t "$URI" --push .

aws iam create-role --role-name lyralearn-lambda-chunk \
  --assume-role-policy-document file://infra/aws/lambda-trust.json >/dev/null 2>&1 || true
sed -e "s/__BUCKET__/$BUCKET/g" -e "s/__REGION__/$AWS_REGION/g" -e "s/__ACCOUNT_ID__/$ACCOUNT_ID/g" \
  infra/aws/lambda-chunk-policy.json > infra/aws/lambda-chunk-policy.filled.json
aws iam put-role-policy --role-name lyralearn-lambda-chunk \
  --policy-name lyralearn-chunk-scoped --policy-document file://infra/aws/lambda-chunk-policy.filled.json

if aws lambda get-function --function-name "$FN" --region "$AWS_REGION" >/dev/null 2>&1; then
  aws lambda update-function-code --function-name "$FN" --image-uri "$URI" --region "$AWS_REGION" \
    --query FunctionArn --output text
else
  sleep 10  # IAM role propagation
  aws lambda create-function --function-name "$FN" --package-type Image --code ImageUri="$URI" \
    --role "arn:aws:iam::$ACCOUNT_ID:role/lyralearn-lambda-chunk" \
    --timeout 300 --memory-size 2048 --region "$AWS_REGION" \
    --query FunctionArn --output text
fi
