#!/usr/bin/env bash
# Phase 6.2 done-when: a connected WebSocket client receives a push the moment
# MarkComplete writes, without polling. Runs ONE real cache-miss pipeline
# (~11 min at MAX_CONCURRENCY=1): a fresh 30s ffmpeg window (CUT_SS env, default 160;
# 60/95/130/160 are already fingerprinted from earlier runs) so no fingerprint de-index is
# needed. The listener holds the socket the whole run - API GW idles sockets
# out at 10 min, so it sends an app-level keepalive frame every 240s (no
# $default route: API GW answers with an error frame but does NOT close;
# frames without jobId are ignored). Asserts: PROCESSING push within 3 min
# (wiring proof), COMPLETE push before a 25-min deadline, push payload ==
# the GET /jobs polling contract, and push-vs-SFN-stopDate latency.
# The listener never calls GET /jobs - there is no polling loop anywhere in
# it; the single GET below is a post-hoc confirmation AFTER the push landed.
# Usage: AWS_REGION=... POOL_ID=... CLIENT_ID=... API=... \
#        WS_URL=wss://xxxx.execute-api.us-east-1.amazonaws.com/prod \
#        scripts/verify_6_2.sh
set -euo pipefail
: "${AWS_REGION:?}" "${POOL_ID:?}" "${CLIENT_ID:?}" "${API:?}" "${WS_URL:?}"
VENV_PY=./lyralearn-env/Scripts/python.exe
FAIL=0
CUT_SS="${CUT_SS:-160}" # each run needs a NEVER-processed window (fingerprint dedup)
CUT="cut_${CUT_SS}.mp3"
LISTENER_PID=""

"$VENV_PY" -m pip show websockets >/dev/null 2>&1 || "$VENV_PY" -m pip install -q websockets

TOKEN=$(aws cognito-idp admin-initiate-auth --user-pool-id "$POOL_ID" --client-id "$CLIENT_ID" \
  --auth-flow ADMIN_USER_PASSWORD_AUTH \
  --auth-parameters USERNAME=test@lyralearn.dev,PASSWORD=LyraTest2026Pass \
  --region "$AWS_REGION" --query AuthenticationResult.IdToken --output text)
SUB=$(aws cognito-idp admin-get-user --user-pool-id "$POOL_ID" --username test@lyralearn.dev \
  --region "$AWS_REGION" --query "UserAttributes[?Name=='sub'].Value" --output text)

rows_for_sub() {
  aws dynamodb query --table-name WebSocketConnections --region "$AWS_REGION" \
    --index-name GSI1 --key-condition-expression "userId = :u" \
    --expression-attribute-values "{\":u\":{\"S\":\"$SUB\"}}" \
    --query "Items[].connectionId.S" --output text
}
FRAMES=$(mktemp)
cleanup() {
  [ -n "$LISTENER_PID" ] && kill "$LISTENER_PID" 2>/dev/null || true
  for cid in $(rows_for_sub); do
    [ "$cid" = "None" ] && continue
    aws dynamodb delete-item --table-name WebSocketConnections --region "$AWS_REGION" \
      --key "{\"connectionId\":{\"S\":\"$cid\"}}" >/dev/null 2>&1 || true
  done
  rm -f "$CUT" "$FRAMES"
}
trap cleanup EXIT
: > "$FRAMES"

# --- 1. connect the listener FIRST so no push can be missed ---
"$VENV_PY" - "$WS_URL" "$TOKEN" "$FRAMES" <<'PYEOF' &
import asyncio, datetime, json, sys
import websockets

async def main():
    url, token, out_path = sys.argv[1], sys.argv[2], sys.argv[3]
    loop = asyncio.get_event_loop()
    deadline = loop.time() + 25 * 60
    async with websockets.connect(f"{url}?token={token}", open_timeout=15) as ws:
        print("LISTENER CONNECTED", flush=True)

        async def keepalive():
            # Keepalive strategy (a): API GW's 10-min idle timeout resets on
            # data frames; with no $default route the reply is an error frame
            # (ignored below) and the socket stays open. 240s << 600s.
            while True:
                await asyncio.sleep(240)
                await ws.send('{"action":"keepalive"}')
                print("KEEPALIVE SENT", flush=True)

        ka = asyncio.create_task(keepalive())
        try:
            while True:
                remaining = deadline - loop.time()
                if remaining <= 0:
                    print("LISTENER DEADLINE (25 min)", flush=True)
                    return 1
                try:
                    frame = await asyncio.wait_for(ws.recv(), timeout=remaining)
                except asyncio.TimeoutError:
                    print("LISTENER DEADLINE (25 min)", flush=True)
                    return 1
                now = datetime.datetime.now(datetime.timezone.utc).isoformat()
                try:
                    body = json.loads(frame)
                except ValueError:
                    body = None
                if not isinstance(body, dict) or "jobId" not in body:
                    # API GW error frame for the keepalive, or noise - ignore.
                    continue
                with open(out_path, "a", encoding="utf-8") as f:
                    f.write(json.dumps({"receivedAt": now, "frame": body}) + "\n")
                print(f"PUSH {body.get('status')} {body.get('jobId')}", flush=True)
                if body.get("status") in ("COMPLETE", "FAILED"):
                    return 0
        finally:
            ka.cancel()

