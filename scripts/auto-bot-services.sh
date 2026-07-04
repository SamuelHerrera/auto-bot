#!/usr/bin/env bash
set -euo pipefail

cd /opt/app
mkdir -p /opt/data/logs

api_pid=""
ui_pid=""
kitchen_pid=""

stop_services() {
  if [ -n "${api_pid}" ]; then
    kill "${api_pid}" >/dev/null 2>&1 || true
  fi
  if [ -n "${ui_pid}" ]; then
    kill "${ui_pid}" >/dev/null 2>&1 || true
  fi
  if [ -n "${kitchen_pid}" ]; then
    kill "${kitchen_pid}" >/dev/null 2>&1 || true
  fi
}

trap stop_services INT TERM EXIT

CI=true pnpm install --frozen-lockfile >>/opt/data/logs/pnpm-install.log 2>&1

pnpm --filter @auto-bot/kitchen-api prisma:generate >>/opt/data/logs/kitchen-api-prisma.log 2>&1
pnpm --filter @auto-bot/kitchen-api prisma:push >>/opt/data/logs/kitchen-api-prisma.log 2>&1
pnpm --filter @auto-bot/kitchen-api db:seed:dev >>/opt/data/logs/kitchen-api-seed.log 2>&1

pnpm --filter @auto-bot/whatsapp-manager-api dev >>/opt/data/logs/whatsapp-manager-api.log 2>&1 &
api_pid="$!"

PORT="${KITCHEN_API_PORT:-3001}" pnpm --filter @auto-bot/kitchen-api dev >>/opt/data/logs/kitchen-api.log 2>&1 &
kitchen_pid="$!"

pnpm --filter @auto-bot/whatsapp-manager-ui dev >>/opt/data/logs/whatsapp-manager-ui.log 2>&1 &
ui_pid="$!"

wait -n "${api_pid}" "${kitchen_pid}" "${ui_pid}"
