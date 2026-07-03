# UI Components

This folder holds render-focused React components for the WhatsApp manager UI.

## Intent

- Keep markup, local view state, and small UI event wiring here.
- Keep cross-view orchestration in `../app.tsx`.
- Keep API calls, storage, and pure data shaping out of component files.

## Current shape

- `number-workspace.tsx` contains the account workspace tabs: home, messages, rules, failures, and the alias dialog.
- `panels.tsx` contains app-level overlay panels for number selection and QR linking.
- `settings-view.tsx` and `logs-view.tsx` are standalone workspace tabs.
- `shared.tsx` contains small primitives reused by the app shell and views.

## Gotchas

- Many CSS classes are shared through `../styles.css`; rename classes only with a browser pass.
- `LinkAccountDialog` relies on `qrcode.react` and should continue to render QR payloads without transforming them.
- `LogsView` owns its local filters because they are display-only and do not affect app-level state.
