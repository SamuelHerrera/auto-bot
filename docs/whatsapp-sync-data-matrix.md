# WhatsApp Sync Data Matrix

This document tracks the WhatsApp data persisted outside Baileys auth state so a logout/relogin test can prove what was received from WhatsApp and what the manager stored.

## Current Implementation

The manager routes live `messages.upsert` events into Hermes and stores delivery records, processed message keys, session mappings, number rules, account aliases, and audit logs. It also journals WhatsApp sync/update events into dedicated SQLite tables and derives typed contact, chat, message, LID mapping, and history batch rows where the Baileys payload includes those fields.

A chat row may still show a WhatsApp LID such as `83038931275996@lid` because the UI currently displays the raw chat JID. The durable routing key should remain that raw JID; phone numbers and display names are now stored as enrichment data when WhatsApp supplies them.

## Data Matrix

| Area | Persistence target | Implementation | Corroboration signal |
| --- | --- | --- | --- |
| LID / phone mapping | `whatsapp_lid_mappings` | Store `lid_jid`, `pn_jid`, source, raw payload, first/last seen | Query rows after relogin and verify any `@lid` chat has a mapping when WhatsApp supplied one |
| Contacts | `whatsapp_contacts` | Store contact id, phone number, lid, display names, raw payload | Chat list can resolve display labels without losing raw JID |
| Chats | `whatsapp_chats` | Store chat JID, type, display name, unread count, last message timestamp, archived/muted/pinned flags, raw payload | `/whatsapp/sync/chats` shows synced chats before Hermes routing |
| Raw messages | `whatsapp_messages` | Store message id, chat JID, sender JID, direction, timestamp, type, text, media summary, raw payload | `/whatsapp/sync/messages` includes historical and live messages independent of delivery records |
| History sync batches | `whatsapp_history_sync_batches` | Store stable sync id, account id, sync type, counts, progress/status, raw payload | Relogin creates one or more batch rows with processed counts |
| Event journal | `whatsapp_sync_events` | Store event type, account id, payload hash, raw payload, received time | Every subscribed Baileys sync event leaves an auditable row |
| Message metadata | `whatsapp_messages.raw_json` | Preserve full message content for edits, deletes, quoted messages, forwarded flags, and ephemeral wrappers | Raw JSON supports follow-up extraction without reconnecting |
| Media metadata | `whatsapp_messages.media_json` | Store media attachment summaries from message content | Media-bearing messages are searchable even before file download support |
| Receipts | `whatsapp_sync_events` initially | Journal receipt/update events raw until typed tables are added | Receipt events can be inspected after relogin |
| Reactions | `whatsapp_messages.reaction_json` | Store reaction summary and raw message JSON | Reaction messages are visible outside Hermes delivery records |
| Groups | `whatsapp_chats`, `whatsapp_contacts`, `whatsapp_sync_events` | Store group chat metadata raw even if routing ignores group messages | Group sync is observable without enabling group routing |
| Account sync metadata | `whatsapp_sync_events`, `whatsapp_history_sync_batches` | Journal account/device sync events and batch checkpoints | Relogin can compare received sync events with stored rows |

## Journaled Baileys Events

The gateway subscribes to these Baileys v7 events for sync corroboration:

- `messaging-history.set`
- `messaging-history.status`
- `chats.upsert`
- `chats.update`
- `chats.delete`
- `contacts.upsert`
- `contacts.update`
- `messages.upsert`
- `messages.update`
- `messages.delete`
- `messages.media-update`
- `messages.reaction`
- `message-receipt.update`
- `groups.upsert`
- `groups.update`
- `group-participants.update`
- `lid-mapping.update`

Array payload events such as `contacts.upsert`, `chats.upsert`, and `groups.upsert` are journaled raw and also projected into typed contact/chat rows.

Duplicate `messaging-history.set` payloads use a stable payload hash ID, so replayed identical chunks update the existing batch row instead of inflating history batch counts.

## Logout / Relogin Validation Checklist

