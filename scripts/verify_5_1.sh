#!/usr/bin/env bash
# Phase 5.1 done-when: a manually-inserted vocab item is queryable via GSI2
# (due-today shape), and the empty Java Lambda is deployed and reachable.
# Usage: AWS_REGION=... POOL_ID=... CLIENT_ID=... API=... scripts/verify_5_1.sh
set -euo pipefail
: "${AWS_REGION:?}" "${POOL_ID:?}" "${CLIENT_ID:?}" "${API:?}"
FAIL=0

TOKEN=$(aws cognito-idp admin-initiate-auth --user-pool-id "$POOL_ID" --client-id "$CLIENT_ID" \
  --auth-flow ADMIN_USER_PASSWORD_AUTH \
  --auth-parameters USERNAME=test@lyralearn.dev,PASSWORD=LyraTest2026Pass \
  --region "$AWS_REGION" --query AuthenticationResult.IdToken --output text)

USER_PK="USER#verify51-user"
cleanup() {
  aws dynamodb delete-item --table-name LyraLearnTable --region "$AWS_REGION" \
    --key "{\"PK\":{\"S\":\"$USER_PK\"},\"SK\":{\"S\":\"VOCAB#verify51-due\"}}" >/dev/null 2>&1 || true
  aws dynamodb delete-item --table-name LyraLearnTable --region "$AWS_REGION" \
    --key "{\"PK\":{\"S\":\"$USER_PK\"},\"SK\":{\"S\":\"VOCAB#verify51-future\"}}" >/dev/null 2>&1 || true
}
trap cleanup EXIT

# --- 1. insert one past-due and one future-due vocab item (full section 6.1 shape) ---
aws dynamodb put-item --table-name LyraLearnTable --region "$AWS_REGION" --item "{
  \"PK\": {\"S\": \"$USER_PK\"}, \"SK\": {\"S\": \"VOCAB#verify51-due\"},
  \"term\": {\"S\": \"inima\"}, \"definition\": {\"S\": \"heart\"},
  \"easeFactor\": {\"N\": \"2.5\"}, \"intervalDays\": {\"N\": \"1\"},
  \"repetitions\": {\"N\": \"0\"},
  \"nextReviewAt\": {\"S\": \"2026-07-01T00:00:00Z\"},
  \"lastReviewedAt\": {\"S\": \"2026-06-30T00:00:00Z\"},
  \"GSI2PK\": {\"S\": \"$USER_PK\"}, \"GSI2SK\": {\"S\": \"2026-07-01T00:00:00Z\"}
}"
aws dynamodb put-item --table-name LyraLearnTable --region "$AWS_REGION" --item "{
  \"PK\": {\"S\": \"$USER_PK\"}, \"SK\": {\"S\": \"VOCAB#verify51-future\"},
  \"term\": {\"S\": \"dor\"}, \"definition\": {\"S\": \"longing\"},
  \"easeFactor\": {\"N\": \"2.5\"}, \"intervalDays\": {\"N\": \"30\"},
  \"repetitions\": {\"N\": \"5\"},
  \"nextReviewAt\": {\"S\": \"2030-01-01T00:00:00Z\"},
  \"lastReviewedAt\": {\"S\": \"2026-07-01T00:00:00Z\"},
  \"GSI2PK\": {\"S\": \"$USER_PK\"}, \"GSI2SK\": {\"S\": \"2030-01-01T00:00:00Z\"}
}"
echo "insert: two vocab items written"

gsi2() {
  aws dynamodb query --table-name LyraLearnTable --region "$AWS_REGION" \
    --index-name GSI2 --key-condition-expression "$1" \
    --expression-attribute-values "$2" --query "$3" --output text
}

# --- 2. both items visible on GSI2 (guards against a silent put failure) ---
[ "$(gsi2 'GSI2PK = :u' "{\":u\":{\"S\":\"$USER_PK\"}}" Count)" = "2" ] \
  && echo "GSI2 hash-only: both items indexed" || { echo "GSI2 hash-only: FAIL"; FAIL=1; }

# --- 3. the due-today query shape (never exercised by 3.1): <= now returns ONLY the past-due item ---
NOW=$(date -u +%Y-%m-%dT%H:%M:%SZ)
VALS="{\":u\":{\"S\":\"$USER_PK\"},\":now\":{\"S\":\"$NOW\"}}"
[ "$(gsi2 'GSI2PK = :u AND GSI2SK <= :now' "$VALS" Count)" = "1" ] \
  && echo "GSI2 due-today: Count 1" || { echo "GSI2 due-today: FAIL"; FAIL=1; }
[ "$(gsi2 'GSI2PK = :u AND GSI2SK <= :now' "$VALS" 'Items[0].SK.S')" = "VOCAB#verify51-due" ] \
  && echo "GSI2 due-today: past-due item returned, future-due excluded" \
  || { echo "GSI2 due-today: WRONG ITEM"; FAIL=1; }

# --- 4. stub Lambda reachable behind the JWT authorizer on both routes ---
check_route() { # method path
  OUT=$(curl -s -w "\n%{http_code}" -X "$1" -H "Authorization: Bearer $TOKEN" "$API$2")
  CODE=$(echo "$OUT" | tail -1); BODY=$(echo "$OUT" | head -1)
  [ "$CODE" = "501" ] && echo "$BODY" | grep -q "not implemented yet" \
    && echo "$BODY" | grep -q "lyralearn-learning" \
    && echo "$1 $2: 501 stub OK" || { echo "$1 $2: FAIL -> $CODE $BODY"; FAIL=1; }
}
check_route GET /vocab/due
check_route POST /vocab/review

NOAUTH=$(curl -s -o /dev/null -w "%{http_code}" "$API/vocab/due")
[ "$NOAUTH" = "401" ] && echo "no token: 401 OK" || { echo "no token: FAIL -> $NOAUTH"; FAIL=1; }

[ "$FAIL" = "0" ] && echo "PASS - Phase 5.1 done-when met." || echo "FAIL - see lines above."
exit $FAIL
