# auto-bot agent notes

## Purpose

`auto-bot` is a Hermes-based container workspace with:

- `hermes` preinstalled
- `codex` CLI preinstalled
- Codex auth rebuilt from env vars at startup
- key-based SSH access to the container as `hermes`
- optional ZeroTier support for Linux Docker hosts

## Runtime model

- Main service: `auto-bot`
- Container shell user: `hermes`
- SSH port in the container: `2222` by default
- Host bind: `0.0.0.0:${SSH_PORT}`
- Persistent host data path: `./data`

## Auth model

Codex auth is not mounted from the host `~/.codex` directory. Instead, startup rebuilds `/opt/data/.codex/auth.json` from:

- `CODEX_AUTH_MODE`
- `CODEX_ACCESS_TOKEN`
- `CODEX_REFRESH_TOKEN`
- `CODEX_ID_TOKEN`
- `CODEX_ACCOUNT_ID`

Fallback:

- If those are absent and `OPENAI_API_KEY` is set, the container runs `codex login --with-api-key`

Only these provider vars are intentionally kept:

- `OPENAI_API_KEY`
- `ANTHROPIC_API_KEY`

## ZeroTier

- Target network ID: `56374ac9a42f1be5`
- ZeroTier state persists at `./data/zerotier-one`
- On Linux, use `docker-compose.zerotier.yml` so the container gets `/dev/net/tun`, `NET_ADMIN`, and `SYS_ADMIN`
- When ZeroTier starts successfully, identity files such as `identity.public` and `identity.secret` will live under `./data/zerotier-one`

Known limitation:

- Docker Desktop on this Mac does not expose `/dev/net/tun`, so ZeroTier can be installed in the image but cannot form its network interface here

## Useful commands

Start:

```bash
docker compose up -d --build
```

Start with Linux ZeroTier support:

```bash
docker compose -f docker-compose.yml -f docker-compose.zerotier.yml up -d --build
```

Open a shell:

```bash
docker compose exec -u hermes auto-bot bash
```

SSH in:

```bash
ssh -p 2222 hermes@127.0.0.1
```

Seed `.env` from the current local Codex login:

```bash
./scripts/write-env-from-codex-auth.sh
```

## Repo hygiene

- Do not commit `.env`
- Do not commit `data/`
- Keep the project self-contained under this directory so it can be copied to another machine and resumed there
