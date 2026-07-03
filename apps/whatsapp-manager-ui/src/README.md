# WhatsApp Manager UI Source

The UI uses a shallow structure so the app is easier to scan without hiding behavior behind too many layers.

## Folders

- `app.tsx`: stateful app shell and workflow orchestration.
- `components/`: render-focused React components and small view-local state.
- `domain/`: API-shaped types plus pure derived-state helpers.
- `services/`: browser and API boundary code.
- `hooks/`: reserved for future reusable React lifecycle/state hooks.

## Refactor rule

Preserve the current behavior first. When moving code, prefer mechanical extraction with matching names and then run `pnpm --filter @auto-bot/whatsapp-manager-ui typecheck` and `pnpm --filter @auto-bot/whatsapp-manager-ui build`.