sys.exit(asyncio.run(main()))
PYEOF
LISTENER_PID=$!
sleep 3  # let the handshake land before starting the pipeline

# --- 2. fresh cache-miss upload: new 30s window at -ss 160 ---
ffmpeg -y -loglevel error -ss "$CUT_SS" -t 30 -i test_data/input_song.mp3 -c:a libmp3lame "$CUT"
S=$(curl -s -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"title":"6.2 Push Gate"}' "$API/songs")
field() { python -c "import json,sys; print(json.load(sys.stdin).get('$1',''))"; }
SONG_ID=$(echo "$S" | field songId); UP_URL=$(echo "$S" | field uploadUrl)
curl -s -X PUT --upload-file "$CUT" "$UP_URL"
OUT=$(curl -s -X POST -H "Authorization: Bearer $TOKEN" "$API/songs/$SONG_ID/process")
JOB=$(echo "$OUT" | field jobId)
[ -n "$JOB" ] || { echo "FAIL: no jobId - window $CUT_SS hit the fingerprint cache? pick a new -ss offset -> $OUT"; exit 1; }
echo "pipeline started: jobId=$JOB"

has_push() { # $1=status; exits 0 if a recorded frame matches JOB + status
  "$VENV_PY" - "$FRAMES" "$JOB" "$1" <<'PYEOF'
import json, sys
job, want = sys.argv[2], sys.argv[3]
ok = False
for line in open(sys.argv[1], encoding="utf-8"):
    f = json.loads(line)["frame"]
    if f.get("jobId") == job and f.get("status") == want:
        ok = True
sys.exit(0 if ok else 1)
PYEOF
}

# --- 3. early wiring proof: PROCESSING push within 3 min ---
GOT_PROC=0
DEADLINE=$(( $(date +%s) + 180 ))
while [ "$(date +%s)" -le "$DEADLINE" ]; do
  if [ -s "$FRAMES" ] && has_push PROCESSING; then GOT_PROC=1; break; fi
  sleep 5
done
[ "$GOT_PROC" = "1" ] && echo "push: PROCESSING received within 3 min (stream->push wiring live)" \
  || { echo "push: FAIL - no PROCESSING push within 3 min"; FAIL=1; }

# --- 4. wait for the COMPLETE push (listener enforces the 25-min deadline) ---
LISTENER_RC=0; wait "$LISTENER_PID" || LISTENER_RC=$?; LISTENER_PID=""
[ "$LISTENER_RC" = "0" ] || { echo "listener: FAIL (rc=$LISTENER_RC, deadline or socket drop)"; FAIL=1; }
has_push COMPLETE && echo "push: COMPLETE received" \
  || { echo "push: FAIL - no COMPLETE frame recorded"; cat "$FRAMES"; FAIL=1; }

# --- 5. payload == polling contract + 'the moment' latency vs SFN stopDate ---
JOB_KEY=${JOB##*.}
EXEC_ARN="arn:aws:states:$AWS_REGION:503233513399:execution:lyralearn-pipeline-chunked:$JOB_KEY"
STOP_DATE=$(aws stepfunctions describe-execution --execution-arn "$EXEC_ARN" \
  --region "$AWS_REGION" --query stopDate --output text)
"$VENV_PY" - "$FRAMES" "$JOB" "$STOP_DATE" <<'PYEOF' \
  && echo "push: payload matches the GET /jobs contract; latency printed above" \
  || { echo "push: payload/latency FAIL"; FAIL=1; }
import datetime, json, sys
frames = [json.loads(l) for l in open(sys.argv[1], encoding="utf-8")]
job, stop_raw = sys.argv[2], sys.argv[3]
done = [f for f in frames if f["frame"].get("jobId") == job and f["frame"].get("status") == "COMPLETE"]
assert done, "no COMPLETE frame"
f = done[0]["frame"]
assert f["songId"] == job.rsplit(".", 1)[0], f
assert isinstance(f.get("chunkCount"), int) and f["chunkCount"] >= 1, f
assert "error" not in f, f
assert set(f) <= {"jobId", "songId", "status", "stage", "chunkCount"}, f
recv = datetime.datetime.fromisoformat(done[0]["receivedAt"])
stop = datetime.datetime.fromisoformat(stop_raw)
delta = (recv - stop).total_seconds()
print(f"push latency: received {delta:+.1f}s relative to SFN stopDate "
      f"(push={recv.isoformat()}, stopDate={stop.isoformat()})")
# MarkComplete's write happens INSIDE the execution, so slightly-negative is
# expected; anything within +/- a few seconds of execution end is "the moment".
assert -120 <= delta <= 15, f"push not 'the moment': {delta:+.1f}s"
PYEOF

# --- 6. no-polling statement + one post-hoc confirmation read (not a poll) ---
echo "no-polling: structural - the listener is a WebSocket client with no HTTP code path; the pushes above arrived with zero GET /jobs calls"
J=$(curl -s -H "Authorization: Bearer $TOKEN" "$API/jobs/$JOB")
[ "$(echo "$J" | field status)" = "COMPLETE" ] \
  && echo "confirmation: single post-hoc GET /jobs agrees (COMPLETE)" \
  || { echo "confirmation: GET /jobs disagrees -> $J"; FAIL=1; }

[ "$FAIL" = "0" ] && echo "PASS - Phase 6.2 done-when met." || echo "FAIL - see lines above."
exit $FAIL
