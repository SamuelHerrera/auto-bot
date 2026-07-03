# UI Services

This folder holds browser services that touch external boundaries.

## Intent

- `api-client.ts` owns authenticated API requests, event stream URL construction, and user-facing error normalization.
- `branding.ts` owns document branding defaults, local branding storage keys, and favicon updates.
- `workspace-storage.ts` owns the workspace tab persistence contract in `localStorage`.

## Gotchas

- The API token defaults to `local-dev-token` to match the current local development setup.
- EventSource cannot send custom headers, so `/events` receives the token as a query parameter.
- Workspace persistence stores tab IDs as raw account IDs plus reserved IDs: `settings` and `logs`.
