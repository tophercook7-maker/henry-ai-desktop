#!/usr/bin/env bash
#
# issue-license.sh — generate a Henry license key and insert it into KV.
#
# Usage:
#   ./issue-license.sh alice@example.com           # pro tier, 2000/day
#   ./issue-license.sh alice@example.com enterprise  # enterprise, 20000/day
#   ./issue-license.sh alice@example.com pro 5000   # custom daily limit
#
# Output: prints the new license key to stdout. Send it to the buyer.
#
set -euo pipefail

EMAIL="${1:?usage: ./issue-license.sh email@example.com [tier] [daily_limit]}"
TIER="${2:-pro}"
CUSTOM_LIMIT="${3:-}"

case "$TIER" in
  pro)        DEFAULT_LIMIT=2000 ;;
  enterprise) DEFAULT_LIMIT=20000 ;;
  *)          echo "Unknown tier '$TIER' (expected pro|enterprise)" >&2; exit 1 ;;
esac

LIMIT="${CUSTOM_LIMIT:-$DEFAULT_LIMIT}"
SUFFIX="$(uuidgen | tr -d '-' | head -c 16 | awk '{print toupper($0)}')"
KEY="HENRY-${SUFFIX}"
TODAY="$(date -u +%Y-%m-%d)"

JSON=$(cat <<EOF
{"active":true,"tier":"$TIER","owner":"$EMAIL","daily_limit":$LIMIT,"created_at":"$TODAY"}
EOF
)

echo "→ Inserting license into KV (remote / production)…"
# wrangler 4.x uses 'kv key put' (spaces) and defaults writes to LOCAL simulated KV.
# We always need --remote to hit the real Cloudflare KV that the deployed worker reads.
# Try the modern syntax first; fall back to the 3.x 'kv:key put' (colons) form if needed.
if ! npx wrangler kv key put --binding=HENRY_KV --remote "license:$KEY" "$JSON" 2>/dev/null; then
  npx wrangler kv:key put --binding=HENRY_KV --remote "license:$KEY" "$JSON"
fi

cat <<EOF

✓ License issued

  Key:          $KEY
  Tier:         $TIER
  Daily limit:  $LIMIT
  Owner:        $EMAIL
  Created:      $TODAY

Send to buyer:
──────────────────────────────────────────
Your Henry license key: $KEY

Paste it into Henry → Settings → License.
You'll get $LIMIT requests per day at no further cost.
──────────────────────────────────────────

To revoke later:
  npx wrangler kv:key put --binding=HENRY_KV "license:$KEY" '{"active":false}'
EOF
