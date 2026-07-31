#!/usr/bin/env bash
# Phase 4.3 API-level restatement of the done-when: immediately after upload
# validation, the raw presigned URL streams (200/206 on a ranged GET) while the
# job is still QUEUED/PROCESSING. The UI half (player visibly playing during the
# pipeline) is a recorded browser session - notes/phase4.md section 4.3.
# Usage: AWS_REGION=... POOL_ID=... CLIENT_ID=... API=... AUDIO=path/to.mp3 scripts/verify_4_3.sh
# NOTE: no MSYS_NO_PATHCONV here - it breaks Git Bash's /dev/null translation for curl.
set -euo pipefail
: "${AWS_REGION:?}" "${POOL_ID:?}" "${CLIENT_ID:?}" "${API:?}"
AUDIO="${AUDIO:-test_data/smoke/smoke_30s.mp3}"
FAIL=0

TOKEN=$(aws cognito-idp admin-initiate-auth --user-pool-id "$POOL_ID" --client-id "$CLIENT_ID" \
  --auth-flow ADMIN_USER_PASSWORD_AUTH \
  --auth-parameters USERNAME=test@lyralearn.dev,PASSWORD=LyraTest2026Pass \
  --region "$AWS_REGION" --query AuthenticationResult.IdToken --output text)

field() { python -c "import json,sys; print(json.load(sys.stdin).get('$1',''))"; }

CREATE=$(curl -s -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"title":"verify 4.3"}' "$API/songs")
SONG=$(echo "$CREATE" | field songId)
UPURL=$(echo "$CREATE" | field uploadUrl)
curl -s -X PUT --upload-file "$AUDIO" "$UPURL"
PROC=$(curl -s -X POST -H "Authorization: Bearer $TOKEN" "$API/songs/$SONG/process")
JOB=$(echo "$PROC" | field jobId)
LINKED=$(echo "$PROC" | field linkedSongId)

# Immediately fetch audio-urls and range-read the raw object.
RAW=$(curl -s -H "Authorization: Bearer $TOKEN" "$API/songs/$SONG/audio-urls" \
  | python -c "import json,sys; print(json.load(sys.stdin)['urls']['raw'])")
CODE=$(curl -s -o /dev/null -w "%{http_code}" -r 0-1023 "$RAW")
case "$CODE" in
  200|206) echo "raw stream: $CODE OK (seconds after validation)" ;;
  *) echo "raw stream: FAIL ($CODE)"; FAIL=1 ;;
esac

if [ -n "$JOB" ]; then
  STATUS=$(curl -s -H "Authorization: Bearer $TOKEN" "$API/jobs/$JOB" | field status)
  case "$STATUS" in
    QUEUED|PROCESSING) echo "pipeline still running: $STATUS OK - playback beat the pipeline" ;;
    *) echo "pipeline status: FAIL (expected QUEUED/PROCESSING, got $STATUS)"; FAIL=1 ;;
  esac
elif [ -n "$LINKED" ]; then
  echo "note: upload LINKED to $LINKED (no pipeline) - raw stream check still valid; run with never-fingerprinted AUDIO for the strict miss-path assertion"
fi

[ "$FAIL" = "0" ] && echo "PASS - Phase 4.3 done-when met (API restatement)." || echo "FAIL - see above."
exit $FAIL
