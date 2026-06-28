#!/usr/bin/env bash
set -euo pipefail

CODEX_HOME="${CODEX_HOME:-${HOME:-/opt/data}/.codex}"
CODEX_AUTH_MODE_VALUE="${CODEX_AUTH_MODE:-}"
CODEX_ACCESS_TOKEN_VALUE="${CODEX_ACCESS_TOKEN:-}"
CODEX_REFRESH_TOKEN_VALUE="${CODEX_REFRESH_TOKEN:-}"
CODEX_ID_TOKEN_VALUE="${CODEX_ID_TOKEN:-}"
CODEX_ACCOUNT_ID_VALUE="${CODEX_ACCOUNT_ID:-}"
OPENAI_API_KEY_VALUE="${OPENAI_API_KEY:-}"
SSH_AUTHORIZED_KEY_VALUE="${SSH_AUTHORIZED_KEY:-}"
SSH_PORT_VALUE="${SSH_PORT:-2222}"
ZEROTIER_AUTOSTART_VALUE="${ZEROTIER_AUTOSTART:-0}"
ZEROTIER_NETWORK_ID_VALUE="${ZEROTIER_NETWORK_ID:-}"

mkdir -p "${CODEX_HOME}"
passwd -d hermes >/dev/null 2>&1 || true

cat > /opt/data/.bashrc <<'EOF'
export HERMES_HOME=/opt/data
export CODEX_HOME=/opt/data/.codex
export PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:$PATH
EOF

cat > /opt/data/.profile <<'EOF'
export HERMES_HOME=/opt/data
export CODEX_HOME=/opt/data/.codex
export PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:$PATH
EOF

chown hermes:hermes /opt/data/.bashrc /opt/data/.profile

if [ -n "${SSH_AUTHORIZED_KEY_VALUE}" ]; then
  install -d -m 0700 -o hermes -g hermes /opt/data/.ssh
  printf '%s\n' "${SSH_AUTHORIZED_KEY_VALUE}" > /opt/data/.ssh/authorized_keys
  chmod 0600 /opt/data/.ssh/authorized_keys
  chown hermes:hermes /opt/data/.ssh/authorized_keys
fi

mkdir -p /opt/data/zerotier-one
if id zerotier-one >/dev/null 2>&1; then
  chown -R zerotier-one:zerotier-one /opt/data/zerotier-one
  chmod 0700 /opt/data/zerotier-one
fi
if [ "${ZEROTIER_AUTOSTART_VALUE}" = "1" ]; then
  if ! command -v zerotier-one >/dev/null 2>&1; then
    echo "ZeroTier autostart requested but zerotier-one is not installed." >&2
  elif [ ! -c /dev/net/tun ]; then
    echo "ZeroTier autostart requested but /dev/net/tun is not available in this container runtime." >&2
  else
    zerotier-one -d
    if [ -n "${ZEROTIER_NETWORK_ID_VALUE}" ]; then
      for _ in $(seq 1 30); do
        if zerotier-cli info >/dev/null 2>&1; then
          break
        fi
        sleep 1
      done
      zerotier-cli join "${ZEROTIER_NETWORK_ID_VALUE}" >/dev/null 2>&1 || true
    fi
  fi
fi

mkdir -p /run/sshd
install -d -m 0700 -o root -g root /opt/data/ssh-host-keys

if [ ! -f /opt/data/ssh-host-keys/ssh_host_rsa_key ]; then
  ssh-keygen -q -N "" -t rsa -b 4096 -f /opt/data/ssh-host-keys/ssh_host_rsa_key
fi
if [ ! -f /opt/data/ssh-host-keys/ssh_host_ecdsa_key ]; then
  ssh-keygen -q -N "" -t ecdsa -b 521 -f /opt/data/ssh-host-keys/ssh_host_ecdsa_key
fi
if [ ! -f /opt/data/ssh-host-keys/ssh_host_ed25519_key ]; then
  ssh-keygen -q -N "" -t ed25519 -f /opt/data/ssh-host-keys/ssh_host_ed25519_key
fi

chown root:root /opt/data/ssh-host-keys/ssh_host_* /opt/data/ssh-host-keys/ssh_host_*.pub
chmod 0600 /opt/data/ssh-host-keys/ssh_host_*
chmod 0644 /opt/data/ssh-host-keys/ssh_host_*.pub
if ! grep -q "^Port ${SSH_PORT_VALUE}$" /etc/ssh/sshd_config; then
  sed -i.bak "s/^Port .*/Port ${SSH_PORT_VALUE}/" /etc/ssh/sshd_config
fi
/usr/sbin/sshd

if [ -n "${CODEX_AUTH_MODE_VALUE}" ] \
  && [ -n "${CODEX_ACCESS_TOKEN_VALUE}" ] \
  && [ -n "${CODEX_REFRESH_TOKEN_VALUE}" ] \
  && [ -n "${CODEX_ID_TOKEN_VALUE}" ] \
  && [ -n "${CODEX_ACCOUNT_ID_VALUE}" ]; then
  node <<'EOF'
const fs = require("fs");
const path = require("path");

const codexHome = process.env.CODEX_HOME;
const authPath = path.join(codexHome, "auth.json");
const payload = {
  auth_mode: process.env.CODEX_AUTH_MODE,
  tokens: {
    access_token: process.env.CODEX_ACCESS_TOKEN,
    refresh_token: process.env.CODEX_REFRESH_TOKEN,
    id_token: process.env.CODEX_ID_TOKEN,
    account_id: process.env.CODEX_ACCOUNT_ID,
  },
};

fs.writeFileSync(authPath, `${JSON.stringify(payload)}\n`, { mode: 0o600 });
EOF
elif [ -n "${OPENAI_API_KEY_VALUE}" ] && [ ! -f "${CODEX_HOME}/auth.json" ]; then
  printf '%s\n' "${OPENAI_API_KEY_VALUE}" | codex login --with-api-key >/dev/null
fi

chown -R hermes:hermes /opt/data/.codex

exec sudo -E -H -u hermes "$@"
