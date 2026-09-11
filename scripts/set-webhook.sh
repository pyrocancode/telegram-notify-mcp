#!/usr/bin/env bash
# allowed_updates must include business_message, иначе секретарь не получит ЛС
set -euo pipefail
cd "$(dirname "$0")/.."
[[ -f .env ]] || { echo "missing .env"; exit 1; }
val() { grep -E "^$1=" .env | head -1 | cut -d= -f2-; }
TOKEN=$(val TELEGRAM_BOT_TOKEN)
SECRET=$(val TELEGRAM_WEBHOOK_SECRET)
URL=$(val PUBLIC_URL)
URL=${URL%/}
[[ -n "$TOKEN" && -n "$SECRET" && -n "$URL" ]] || {
  echo "need TELEGRAM_BOT_TOKEN, TELEGRAM_WEBHOOK_SECRET, PUBLIC_URL"
  exit 1
}
curl -sS "https://api.telegram.org/bot${TOKEN}/setWebhook" \
  -d "url=${URL}/telegram/webhook" \
  -d "secret_token=${SECRET}" \
  -d 'allowed_updates=["message","business_message","business_connection"]'
echo
