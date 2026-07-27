#!/usr/bin/env bash
# Phase 3.5: build + push the StitchResults Lambda image and create/update the function.
# Usage: AWS_REGION=... ACCOUNT_ID=... BUCKET=... scripts/aws/deploy_stitch_lambda.sh
set -euo pipefail
: "${AWS_REGION:?}" "${ACCOUNT_ID:?}" "${BUCKET:?}"

FN=lyralearn-stitch-results
URI="$ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com/lyralearn-stitch-results:3.5"

aws ecr create-repository --repository-name lyralearn-stitch-results --region "$AWS_REGION" >/dev/null 2>&1 || true
aws ecr get-login-password --region "$AWS_REGION" | docker login --username AWS --password-stdin "$ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com"
# --provenance=false: Lambda rejects OCI attestation indexes (Phase 2.3 finding)
docker buildx build --platform linux/amd64 --provenance=false --sbom=false \
  -f lambda/stitch_results/Dockerfile -t "$URI" --push .

aws iam create-role --role-name lyralearn-lambda-stitch \
  --assume-role-policy-document file://infra/aws/lambda-trust.json >/dev/null 2>&1 || true
sed -e "s/__BUCKET__/$BUCKET/g" -e "s/__REGION__/$AWS_REGION/g" -e "s/__ACCOUNT_ID__/$ACCOUNT_ID/g" \
  infra/aws/lambda-stitch-policy.json > infra/aws/lambda-stitch-policy.filled.json
aws iam put-role-policy --role-name lyralearn-lambda-stitch \
  --policy-name lyralearn-stitch-scoped --policy-document file://infra/aws/lambda-stitch-policy.filled.json

if aws lambda get-function --function-name "$FN" --region "$AWS_REGION" >/dev/null 2>&1; then
  aws lambda update-function-code --function-name "$FN" --image-uri "$URI" --region "$AWS_REGION" \
    --query FunctionArn --output text
else
  sleep 10  # IAM role propagation
  aws lambda create-function --function-name "$FN" --package-type Image --code ImageUri="$URI" \
    --role "arn:aws:iam::$ACCOUNT_ID:role/lyralearn-lambda-stitch" \
    --timeout 300 --memory-size 4096 --region "$AWS_REGION" \
    --query FunctionArn --output text
fi
