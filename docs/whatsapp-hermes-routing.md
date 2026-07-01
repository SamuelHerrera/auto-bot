# WhatsApp To Hermes Session Routing

This service owns WhatsApp transport and routing. Hermes is treated as a downstream execution engine.

## Recommended default

Use `1 WhatsApp account + chat -> 1 Hermes session`.

- Each WhatsApp routing key gets one dedicated Hermes session.
- The service persists `session_key -> hermes_session_id`.
- The first inbound message creates the mapping.
- Later messages reuse the same Hermes session until the mapping is reset or remapped.

This is the safest model for context isolation and debugging.

The default routing key is:

```text
whatsapp:{accountId}:{chatType}:{chatJid}
```

For participant-isolated group routing, the key can include the participant JID:

```text
whatsapp:{accountId}:group:{groupJid}:user:{participantJid}
```

## Other mapping options

### `1 user -> 1 Hermes session`

Use one Hermes session for all chats owned by the same operator or tenant.

- Lower session churn.
- Higher risk of context leakage between chats.
- Requires an additional identity layer beyond raw WhatsApp chat IDs.

### `1 workspace/router -> many chats`

Use a policy engine to assign each inbound chat to a shared or dynamic Hermes session.

- Most flexible.
- Best when chats need to collaborate through a shared assistant context.
- Highest orchestration complexity.

## Hermes adapter options

The callback/routing layer can target Hermes in a few different ways:

### CLI session wrapper

The API service launches Hermes commands or a long-lived terminal session and manages session IDs itself.

- Fastest to prototype in this repo.
- Requires robust process management, stdout parsing, timeouts, and restart recovery.

### Local HTTP bridge

Use Hermes' native API server session endpoints:

```text
POST /api/sessions
POST /api/sessions/{session_id}/chat
DELETE /api/sessions/{session_id}
```

- Cleaner contract for the WhatsApp manager.
- Easier to observe and test than raw CLI process control.
- Requires `hermes gateway run` with `API_SERVER_KEY` configured.

### Queue or job worker handoff

The API service enqueues work and a Hermes worker consumes it asynchronously.

- Best when Hermes calls are slow or expensive.
- Easier to scale independently.
- Adds delivery, correlation, and status-tracking complexity.

## Suggested first implementation path

Start with the routing model implemented in this repo:

- persist one mapping per WhatsApp account/chat routing key
- deduplicate WhatsApp messages by account, chat, and message ID
- serialize Hermes turns per routing key
- keep the Hermes adapter behind an interface
- use SQLite-backed bridge persistence by default
- use the Hermes API adapter when a Hermes gateway API server is running
