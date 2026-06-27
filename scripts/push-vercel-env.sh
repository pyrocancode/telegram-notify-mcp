#!/usr/bin/env bash
# ponytail: one-shot env push — run after `npx vercel login` + `npx vercel link`
set -euo pipefail
cd "$(dirname "$0")/.."
[[ -f .env ]] || { echo "missing .env"; exit 1; }

add() {
  local name="$1"
  local val
  val=$(grep -E "^${name}=" .env | head -1 | cut -d= -f2-)
  [[ -n "$val" ]] || { echo "skip $name (empty)"; return; }
  printf '%s' "$val" | npx vercel@latest env add "$name" production --force
}

for v in TELEGRAM_BOT_TOKEN TELEGRAM_CHAT_ID MCP_SECRET CURSOR_API_KEY CURSOR_MODEL TELEGRAM_WEBHOOK_SECRET ALLOWED_CHAT_IDS PUBLIC_URL; do
  add "$v"
done

echo "done — redeploy: npx vercel --prod"
