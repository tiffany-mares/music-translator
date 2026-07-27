#!/usr/bin/env bash
# Phase 3.1 done-when: issue a JWT and read/write a test item via each GSI.
# Usage: AWS_REGION=... POOL_ID=... CLIENT_ID=... scripts/verify_3_1.sh
set -euo pipefail
: "${AWS_REGION:?}" "${POOL_ID:?}" "${CLIENT_ID:?}"
FAIL=0

# --- JWT ---
USERNAME="test@lyralearn.dev"
PASSWORD="LyraTest2026Pass"
aws cognito-idp admin-create-user --user-pool-id "$POOL_ID" --username "$USERNAME" \
  --message-action SUPPRESS --region "$AWS_REGION" >/dev/null 2>&1 || true
aws cognito-idp admin-set-user-password --user-pool-id "$POOL_ID" --username "$USERNAME" \
  --password "$PASSWORD" --permanent --region "$AWS_REGION"
ID_TOKEN=$(aws cognito-idp admin-initiate-auth --user-pool-id "$POOL_ID" --client-id "$CLIENT_ID" \
  --auth-flow ADMIN_USER_PASSWORD_AUTH \
  --auth-parameters USERNAME="$USERNAME",PASSWORD="$PASSWORD" \
  --region "$AWS_REGION" --query AuthenticationResult.IdToken --output text)
CLAIMS=$(python -c "import base64,json,sys; t=sys.argv[1].split('.')[1]; t+='='*(-len(t)%4); print(json.dumps(json.loads(base64.urlsafe_b64decode(t))))" "$ID_TOKEN")
echo "$CLAIMS" | grep -q "cognito-idp.$AWS_REGION.amazonaws.com/$POOL_ID" \
  && echo "JWT: issued, issuer OK" || { echo "JWT: BAD ISSUER"; FAIL=1; }
echo "$CLAIMS" | grep -q "\"aud\": *\"$CLIENT_ID\"" \
  && echo "JWT: audience OK" || { echo "JWT: BAD AUDIENCE"; FAIL=1; }

# --- LyraLearnTable: one item that hits all three GSIs ---
aws dynamodb put-item --table-name LyraLearnTable --region "$AWS_REGION" --item '{
  "PK": {"S": "SONG#gsi-test"}, "SK": {"S": "METADATA"},
  "GSI1PK": {"S": "USER#gsi-test-user"}, "GSI1SK": {"S": "2026-07-27T00:00:00Z"},
  "GSI2PK": {"S": "USER#gsi-test-user"}, "GSI2SK": {"S": "2026-08-01T00:00:00Z"},
  "GSI3PK": {"S": "fp-gsi-test-fingerprint"}
}'
q() {
  aws dynamodb query --table-name LyraLearnTable --region "$AWS_REGION" \
    --index-name "$1" --key-condition-expression "$2" \
    --expression-attribute-values "$3" --query "Count" --output text
}
[ "$(q GSI1 'GSI1PK = :v' '{":v":{"S":"USER#gsi-test-user"}}')" = "1" ] \
  && echo "GSI1: read OK" || { echo "GSI1: FAIL"; FAIL=1; }
[ "$(q GSI2 'GSI2PK = :v' '{":v":{"S":"USER#gsi-test-user"}}')" = "1" ] \
  && echo "GSI2: read OK" || { echo "GSI2: FAIL"; FAIL=1; }
[ "$(q GSI3 'GSI3PK = :v' '{":v":{"S":"fp-gsi-test-fingerprint"}}')" = "1" ] \
  && echo "GSI3: read OK" || { echo "GSI3: FAIL"; FAIL=1; }
aws dynamodb delete-item --table-name LyraLearnTable --region "$AWS_REGION" \
  --key '{"PK":{"S":"SONG#gsi-test"},"SK":{"S":"METADATA"}}'

# --- WebSocketConnections GSI ---
aws dynamodb put-item --table-name WebSocketConnections --region "$AWS_REGION" \
  --item '{"connectionId":{"S":"conn-gsi-test"},"userId":{"S":"gsi-test-user"}}'
CNT=$(aws dynamodb query --table-name WebSocketConnections --region "$AWS_REGION" \
  --index-name GSI1 --key-condition-expression "userId = :u" \
  --expression-attribute-values '{":u":{"S":"gsi-test-user"}}' --query Count --output text)
[ "$CNT" = "1" ] && echo "WebSocketConnections GSI1: read OK" || { echo "WS GSI1: FAIL"; FAIL=1; }
aws dynamodb delete-item --table-name WebSocketConnections --region "$AWS_REGION" \
  --key '{"connectionId":{"S":"conn-gsi-test"}}'

[ "$FAIL" = "0" ] && echo "PASS - Phase 3.1 done-when met." || echo "FAIL - see lines above."
exit $FAIL
