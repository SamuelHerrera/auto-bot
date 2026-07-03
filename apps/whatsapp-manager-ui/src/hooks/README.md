# UI Hooks

This folder holds reusable React hooks for named UI workflows.

## Intent

Use this folder for hooks that coordinate React state or browser lifecycle behavior across components.

- `use-workspace-tabs.ts` owns workspace tab persistence, tab cleanup after account refreshes, and horizontal wheel scrolling.
- `use-link-session.ts` owns WhatsApp QR/link dialog state plus the refs needed by async refresh callbacks.
- Server-sent event subscription handling still lives in `app.tsx` because it is tightly coupled to refresh scopes.

## Gotchas

Avoid extracting a hook just because a block is long. A hook is useful here when it gives a behavior a clear name and reduces the number of state/ref details a component needs to know.

Keep hooks free of JSX. Components should render; hooks should name and coordinate behavior.
