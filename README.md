# auto-bot

Hermes-first monorepo scaffold for `~/Work/HYP/auto-bot`.

## Included

- `Dockerfile` based on `nousresearch/hermes-agent`
- `docker-compose.yml` with a persistent Hermes home mounted at `/opt/data`
- `codex` CLI installed in the image
- `pnpm`-based monorepo tooling with Turborepo
- `zerotier-one` installed in the image
- automatic Codex auth bootstrap from env vars
- SSH server enabled for key-based shell access as `hermes`
- interactive container setup so `hermes` can be used directly inside the container
- `apps/whatsapp-manager-api` backend scaffold for WhatsApp-to-Hermes routing
- `apps/whatsapp-manager-ui` React/Vite dashboard for WhatsApp account and session management

## Build

```bash
cd /Users/samuelherrerafuente/Work/HYP/auto-bot
docker compose build
npx pnpm@9.15.0 install
```

## Start

```bash
docker compose up -d
docker compose exec -u hermes auto-bot bash
```

Inside the container, Hermes, Codex, and `pnpm` are available on the path:

```bash
hermes --help
codex --version
pnpm --version
```

Run the workspace tasks from the repo root:

```bash
pnpm install
pnpm typecheck
pnpm test
pnpm --filter @auto-bot/whatsapp-manager-api dev
pnpm --filter @auto-bot/whatsapp-manager-ui dev
```

## Monorepo layout

```text
apps/
  whatsapp-manager-api/
  whatsapp-manager-ui/
docs/
scripts/
ssh/
```

The WhatsApp manager now has two apps:

- `apps/whatsapp-manager-api`: Fastify service that owns WhatsApp transport and routes chats into Hermes sessions through an adapter boundary.
- `apps/whatsapp-manager-ui`: browser dashboard for operators to connect or disconnect WhatsApp accounts, review chat-to-session mappings, remap or reset sessions, and send outbound test messages.

The current scaffold still uses a mock WhatsApp gateway and mock Hermes adapter, plus the routing design notes in `docs/whatsapp-hermes-routing.md`.

## Notes

- Hermes, Codex, and ZeroTier state are persisted on the host under `./data`.
- On startup, the container rebuilds `/opt/data/.codex/auth.json` from `CODEX_AUTH_MODE`, `CODEX_ACCESS_TOKEN`, `CODEX_REFRESH_TOKEN`, `CODEX_ID_TOKEN`, and `CODEX_ACCOUNT_ID` when those vars are present.
- If token vars are absent, the container falls back to `codex login --with-api-key` when `OPENAI_API_KEY` is set.
- The only provider env vars left are `OPENAI_API_KEY` and `ANTHROPIC_API_KEY`.
- SSH listens on `SSH_PORT` and allows only key-based login for user `hermes`.
- Docker exposes the WhatsApp API on `3000` and the UI dev server on `4173` by default.
- The WhatsApp manager defaults to mock transport. Set `WHATSAPP_GATEWAY_MODE=baileys` to run the real Baileys gateway and persist its auth state under `/opt/data/whatsapp-manager/baileys`.
- `zerotier-one` is installed, but actual ZeroTier networking inside the container requires `/dev/net/tun` plus extra capabilities; Docker Desktop on this Mac does not provide that.
- Keep secrets in a local `.env` file, not committed to git.

## Local `.env`

Create `/Users/samuelherrerafuente/Work/HYP/auto-bot/.env` with:

```bash
CODEX_AUTH_MODE=chatgpt
CODEX_ACCESS_TOKEN=...
CODEX_REFRESH_TOKEN=...
CODEX_ID_TOKEN=...
CODEX_ACCOUNT_ID=...
SSH_AUTHORIZED_KEY=ssh-rsa ...
SSH_PORT=2222
WHATSAPP_MANAGER_API_PORT=3000
WHATSAPP_MANAGER_API_TOKEN=local-dev-token
WHATSAPP_MANAGER_UI_PORT=4173
WHATSAPP_MANAGER_UI_CORS_ORIGIN=http://127.0.0.1:4173,http://localhost:4173
VITE_WHATSAPP_MANAGER_API_URL=http://127.0.0.1:3000
VITE_WHATSAPP_MANAGER_UI_TITLE=WhatsApp Account Console
WHATSAPP_GATEWAY_MODE=mock
HERMES_ADAPTER_MODE=mock
HERMES_API_BASE_URL=http://127.0.0.1:8642/v1
HERMES_API_KEY=
HERMES_API_MODEL=hermes-agent
BAILEYS_STATE_DIR=/opt/data/whatsapp-manager/baileys
BRIDGE_STATE_FILE=/opt/data/whatsapp-manager/bridge-state.json
AUTO_BOT_DATA_DIR=./data
ZEROTIER_AUTOSTART=1
ZEROTIER_NETWORK_ID=56374ac9a42f1be5
OPENAI_API_KEY=
ANTHROPIC_API_KEY=
```

If you want to seed that from your current Codex login automatically:

```bash
./scripts/write-env-from-codex-auth.sh
```

## Access Methods

Start the container:

```bash
cd /Users/samuelherrerafuente/Work/HYP/auto-bot
docker compose up -d --build
```

Docker exec shell:

```bash
docker compose exec -u hermes auto-bot bash
```

Run the API:

```bash
pnpm --filter @auto-bot/whatsapp-manager-api dev
```

Run the UI:

```bash
pnpm --filter @auto-bot/whatsapp-manager-ui dev
```

Open the dashboard:

```text
http://127.0.0.1:4173
```

SSH shell:

```bash
ssh -p 2222 hermes@127.0.0.1
```

## ZeroTier

The image includes `zerotier-one` and persists its state in `./data/zerotier-one` on the host through the `/opt/data/zerotier-one` path in the container.
When ZeroTier starts successfully on a Linux host, its identity and network state will be written there, including files such as `identity.public`, `identity.secret`, and the joined network state.

On a Linux Docker host that exposes `/dev/net/tun`, start with the override file:

```bash
docker compose -f docker-compose.yml -f docker-compose.zerotier.yml up -d --build
```

That enables:

- `NET_ADMIN`
- `SYS_ADMIN`
- `/dev/net/tun`

When `ZEROTIER_AUTOSTART=1`, the entrypoint will start ZeroTier and, if `ZEROTIER_NETWORK_ID` is set, attempt to join that network.

Inside the container you can inspect it with:

```bash
zerotier-cli info
zerotier-cli listnetworks
```
