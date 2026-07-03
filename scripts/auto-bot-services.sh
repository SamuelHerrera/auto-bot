#!/usr/bin/env bash
set -euo pipefail

cd /opt/app
mkdir -p /opt/data/logs

api_pid=""
ui_pid=""

stop_services() {
  if [ -n "${api_pid}" ]; then
    kill "${api_pid}" >/dev/null 2>&1 || true
  fi
  if [ -n "${ui_pid}" ]; then
    kill "${ui_pid}" >/dev/null 2>&1 || true
  fi
}

trap stop_services INT TERM EXIT

pnpm --filter @auto-bot/whatsapp-manager-api dev >>/opt/data/logs/whatsapp-manager-api.log 2>&1 &
api_pid="$!"

pnpm --filter @auto-bot/whatsapp-manager-ui dev >>/opt/data/logs/whatsapp-manager-ui.log 2>&1 &
ui_pid="$!"

wait -n "${api_pid}" "${ui_pid}"
