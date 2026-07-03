# UI Hooks

This folder is reserved for reusable React hooks once behavior is stable enough to extract.

## Intent

Use this folder for hooks that coordinate React state or browser lifecycle behavior across components. Examples that could move here later:

- workspace tab lifecycle
- WhatsApp link session tracking
- server-sent event subscriptions

## Gotchas

Avoid extracting a hook just because a block is long. A hook is useful here when it gives a behavior a clear name and reduces the number of state/ref details a component needs to know.
