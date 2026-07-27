#!/usr/bin/env bash
# Phase 2.3: create/update the lyralearn-pipeline state machine (+ table + SFN role).
# Usage: AWS_REGION=... ACCOUNT_ID=... BUCKET=... [IMAGE_TAG=2.2] scripts/aws/deploy_state_machine.sh
set -euo pipefail
: "${AWS_REGION:?}" "${ACCOUNT_ID:?}" "${BUCKET:?}"
IMAGE_TAG="${IMAGE_TAG:-2.2}"
SM_NAME=lyralearn-pipeline
ROLE=lyralearn-sfn-pipeline
SM_ARN="arn:aws:states:$AWS_REGION:$ACCOUNT_ID:stateMachine:$SM_NAME"

aws dynamodb describe-table --table-name LyraLearnTable --region "$AWS_REGION" >/dev/null 2>&1 || {
  aws dynamodb create-table --table-name LyraLearnTable \
    --attribute-definitions AttributeName=PK,AttributeType=S AttributeName=SK,AttributeType=S \
    --key-schema AttributeName=PK,KeyType=HASH AttributeName=SK,KeyType=RANGE \
    --billing-mode PAY_PER_REQUEST --region "$AWS_REGION" >/dev/null
  aws dynamodb wait table-exists --table-name LyraLearnTable --region "$AWS_REGION"
}

aws iam create-role --role-name "$ROLE" \
  --assume-role-policy-document file://infra/aws/sfn-trust.json >/dev/null 2>&1 || true
# Rendered files go next to the templates, not /tmp: the native-Windows AWS CLI
# can't see Git Bash's /tmp. .filled.json is gitignored.
sed -e "s/__BUCKET__/$BUCKET/g" -e "s/__REGION__/$AWS_REGION/g" -e "s/__ACCOUNT_ID__/$ACCOUNT_ID/g" \
  infra/aws/sfn-pipeline-policy.json > infra/aws/sfn-pipeline-policy.filled.json
aws iam put-role-policy --role-name "$ROLE" \
  --policy-name lyralearn-sfn-scoped --policy-document file://infra/aws/sfn-pipeline-policy.filled.json

sed -e "s/__BUCKET__/$BUCKET/g" -e "s/__REGION__/$AWS_REGION/g" -e "s/__ACCOUNT_ID__/$ACCOUNT_ID/g" \
    -e "s/__IMAGE_TAG__/$IMAGE_TAG/g" \
  infra/aws/pipeline-2.3.asl.json > infra/aws/pipeline-2.3.filled.json

if aws stepfunctions describe-state-machine --state-machine-arn "$SM_ARN" --region "$AWS_REGION" >/dev/null 2>&1; then
  aws stepfunctions update-state-machine --state-machine-arn "$SM_ARN" \
    --definition file://infra/aws/pipeline-2.3.filled.json \
    --role-arn "arn:aws:iam::$ACCOUNT_ID:role/$ROLE" --region "$AWS_REGION" >/dev/null
  echo "updated: $SM_ARN"
else
  sleep 10  # IAM role propagation
  aws stepfunctions create-state-machine --name "$SM_NAME" --type STANDARD \
    --definition file://infra/aws/pipeline-2.3.filled.json \
    --role-arn "arn:aws:iam::$ACCOUNT_ID:role/$ROLE" --region "$AWS_REGION" \
    --query stateMachineArn --output text
fi
