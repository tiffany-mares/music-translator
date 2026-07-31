#!/usr/bin/env bash
# Build the frontend and deploy to S3 + invalidate CloudFront.
# Usage: scripts/deploy_frontend.sh   (uses ambient AWS creds; BUCKET/DIST_ID overridable)
set -euo pipefail
export MSYS_NO_PATHCONV=1 # Git Bash mangles "/index.html" args into C:/Program Files/... otherwise
cd "$(dirname "$0")/../frontend"

BUCKET="${BUCKET:-lyralearn-frontend-503233513399}"
DIST_ID="${DIST_ID:-$(cd ../terraform && terraform output -raw cloudfront_distribution_id)}"

npm ci
npm run build

# Hashed assets first (immutable), index.html last (no-cache) — a new index.html
# never references assets that aren't uploaded yet. No --delete: old hashed
# assets keep serving already-open tabs.
aws s3 sync dist/ "s3://$BUCKET/" --exclude "index.html" \
  --cache-control "public,max-age=31536000,immutable"
aws s3 cp dist/index.html "s3://$BUCKET/index.html" \
  --cache-control "no-cache" --content-type "text/html"

aws cloudfront create-invalidation --distribution-id "$DIST_ID" --paths "/index.html" "/"
echo "deployed to https://$(cd ../terraform && terraform output -raw cloudfront_domain)"
