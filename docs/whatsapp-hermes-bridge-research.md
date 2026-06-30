# WhatsApp To Hermes External Bridge Research

This note captures the recommended direction for a new external WhatsApp bridge that uses Baileys for WhatsApp transport and manages WhatsApp chats as Hermes sessions. It intentionally treats the current implementation as WIP context, not as the implementation target.

## Goal

Build one bridge instance that can manage multiple WhatsApp numbers and route each WhatsApp chat into the correct Hermes session.

The bridge should own:

- WhatsApp account lifecycle and Baileys sockets
- WhatsApp auth/session state
- inbound message normalization
- chat-to-Hermes session routing
- outbound WhatsApp delivery
- operator controls for accounts and mappings

Hermes should remain a downstream execution engine behind a stable adapter boundary.

## Recommended path

Use an external Node/TypeScript service with:

- one Baileys runtime per WhatsApp account
- durable WhatsApp auth state per account
- durable chat-to-Hermes session mappings
- a Hermes client adapter using Hermes' programmatic API surface

Prefer the Hermes API server or TUI JSON-RPC interface over scripting the CLI directly.

The CLI wrapper path is useful for a quick spike, but it becomes fragile because it requires process supervision, stdout parsing, timeout handling, restart recovery, and prompt/session state inference.

## Reference architecture

```text
Baileys Account Supervisor
  accountId -> WASocket
  accountId -> auth state

Inbound Normalizer
  Baileys WAMessage -> normalized WhatsApp event

Session Router
  (accountId, chatJid, chatType/thread) -> hermesSessionId

Hermes Client
  create/resume Hermes session
  send one turn
  stream result
  interrupt/stop if needed

Outbound Dispatcher
  hermes reply -> accountId socket -> WhatsApp chat
```

## Session identity

Do not key Hermes sessions only by WhatsApp `chatId`.

Multiple WhatsApp numbers can see the same remote JID, so the bridge must include the local WhatsApp account in the routing key.

Recommended default:

```text
whatsapp:{accountId}:{chatType}:{chatJid}
```

Examples:

```text
whatsapp:ops-main:direct:15551234567@s.whatsapp.net
whatsapp:sales-main:direct:15551234567@s.whatsapp.net
whatsapp:ops-main:group:120363000000000000@g.us
```

For groups, choose one of these policies explicitly:

- one Hermes session per group
- one Hermes session per group participant
- one shared workspace session for selected groups

If group participant isolation is required, include the participant JID:

```text
whatsapp:{accountId}:group:{groupJid}:user:{participantJid}
```

## Core components

### Baileys account supervisor

Responsibilities:

- start and stop one Baileys socket per WhatsApp account
- persist auth state per `accountId`
- expose QR or pairing status for each account
- reconnect accounts after transient disconnects
- mark logged-out accounts as disconnected
- route outbound sends through the correct account socket

Prototype state path:

```text
/opt/data/baileys/{accountId}
```

This can use Baileys multi-file auth state while prototyping.

For a more durable deployment, replace file auth with a SQL or NoSQL auth-state adapter keyed by `accountId`.

### Inbound normalizer

Responsibilities:

- convert Baileys `WAMessage` payloads into a bridge-owned event shape
- ignore messages from self unless explicitly configured otherwise
- ignore WhatsApp status broadcasts
- extract text from common message types and captions
- preserve message IDs for idempotency
- include `accountId` on every event

Suggested normalized event:

```ts
interface WhatsAppInboundEvent {
  accountId: string;
  chatJid: string;
  chatType: "direct" | "group";
  senderJid: string;
  participantJid?: string;
  messageId: string;
  text: string;
  timestamp: string;
}
```

### Session router

Responsibilities:

- resolve the routing key for each inbound event
- find or create the mapped Hermes session
- serialize turns per mapped session
- dedupe repeated WhatsApp messages
- support reset/remap operations
- expose mapping inspection for the operator UI

Default policy:

```text
1 WhatsApp routing key -> 1 Hermes session
```

This is the safest model for context isolation and debugging.

### Hermes client adapter

Responsibilities:

- create or resolve a Hermes session
- send inbound WhatsApp text as one Hermes turn
- receive the Hermes response, ideally by streaming if supported
- support cancellation or interruption where Hermes exposes it
- normalize Hermes errors into bridge-level retry/failure states

Preferred integration options:

- Hermes API server for REST/SSE session management
- Hermes TUI JSON-RPC when richer live-session controls are needed
- Hermes relay connector contract if the project wants to align with Hermes gateway internals

Avoid making the bridge depend on Hermes terminal text output as the long-term contract.

### Outbound dispatcher

Responsibilities:

- send replies through the same WhatsApp account that received the inbound message
- enforce WhatsApp delivery constraints
- split or truncate overly long Hermes outputs if needed
- optionally support typing indicators, reactions, and media later
- record delivery success or failure

## Durable data model

Suggested first schema:

```text
whatsapp_accounts(
  account_id,
  label,
  status,
  auth_state_ref,
  created_at,
  updated_at
)

whatsapp_chats(
  account_id,
  chat_jid,
  chat_type,
  display_name,
  last_message_at
)

hermes_chat_sessions(
  account_id,
  chat_jid,
  chat_type,
  hermes_session_id,
  hermes_session_key,
  status,
  created_at,
  updated_at
)

processed_messages(
  account_id,
  message_id,
  chat_jid,
  processed_at
)
```

Add a uniqueness constraint for:

```text
hermes_chat_sessions(account_id, chat_jid, chat_type)
processed_messages(account_id, message_id)
```

## Integration options

### Option 1: External bridge plus Hermes API server

This is the recommended first real implementation path.

Pros:

