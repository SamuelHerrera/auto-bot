#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
AUTH_FILE="${HOME}/.codex/auth.json"
ENV_FILE="${ROOT_DIR}/.env"
SSH_PUBLIC_KEY_FILE="${HOME}/.ssh/id_rsa.pub"
ZEROTIER_NETWORK_ID_FILE="${HOME}/Work/HYP/secrets/zerotier-network-id"

quote_value() {
  jq -Rn --arg v "$1" '$v'
}

if [ ! -f "${AUTH_FILE}" ]; then
  echo "Missing ${AUTH_FILE}" >&2
  exit 1
fi

OPENAI_API_KEY_VALUE="$(jq -r '.OPENAI_API_KEY // empty' "${AUTH_FILE}")"
AUTH_MODE_VALUE="$(jq -r '.auth_mode // empty' "${AUTH_FILE}")"
ACCESS_TOKEN_VALUE="$(jq -r '.tokens.access_token // empty' "${AUTH_FILE}")"
REFRESH_TOKEN_VALUE="$(jq -r '.tokens.refresh_token // empty' "${AUTH_FILE}")"
ID_TOKEN_VALUE="$(jq -r '.tokens.id_token // empty' "${AUTH_FILE}")"
ACCOUNT_ID_VALUE="$(jq -r '.tokens.account_id // empty' "${AUTH_FILE}")"
SSH_AUTHORIZED_KEY_VALUE=""
ZEROTIER_NETWORK_ID_VALUE=""

if [ -f "${SSH_PUBLIC_KEY_FILE}" ]; then
  SSH_AUTHORIZED_KEY_VALUE="$(tr -d '\n' < "${SSH_PUBLIC_KEY_FILE}")"
fi

if [ -f "${ZEROTIER_NETWORK_ID_FILE}" ]; then
  ZEROTIER_NETWORK_ID_VALUE="$(tr -d '\n' < "${ZEROTIER_NETWORK_ID_FILE}")"
fi

if [ -n "${AUTH_MODE_VALUE}" ] \
  && [ -n "${ACCESS_TOKEN_VALUE}" ] \
  && [ -n "${REFRESH_TOKEN_VALUE}" ] \
  && [ -n "${ID_TOKEN_VALUE}" ] \
  && [ -n "${ACCOUNT_ID_VALUE}" ]; then
  cat > "${ENV_FILE}" <<EOF
CODEX_AUTH_MODE=$(quote_value "${AUTH_MODE_VALUE}")
CODEX_ACCESS_TOKEN=$(quote_value "${ACCESS_TOKEN_VALUE}")
CODEX_REFRESH_TOKEN=$(quote_value "${REFRESH_TOKEN_VALUE}")
CODEX_ID_TOKEN=$(quote_value "${ID_TOKEN_VALUE}")
CODEX_ACCOUNT_ID=$(quote_value "${ACCOUNT_ID_VALUE}")
SSH_AUTHORIZED_KEY=$(quote_value "${SSH_AUTHORIZED_KEY_VALUE}")
SSH_PORT="2222"
AUTO_BOT_DATA_DIR="./data"
ZEROTIER_AUTOSTART="1"
ZEROTIER_NETWORK_ID=$(quote_value "${ZEROTIER_NETWORK_ID_VALUE}")
OPENAI_API_KEY=""
ANTHROPIC_API_KEY=""
EOF
elif [ -n "${OPENAI_API_KEY_VALUE}" ]; then
  cat > "${ENV_FILE}" <<EOF
CODEX_AUTH_MODE=""
CODEX_ACCESS_TOKEN=""
CODEX_REFRESH_TOKEN=""
CODEX_ID_TOKEN=""
CODEX_ACCOUNT_ID=""
SSH_AUTHORIZED_KEY=$(quote_value "${SSH_AUTHORIZED_KEY_VALUE}")
SSH_PORT="2222"
AUTO_BOT_DATA_DIR="./data"
ZEROTIER_AUTOSTART="1"
ZEROTIER_NETWORK_ID=$(quote_value "${ZEROTIER_NETWORK_ID_VALUE}")
OPENAI_API_KEY=$(quote_value "${OPENAI_API_KEY_VALUE}")
ANTHROPIC_API_KEY=""
EOF
else
  echo "No supported Codex auth data found in ${AUTH_FILE}" >&2
  exit 1
fi

chmod 0600 "${ENV_FILE}"
echo "Wrote ${ENV_FILE}"
