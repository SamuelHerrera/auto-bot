#!/usr/bin/env bash
set -euo pipefail

API_URL="${WHATSAPP_MANAGER_API_URL:-http://127.0.0.1:${WHATSAPP_MANAGER_API_PORT:-3000}}"
API_URL="${API_URL%/}"
API_TOKEN="${WHATSAPP_MANAGER_API_TOKEN:-local-dev-token}"
ACCOUNT_ID="${1:-${WHATSAPP_ACCOUNT_ID:-}}"
CHAT_JID="${2:-${WHATSAPP_CHAT_JID:-}}"

url_encode() {
  node -e "process.stdout.write(encodeURIComponent(process.argv[1] || ''))" "$1"
}

query() {
  local path="$1"
  curl -fsS \
    -H "authorization: Bearer ${API_TOKEN}" \
    -H "accept: application/json" \
    "${API_URL}${path}"
}

with_query() {
  local path="$1"
  local separator="?"
  if [[ "${path}" == *"?"* ]]; then
    separator="&"
  fi

  if [[ -n "${ACCOUNT_ID}" ]]; then
    path="${path}${separator}accountId=$(url_encode "${ACCOUNT_ID}")"
    separator="&"
  fi

  printf '%s' "${path}"
}

print_section() {
  printf '\n## %s\n' "$1"
}

print_section "summary"
query "$(with_query "/whatsapp/sync/summary")"

print_section "history batches"
query "$(with_query "/whatsapp/sync/history-batches?limit=20")"

print_section "chats"
query "$(with_query "/whatsapp/sync/chats?limit=20")"

print_section "contacts"
query "$(with_query "/whatsapp/sync/contacts?limit=20")"

print_section "lid mappings"
query "$(with_query "/whatsapp/sync/lid-mappings?limit=50")"

print_section "sync events"
query "$(with_query "/whatsapp/sync/events?limit=50")"

if [[ -n "${CHAT_JID}" ]]; then
  print_section "messages for ${CHAT_JID}"
  query "$(with_query "/whatsapp/sync/messages?limit=50&chatJid=$(url_encode "${CHAT_JID}")")"
else
print_section "messages"
query "$(with_query "/whatsapp/sync/messages?limit=50")"
fi

print_section "message receipts"
query "$(with_query "/whatsapp/sync/message-receipts?limit=50")"

print_section "message updates"
query "$(with_query "/whatsapp/sync/message-updates?limit=50")"

print_section "media assets"
query "$(with_query "/whatsapp/sync/media-assets?limit=50")"

printf '\n'
