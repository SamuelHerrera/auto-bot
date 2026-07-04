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

- `apps/whatsapp-manager-api`: Fastify service that owns live Baileys WhatsApp transport, routes chats into Hermes sessions through an adapter boundary, and persists bridge operations in SQLite by default.
- `apps/whatsapp-manager-ui`: browser dashboard for operators to connect or disconnect WhatsApp accounts, review direct chat activity, and retry failed deliveries.

The WhatsApp manager runs the Baileys gateway for live WhatsApp connectivity and can use the Hermes API adapter against Hermes' native API server session endpoints.

WhatsApp sync metadata is tracked separately from Hermes delivery records. See `docs/whatsapp-sync-data-matrix.md` for the storage matrix and logout/relogin validation flow. The quick validation commands are:

```bash
pnpm sync:dump <accountId>
pnpm sync:wait -- --account <accountId>
pnpm sync:corroborate -- --account <accountId>
pnpm sync:compare -- --before before.json --after after.json
```

## Notes

- Agent and maintainer engineering guidelines live in `AGENTS.md`; read them before changing persistence, delivery status semantics, or recovery/cleanup code.
- Hermes, Codex, and ZeroTier state are persisted on the host under `./data`.
- On startup, the container rebuilds `/opt/data/.codex/auth.json` from `CODEX_AUTH_MODE`, `CODEX_ACCESS_TOKEN`, `CODEX_REFRESH_TOKEN`, `CODEX_ID_TOKEN`, and `CODEX_ACCOUNT_ID` when those vars are present.
- If token vars are absent, the container falls back to `codex login --with-api-key` when `OPENAI_API_KEY` is set.
- The only provider env vars left are `OPENAI_API_KEY` and `ANTHROPIC_API_KEY`.
- SSH listens on `SSH_PORT` and allows only key-based login for user `hermes`.
- Docker exposes the WhatsApp API on `3000` and the UI dev server on `4173` by default.
- The WhatsApp manager always uses live Baileys transport and persists auth state under `/opt/data/whatsapp-manager/baileys`.
- Bridge mappings, processed WhatsApp message IDs, delivery records, and WhatsApp sync tables persist in SQLite at `/opt/data/whatsapp-manager/bridge-state.sqlite` by default.
- Live WhatsApp media files are retained under `/opt/data/whatsapp-manager/media` by default, and the corresponding sync media row stores the local path.
- Run `hermes gateway run --force --accept-hooks` when using the Hermes platform plugin. WhatsApp Manager exposes neutral platform adapter APIs; the bundled Hermes adapter is one compatible implementation. See `docs/whatsapp-manager-postbacks.md` for the native platform adapter flow and generic HTTP webhook postbacks. The container creates a persistent internal key at `/opt/data/whatsapp-manager/internal-api-key` and exports compatibility names for Hermes.
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
WHATSAPP_MANAGER_UI_CORS_ORIGIN=*
VITE_WHATSAPP_MANAGER_API_URL=
VITE_WHATSAPP_MANAGER_UI_TITLE=WhatsApp Account Console
AGENT_API_BASE_URL=http://127.0.0.1:8642
AGENT_API_MODEL=hermes-agent
WHATSAPP_MANAGER_NATIVE_ADAPTER_ENABLED=auto
WHATSAPP_MANAGER_API_URL=http://127.0.0.1:3000
WHATSAPP_MANAGER_ALLOW_ALL_USERS=true
WHATSAPP_MANAGER_ALLOWED_USERS=
WHATSAPP_MANAGER_HOME_CHANNEL=
WHATSAPP_MANAGER_POLL_INTERVAL=1
WHATSAPP_MANAGER_PAGE_SIZE=50
POSTBACK_RUN_RETENTION_DAYS=30
HERMES_PLATFORM_EVENT_RETENTION_DAYS=7
BAILEYS_STATE_DIR=/opt/data/whatsapp-manager/baileys
WHATSAPP_MEDIA_DIR=/opt/data/whatsapp-manager/media
BRIDGE_DATABASE_FILE=/opt/data/whatsapp-manager/bridge-state.sqlite
BRIDGE_STATE_FILE=
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
