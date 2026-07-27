#!/usr/bin/env bash
# Phase 2.4: create/update the lyralearn-pipeline-chunked state machine.
# Usage: AWS_REGION=... ACCOUNT_ID=... BUCKET=... [IMAGE_TAG=2.4] [MAX_CONCURRENCY=1] \
#          scripts/aws/deploy_chunked_state_machine.sh
# MAX_CONCURRENCY defaults to 1 (the current ml.g4dn.xlarge quota); redeploy with
# MAX_CONCURRENCY=6 once the quota-6 request lands (section 4's value; 2.6 needs it).
set -euo pipefail
: "${AWS_REGION:?}" "${ACCOUNT_ID:?}" "${BUCKET:?}"
IMAGE_TAG="${IMAGE_TAG:-2.4}"
MAX_CONCURRENCY="${MAX_CONCURRENCY:-1}"
SM_NAME=lyralearn-pipeline-chunked
ROLE=lyralearn-sfn-pipeline
SM_ARN="arn:aws:states:$AWS_REGION:$ACCOUNT_ID:stateMachine:$SM_NAME"

# Refresh the (shared) SFN role policy - it gained the chunk Lambda invoke.
sed -e "s/__BUCKET__/$BUCKET/g" -e "s/__REGION__/$AWS_REGION/g" -e "s/__ACCOUNT_ID__/$ACCOUNT_ID/g" \
  infra/aws/sfn-pipeline-policy.json > infra/aws/sfn-pipeline-policy.filled.json
aws iam put-role-policy --role-name "$ROLE" \
  --policy-name lyralearn-sfn-scoped --policy-document file://infra/aws/sfn-pipeline-policy.filled.json

sed -e "s/__BUCKET__/$BUCKET/g" -e "s/__REGION__/$AWS_REGION/g" -e "s/__ACCOUNT_ID__/$ACCOUNT_ID/g" \
    -e "s/__IMAGE_TAG__/$IMAGE_TAG/g" -e "s/__MAX_CONCURRENCY__/$MAX_CONCURRENCY/g" \
  infra/aws/pipeline-2.4-chunked.asl.json > infra/aws/pipeline-2.4-chunked.filled.json

if aws stepfunctions describe-state-machine --state-machine-arn "$SM_ARN" --region "$AWS_REGION" >/dev/null 2>&1; then
  aws stepfunctions update-state-machine --state-machine-arn "$SM_ARN" \
    --definition file://infra/aws/pipeline-2.4-chunked.filled.json \
    --role-arn "arn:aws:iam::$ACCOUNT_ID:role/$ROLE" --region "$AWS_REGION" >/dev/null
  echo "updated: $SM_ARN"
else
  aws stepfunctions create-state-machine --name "$SM_NAME" --type STANDARD \
    --definition file://infra/aws/pipeline-2.4-chunked.filled.json \
    --role-arn "arn:aws:iam::$ACCOUNT_ID:role/$ROLE" --region "$AWS_REGION" \
    --query stateMachineArn --output text
fi
