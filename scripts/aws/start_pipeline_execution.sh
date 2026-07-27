#!/usr/bin/env bash
# Phase 2.3: start one pipeline execution and watch it to a terminal state.
# Usage: AWS_REGION=... ACCOUNT_ID=... [SM_NAME=lyralearn-pipeline-chunked] scripts/aws/start_pipeline_execution.sh <songId> <jobId> [execName]
set -euo pipefail
: "${AWS_REGION:?}" "${ACCOUNT_ID:?}"
SONG_ID="${1:?songId}"; JOB_ID="${2:?jobId}"
EXEC_NAME="${3:-${JOB_ID}-$(date +%Y%m%d-%H%M%S)}"   # becomes part of the job name; keep short
SM_ARN="arn:aws:states:$AWS_REGION:$ACCOUNT_ID:stateMachine:${SM_NAME:-lyralearn-pipeline}"

EXEC_ARN=$(aws stepfunctions start-execution --state-machine-arn "$SM_ARN" --name "$EXEC_NAME" \
  --input "{\"songId\":\"$SONG_ID\",\"jobId\":\"$JOB_ID\"}" \
  --region "$AWS_REGION" --query executionArn --output text)
echo "started: $EXEC_ARN"

while true; do
  STATUS=$(aws stepfunctions describe-execution --execution-arn "$EXEC_ARN" \
    --region "$AWS_REGION" --query status --output text)
  echo "$(date +%T) $STATUS"
  [ "$STATUS" != "RUNNING" ] && break
  sleep 30
done

echo "--- job item ---"
aws dynamodb get-item --table-name LyraLearnTable --region "$AWS_REGION" \
  --key "{\"PK\":{\"S\":\"SONG#$SONG_ID\"},\"SK\":{\"S\":\"JOB#$JOB_ID\"}}" --output json
