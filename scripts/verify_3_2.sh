#!/usr/bin/env bash
# Phase 3.2 done-when: every route callable with a real JWT, correct shapes.
# Usage: AWS_REGION=... POOL_ID=... CLIENT_ID=... API=... scripts/verify_3_2.sh
set -euo pipefail
: "${AWS_REGION:?}" "${POOL_ID:?}" "${CLIENT_ID:?}" "${API:?}"
FAIL=0

TOKEN=$(aws cognito-idp admin-initiate-auth --user-pool-id "$POOL_ID" --client-id "$CLIENT_ID" \
  --auth-flow ADMIN_USER_PASSWORD_AUTH \
  --auth-parameters USERNAME=test@lyralearn.dev,PASSWORD=LyraTest2026Pass \
  --region "$AWS_REGION" --query AuthenticationResult.IdToken --output text)

code() { curl -s -o /dev/null -w "%{http_code}" "$@"; }
jget() { curl -s -H "Authorization: Bearer $TOKEN" "$@"; }

# 401 without a token
[ "$(code "$API/songs/test-song-001/lyrics")" = "401" ] \
  && echo "auth: unauthenticated 401 OK" || { echo "auth: FAIL (no-token not rejected)"; FAIL=1; }

# POST /songs
POST_OUT=$(curl -s -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"title":"Verify Song","artist":"Test"}' "$API/songs")
echo "$POST_OUT" | python -c "import json,sys; d=json.load(sys.stdin); assert len(d['songId'])==12 and 'X-Amz-' in d['uploadUrl']" \
  && echo "POST /songs: shape OK" || { echo "POST /songs: FAIL -> $POST_OUT"; FAIL=1; }

# GET /jobs/{id} - real Phase 2 job item
JOB_OUT=$(jget "$API/jobs/test-song-001.job-2-5")
echo "$JOB_OUT" | python -c "import json,sys; d=json.load(sys.stdin); assert d['status']=='COMPLETE' and d['songId']=='test-song-001'" \
  && echo "GET /jobs: shape OK (real job, COMPLETE)" || { echo "GET /jobs: FAIL -> $JOB_OUT"; FAIL=1; }

# GET /songs/{id}/lyrics - real translated doc
LYR_OUT=$(jget "$API/songs/test-song-001/lyrics")
echo "$LYR_OUT" | python -c "import json,sys; d=json.load(sys.stdin); assert d['songId']=='test-song-001' and len(d['lines'])>10 and d['lines'][1]['translatedText']" \
  && echo "GET /lyrics: section 6.2 doc OK" || { echo "GET /lyrics: FAIL"; FAIL=1; }

# GET /songs/{id}/audio-urls - presigned and actually fetchable
AU_OUT=$(jget "$API/songs/test-song-001/audio-urls")
RAW_URL=$(echo "$AU_OUT" | python -c "import json,sys; d=json.load(sys.stdin); assert d['expiresInSeconds']==900 and set(d['urls'])=={'raw','vocals','noVocals'}; print(d['urls']['raw'])") \
  && echo "GET /audio-urls: shape OK" || { echo "GET /audio-urls: FAIL -> $AU_OUT"; FAIL=1; }
[ -n "${RAW_URL:-}" ] && [ "$(code "$RAW_URL")" = "200" ] \
  && echo "presigned raw URL: fetches 200 OK" || { echo "presigned URL: FAIL"; FAIL=1; }

if [ "$FAIL" = "0" ]; then
  echo "PASS - Phase 3.2 done-when met."
  echo ""
  echo "Postman setup: base URL $API ; header 'Authorization: Bearer <token below>' (valid ~1h)"
  echo "$TOKEN"
else
  echo "FAIL - see lines above."
fi
exit $FAIL
