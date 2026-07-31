#!/usr/bin/env bash
# Phase 4.2 contract tripwire: the endpoints the upload UI depends on still
# behave as coded against (auth required; CORS for both origins). The binding
# done-when (watch a real song upload->COMPLETE in the UI) is a recorded
# browser session - see notes/phase4.md section 4.2.
# Usage: API_URL=https://v7iyrsczl5.execute-api.us-east-1.amazonaws.com CF_DOMAIN=d38bvqcndpelgt.cloudfront.net scripts/verify_4_2.sh
# NOTE: no MSYS_NO_PATHCONV here - it breaks Git Bash's /dev/null translation for curl.
set -euo pipefail
: "${API_URL:?}" "${CF_DOMAIN:?}"
FAIL=0

# Unauthenticated requests are rejected (JWT authorizer in front of every route)
for CALL in "POST /songs" "POST /songs/x/process" "GET /jobs/x.y"; do
  METHOD=${CALL%% *}; ROUTE=${CALL#* }
  CODE=$(curl -sS -o /dev/null -w "%{http_code}" -X "$METHOD" "$API_URL$ROUTE")
  [ "$CODE" = "401" ] && echo "auth guard $CALL: 401 OK" || { echo "auth guard $CALL: FAIL ($CODE)"; FAIL=1; }
done

# CORS preflight still allows both frontend origins
for ORIGIN in "https://$CF_DOMAIN" "http://localhost:5173"; do
  curl -sSi -X OPTIONS "$API_URL/songs" -H "Origin: $ORIGIN" \
    -H "Access-Control-Request-Method: POST" \
    -H "Access-Control-Request-Headers: authorization,content-type" \
    | grep -qi "access-control-allow-origin: $ORIGIN" \
    && echo "CORS $ORIGIN: OK" || { echo "CORS $ORIGIN: FAIL"; FAIL=1; }
done

[ "$FAIL" = "0" ] && echo "PASS - Phase 4.2 contract tripwire green." || echo "FAIL - see above."
exit $FAIL
