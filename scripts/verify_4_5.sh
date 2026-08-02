#!/usr/bin/env bash
# Phase 4.5 API restatement of the done-when: an ID3-headed garbage upload passes
# validation (degrades past fingerprinting), starts the pipeline, FAILS at
# ChunkAudio within ~1 min with a non-empty error, and a retry POST /process
# mints a FRESH jobId (new execution). The UI half (error state + Try again,
# no silent hang) is the live browser gate - notes/phase4.md 4.5.
# Usage: AWS_REGION=... POOL_ID=... CLIENT_ID=... API=... scripts/verify_4_5.sh
# NOTE: no MSYS_NO_PATHCONV here - it breaks Git Bash's /dev/null translation for curl.
set -euo pipefail
: "${TEST_PASSWORD:?set TEST_PASSWORD - the shared verify-user password (never hardcoded; see notes/phase7.md)}"
: "${AWS_REGION:?}" "${POOL_ID:?}" "${CLIENT_ID:?}" "${API:?}"
FAIL=0

TOKEN=$(aws cognito-idp admin-initiate-auth --user-pool-id "$POOL_ID" --client-id "$CLIENT_ID" \
  --auth-flow ADMIN_USER_PASSWORD_AUTH \
  --auth-parameters USERNAME=test@lyralearn.dev,PASSWORD=$TEST_PASSWORD \
  --region "$AWS_REGION" --query AuthenticationResult.IdToken --output text)

field() { python -c "import json,sys; print(json.load(sys.stdin).get('$1',''))"; }

GARBAGE=$(mktemp --suffix=.mp3)
python -c "import os,sys; open(sys.argv[1],'wb').write(b'ID3' + os.urandom(61*1024))" "$GARBAGE"

CREATE=$(curl -s -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"title":"verify 4.5 forced failure"}' "$API/songs")
SONG=$(echo "$CREATE" | field songId)
UPURL=$(echo "$CREATE" | field uploadUrl)
curl -s -X PUT --upload-file "$GARBAGE" "$UPURL"
rm -f "$GARBAGE"

PROC=$(curl -s -X POST -H "Authorization: Bearer $TOKEN" "$API/songs/$SONG/process")
JOB=$(echo "$PROC" | field jobId)
if [ -n "$JOB" ]; then echo "garbage passed validation, pipeline started: $JOB"; else
  echo "FAIL: expected a started pipeline, got: $PROC"; exit 1; fi

DEADLINE=$((SECONDS + 180))
STATUS=""
J=""
while [ $SECONDS -lt $DEADLINE ]; do
  J=$(curl -s -H "Authorization: Bearer $TOKEN" "$API/jobs/$JOB")
  STATUS=$(echo "$J" | field status)
  [ "$STATUS" = "FAILED" ] && break
  [ "$STATUS" = "COMPLETE" ] && { echo "FAIL: garbage COMPLETEd?!"; exit 1; }
  sleep 5
done
ERR=$(echo "$J" | field error)
if [ "$STATUS" = "FAILED" ] && [ -n "$ERR" ]; then
  echo "forced failure: FAILED with non-empty error OK"
else
  echo "forced failure: FAIL (status=$STATUS, error='$ERR')"; FAIL=1
fi

RETRY=$(curl -s -X POST -H "Authorization: Bearer $TOKEN" "$API/songs/$SONG/process")
JOB2=$(echo "$RETRY" | field jobId)
if [ -n "$JOB2" ] && [ "$JOB2" != "$JOB" ]; then
  echo "retry contract: fresh jobId minted OK ($JOB2)"
else
  echo "retry contract: FAIL (got '$JOB2')"; FAIL=1
fi

[ "$FAIL" = "0" ] && echo "PASS - Phase 4.5 done-when met (API restatement)." || echo "FAIL - see above."
exit $FAIL
