# auto-bot

Minimal Hermes-first project scaffold for `~/Work/HYP/auto-bot`.

## Included

- `Dockerfile` based on `nousresearch/hermes-agent`
- `docker-compose.yml` with a persistent Hermes home mounted at `/opt/data`
- `codex` CLI installed in the image
- `zerotier-one` installed in the image
- automatic Codex auth bootstrap from env vars
- SSH server enabled for key-based shell access as `hermes`
- interactive container setup so `hermes` can be used directly inside the container

## Build

```bash
cd /Users/samuelherrerafuente/Work/HYP/auto-bot
docker compose build
```

## Start

```bash
docker compose up -d
docker compose exec -u hermes auto-bot bash
```

Inside the container, both Hermes and Codex are available on the path:

```bash
hermes --help
codex --version
```

## Notes

- Hermes, Codex, and ZeroTier state are persisted on the host under `./data`.
- On startup, the container rebuilds `/opt/data/.codex/auth.json` from `CODEX_AUTH_MODE`, `CODEX_ACCESS_TOKEN`, `CODEX_REFRESH_TOKEN`, `CODEX_ID_TOKEN`, and `CODEX_ACCOUNT_ID` when those vars are present.
- If token vars are absent, the container falls back to `codex login --with-api-key` when `OPENAI_API_KEY` is set.
- The only provider env vars left are `OPENAI_API_KEY` and `ANTHROPIC_API_KEY`.
- SSH listens on `SSH_PORT` and allows only key-based login for user `hermes`.
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
