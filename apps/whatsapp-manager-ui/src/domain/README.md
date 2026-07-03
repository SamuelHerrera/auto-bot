# UI Domain Helpers

This folder holds framework-light types and pure helper functions for the WhatsApp manager UI.

## Intent

- `models.ts` defines the API-shaped records used by the UI.
- `accounts.ts`, `chats.ts`, `audit-logs.ts`, and `rules.ts` contain formatting and derived-state helpers for those records.
- Helpers here should not call `fetch`, read `localStorage`, mutate React state, or touch the DOM.

## Gotchas

- Chat summaries are derived from direct-chat session mappings and delivery records. Group records are intentionally filtered out by callers before rendering.
- Pending link accounts use account IDs prefixed with `pending-`; account display helpers hide those IDs from primary labels.
- Date formatting currently uses `toLocaleString()` to preserve the app's existing behavior.
- Audit log display helpers convert raw audit actions into readable titles/descriptions while preserving the raw JSON details in the UI.
