# WhatsApp Manager Postbacks

WhatsApp Manager postbacks are account-scoped HTTP webhook hooks for inbound WhatsApp messages. They are configured in the manager UI and stored by the API.

The native platform adapter path is not configured as a postback. It is an intrinsic manager capability: after an inbound message passes number rules, WhatsApp Manager writes the event to the neutral platform event queue. A compatible adapter can then consume `/agent/platform/events` and post replies through `/agent/platform/replies`.

## Native platform adapter

Use the platform adapter path when inbound WhatsApp messages should be handed to the native adapter. WhatsApp Manager does not call a runtime directly. It stores the inbound event in a neutral platform queue, and the adapter consumes that queue and posts replies back through the manager API.

```mermaid
sequenceDiagram
  participant WA as WhatsApp
  participant WM as WhatsApp Manager
  participant DB as Platform Event Queue
  participant Adapter as Platform Adapter
  participant Runtime as Agent Runtime
  participant WAGW as WhatsApp Gateway

  WA->>WM: Incoming message
  WM->>WM: Apply number rules
  WM->>DB: Store platform event
  Adapter->>WM: Poll /agent/platform/events
  WM->>Adapter: Return queued event
  Adapter->>Runtime: Process message
  Runtime->>Adapter: Reply text
  Adapter->>WM: POST /agent/platform/replies
  WM->>WAGW: Send WhatsApp reply
  WAGW->>WA: Outgoing message
```

Manager contract:

```text
GET  /agent/platform/events?cursor=<cursor>
POST /agent/platform/replies
```

Direct callback mode is intentionally not supported. Agent/runtime replies must come back through `/agent/platform/replies`.

## HTTP webhook postbacks

Use the HTTP webhook action for generic outbound integrations such as a CRM, Zapier/Make, analytics, logging, or a custom service. WhatsApp Manager posts the inbound event payload to the configured URL and records the HTTP result.

```mermaid
sequenceDiagram
  participant WA as WhatsApp
  participant WM as WhatsApp Manager
  participant External as External HTTP Service

  WA->>WM: Incoming message
  WM->>WM: Apply number rules
  WM->>WM: Match account HTTP postback
  WM->>External: POST webhook payload
  External->>WM: HTTP response
```

An HTTP webhook is not the native platform adapter path unless the external service itself implements an adapter-compatible bridge.

## Mental model

```mermaid
flowchart LR
  Inbound["Incoming WhatsApp message"] --> Rules["Number rules"]

  Rules --> Queue["Neutral platform queue"]
  Queue --> Native["Native adapter"]
  Native --> Reply["/agent/platform/replies"]
  Reply --> WhatsAppReply["WhatsApp reply"]

  Rules --> Webhook["HTTP webhook postbacks"]
  Webhook --> External["External URL"]
```

## Account scope

HTTP postbacks are configured per WhatsApp account. A postback applies to all chats inside that account.

The postback run still records the concrete chat that triggered it, because every inbound message belongs to a specific conversation. That chat is run metadata, not configuration scope.

Number rules run before platform event queueing and HTTP postback dispatch. If an account has a default deny-all rule, only chats allowed by number rules reach either path.