- clean separation between WhatsApp transport and Hermes runtime
- easier to test than terminal automation
- supports multiple WhatsApp accounts in one bridge instance
- keeps Hermes replaceable behind an adapter
- fits the current repo's boundary shape

Cons:

- depends on Hermes API server behavior and stability
- may need extra work for streaming, cancellation, or live approvals

### Option 2: External bridge plus Hermes TUI JSON-RPC

Use this when the bridge needs deeper live-session controls than plain REST.

Pros:

- better fit for interrupts, slash commands, approvals, and streaming lifecycle events
- still avoids scraping terminal output

Cons:

- more complex client implementation
- tighter coupling to Hermes runtime semantics

### Option 3: Hermes relay connector

Hermes documents an experimental relay connector model where an external connector owns platform-specific socket and identity logic, then streams normalized events to Hermes.

Pros:

- closest conceptual fit for a first-class external connector
- aligns with Hermes gateway architecture
- lets the connector focus on WhatsApp-specific logic

Cons:

- currently experimental
- higher risk if the contract changes
- may require adapting to Hermes' gateway expectations

### Option 4: Native Hermes platform adapter

Implement WhatsApp as a Hermes platform adapter.

Pros:

- deepest integration with Hermes gateway internals
- likely best if upstreaming into Hermes is the goal

Cons:

- not an external bridge
- more coupled to Hermes internals
- less aligned with the current requirement

### Option 5: WhatsApp Cloud API instead of Baileys

Use Meta's official WhatsApp Cloud API instead of Baileys for production-grade business messaging.

Pros:

- official API
- stable webhook model
- better compliance story

Cons:

- requires Meta Business setup
- requires public HTTPS webhooks
- uses business numbers
- has template and customer-service-window constraints
- less suitable for personal linked-device style automation

## Baileys notes

Baileys is a WhatsApp Web client library. It uses WhatsApp linked-device authentication and an event-driven socket model.

Important events:

- `connection.update`
- `creds.update`
- `messages.upsert`

Important implementation details:

- save credentials whenever `creds.update` fires
- do not process messages from the bridge's own account unless intentionally configured
- ignore `status@broadcast`
- reconnect on transient disconnects
- do not reconnect blindly after logged-out states
- persist one auth state per WhatsApp account
- include `accountId` in every normalized inbound and outbound event

Baileys multi-file auth state is acceptable for a prototype. For a durable service, use a custom database-backed auth state adapter.

## Operational concerns

### Concurrency

Process only one Hermes turn at a time per mapped session unless Hermes explicitly supports concurrent turns safely.

Use a per-session queue:

```text
sessionKey -> FIFO queue
```

If a second WhatsApp message arrives while Hermes is answering, choose one policy:

- enqueue it
- merge it into the pending turn
- interrupt the current Hermes turn and replace it

The default should be enqueue.

### Idempotency

WhatsApp reconnects and event replay can duplicate messages.

Before routing a message to Hermes, insert:

```text
processed_messages(account_id, message_id)
```

If the insert conflicts, skip processing.

### Error handling

Separate these failure classes:

- WhatsApp account disconnected
- WhatsApp send failed
- Hermes session unavailable
- Hermes turn timed out
- message unsupported or empty
- duplicate message

Do not collapse them into one generic error because the operator actions differ.

### Observability

Log these IDs together on every event:

```text
accountId
chatJid
messageId
sessionKey
hermesSessionId
turnId
```

Expose operator endpoints for:

- account list
- account QR/pairing status
- active sockets
- chat mappings
- reset mapping
- remap mapping
- replay or retry failed turn

## Recommended phased plan

### Phase 1: External bridge skeleton

- define bridge-owned domain types with `accountId`
- keep Hermes behind `HermesClient`
- keep Baileys behind `WhatsAppAccountRuntime`
- persist accounts, mappings, and processed messages
- support direct text messages only

### Phase 2: Multi-account Baileys runtime

- connect multiple accounts in one process
- show QR/pairing status per account
- reconnect accounts independently
- send outbound messages through the correct account

### Phase 3: Hermes session routing

- implement get-or-create mapping
- route each inbound event into the mapped Hermes session
- serialize turns per session
- send Hermes output back to WhatsApp

### Phase 4: Operator controls

- inspect accounts
- inspect mappings
- reset/remap a session
- disconnect/reconnect accounts
- view failures and retries

### Phase 5: Production hardening

- replace multi-file auth with database-backed auth state
- add media handling
- add group policy controls
- add rate limits
- add health checks
- add structured metrics and logs

## Recommendation summary

Build a new external multi-account Baileys bridge and connect it to Hermes through a stable programmatic interface.

Use this default routing policy:

```text
1 WhatsApp account + chat -> 1 Hermes session
```

Persist the mapping instead of deriving Hermes state from WhatsApp IDs.

Keep Baileys sessions, Hermes sessions, and routing mappings as separate durable concepts.

Avoid a long-term CLI-wrapper implementation unless no Hermes API or JSON-RPC surface is available.

## References

- Baileys docs: https://baileys.wiki/docs/intro/
- Baileys auth state docs: https://baileys.wiki/docs/api/functions/useMultiFileAuthState/
- Hermes messaging gateway docs: https://hermes-agent.nousresearch.com/docs/user-guide/messaging/
- Hermes gateway internals: https://hermes-agent.nousresearch.com/docs/developer-guide/gateway-internals
- Hermes programmatic integration: https://hermes-agent.nousresearch.com/docs/developer-guide/programmatic-integration
- Hermes API server: https://hermes-agent.nousresearch.com/docs/user-guide/features/api-server
- Hermes relay connector contract: https://github.com/nousresearch/hermes-agent/blob/main/docs/relay-connector-contract.md
