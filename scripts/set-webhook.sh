#!/usr/bin/env bash
# allowed_updates must include business_message, иначе секретарь не получит ЛС
set -euo pipefail
cd "$(dirname "$0")/.."

val() {
  local name="$1"
  local v="${!name:-}"
  if [[ -n "$v" && "$v" != "[SENSITIVE]" ]]; then
    printf '%s' "$v"
    return
  fi
  if [[ -f .env ]]; then
    v=$(grep -E "^${name}=" .env | head -1 | cut -d= -f2- || true)
    if [[ -n "$v" && "$v" != "[SENSITIVE]" ]]; then
      printf '%s' "$v"
      return
    fi
  fi
  return 1
}

TOKEN=$(val TELEGRAM_BOT_TOKEN) || true
SECRET=$(val TELEGRAM_WEBHOOK_SECRET) || true
URL=$(val PUBLIC_URL) || true
URL=${URL:-https://telegram-notify-mcp.vercel.app}
URL=${URL%/}

if [[ -z "${TOKEN:-}" || -z "${SECRET:-}" ]]; then
  echo "Нет токена. Запусти так:"
  echo "  npx vercel env run --environment production -- bash scripts/set-webhook.sh"
  exit 1
fi

curl -sS "https://api.telegram.org/bot${TOKEN}/setWebhook" \
  -d "url=${URL}/telegram/webhook" \
  -d "secret_token=${SECRET}" \
  -d 'allowed_updates=["message","business_message","business_connection"]'
echo
