#!/usr/bin/env bash
# Phase 4.1 done-when (scriptable half): CloudFront serves the app over HTTPS,
# SPA deep-link fallback works, hashed assets are immutable, and the API answers
# CORS preflights for the CloudFront + localhost dev origins. The signup/login/
# shell half of the done-when is a recorded real-browser session (notes 4.1).
# Usage: CF_DOMAIN=dxxxx.cloudfront.net API_URL=https://v7iyrsczl5.execute-api.us-east-1.amazonaws.com scripts/verify_4_1.sh
set -euo pipefail
export MSYS_NO_PATHCONV=1
: "${CF_DOMAIN:?}" "${API_URL:?}"
FAIL=0

curl -sSI "https://$CF_DOMAIN/" | grep -qi "^content-type: text/html" \
  && echo "root: text/html OK" || { echo "root: FAIL"; FAIL=1; }

DEEP_CODE=$(curl -sS -o /dev/null -w "%{http_code}" "https://$CF_DOMAIN/some/deep/path")
curl -sS "https://$CF_DOMAIN/some/deep/path" | grep -q 'id="root"' && [ "$DEEP_CODE" = "200" ] \
  && echo "spa-fallback: 200 index.html OK" || { echo "spa-fallback: FAIL ($DEEP_CODE)"; FAIL=1; }

ASSET=$(curl -sS "https://$CF_DOMAIN/" | grep -o '/assets/[^"]*\.js' | head -1)
[ -n "$ASSET" ] && curl -sSI "https://$CF_DOMAIN$ASSET" | grep -qi "immutable" \
  && echo "asset cache-control: immutable OK" || { echo "asset cache-control: FAIL ($ASSET)"; FAIL=1; }

for ORIGIN in "https://$CF_DOMAIN" "http://localhost:5173"; do
  curl -sSi -X OPTIONS "$API_URL/songs" -H "Origin: $ORIGIN" \
    -H "Access-Control-Request-Method: POST" \
    -H "Access-Control-Request-Headers: authorization,content-type" \
    | grep -qi "access-control-allow-origin: $ORIGIN" \
    && echo "CORS $ORIGIN: OK" || { echo "CORS $ORIGIN: FAIL"; FAIL=1; }
done

[ "$FAIL" = "0" ] && echo "PASS - Phase 4.1 done-when met (scripted half)." || echo "FAIL - see above."
exit $FAIL
