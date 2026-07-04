# Hermes WhatsApp Platform Adapter

This directory contains a native Hermes platform plugin for routing WhatsApp Manager chats through Hermes' gateway platform path.

The adapter implements Hermes' real `BasePlatformAdapter` contract from `gateway.platforms.base`:

- `connect()`
- `disconnect()`
- `send()`
- `get_chat_info()`

It is packaged with `plugin.yaml` and `__init__.py`, so it can be installed as a Hermes platform plugin instead of patching Hermes core.

The adapter expects WhatsApp Manager to expose HTTP endpoints for inbound event polling and outbound replies. Those endpoints are implemented by `apps/whatsapp-manager-api`.

To route a WhatsApp account through this native adapter, connect the account and allow the desired inbound senders through number rules. WhatsApp Manager stores allowed inbound messages in the neutral platform event queue automatically; the adapter consumes the queue and posts replies back to WhatsApp Manager. Direct callback mode is intentionally not supported.

See `../../docs/whatsapp-manager-postbacks.md` for the native platform adapter and HTTP webhook flow diagrams.

Required manager contract:

```text
GET  /agent/platform/events?cursor=<cursor>
POST /agent/platform/replies
```

Install shape:

```text
~/.hermes/plugins/whatsapp-manager-platform/
  __init__.py
  plugin.yaml
  whatsapp_manager.py
```

Required environment:

```bash
WHATSAPP_MANAGER_API_URL=http://127.0.0.1:3000
WHATSAPP_MANAGER_API_TOKEN=...
```

Optional environment:

```bash
WHATSAPP_MANAGER_POLL_INTERVAL=1
WHATSAPP_MANAGER_PAGE_SIZE=50
WHATSAPP_MANAGER_CURSOR_FILE=/opt/data/whatsapp-manager/platform-cursor
WHATSAPP_MANAGER_ALLOWED_USERS=
WHATSAPP_MANAGER_ALLOW_ALL_USERS=true
```

Enable the platform in Hermes config as `whatsapp-manager`, then run the gateway normally.

Event payload:

```json
{
  "items": [
    {
      "accountId": "ops-main",
      "chatJid": "15551234567@s.whatsapp.net",
      "chatType": "direct",
      "senderJid": "15551234567@s.whatsapp.net",
      "messageId": "wamid.123",
      "text": "hello",
      "timestamp": "2026-07-03T00:00:00.000Z"
    }
  ],
  "nextCursor": "1"
}
```

Reply payload:

```json
{
  "accountId": "ops-main",
  "chatJid": "15551234567@s.whatsapp.net",
  "inboundMessageId": "wamid.123",
  "text": "Agent response text"
}
```
