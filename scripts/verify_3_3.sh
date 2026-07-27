#!/usr/bin/env bash
# Phase 3.3 done-when: malformed uploads are rejected before Step Functions.
# Usage: AWS_REGION=... POOL_ID=... CLIENT_ID=... API=... scripts/verify_3_3.sh
set -euo pipefail
: "${AWS_REGION:?}" "${POOL_ID:?}" "${CLIENT_ID:?}" "${API:?}"
FAIL=0

TOKEN=$(aws cognito-idp admin-initiate-auth --user-pool-id "$POOL_ID" --client-id "$CLIENT_ID" \
  --auth-flow ADMIN_USER_PASSWORD_AUTH \
  --auth-parameters USERNAME=test@lyralearn.dev,PASSWORD=LyraTest2026Pass \
  --region "$AWS_REGION" --query AuthenticationResult.IdToken --output text)

sfn_count() {
  aws stepfunctions list-executions --state-machine-arn "$1" --region "$AWS_REGION" \
    --query "length(executions)" --output text
}
LINEAR_ARN="arn:aws:states:$AWS_REGION:503233513399:stateMachine:lyralearn-pipeline"
CHUNKED_ARN="arn:aws:states:$AWS_REGION:503233513399:stateMachine:lyralearn-pipeline-chunked"
BEFORE_LINEAR=$(sfn_count "$LINEAR_ARN"); BEFORE_CHUNKED=$(sfn_count "$CHUNKED_ARN")

new_song() {
  curl -s -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
    -d "{\"title\":\"$1\"}" "$API/songs"
}
field() { python -c "import json,sys; print(json.load(sys.stdin)['$1'])"; }
status_of() {
  aws dynamodb get-item --table-name LyraLearnTable --region "$AWS_REGION" \
    --key "{\"PK\":{\"S\":\"SONG#$1\"},\"SK\":{\"S\":\"METADATA\"}}" \
    --query "Item.status.S" --output text
}

# --- happy path: real mp3 ---
GOOD=$(new_song "Valid Upload Test")
GOOD_ID=$(echo "$GOOD" | field songId); GOOD_URL=$(echo "$GOOD" | field uploadUrl)
curl -s -X PUT --upload-file test_data/input_song.mp3 "$GOOD_URL"
GOOD_OUT=$(curl -s -X POST -H "Authorization: Bearer $TOKEN" "$API/songs/$GOOD_ID/process")
echo "$GOOD_OUT" | python -c "import json,sys; d=json.load(sys.stdin); assert d['valid'] is True and d['format']=='mp3'" \
  && echo "valid mp3: accepted (format=mp3)" || { echo "valid mp3: FAIL -> $GOOD_OUT"; FAIL=1; }
[ "$(status_of "$GOOD_ID")" = "VALIDATED" ] \
  && echo "valid mp3: status VALIDATED" || { echo "valid mp3: status FAIL"; FAIL=1; }

# --- malformed: garbage bytes big enough to pass the size check ---
BAD=$(new_song "Malformed Upload Test")
BAD_ID=$(echo "$BAD" | field songId); BAD_URL=$(echo "$BAD" | field uploadUrl)
python -c "open('bad_upload.bin','wb').write(b'this is definitely not audio ' * 4000)"
curl -s -X PUT --upload-file bad_upload.bin "$BAD_URL"; rm -f bad_upload.bin
BAD_CODE_OUT=$(curl -s -w "\n%{http_code}" -X POST -H "Authorization: Bearer $TOKEN" "$API/songs/$BAD_ID/process")
BAD_CODE=$(echo "$BAD_CODE_OUT" | tail -1); BAD_OUT=$(echo "$BAD_CODE_OUT" | head -1)
[ "$BAD_CODE" = "400" ] && echo "$BAD_OUT" | python -c "import json,sys; d=json.load(sys.stdin); assert d['valid'] is False and 'unrecognized' in d['reason']" \
  && echo "garbage upload: rejected 400 (header check)" || { echo "garbage upload: FAIL -> $BAD_CODE $BAD_OUT"; FAIL=1; }
[ "$(status_of "$BAD_ID")" = "REJECTED" ] \
  && echo "garbage upload: status REJECTED" || { echo "garbage upload: status FAIL"; FAIL=1; }

# --- missing upload: process with nothing uploaded ---
EMPTY=$(new_song "Never Uploaded Test")
EMPTY_ID=$(echo "$EMPTY" | field songId)
EMPTY_OUT=$(curl -s -X POST -H "Authorization: Bearer $TOKEN" "$API/songs/$EMPTY_ID/process")
echo "$EMPTY_OUT" | python -c "import json,sys; d=json.load(sys.stdin); assert d['valid'] is False and 'no uploaded file' in d['reason']" \
  && echo "missing upload: rejected" || { echo "missing upload: FAIL -> $EMPTY_OUT"; FAIL=1; }

# --- the done-when clause: Step Functions untouched by ALL of the above ---
AFTER_LINEAR=$(sfn_count "$LINEAR_ARN"); AFTER_CHUNKED=$(sfn_count "$CHUNKED_ARN")
[ "$BEFORE_LINEAR" = "$AFTER_LINEAR" ] && [ "$BEFORE_CHUNKED" = "$AFTER_CHUNKED" ] \
  && echo "Step Functions: zero new executions (before/after $BEFORE_LINEAR/$AFTER_LINEAR linear, $BEFORE_CHUNKED/$AFTER_CHUNKED chunked)" \
  || { echo "Step Functions: EXECUTION COUNT CHANGED"; FAIL=1; }

[ "$FAIL" = "0" ] && echo "PASS - Phase 3.3 done-when met." || echo "FAIL - see lines above."
exit $FAIL
