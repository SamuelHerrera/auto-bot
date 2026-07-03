# Hermes External Chat Integration Notes

Date: 2026-07-02

## Summary

Hermes already has most of the primitives needed to tunnel an external chat service into Hermes while preserving conversation identity and follow-up behavior.

The strongest integration path is to implement a real Hermes `BasePlatformAdapter` for the external chat service. That lets Hermes handle native session routing, active-run locking, queued follow-ups, `/queue`, `/steer`, `/stop`, `/new`, `/reset`, delivery back to the same chat/thread, and media/thread behavior when supported by the external service.

## Current Hermes Surfaces

Hermes has several relevant entry points:

- Platform gateway adapters, based on `BasePlatformAdapter`.
- Generic webhook adapter for inbound HTTP callbacks.
- OpenAI-compatible API server.
- Async run API with run IDs, status, SSE events, approvals, and stop.
- CLI/PTY interaction, which is possible but should not be the primary bridge.

Important files:

- `/Users/samuelherrerafuente/.hermes/hermes-agent/gateway/session.py`
- `/Users/samuelherrerafuente/.hermes/hermes-agent/gateway/platforms/base.py`
- `/Users/samuelherrerafuente/.hermes/hermes-agent/gateway/run.py`
- `/Users/samuelherrerafuente/.hermes/hermes-agent/gateway/platforms/webhook.py`
- `/Users/samuelherrerafuente/.hermes/hermes-agent/gateway/platforms/api_server.py`

## Conversation Identity

Conversation/thread continuity depends on stable source identifiers. The external service should be normalized into Hermes fields like:

- `chat_id`: stable external conversation/channel ID.
- `user_id`: stable external user ID.
- `thread_id`: external thread/reply/topic ID when present.
- `message_id`: external message ID.
- `chat_type`: DM, group, channel, thread, or equivalent.

If the external service has thread or reply channels, preserve that as `thread_id`. Do not collapse everything into only `chat_id`, or separate threads can bleed into the same Hermes session.

## Follow-Up Behavior During Active Runs

Hermes already supports active-session behavior in the gateway path:

- Active sessions are tracked.
- New messages during a run can be queued.
- Text follow-ups can be merged/debounced.
- `/queue <prompt>` creates explicit FIFO follow-up turns.
- `/steer <prompt>` injects a follow-up into the current run after the next tool call.
- `/stop` interrupts the active agent.
- `/new` and `/reset` clear or rotate the active conversation.

Relevant config knobs:

```bash
HERMES_GATEWAY_BUSY_INPUT_MODE=queue
HERMES_GATEWAY_BUSY_INPUT_MODE=interrupt
HERMES_GATEWAY_BUSY_INPUT_MODE=steer
HERMES_GATEWAY_BUSY_TEXT_MODE=queue
HERMES_GATEWAY_BUSY_TEXT_MODE=interrupt
```

Recommended starting behavior for the requested use case:

```bash
HERMES_GATEWAY_BUSY_INPUT_MODE=steer
HERMES_GATEWAY_BUSY_TEXT_MODE=queue
```

That allows normal follow-ups to steer active work when the active agent supports it, with queueing as the safer fallback.

## Integration Options

### 1. Native Hermes Platform Adapter

This is the best option when the external chat service has a real API, WebSocket stream, callbacks, message IDs, threads, attachments, or delivery status.

The adapter should:

1. Connect to the external service by WebSocket, webhook, polling, or SDK.
2. Convert inbound messages into Hermes `MessageEvent`.
3. Build a stable `SessionSource` from external conversation metadata.
4. Call the normal Hermes gateway message handling path.
5. Send Hermes responses back through the external chat API.

Advantages:

- Reuses Hermes' existing queue/steer/stop semantics.
- Keeps active-run behavior consistent with Telegram/Slack/etc.
- Handles thread routing cleanly.
- Supports future media and typing indicators.

### 2. Existing Webhook Adapter

Use this when the external chat service can call Hermes by HTTP callback and does not need a fully custom adapter immediately.

This is a good first implementation if the external service can POST inbound messages and Hermes can call the service API to send replies.

Advantages:

- Less code than a full platform adapter.
- Still closer to Hermes gateway semantics than direct `/v1/responses`.
- Good for callback-based systems.

Limitation:

- May need customization for outbound delivery, authentication, retry handling, and thread mapping.

### 3. Hermes API Server

Hermes exposes an API server with:

- `POST /v1/responses`
- `POST /v1/chat/completions`
- `POST /api/sessions/{session_id}/chat`
- `POST /api/sessions/{session_id}/chat/stream`
- `POST /v1/runs`
- `GET /v1/runs/{run_id}`
- `GET /v1/runs/{run_id}/events`
- `POST /v1/runs/{run_id}/approval`
- `POST /v1/runs/{run_id}/stop`

For an external chat bridge, `/v1/runs` is better than plain `/v1/responses` because it gives a durable `run_id`, status polling, event streaming, approval handling, and stop.

However, the plain API server path does not automatically provide the same per-chat pending-message queue semantics as the gateway platform path. If using `/v1/runs`, the bridge service should maintain its own per-conversation queue and decide whether a new message should:

- queue after the current run,
- stop the current run and start a new one,
- send a steer-like follow-up through a gateway/platform path,
- or call a future explicit API endpoint for steering if one is added.

### 4. CLI / Terminal Calls

Running Hermes next to the external chat service and driving it through CLI/PTY is possible, but it should be the fallback.

Reasons to avoid it as the primary integration:

- Harder to correlate external message IDs to Hermes turns.
- Harder to handle retries and idempotency.
- Harder to stream structured output.
- More fragile around terminal prompts, approvals, and control messages.
- Less clean than using gateway adapters or API endpoints.

## Recommended Architecture

Create a small bridge service next to Hermes:

1. Inbound connector receives external chat messages by WebSocket, callback, polling, or CLI event.
2. Normalizer maps external events into a canonical shape:
   - `external_conversation_id`
   - `external_thread_id`
   - `external_user_id`
   - `external_message_id`
   - `text`
   - `attachments`
3. Hermes adapter layer turns that into `SessionSource` and `MessageEvent`.
4. Hermes gateway handles active sessions, queueing, steering, commands, and execution.
5. Outbound connector sends Hermes responses back through the external service API.

Minimal event shape:

```json
{
  "conversation_id": "external-chat-123",
  "thread_id": "thread-456",
  "user_id": "user-789",
  "message_id": "msg-abc",
  "text": "please update the task",
  "timestamp": "2026-07-02T00:00:00Z"
}
```

## Practical Recommendation

For the behavior described, use a native `BasePlatformAdapter` if possible. It is the cleanest path because Hermes already has the correct active-session model there.

If a quick version is needed first, use the existing webhook adapter or a thin bridge around `/v1/runs`, but treat that as a stepping stone. The bridge must preserve stable conversation IDs and implement per-conversation queueing if it does not enter through Hermes' gateway adapter path.