1. Start with a clean or known SQLite file.
2. Connect the test account and let initial sync settle.
3. Query `/whatsapp/sync/summary` or run `./scripts/check-whatsapp-sync.sh <accountId>` and confirm contacts, chats, messages, and sync event counts increase.
4. Query `/whatsapp/sync/chats` and confirm direct chats are present even before sending a new inbound message.
5. Query `/whatsapp/sync/messages` for one chat and confirm previous synced messages are represented when WhatsApp provides history.
6. Query `/whatsapp/sync/lid-mappings` and confirm mappings exist for any LID/PN pairs WhatsApp exposes.
7. Send a live message from another number and confirm both the live message table and Hermes delivery flow update.
8. Logout and relogin the test account, then repeat the summary queries and compare counts/checkpoints.

The automated API test suite covers both a synthetic history sync payload and a live `messages.upsert` payload. The logout/relogin run is still required because only WhatsApp can prove which history/contact/LID events are emitted for the linked test account.

## Corroboration Commands

Use the helper with the same token and port as Docker Compose:

```bash
WHATSAPP_MANAGER_API_TOKEN=local-dev-token \
WHATSAPP_MANAGER_API_PORT=3000 \
pnpm sync:dump <accountId>
```

Capture a baseline before logout/relogin:

```bash
mkdir -p data/sync-checks
WHATSAPP_MANAGER_API_TOKEN=local-dev-token \
pnpm sync:dump <accountId> \
  | tee data/sync-checks/before-relogin.txt
```

After logout, relogin, and waiting for sync to settle, capture the same endpoints:

```bash
WHATSAPP_MANAGER_API_TOKEN=local-dev-token \
pnpm sync:wait -- --account <accountId>

WHATSAPP_MANAGER_API_TOKEN=local-dev-token \
pnpm sync:dump <accountId> \
  | tee data/sync-checks/after-relogin.txt
```

Then compare the captured evidence:

```bash
diff -u data/sync-checks/before-relogin.txt data/sync-checks/after-relogin.txt
```

For a quicker pass/fail matrix, use the corroboration script:

```bash
WHATSAPP_MANAGER_API_TOKEN=local-dev-token \
pnpm sync:corroborate -- --account <accountId> \
  | tee data/sync-checks/corroboration-after-relogin.md
```

For a machine-readable artifact:

```bash
WHATSAPP_MANAGER_API_TOKEN=local-dev-token \
pnpm sync:corroborate -- --account <accountId> --json \
  | tee data/sync-checks/corroboration-after-relogin.json
```

To compare machine-readable before/after artifacts:

```bash
WHATSAPP_MANAGER_API_TOKEN=local-dev-token \
pnpm sync:corroborate -- --account <accountId> --json \
  | tee data/sync-checks/corroboration-before-relogin.json

# logout/relogin, then wait for sync to settle

WHATSAPP_MANAGER_API_TOKEN=local-dev-token \
pnpm sync:wait -- --account <accountId>

WHATSAPP_MANAGER_API_TOKEN=local-dev-token \
pnpm sync:corroborate -- --account <accountId> --json \
  | tee data/sync-checks/corroboration-after-relogin.json

pnpm sync:compare -- \
  --before data/sync-checks/corroboration-before-relogin.json \
  --after data/sync-checks/corroboration-after-relogin.json
```

The corroboration script exits with status `2` when required rows are missing for contacts, chats, messages, history batches, or sync events. LID mappings are reported as optional because WhatsApp does not guarantee every account/session emits LID-to-phone mappings.

To inspect messages for a specific chat:

```bash
WHATSAPP_MANAGER_API_TOKEN=local-dev-token \
pnpm sync:dump <accountId> '83038931275996@lid'
```

Or with the matrix view:

```bash
WHATSAPP_MANAGER_API_TOKEN=local-dev-token \
pnpm sync:corroborate -- --account <accountId> --chat '83038931275996@lid'
```

The script prints raw JSON from:

- `/whatsapp/sync/summary`
- `/whatsapp/sync/history-batches`
- `/whatsapp/sync/chats`
- `/whatsapp/sync/contacts`
- `/whatsapp/sync/lid-mappings`
- `/whatsapp/sync/events`
- `/whatsapp/sync/messages`

## Important Constraint

WhatsApp does not guarantee that every LID can be resolved to a phone number. The durable key should remain the WhatsApp JID received from Baileys; phone numbers and display names are enrichment data when available.
