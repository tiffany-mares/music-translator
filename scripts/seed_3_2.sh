#!/usr/bin/env bash
# Phase 3.2: seed the METADATA item for test-song-001 pointing at REAL artifacts.
# Usage: AWS_REGION=... scripts/seed_3_2.sh
set -euo pipefail
: "${AWS_REGION:?}"
STITCH="songs/test-song-001/stitched/job-2-4-20260727-023532/stems/htdemucs/input_song"
aws dynamodb put-item --table-name LyraLearnTable --region "$AWS_REGION" --item "{
  \"PK\": {\"S\": \"SONG#test-song-001\"}, \"SK\": {\"S\": \"METADATA\"},
  \"title\": {\"S\": \"Dragostea din tei\"}, \"artist\": {\"S\": \"O-Zone\"},
  \"uploadedBy\": {\"S\": \"seed\"}, \"status\": {\"S\": \"COMPLETE\"},
  \"createdAt\": {\"S\": \"2026-07-27T00:00:00Z\"},
  \"GSI1PK\": {\"S\": \"USER#seed\"}, \"GSI1SK\": {\"S\": \"2026-07-27T00:00:00Z\"},
  \"audioKeys\": {\"M\": {
    \"raw\": {\"S\": \"songs/test-song-001/raw/input_song.mp3\"},
    \"vocals\": {\"S\": \"$STITCH/vocals.wav\"},
    \"noVocals\": {\"S\": \"$STITCH/no_vocals.wav\"}
  }}
}"
echo "seeded SONG#test-song-001 METADATA"
