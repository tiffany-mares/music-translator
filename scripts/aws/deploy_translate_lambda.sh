#!/usr/bin/env bash
# Phase 3.5: build + push the RunTranslation Lambda image and create/update the function.
# Usage: AWS_REGION=... ACCOUNT_ID=... BUCKET=... scripts/aws/deploy_translate_lambda.sh
set -euo pipefail
: "${AWS_REGION:?}" "${ACCOUNT_ID:?}" "${BUCKET:?}"

FN=lyralearn-translate
URI="$ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com/lyralearn-translate:3.5"

aws ecr create-repository --repository-name lyralearn-translate --region "$AWS_REGION" >/dev/null 2>&1 || true
aws ecr get-login-password --region "$AWS_REGION" | docker login --username AWS --password-stdin "$ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com"
# --provenance=false: Lambda rejects OCI attestation indexes (Phase 2.3 finding;
# bit this script at 3.5 when plain docker build started emitting OCI manifests)
docker buildx build --platform linux/amd64 --provenance=false --sbom=false \
  -f lambda/translate/Dockerfile -t "$URI" --push .

aws iam create-role --role-name lyralearn-lambda-translate \
  --assume-role-policy-document file://infra/aws/lambda-trust.json >/dev/null 2>&1 || true
# Rendered files go next to the templates, not /tmp: the native-Windows AWS CLI
# can't see Git Bash's /tmp. .filled.json is gitignored.
sed -e "s/__BUCKET__/$BUCKET/g" -e "s/__REGION__/$AWS_REGION/g" -e "s/__ACCOUNT_ID__/$ACCOUNT_ID/g" \
  infra/aws/lambda-translate-policy.json > infra/aws/lambda-translate-policy.filled.json
aws iam put-role-policy --role-name lyralearn-lambda-translate \
  --policy-name lyralearn-translate-scoped --policy-document file://infra/aws/lambda-translate-policy.filled.json

if aws lambda get-function --function-name "$FN" --region "$AWS_REGION" >/dev/null 2>&1; then
  aws lambda update-function-code --function-name "$FN" --image-uri "$URI" --region "$AWS_REGION" \
    --query FunctionArn --output text
else
  # IAM role propagation can lag role creation by a few seconds; retry once.
  sleep 10
  aws lambda create-function --function-name "$FN" --package-type Image --code ImageUri="$URI" \
    --role "arn:aws:iam::$ACCOUNT_ID:role/lyralearn-lambda-translate" \
    --timeout 300 --memory-size 4096 --region "$AWS_REGION" \
    --query FunctionArn --output text
fi
