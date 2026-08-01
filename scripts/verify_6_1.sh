#!/usr/bin/env bash
# Phase 6.1 done-when: connecting a test WebSocket client writes a
# WebSocketConnections row (connectionId + userId=sub) and disconnecting
# deletes it. Also gates: bad token and missing token are refused at the
# handshake AND write no row.
# One-time setup (websocket client lib, not in requirements.txt - test-only):
#   ./lyralearn-env/Scripts/python.exe -m pip install websockets
# Usage: AWS_REGION=... POOL_ID=... CLIENT_ID=... \
#        WS_URL=wss://xxxx.execute-api.us-east-1.amazonaws.com/prod \
#        scripts/verify_6_1.sh
set -euo pipefail
: "${AWS_REGION:?}" "${POOL_ID:?}" "${CLIENT_ID:?}" "${WS_URL:?}"
VENV_PY=./lyralearn-env/Scripts/python.exe
FAIL=0

"$VENV_PY" -m pip show websockets >/dev/null 2>&1 || "$VENV_PY" -m pip install -q websockets

TOKEN=$(aws cognito-idp admin-initiate-auth --user-pool-id "$POOL_ID" --client-id "$CLIENT_ID" \
  --auth-flow ADMIN_USER_PASSWORD_AUTH \
  --auth-parameters USERNAME=test@lyralearn.dev,PASSWORD=LyraTest2026Pass \
  --region "$AWS_REGION" --query AuthenticationResult.IdToken --output text)
SUB=$(aws cognito-idp admin-get-user --user-pool-id "$POOL_ID" --username test@lyralearn.dev \
  --region "$AWS_REGION" --query "UserAttributes[?Name=='sub'].Value" --output text)

rows_for_sub() { # connectionIds currently in the table for the test user (via GSI1)
  aws dynamodb query --table-name WebSocketConnections --region "$AWS_REGION" \
    --index-name GSI1 --key-condition-expression "userId = :u" \
    --expression-attribute-values "{\":u\":{\"S\":\"$SUB\"}}" \
    --query "Items[].connectionId.S" --output text
}

cleanup() { # stale rows are possible pre-6.2 (no TTL, no GoneException sweep yet)
  for cid in $(rows_for_sub); do
    [ "$cid" = "None" ] && continue
    aws dynamodb delete-item --table-name WebSocketConnections --region "$AWS_REGION" \
      --key "{\"connectionId\":{\"S\":\"$cid\"}}" >/dev/null 2>&1 || true
  done
}
trap cleanup EXIT
cleanup

# --- 1. valid token: connect, hold ~12s (assertions run from bash meanwhile) ---
# JWT chars are base64url + '.' - URL-safe, no escaping needed in the query.
"$VENV_PY" - "$WS_URL" "$TOKEN" <<'PYEOF' &
import asyncio, sys
import websockets

async def main():
    async with websockets.connect(f"{sys.argv[1]}?token={sys.argv[2]}", open_timeout=15):
        print("CONNECTED", flush=True)
        await asyncio.sleep(12)
    print("CLOSED", flush=True)

asyncio.run(main())
PYEOF
CLIENT_PID=$!

CID=""
for i in $(seq 1 10); do
  CID=$(rows_for_sub | head -1)
  [ -n "$CID" ] && [ "$CID" != "None" ] && break
  CID=""; sleep 1
done
[ -n "$CID" ] && echo "connect: row present via GSI1 (connectionId=$CID)" \
  || { echo "connect: FAIL - no row within 10s"; FAIL=1; }

GOT_USER=$(aws dynamodb get-item --table-name WebSocketConnections --region "$AWS_REGION" \
  --key "{\"connectionId\":{\"S\":\"$CID\"}}" --query "Item.userId.S" --output text 2>/dev/null || echo "")
[ "$GOT_USER" = "$SUB" ] && echo "connect: base-table item userId == test user's sub" \
  || { echo "connect: item shape FAIL -> userId=$GOT_USER, want $SUB"; FAIL=1; }

# --- 2. disconnect: client closes; row must disappear (async - poll) ---
wait "$CLIENT_PID" || { echo "client: FAIL - websocket client exited nonzero"; FAIL=1; }
GONE=0
for i in $(seq 1 15); do
  LEFT=$(rows_for_sub)
  { [ -z "$LEFT" ] || [ "$LEFT" = "None" ]; } && { GONE=1; break; }
  sleep 1
done
[ "$GONE" = "1" ] && echo "disconnect: row deleted (the done-when)" \
  || { echo "disconnect: FAIL - row still present after 15s -> $LEFT"; FAIL=1; }

# --- 3. bad token: handshake refused, no row written ---
neg() { # $1 = url suffix after WS_URL; expects handshake rejection
  set +e
  "$VENV_PY" - "$WS_URL$1" <<'PYEOF'
import asyncio, sys
import websockets

async def main():
    try:
        async with websockets.connect(sys.argv[1], open_timeout=15):
            print("ACCEPTED")
            return 1
    except Exception as e:  # InvalidStatus (v12+) / InvalidStatusCode (legacy)
        code = getattr(getattr(e, "response", None), "status_code", None) \
            or getattr(e, "status_code", None)
        print(f"REFUSED type={type(e).__name__} status={code}")
        return 0

sys.exit(asyncio.run(main()))
PYEOF
  RC=$?
  set -e
  return $RC
}

neg "?token=not.a.jwt" && echo "bad token: handshake refused" \
  || { echo "bad token: FAIL - connection accepted"; FAIL=1; }
LEFT=$(rows_for_sub)
{ [ -z "$LEFT" ] || [ "$LEFT" = "None" ]; } && echo "bad token: no row written" \
  || { echo "bad token: FAIL - row exists -> $LEFT"; FAIL=1; }

# --- 4. missing token: handshake refused, no row written ---
neg "" && echo "missing token: handshake refused" \
  || { echo "missing token: FAIL - connection accepted"; FAIL=1; }
LEFT=$(rows_for_sub)
{ [ -z "$LEFT" ] || [ "$LEFT" = "None" ]; } && echo "missing token: no row written" \
  || { echo "missing token: FAIL - row exists -> $LEFT"; FAIL=1; }

[ "$FAIL" = "0" ] && echo "PASS - Phase 6.1 done-when met." || echo "FAIL - see lines above."
exit $FAIL
