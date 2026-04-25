#!/usr/bin/env bash
# Live API smoke test (spec §7.4). Hand-runnable: covers /score, /capture,
# /diff, /wiki/recent against the deployed Railway endpoint with the demo
# team token. Pass --local to point at http://localhost:3000.

set -euo pipefail

API_URL="${TRAILHEAD_API_URL:-https://trailheadapi-production.up.railway.app}"
TOKEN="${TRAILHEAD_TEAM_TOKEN:-trailhead_demo_acme_2026}"

if [[ "${1:-}" == "--local" ]]; then
  API_URL="http://localhost:3000"
fi

if ! command -v curl >/dev/null 2>&1; then
  echo "smoke.sh requires curl" >&2
  exit 1
fi
JQ="cat"
if command -v jq >/dev/null 2>&1; then
  JQ="jq ."
fi

H_JSON=( -H "Content-Type: application/json" -H "X-Team-Token: ${TOKEN}" )

echo "=== POST /score ==="
curl -sS -X POST "${API_URL}/score" "${H_JSON[@]}" \
  -d '{"prompt":"fix the retry","user_id":"demo"}' | $JQ
echo

echo "=== POST /capture ==="
curl -sS -X POST "${API_URL}/capture" "${H_JSON[@]}" \
  -d '{"surface":"browser","user_prompt":"fix the retry","user_id":"demo"}' | $JQ
echo

echo "=== POST /diff ==="
curl -sS -X POST "${API_URL}/diff" "${H_JSON[@]}" \
  -d '{"user_prompt":"fix the retry","file_path":"src/api/webhooks/handler.ts","user_id":"demo"}' | $JQ
echo

echo "=== GET /wiki/recent ==="
SINCE=$(date -u -d '1 hour ago' +%Y-%m-%dT%H:%M:%S.000Z 2>/dev/null \
  || date -u -v-1H +%Y-%m-%dT%H:%M:%S.000Z 2>/dev/null \
  || echo "2026-04-25T00:00:00.000Z")
curl -sS -G "${API_URL}/wiki/recent" "${H_JSON[@]}" \
  --data-urlencode "since=${SINCE}" | $JQ
echo

echo "smoke ok"
