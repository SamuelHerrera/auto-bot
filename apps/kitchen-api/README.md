# Kitchen API

Kitchen backend application imported from `GiovanniSalazar-n/KitchenBot-for-WhatsApp-With-hermes`.

This package intentionally contains only the backend application code:

- Express HTTP API under `src/`
- Prisma schema under `prisma/`
- app-local scripts under `scripts/`
- backend regression tests under `test/`

It intentionally does not include the source repository's Docker setup, agent scaffolding, or separate WhatsApp/Hermes service packages.

## Commands

From the repository root:

```bash
pnpm --filter @auto-bot/kitchen-api dev
pnpm --filter @auto-bot/kitchen-api typecheck
pnpm --filter @auto-bot/kitchen-api test
pnpm --filter @auto-bot/kitchen-api prisma:generate
```

The API expects `DATABASE_URL` for Prisma/Postgres-backed flows.
