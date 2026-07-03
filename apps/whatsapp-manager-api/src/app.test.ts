import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createApp } from "./app.js";
import {
  ensureDefaultDenyAllNumberRule,
  sendReplyWithDeliveryRecord,
  type AppServices,
} from "./build-services.js";
import { loadConfig } from "./config.js";
import { evaluateNumberRules, recordBlockedNumberDelivery } from "./services/number-rules.js";
import { recordWhatsAppSyncEvent } from "./services/whatsapp-sync-recorder.js";
import { AppEventBus } from "./services/event-bus.js";
import { HermesApiAdapter, type HermesAdapter } from "./services/hermes-adapter.js";
import { PostbackActionDispatcher } from "./services/postback-actions.js";
import { FileBridgeStateStore } from "./services/bridge-state-store.js";
import { InMemoryChatSessionRouter } from "./services/chat-session-router.js";
import { SqliteBridgeStateStore } from "./services/sqlite-bridge-state-store.js";
import type { WhatsAppGateway } from "./services/whatsapp-service.js";
import type { WhatsAppSyncEvent } from "./services/whatsapp-service.js";
import type { AppConfig } from "./config.js";
import type {
  AuditLogInput,
  HermesReply,
  HermesSession,
  OutboundWhatsAppMessage,
  WhatsAppAccountStatus,
  WhatsAppMessageEvent,
} from "./domain/types.js";
import { getWhatsAppChatType, getWhatsAppSessionKey } from "./domain/types.js";

describe("whatsapp-manager-api", () => {
  let app: ReturnType<typeof createApp>;
  const config = loadConfig({
    API_TOKEN: "test-token",
    BRIDGE_DATABASE_FILE: "",
    BRIDGE_STATE_FILE: "",
    DATABASE_URL: "postgres://postgres:postgres@127.0.0.1:5432/auto_bot",
    NODE_ENV: "test",
    PORT: "3000",
  });

  beforeEach(() => {
    app = createApp({
      config,
      services: createTestServices(config),
    });
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    await app.close();
  });

  it("allows live health checks without auth", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/health/live",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: "ok" });
  });

  it("creates and reuses a hermes session per chat", async () => {
    const first = await app.inject({
      method: "POST",
      url: "/messages/inbound",
      headers: {
        authorization: "Bearer test-token",
      },
      payload: {
        accountId: "ops-main",
        chatId: "12345@s.whatsapp.net",
        text: "hello",
      },
    });

    const second = await app.inject({
      method: "POST",
      url: "/messages/inbound",
      headers: {
        authorization: "Bearer test-token",
      },
      payload: {
        accountId: "ops-main",
        chatId: "12345@s.whatsapp.net",
        text: "follow up",
      },
    });

    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);

    const firstBody = first.json();
    const secondBody = second.json();

    expect(firstBody.session.id).toBe(secondBody.session.id);
    expect(firstBody.mapping.sessionKey).toBe("whatsapp:ops-main:direct:12345@s.whatsapp.net");
    expect(secondBody.reply.outputText).toContain("follow up");
  });

  it("keeps the same remote chat isolated across WhatsApp accounts", async () => {
    const first = await app.inject({
      method: "POST",
      url: "/messages/inbound",
      headers: {
        authorization: "Bearer test-token",
      },
      payload: {
        accountId: "ops-main",
        chatJid: "12345@s.whatsapp.net",
        messageId: "wamid.ops.1",
        text: "ops hello",
      },
    });

    const second = await app.inject({
      method: "POST",
      url: "/messages/inbound",
      headers: {
        authorization: "Bearer test-token",
      },
      payload: {
        accountId: "sales-main",
        chatJid: "12345@s.whatsapp.net",
        messageId: "wamid.sales.1",
        text: "sales hello",
      },
    });

    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);

    const firstBody = first.json();
    const secondBody = second.json();

    expect(firstBody.session.id).not.toBe(secondBody.session.id);
    expect(firstBody.mapping.sessionKey).toBe("whatsapp:ops-main:direct:12345@s.whatsapp.net");
    expect(secondBody.mapping.sessionKey).toBe("whatsapp:sales-main:direct:12345@s.whatsapp.net");
  });

  it("rejects protected routes without auth", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/sessions",
    });

    expect(response.statusCode).toBe(401);
  });

  it("tracks multiple WhatsApp accounts for the UI", async () => {
    await app.inject({
      method: "POST",
      url: "/whatsapp/connect",
      headers: {
        authorization: "Bearer test-token",
      },
      payload: {
        accountId: "ops-main",
      },
    });

    await app.inject({
      method: "POST",
      url: "/whatsapp/connect",
      headers: {
        authorization: "Bearer test-token",
      },
      payload: {
        accountId: "ops-backup",
      },
    });

    const response = await app.inject({
      method: "GET",
      url: "/whatsapp/accounts",
      headers: {
        authorization: "Bearer test-token",
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      items: [
        expect.objectContaining({
          accountId: "ops-main",
          status: "connected",
        }),
        expect.objectContaining({
          accountId: "ops-backup",
          status: "connected",
        }),
      ],
    });
  });

  it("persists account aliases and merges them into account listings", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "auto-bot-account-alias-"));
    const aliasConfig = loadConfig({
      ...process.env,
      API_TOKEN: "test-token",
      BRIDGE_DATABASE_FILE: path.join(dir, "bridge-state.sqlite"),
      BRIDGE_STATE_FILE: "",
      DATABASE_URL: "postgres://postgres:postgres@127.0.0.1:5432/auto_bot",
      NODE_ENV: "test",
      PORT: "3000",
    });
    const aliasApp = createApp({
      config: aliasConfig,
      services: createTestServices(aliasConfig),
    });

    try {
      await aliasApp.inject({
        method: "POST",
        url: "/whatsapp/connect",
        headers: {
          authorization: "Bearer test-token",
        },
        payload: {
          accountId: "15551234567",
        },
      });

      const updateResponse = await aliasApp.inject({
        method: "PATCH",
        url: "/whatsapp/accounts/15551234567",
        headers: {
          authorization: "Bearer test-token",
        },
        payload: {
          alias: "Sales line",
        },
      });

      expect(updateResponse.statusCode).toBe(200);
      expect(updateResponse.json()).toEqual(
        expect.objectContaining({
          accountId: "15551234567",
          alias: "Sales line",
        }),
      );

      const listResponse = await aliasApp.inject({
        method: "GET",
        url: "/whatsapp/accounts",
        headers: {
          authorization: "Bearer test-token",
        },
      });

      expect(listResponse.json()).toEqual({
        items: [
          expect.objectContaining({
            accountId: "15551234567",
            alias: "Sales line",
            status: "connected",
          }),
        ],
      });
    } finally {
      await aliasApp.close();
      rmSync(dir, { force: true, recursive: true });
    }
  });

  it("creates postback actions and records Hermes action runs", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "auto-bot-postbacks-"));
    const postbackConfig = loadConfig({
      ...process.env,
      API_TOKEN: "test-token",
      BRIDGE_DATABASE_FILE: path.join(dir, "bridge-state.sqlite"),
      BRIDGE_STATE_FILE: "",
      DATABASE_URL: "postgres://postgres:postgres@127.0.0.1:5432/auto_bot",
      NODE_ENV: "test",
      PORT: "3000",
    });
    const postbackApp = createApp({
      config: postbackConfig,
      services: createTestServices(postbackConfig),
    });

    try {
      const createResponse = await postbackApp.inject({
        method: "POST",
        url: "/postback-actions",
        headers: {
          authorization: "Bearer test-token",
        },
        payload: {
          name: "Hermes inbound",
          actionType: "hermes",
          trigger: "inbound_message",
          accountId: "ops-main",
          config: {
            replyToWhatsApp: true,
          },
        },
      });

      expect(createResponse.statusCode).toBe(200);
      expect(createResponse.json()).toEqual(expect.objectContaining({
        name: "Hermes inbound",
        actionType: "hermes",
        accountId: "ops-main",
      }));
      const actionId = createResponse.json().id;

      const testResponse = await postbackApp.inject({
        method: "POST",
        url: `/postback-actions/${encodeURIComponent(actionId)}/test`,
        headers: {
          authorization: "Bearer test-token",
        },
        payload: {
          event: {
            accountId: "ops-main",
            chatJid: "12345@s.whatsapp.net",
            messageId: "wamid.postback.test",
            text: "test postback",
          },
        },
      });

      expect(testResponse.statusCode).toBe(200);
      expect(testResponse.json()).toEqual(expect.objectContaining({
        actionName: "Hermes inbound",
        actionType: "hermes",
        status: "success",
      }));

      const inboundResponse = await postbackApp.inject({
        method: "POST",
        url: "/messages/inbound",
        headers: {
          authorization: "Bearer test-token",
        },
        payload: {
          accountId: "ops-main",
          chatJid: "12345@s.whatsapp.net",
          messageId: "wamid.postback.1",
          text: "trigger postback",
        },
      });

      expect(inboundResponse.statusCode).toBe(200);
      expect(inboundResponse.json().postbackRuns).toEqual([
        expect.objectContaining({
          actionName: "Hermes inbound",
          actionType: "hermes",
          status: "success",
        }),
      ]);

      const runsResponse = await postbackApp.inject({
        method: "GET",
        url: "/postback-action-runs",
        headers: {
          authorization: "Bearer test-token",
        },
      });

      expect(runsResponse.statusCode).toBe(200);
      expect(runsResponse.json().items).toEqual(expect.arrayContaining([
        expect.objectContaining({
          actionName: "Hermes inbound",
          inboundMessageId: "wamid.postback.1",
          status: "success",
        }),
        expect.objectContaining({
          actionName: "Hermes inbound",
          inboundMessageId: "wamid.postback.test",
          status: "success",
        }),
      ]));
    } finally {
      await postbackApp.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("queues Hermes platform events and accepts native adapter replies", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "auto-bot-hermes-platform-"));
    const platformConfig = loadConfig({
      ...process.env,
      API_TOKEN: "test-token",
      BRIDGE_DATABASE_FILE: path.join(dir, "bridge-state.sqlite"),
      BRIDGE_STATE_FILE: "",
      DATABASE_URL: "postgres://postgres:postgres@127.0.0.1:5432/auto_bot",
      NODE_ENV: "test",
      PORT: "3000",
    });
    const services = createTestServices(platformConfig);
    const platformApp = createApp({
      config: platformConfig,
      services,
    });

    try {
      await platformApp.inject({
        method: "POST",
        url: "/postback-actions",
        headers: {
          authorization: "Bearer test-token",
        },
        payload: {
          name: "Native Hermes",
          actionType: "hermes",
          trigger: "inbound_message",
          config: {
            deliveryMode: "platform",
          },
        },
      });

      const inboundResponse = await platformApp.inject({
        method: "POST",
        url: "/messages/inbound",
        headers: {
          authorization: "Bearer test-token",
        },
        payload: {
          accountId: "ops-main",
          chatJid: "12345@s.whatsapp.net",
          messageId: "wamid.platform.1",
          text: "native adapter input",
        },
      });

      expect(inboundResponse.statusCode).toBe(200);
      expect(inboundResponse.json().postbackRuns).toEqual([
        expect.objectContaining({
          actionName: "Native Hermes",
          status: "success",
        }),
      ]);

      const eventsResponse = await platformApp.inject({
        method: "GET",
        url: "/hermes/platform/events?cursor=0",
        headers: {
          authorization: "Bearer test-token",
        },
      });

      expect(eventsResponse.statusCode).toBe(200);
      expect(eventsResponse.json()).toEqual({
        items: [
          expect.objectContaining({
            sequence: 1,
            accountId: "ops-main",
            chatJid: "12345@s.whatsapp.net",
            messageId: "wamid.platform.1",
            text: "native adapter input",
          }),
        ],
        nextCursor: "1",
      });

      const replyResponse = await platformApp.inject({
        method: "POST",
        url: "/hermes/platform/replies",
        headers: {
          authorization: "Bearer test-token",
        },
        payload: {
          accountId: "ops-main",
          chatJid: "12345@s.whatsapp.net",
          inboundMessageId: "wamid.platform.1",
          text: "native adapter response",
        },
      });

      expect(replyResponse.statusCode).toBe(200);
      expect((services.whatsappGateway as TestWhatsAppGateway).getSentMessages()).toEqual([
        expect.objectContaining({
          accountId: "ops-main",
          chatId: "12345@s.whatsapp.net",
          text: "native adapter response",
        }),
      ]);
    } finally {
      await platformApp.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("routes external gateway inbound through native platform postbacks and fake adapter replies", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "auto-bot-native-e2e-"));
    const nativeConfig = loadConfig({
      ...process.env,
      API_TOKEN: "test-token",
      BRIDGE_DATABASE_FILE: path.join(dir, "bridge-state.sqlite"),
      BRIDGE_STATE_FILE: "",
      DATABASE_URL: "postgres://postgres:postgres@127.0.0.1:5432/auto_bot",
      NODE_ENV: "test",
      PORT: "3000",
    });
    const services = createTestServices(nativeConfig);
    const nativeApp = createApp({
      config: nativeConfig,
      services,
    });
    const gateway = services.whatsappGateway as TestWhatsAppGateway;

    try {
      await gateway.initializeAccount("ops-main");

      await nativeApp.inject({
        method: "POST",
        url: "/number-rules",
        headers: { authorization: "Bearer test-token" },
        payload: {
          accountId: "ops-main",
          action: "allow",
          matchType: "exact",
          pattern: "12345@s.whatsapp.net",
          label: "test allow",
        },
      });

      await nativeApp.inject({
        method: "POST",
        url: "/postback-actions",
        headers: { authorization: "Bearer test-token" },
        payload: {
          name: "Native fake adapter",
          actionType: "hermes",
          trigger: "inbound_message",
          accountId: "ops-main",
          chatJid: "12345@s.whatsapp.net",
          config: {
            deliveryMode: "platform",
          },
        },
      });

      await gateway.injectInboundMessage({
        accountId: "ops-main",
        chatJid: "12345@s.whatsapp.net",
        messageId: "wamid.external.native.1",
        text: "external native input",
      });

      const eventsResponse = await nativeApp.inject({
        method: "GET",
        url: "/hermes/platform/events?cursor=0",
        headers: { authorization: "Bearer test-token" },
      });
      expect(eventsResponse.statusCode).toBe(200);
      expect(eventsResponse.json().items).toEqual([
        expect.objectContaining({
          sequence: 1,
          messageId: "wamid.external.native.1",
          text: "external native input",
        }),
      ]);

      const replyResponse = await nativeApp.inject({
        method: "POST",
        url: "/hermes/platform/replies",
        headers: { authorization: "Bearer test-token" },
        payload: {
          accountId: "ops-main",
          chatJid: "12345@s.whatsapp.net",
          inboundMessageId: "wamid.external.native.1",
          text: "fake native reply",
        },
      });

      expect(replyResponse.statusCode).toBe(200);
      expect(gateway.getSentMessages()).toEqual([
        expect.objectContaining({
          accountId: "ops-main",
          chatId: "12345@s.whatsapp.net",
          text: "fake native reply",
        }),
      ]);
    } finally {
      await nativeApp.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("reports runtime status and cleans old postback records", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "auto-bot-postback-maintenance-"));
    const maintenanceConfig = loadConfig({
      ...process.env,
      API_TOKEN: "test-token",
      BRIDGE_DATABASE_FILE: path.join(dir, "bridge-state.sqlite"),
      BRIDGE_STATE_FILE: "",
      DATABASE_URL: "postgres://postgres:postgres@127.0.0.1:5432/auto_bot",
      HERMES_PLATFORM_EVENT_RETENTION_DAYS: "7",
      NODE_ENV: "test",
      PORT: "3000",
      POSTBACK_RUN_RETENTION_DAYS: "30",
      WHATSAPP_MANAGER_ALLOWED_USERS: "",
      WHATSAPP_MANAGER_ALLOW_ALL_USERS: "true",
      WHATSAPP_MANAGER_API_TOKEN: "test-token",
      WHATSAPP_MANAGER_API_URL: "http://127.0.0.1:3000",
    });
    const services = createTestServices(maintenanceConfig);
    const maintenanceApp = createApp({
      config: maintenanceConfig,
      services,
    });
    const store = services.postbackActionStore!;

    try {
      store.savePostbackActionRun({
        id: "old-run",
        actionId: "action-1",
        actionName: "old",
        actionType: "hermes",
        accountId: "ops-main",
        chatJid: "12345@s.whatsapp.net",
        inboundMessageId: "old-message",
        status: "success",
        attempts: 1,
        createdAt: "2026-05-01T00:00:00.000Z",
        updatedAt: "2026-05-01T00:00:00.000Z",
      });
      store.savePostbackActionRun({
        id: "new-run",
        actionId: "action-1",
        actionName: "new",
        actionType: "hermes",
        accountId: "ops-main",
        chatJid: "12345@s.whatsapp.net",
        inboundMessageId: "new-message",
        status: "success",
        attempts: 1,
        createdAt: "2026-07-02T00:00:00.000Z",
        updatedAt: "2026-07-02T00:00:00.000Z",
      });
      services.hermesPlatformEventStore!.appendHermesPlatformEvent({
        accountId: "ops-main",
        chatJid: "12345@s.whatsapp.net",
        chatType: "direct",
        senderJid: "12345@s.whatsapp.net",
        sessionKey: "whatsapp:ops-main:direct:12345@s.whatsapp.net",
        messageId: "platform-old",
        chatId: "12345@s.whatsapp.net",
        senderId: "12345@s.whatsapp.net",
        text: "old event",
        timestamp: "2026-05-01T00:00:00.000Z",
      });

      const statusResponse = await maintenanceApp.inject({
        method: "GET",
        url: "/runtime/status",
        headers: { authorization: "Bearer test-token" },
      });
      expect(statusResponse.statusCode).toBe(200);
      expect(statusResponse.json().hermesNativeAdapter).toEqual(expect.objectContaining({
        ready: true,
        apiUrlConfigured: true,
        apiTokenConfigured: true,
      }));

      const cleanupResponse = await maintenanceApp.inject({
        method: "POST",
        url: "/postback-maintenance/cleanup",
        headers: { authorization: "Bearer test-token" },
        payload: {
          runRetentionDays: 30,
          platformEventRetentionDays: 7,
        },
      });

      expect(cleanupResponse.statusCode).toBe(200);
      expect(cleanupResponse.json().result).toEqual({
        deletedRuns: 1,
        deletedPlatformEvents: 0,
      });
      expect(store.getPostbackActionRun("old-run")).toBeNull();
      expect(store.getPostbackActionRun("new-run")).toEqual(expect.objectContaining({ id: "new-run" }));
      expect(store.cleanupPostbackRecords?.({
        runRetentionDays: 0,
        platformEventRetentionDays: 1,
        now: new Date("2026-07-10T00:00:00.000Z"),
      })).toEqual({
        deletedRuns: 0,
        deletedPlatformEvents: 1,
      });
    } finally {
      await maintenanceApp.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("stores app-manager chat archives separately from WhatsApp chat archive sync state", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "auto-bot-manager-chat-archive-"));
    const archiveConfig = loadConfig({
      ...process.env,
      API_TOKEN: "test-token",
      BRIDGE_DATABASE_FILE: path.join(dir, "bridge-state.sqlite"),
      BRIDGE_STATE_FILE: "",
      DATABASE_URL: "postgres://postgres:postgres@127.0.0.1:5432/auto_bot",
      NODE_ENV: "test",
      PORT: "3000",
    });
    const services = createTestServices(archiveConfig);
    const archiveApp = createApp({
      config: archiveConfig,
      services,
    });

    try {
      services.whatsappSyncStore?.saveWhatsAppChat({
        accountId: "ops-main",
        chatJid: "12345@s.whatsapp.net",
        chatType: "direct",
        archived: false,
        firstSeenAt: "2026-07-03T00:00:00.000Z",
        lastSeenAt: "2026-07-03T00:00:00.000Z",
      });

      const archiveResponse = await archiveApp.inject({
        method: "PATCH",
        url: "/manager/chats",
        headers: {
          authorization: "Bearer test-token",
        },
        payload: {
          accountId: "ops-main",
          chatJid: "12345@s.whatsapp.net",
          archived: true,
        },
      });

      expect(archiveResponse.statusCode).toBe(200);
      expect(archiveResponse.json()).toEqual(
        expect.objectContaining({
          accountId: "ops-main",
          chatJid: "12345@s.whatsapp.net",
          archived: true,
        }),
      );

      const managerChats = await archiveApp.inject({
        method: "GET",
        url: "/manager/chats?accountId=ops-main",
        headers: {
          authorization: "Bearer test-token",
        },
      });
      expect(managerChats.json()).toEqual({
        items: [
          expect.objectContaining({
            accountId: "ops-main",
            chatJid: "12345@s.whatsapp.net",
            archived: true,
          }),
        ],
      });

      const syncedChats = await archiveApp.inject({
        method: "GET",
        url: "/whatsapp/sync/chats?accountId=ops-main",
        headers: {
          authorization: "Bearer test-token",
        },
      });
      expect(syncedChats.json()).toEqual({
        items: [
          expect.objectContaining({
            accountId: "ops-main",
            chatJid: "12345@s.whatsapp.net",
            archived: false,
          }),
        ],
      });

      const restoreResponse = await archiveApp.inject({
        method: "PATCH",
        url: "/manager/chats",
        headers: {
          authorization: "Bearer test-token",
        },
        payload: {
          accountId: "ops-main",
          chatJid: "12345@s.whatsapp.net",
          archived: false,
        },
      });
      expect(restoreResponse.statusCode).toBe(200);
      expect(restoreResponse.json()).toEqual(
        expect.objectContaining({
          archived: false,
        }),
      );
    } finally {
      await archiveApp.close();
      rmSync(dir, { force: true, recursive: true });
    }
  });

  it("uses the linked WhatsApp phone number when no account name is provided", async () => {
    const connectResponse = await app.inject({
      method: "POST",
      url: "/whatsapp/connect",
      headers: {
        authorization: "Bearer test-token",
      },
      payload: {},
    });

    expect(connectResponse.statusCode).toBe(200);
    expect(connectResponse.json()).toEqual(
      expect.objectContaining({
        accountId: "15551234567",
        status: "connected",
      }),
    );

    const response = await app.inject({
      method: "GET",
      url: "/whatsapp/accounts",
      headers: {
        authorization: "Bearer test-token",
      },
    });

    expect(response.json()).toEqual({
      items: [
        expect.objectContaining({
          accountId: "15551234567",
          status: "connected",
        }),
      ],
    });
  });

  it("starts newly connected WhatsApp accounts with a default deny-all rule", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "auto-bot-default-deny-rule-"));
    const rulesConfig = loadConfig({
      ...process.env,
      API_TOKEN: "test-token",
      BRIDGE_DATABASE_FILE: path.join(dir, "bridge-state.sqlite"),
      BRIDGE_STATE_FILE: "",
      DATABASE_URL: "postgres://postgres:postgres@127.0.0.1:5432/auto_bot",
      NODE_ENV: "test",
      PORT: "3000",
    });

    try {
      const services = createTestServices(rulesConfig);
      const gateway = services.whatsappGateway as TestWhatsAppGateway;
      app = createApp({ config: rulesConfig, services });

      const connectResponse = await app.inject({
        method: "POST",
        url: "/whatsapp/connect",
        headers: {
          authorization: "Bearer test-token",
        },
        payload: {
          accountId: "ops-main",
        },
      });

      expect(connectResponse.statusCode).toBe(200);
      expect(services.numberRuleStore?.listNumberRules("ops-main")).toEqual([
        expect.objectContaining({
          accountId: "ops-main",
          action: "deny",
          matchType: "all",
          pattern: "",
          label: "Default deny all",
          enabled: true,
        }),
      ]);

      await app.inject({
        method: "POST",
        url: "/whatsapp/connect",
        headers: {
          authorization: "Bearer test-token",
        },
        payload: {
          accountId: "ops-main",
        },
      });
      expect(services.numberRuleStore?.listNumberRules("ops-main")).toHaveLength(1);

      await gateway.injectInboundMessage({
        accountId: "ops-main",
        chatId: "12345@s.whatsapp.net",
        messageId: "wamid.default-deny",
        senderId: "12345@s.whatsapp.net",
        text: "should not answer yet",
      });

      expect(await services.router.getMappings()).toEqual([]);
      expect(gateway.getSentMessages()).toEqual([]);
      expect(services.deliveryStore?.listDeliveries()).toEqual([
        expect.objectContaining({
          accountId: "ops-main",
          inboundMessageId: "wamid.default-deny",
          status: "ignored",
          error: expect.stringContaining("Default deny all"),
        }),
      ]);
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  it("disconnects WhatsApp accounts", async () => {
    await app.inject({
      method: "POST",
      url: "/whatsapp/connect",
      headers: {
        authorization: "Bearer test-token",
      },
      payload: {
        accountId: "ops-main",
      },
    });

    const response = await app.inject({
      method: "POST",
      url: "/whatsapp/accounts/ops-main/disconnect",
      headers: {
        authorization: "Bearer test-token",
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual(
      expect.objectContaining({
        accountId: "ops-main",
        status: "disconnected",
      }),
    );
  });

  it("returns parser errors with their original HTTP status", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/whatsapp/accounts/ops-main/disconnect",
      headers: {
        authorization: "Bearer test-token",
        "content-type": "application/json",
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({
      error: "Body cannot be empty when content-type is set to 'application/json'",
    });
  });

  it("passes optional account IDs to outbound WhatsApp messages", async () => {
    const services = createTestServices(config);
    app = createApp({ config, services });

    const response = await app.inject({
      method: "POST",
      url: "/messages/outbound",
      headers: {
        authorization: "Bearer test-token",
      },
      payload: {
        accountId: "ops-main",
        chatId: "12345@s.whatsapp.net",
        text: "manual outbound",
      },
    });

    expect(response.statusCode).toBe(200);
    expect((services.whatsappGateway as TestWhatsAppGateway).getSentMessages()).toEqual([
      {
        accountId: "ops-main",
        chatId: "12345@s.whatsapp.net",
        text: "manual outbound",
      },
    ]);
  });

  it("routes gateway inbound messages to Hermes and sends replies back to WhatsApp", async () => {
    const services = createTestServices(config);
    const gateway = services.whatsappGateway as TestWhatsAppGateway;

    await gateway.injectInboundMessage({
      accountId: "ops-main",
      chatId: "12345@s.whatsapp.net",
      messageId: "wamid.1",
      senderId: "12345@s.whatsapp.net",
      text: "hello through gateway",
      timestamp: "2026-06-29T00:00:00.000Z",
    });

    const mappings = await services.router.getMappings();

    expect(mappings).toHaveLength(1);
    expect(mappings[0]).toEqual(
      expect.objectContaining({
        chatId: "12345@s.whatsapp.net",
        accountId: "ops-main",
        sessionKey: "whatsapp:ops-main:direct:12345@s.whatsapp.net",
      }),
    );
    expect(gateway.getSentMessages()).toEqual([
      {
        accountId: "ops-main",
        chatJid: "12345@s.whatsapp.net",
        chatId: "12345@s.whatsapp.net",
        text: "test-hermes-response: hello through gateway",
      },
    ]);
  });

  it("deduplicates repeated WhatsApp messages before routing to Hermes", async () => {
    const services = createTestServices(config);
    const gateway = services.whatsappGateway as TestWhatsAppGateway;

    const payload = {
      accountId: "ops-main",
      chatId: "12345@s.whatsapp.net",
      messageId: "wamid.duplicate",
      senderId: "12345@s.whatsapp.net",
      text: "only process once",
      timestamp: "2026-06-29T00:00:00.000Z",
    };

    await gateway.injectInboundMessage(payload);
    await gateway.injectInboundMessage(payload);

    expect(await services.router.getMappings()).toHaveLength(1);
    expect(gateway.getSentMessages()).toEqual([
      {
        accountId: "ops-main",
        chatJid: "12345@s.whatsapp.net",
        chatId: "12345@s.whatsapp.net",
        text: "test-hermes-response: only process once",
      },
    ]);
  });

  it("persists mappings and processed message keys across service rebuilds", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "auto-bot-bridge-state-"));
    const persistedConfig = loadConfig({
      ...process.env,
      API_TOKEN: "test-token",
      BRIDGE_DATABASE_FILE: "",
      BRIDGE_STATE_FILE: path.join(dir, "bridge-state.json"),
      DATABASE_URL: "postgres://postgres:postgres@127.0.0.1:5432/auto_bot",
      NODE_ENV: "test",
      PORT: "3000",
    });

    try {
      const firstServices = createTestServices(persistedConfig);
      const firstGateway = firstServices.whatsappGateway as TestWhatsAppGateway;
      const payload = {
        accountId: "ops-main",
        chatId: "12345@s.whatsapp.net",
        messageId: "wamid.persisted",
        senderId: "12345@s.whatsapp.net",
        text: "persist me",
        timestamp: "2026-06-29T00:00:00.000Z",
      };

      await firstGateway.injectInboundMessage(payload);

      const secondServices = createTestServices(persistedConfig);
      const secondGateway = secondServices.whatsappGateway as TestWhatsAppGateway;

      expect(await secondServices.router.getMappings()).toEqual([
        expect.objectContaining({
          accountId: "ops-main",
          chatJid: "12345@s.whatsapp.net",
          sessionKey: "whatsapp:ops-main:direct:12345@s.whatsapp.net",
        }),
      ]);

      await secondGateway.injectInboundMessage(payload);
      expect(secondGateway.getSentMessages()).toEqual([]);
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  it("persists mappings and deliveries in the SQLite bridge database", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "auto-bot-bridge-sqlite-"));
    const databaseFile = path.join(dir, "bridge-state.sqlite");
    const persistedConfig = loadConfig({
      ...process.env,
      API_TOKEN: "test-token",
      BRIDGE_DATABASE_FILE: databaseFile,
      BRIDGE_STATE_FILE: "",
      DATABASE_URL: "postgres://postgres:postgres@127.0.0.1:5432/auto_bot",
      NODE_ENV: "test",
      PORT: "3000",
    });

    try {
      const firstServices = createTestServices(persistedConfig);
      const firstGateway = firstServices.whatsappGateway as TestWhatsAppGateway;
      await firstGateway.injectInboundMessage({
        accountId: "ops-main",
        chatId: "12345@s.whatsapp.net",
        messageId: "wamid.sqlite",
        senderId: "12345@s.whatsapp.net",
        text: "persist in sqlite",
        timestamp: "2026-06-29T00:00:00.000Z",
      });

      const secondServices = createTestServices(persistedConfig);

      expect(await secondServices.router.getMappings()).toEqual([
        expect.objectContaining({
          accountId: "ops-main",
          sessionKey: "whatsapp:ops-main:direct:12345@s.whatsapp.net",
        }),
      ]);
      expect(secondServices.deliveryStore?.listDeliveries()).toEqual([
        expect.objectContaining({
          accountId: "ops-main",
          inboundMessageId: "wamid.sqlite",
          status: "sent",
          attempts: 1,
        }),
      ]);
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  it("ignores group messages before routing them to Hermes", async () => {
    const services = createTestServices(config);
    const gateway = services.whatsappGateway as TestWhatsAppGateway;

    await gateway.injectInboundMessage({
      accountId: "ops-main",
      chatId: "120363000000000000@g.us",
      chatType: "group",
      participantJid: "15550000001@s.whatsapp.net",
      messageId: "wamid.group.1",
      text: "group participant hello",
    });

    expect(await services.router.getMappings()).toEqual([]);
  });

  it("returns ignored for manual group inbound payloads", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/messages/inbound",
      headers: {
        authorization: "Bearer test-token",
      },
      payload: {
        accountId: "ops-main",
        chatId: "120363000000000000@g.us",
        chatType: "group",
        messageId: "wamid.group.manual",
        text: "manual group hello",
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ignored: true, reason: "group-chat" });
  });

  it("lists failed deliveries and retries them through the API", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "auto-bot-delivery-retry-"));
    const retryConfig = loadConfig({
      ...process.env,
      API_TOKEN: "test-token",
      BRIDGE_DATABASE_FILE: path.join(dir, "bridge-state.sqlite"),
      BRIDGE_STATE_FILE: "",
      DATABASE_URL: "postgres://postgres:postgres@127.0.0.1:5432/auto_bot",
      NODE_ENV: "test",
      PORT: "3000",
    });

    try {
      const services = createTestServices(retryConfig);
      const gateway = services.whatsappGateway as TestWhatsAppGateway;
      app = createApp({ config: retryConfig, services });

      await gateway.injectInboundMessage({
        accountId: "ops-main",
        chatId: "12345@s.whatsapp.net",
        messageId: "wamid.retry",
        senderId: "12345@s.whatsapp.net",
        text: "retry me",
      });

      const delivery = services.deliveryStore?.listDeliveries()[0];
      expect(delivery).toEqual(expect.objectContaining({ status: "sent" }));

      services.deliveryStore?.saveDelivery({
        ...delivery!,
        status: "failed",
        attempts: 1,
        error: "forced failure",
        updatedAt: new Date().toISOString(),
      });

      const list = await app.inject({
        method: "GET",
        url: "/deliveries",
        headers: {
          authorization: "Bearer test-token",
        },
      });
      expect(list.json().items[0]).toEqual(expect.objectContaining({ status: "failed" }));

      const retry = await app.inject({
        method: "POST",
        url: `/deliveries/${encodeURIComponent(delivery!.id)}/retry`,
        headers: {
          authorization: "Bearer test-token",
        },
      });

      expect(retry.statusCode).toBe(200);
      expect(retry.json()).toEqual(expect.objectContaining({ status: "sent" }));
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  it("cleans up legacy number-rule blocked deliveries stored as failures", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "auto-bot-blocked-delivery-cleanup-"));
    const databaseFile = path.join(dir, "bridge-state.sqlite");

    try {
      const originalStore = new SqliteBridgeStateStore(databaseFile);
      const now = new Date().toISOString();

      originalStore.saveDelivery({
        id: "ops-main:12345@s.whatsapp.net:wamid.blocked-legacy",
        accountId: "ops-main",
        chatJid: "12345@s.whatsapp.net",
        chatType: "direct",
        sessionKey: "whatsapp:ops-main:direct:12345@s.whatsapp.net",
        inboundMessageId: "wamid.blocked-legacy",
        inboundText: "blocked",
        outboundText: "",
        status: "failed",
        attempts: 0,
        failureStage: "hermes",
        error: "Blocked by number rule: Default deny all",
        createdAt: now,
        updatedAt: now,
      });

      expect(originalStore.listDeliveries()[0]).toEqual(
        expect.objectContaining({
          status: "failed",
          failureStage: "hermes",
        }),
      );

      const migratedStore = new SqliteBridgeStateStore(databaseFile);
      const deliveries = migratedStore.listDeliveries();

      expect(deliveries[0]).toEqual(
        expect.objectContaining({
          status: "ignored",
          error: "Blocked by number rule: Default deny all",
        }),
      );
      expect(deliveries[0]).not.toHaveProperty("failureStage");
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  it("records failed Hermes turns and retries them through the API", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "auto-bot-hermes-retry-"));
    const retryConfig = loadConfig({
      ...process.env,
      API_TOKEN: "test-token",
      BRIDGE_DATABASE_FILE: path.join(dir, "bridge-state.sqlite"),
      BRIDGE_STATE_FILE: "",
      DATABASE_URL: "postgres://postgres:postgres@127.0.0.1:5432/auto_bot",
      NODE_ENV: "test",
      PORT: "3000",
    });

    try {
      const services = createTestServices(retryConfig);
      const gateway = services.whatsappGateway as TestWhatsAppGateway;
      app = createApp({ config: retryConfig, services });

      vi.spyOn(services.hermesAdapter, "sendMessage")
        .mockRejectedValueOnce(new Error("forced Hermes failure"))
        .mockResolvedValueOnce({
          sessionId: "retry-session",
          outputText: "Hermes retry reply",
        });

      await expect(
        gateway.injectInboundMessage({
          accountId: "ops-main",
          chatId: "12345@s.whatsapp.net",
          messageId: "wamid.hermes.retry",
          senderId: "12345@s.whatsapp.net",
          text: "retry hermes",
        }),
      ).resolves.toBeUndefined();

      const delivery = services.deliveryStore?.listDeliveries()[0];
      expect(delivery).toEqual(
        expect.objectContaining({
          failureStage: "hermes",
          inboundText: "retry hermes",
          status: "failed",
        }),
      );

      const retry = await app.inject({
        method: "POST",
        url: `/deliveries/${encodeURIComponent(delivery!.id)}/retry`,
        headers: {
          authorization: "Bearer test-token",
        },
      });

      expect(retry.statusCode).toBe(200);
      expect(retry.json()).toEqual(expect.objectContaining({ status: "sent" }));
      expect(gateway.getSentMessages()).toEqual([
        expect.objectContaining({
          accountId: "ops-main",
          chatJid: "12345@s.whatsapp.net",
          text: "Hermes retry reply",
        }),
      ]);
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  it("creates, updates, lists, and deletes account number rules", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "auto-bot-number-rules-api-"));
    const rulesConfig = loadConfig({
      ...process.env,
      API_TOKEN: "test-token",
      BRIDGE_DATABASE_FILE: path.join(dir, "bridge-state.sqlite"),
      BRIDGE_STATE_FILE: "",
      DATABASE_URL: "postgres://postgres:postgres@127.0.0.1:5432/auto_bot",
      NODE_ENV: "test",
      PORT: "3000",
    });

    try {
      const services = createTestServices(rulesConfig);
      app = createApp({ config: rulesConfig, services });

      const created = await app.inject({
        method: "POST",
        url: "/number-rules",
        headers: {
          authorization: "Bearer test-token",
        },
        payload: {
          accountId: "ops-main",
          action: "deny",
          matchType: "regex",
          pattern: "^1555",
          label: "test deny prefix",
        },
      });

      expect(created.statusCode).toBe(200);
      const rule = created.json();
      expect(rule).toEqual(
        expect.objectContaining({
          accountId: "ops-main",
          action: "deny",
          matchType: "regex",
          pattern: "^1555",
          enabled: true,
        }),
      );

      const updated = await app.inject({
        method: "PUT",
        url: `/number-rules/${encodeURIComponent(rule.id)}`,
        headers: {
          authorization: "Bearer test-token",
        },
        payload: {
          enabled: false,
        },
      });
      expect(updated.statusCode).toBe(200);
      expect(updated.json()).toEqual(expect.objectContaining({ enabled: false }));

      const list = await app.inject({
        method: "GET",
        url: "/number-rules?accountId=ops-main",
        headers: {
          authorization: "Bearer test-token",
        },
      });
      expect(list.json().items).toEqual([expect.objectContaining({ id: rule.id })]);

      const deleted = await app.inject({
        method: "DELETE",
        url: `/number-rules/${encodeURIComponent(rule.id)}`,
        headers: {
          authorization: "Bearer test-token",
        },
      });
      expect(deleted.statusCode).toBe(204);
      expect(services.numberRuleStore?.listNumberRules("ops-main")).toEqual([]);
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  it("records and lists audit logs for app mutations", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "auto-bot-audit-logs-"));
    const auditConfig = loadConfig({
      ...process.env,
      API_TOKEN: "test-token",
      BRIDGE_DATABASE_FILE: path.join(dir, "bridge-state.sqlite"),
      BRIDGE_STATE_FILE: "",
      DATABASE_URL: "postgres://postgres:postgres@127.0.0.1:5432/auto_bot",
      NODE_ENV: "test",
      PORT: "3000",
    });

    try {
      const services = createTestServices(auditConfig);
      const events: string[] = [];
      const unsubscribe = services.eventBus.subscribe((event) => {
        events.push(event.type);
      });
      app = createApp({ config: auditConfig, services });

      try {
        await app.inject({
          method: "POST",
          url: "/whatsapp/connect",
          headers: {
            authorization: "Bearer test-token",
          },
          payload: {
            accountId: "ops-main",
          },
        });

        const created = await app.inject({
          method: "POST",
          url: "/number-rules",
          headers: {
            authorization: "Bearer test-token",
          },
          payload: {
            accountId: "ops-main",
            action: "allow",
            matchType: "exact",
            pattern: "12345",
          },
        });

        expect(created.statusCode).toBe(200);

        const logs = await app.inject({
          method: "GET",
          url: "/audit-logs?limit=10",
          headers: {
            authorization: "Bearer test-token",
          },
        });

        expect(logs.statusCode).toBe(200);
        expect(logs.json().items).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              action: "whatsapp.connect",
              resourceType: "whatsapp-account",
              resourceId: "ops-main",
              outcome: "success",
            }),
            expect.objectContaining({
              action: "number-rule.create",
              resourceType: "number-rule",
              outcome: "success",
            }),
          ]),
        );
        expect(events.filter((event) => event === "logs")).toHaveLength(2);
      } finally {
        unsubscribe();
      }
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  it("coalesces rapid branding audit updates", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "auto-bot-branding-audit-logs-"));
    const auditConfig = loadConfig({
      ...process.env,
      API_TOKEN: "test-token",
      BRIDGE_DATABASE_FILE: path.join(dir, "bridge-state.sqlite"),
      BRIDGE_STATE_FILE: "",
      DATABASE_URL: "postgres://postgres:postgres@127.0.0.1:5432/auto_bot",
      NODE_ENV: "test",
      PORT: "3000",
    });

    try {
      const services = createTestServices(auditConfig);
      app = createApp({ config: auditConfig, services });

      const first = await app.inject({
        method: "POST",
        url: "/audit-logs",
        headers: {
          authorization: "Bearer test-token",
        },
        payload: {
          action: "ui-branding.update",
          resourceType: "ui-settings",
          resourceId: "branding",
          details: {
            accountId: "ops-main",
            previousTitle: "Auto Bot",
            title: "Samuel",
            previousCustomIcon: false,
            customIcon: true,
          },
        },
      });

      const second = await app.inject({
        method: "POST",
        url: "/audit-logs",
        headers: {
          authorization: "Bearer test-token",
        },
        payload: {
          action: "ui-branding.update",
          resourceType: "ui-settings",
          resourceId: "branding",
          details: {
            accountId: "ops-main",
            previousTitle: "Samuel",
            title: "Samuel kitchen",
            previousCustomIcon: true,
            customIcon: true,
          },
        },
      });

      expect(first.statusCode).toBe(200);
      expect(second.statusCode).toBe(200);
      expect(second.json()).toEqual(
        expect.objectContaining({
          id: first.json().id,
          details: expect.objectContaining({
            accountId: "ops-main",
            previousTitle: "Auto Bot",
            title: "Samuel kitchen",
            previousCustomIcon: false,
            customIcon: true,
            changeCount: 2,
          }),
        }),
      );

      const logs = await app.inject({
        method: "GET",
        url: "/audit-logs?limit=10",
        headers: {
          authorization: "Bearer test-token",
        },
      });

      expect(logs.statusCode).toBe(200);
      expect(logs.json().items).toHaveLength(1);
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  it("blocks denied gateway numbers before creating Hermes sessions", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "auto-bot-number-rules-deny-"));
    const rulesConfig = loadConfig({
      ...process.env,
      API_TOKEN: "test-token",
      BRIDGE_DATABASE_FILE: path.join(dir, "bridge-state.sqlite"),
      BRIDGE_STATE_FILE: "",
      DATABASE_URL: "postgres://postgres:postgres@127.0.0.1:5432/auto_bot",
      NODE_ENV: "test",
      PORT: "3000",
    });

    try {
      const services = createTestServices(rulesConfig);
      const gateway = services.whatsappGateway as TestWhatsAppGateway;
      app = createApp({ config: rulesConfig, services });
      services.numberRuleStore?.createNumberRule({
        accountId: "ops-main",
        action: "deny",
        matchType: "exact",
        pattern: "12345",
      });

      await gateway.injectInboundMessage({
        accountId: "ops-main",
        chatId: "12345@s.whatsapp.net",
        messageId: "wamid.denied",
        senderId: "12345@s.whatsapp.net",
        text: "do not route",
      });

      expect(await services.router.getMappings()).toEqual([]);
      expect(gateway.getSentMessages()).toEqual([]);
      expect(services.deliveryStore?.listDeliveries()).toEqual([
        expect.objectContaining({
          accountId: "ops-main",
          inboundMessageId: "wamid.denied",
          status: "ignored",
          error: expect.stringContaining("Blocked by number rule"),
        }),
      ]);

      const delivery = services.deliveryStore?.listDeliveries()[0];
      const retry = await app.inject({
        method: "POST",
        url: `/deliveries/${encodeURIComponent(delivery!.id)}/retry`,
        headers: {
          authorization: "Bearer test-token",
        },
      });
      expect(retry.statusCode).toBe(409);
      expect(retry.json()).toEqual({ error: expect.stringContaining("Blocked by number rule") });

      const logs = await app.inject({
        method: "GET",
        url: "/audit-logs?limit=10",
        headers: {
          authorization: "Bearer test-token",
        },
      });
      expect(logs.statusCode).toBe(200);
      expect(logs.json().items).toEqual([
        expect.objectContaining({
          action: "message.inbound",
          outcome: "ignored",
          resourceId: "wamid.denied",
        }),
      ]);
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  it("requires an allow rule match when account allow rules exist", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "auto-bot-number-rules-allow-"));
    const rulesConfig = loadConfig({
      ...process.env,
      API_TOKEN: "test-token",
      BRIDGE_DATABASE_FILE: path.join(dir, "bridge-state.sqlite"),
      BRIDGE_STATE_FILE: "",
      DATABASE_URL: "postgres://postgres:postgres@127.0.0.1:5432/auto_bot",
      NODE_ENV: "test",
      PORT: "3000",
    });

    try {
      const services = createTestServices(rulesConfig);
      const gateway = services.whatsappGateway as TestWhatsAppGateway;
      services.numberRuleStore?.createNumberRule({
        accountId: "ops-main",
        action: "allow",
        matchType: "regex",
        pattern: "^12345$",
      });

      await gateway.injectInboundMessage({
        accountId: "ops-main",
        chatId: "99999@s.whatsapp.net",
        messageId: "wamid.not-allowed",
        senderId: "99999@s.whatsapp.net",
        text: "blocked by allow list",
      });
      await gateway.injectInboundMessage({
        accountId: "ops-main",
        chatId: "12345@s.whatsapp.net",
        messageId: "wamid.allowed",
        senderId: "12345@s.whatsapp.net",
        text: "allowed by allow list",
      });

      expect(await services.router.getMappings()).toEqual([
        expect.objectContaining({
          chatJid: "12345@s.whatsapp.net",
        }),
      ]);
      expect(gateway.getSentMessages()).toEqual([
        expect.objectContaining({
          chatJid: "12345@s.whatsapp.net",
          text: "test-hermes-response: allowed by allow list",
        }),
      ]);
      expect(services.deliveryStore?.listDeliveries()).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            inboundMessageId: "wamid.not-allowed",
            status: "ignored",
          }),
          expect.objectContaining({
            inboundMessageId: "wamid.allowed",
            status: "sent",
          }),
        ]),
      );
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  it("lets a specific allow rule override the default deny-all fallback", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "auto-bot-number-rules-default-allow-"));
    const rulesConfig = loadConfig({
      ...process.env,
      API_TOKEN: "test-token",
      BRIDGE_DATABASE_FILE: path.join(dir, "bridge-state.sqlite"),
      BRIDGE_STATE_FILE: "",
      DATABASE_URL: "postgres://postgres:postgres@127.0.0.1:5432/auto_bot",
      NODE_ENV: "test",
      PORT: "3000",
    });

    try {
      const services = createTestServices(rulesConfig);
      const gateway = services.whatsappGateway as TestWhatsAppGateway;
      app = createApp({ config: rulesConfig, services });

      services.numberRuleStore?.createNumberRule({
        accountId: "ops-main",
        action: "deny",
        matchType: "all",
        label: "Default deny all",
      });
      services.numberRuleStore?.createNumberRule({
        accountId: "ops-main",
        action: "allow",
        matchType: "exact",
        pattern: "12345",
      });

      await gateway.injectInboundMessage({
        accountId: "ops-main",
        chatId: "99999@s.whatsapp.net",
        messageId: "wamid.default-deny-not-allowed",
        senderId: "99999@s.whatsapp.net",
        text: "blocked by default deny",
      });
      await gateway.injectInboundMessage({
        accountId: "ops-main",
        chatId: "12345@s.whatsapp.net",
        messageId: "wamid.default-deny-allowed",
        senderId: "12345@s.whatsapp.net",
        text: "allowed by first allow",
      });

      expect(await services.router.getMappings()).toEqual([
        expect.objectContaining({
          chatJid: "12345@s.whatsapp.net",
        }),
      ]);
      expect(gateway.getSentMessages()).toEqual([
        expect.objectContaining({
          chatJid: "12345@s.whatsapp.net",
          text: "test-hermes-response: allowed by first allow",
        }),
      ]);
      expect(services.deliveryStore?.listDeliveries()).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            inboundMessageId: "wamid.default-deny-not-allowed",
            status: "ignored",
          }),
          expect.objectContaining({
            inboundMessageId: "wamid.default-deny-allowed",
            status: "sent",
          }),
        ]),
      );
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  it("persists WhatsApp sync contacts, chats, messages, LID mappings, and event metadata", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "auto-bot-whatsapp-sync-"));
    const syncConfig = loadConfig({
      ...process.env,
      API_TOKEN: "test-token",
      BRIDGE_DATABASE_FILE: path.join(dir, "bridge-state.sqlite"),
      BRIDGE_STATE_FILE: "",
      DATABASE_URL: "postgres://postgres:postgres@127.0.0.1:5432/auto_bot",
      NODE_ENV: "test",
      PORT: "3000",
    });

    try {
      const services = createTestServices(syncConfig);
      const gateway = services.whatsappGateway as TestWhatsAppGateway;
      const syncApp = createApp({ config: syncConfig, services });

      try {
        const historyPayload = {
          syncType: "initial_bootstrap",
          contacts: [
            {
              id: "83038931275996@lid",
              phoneNumber: "15551234567@s.whatsapp.net",
              lid: "83038931275996@lid",
              name: "Test Customer",
              notify: "Customer",
            },
          ],
          chats: [
            {
              id: "83038931275996@lid",
              name: "Test Customer",
              unreadCount: 2,
              conversationTimestamp: 1783080000,
            },
          ],
          messages: [
            {
              key: {
                remoteJid: "83038931275996@lid",
                id: "wamid.history.1",
                fromMe: false,
              },
              messageTimestamp: 1783080000,
              message: {
                conversation: "historical hello",
              },
            },
          ],
          lidPnMappings: [
            {
              lid: "83038931275996@lid",
              pn: "15551234567@s.whatsapp.net",
            },
          ],
        };
        gateway.injectSyncEvent({
          accountId: "ops-main",
          eventType: "messaging-history.set",
          receivedAt: "2026-07-03T12:00:00.000Z",
          payload: historyPayload,
        });
        gateway.injectSyncEvent({
          accountId: "ops-main",
          eventType: "messaging-history.set",
          receivedAt: "2026-07-03T12:00:02.000Z",
          payload: historyPayload,
        });
        gateway.injectSyncEvent({
          accountId: "ops-main",
          eventType: "lid-mapping.update",
          receivedAt: "2026-07-03T12:00:01.000Z",
          payload: {
            lid: "83038931275996@lid",
            pn: "15551234567@s.whatsapp.net",
          },
        });

        const headers = { authorization: "Bearer test-token" };
        const summary = await syncApp.inject({
          method: "GET",
          url: "/whatsapp/sync/summary?accountId=ops-main",
          headers,
        });
        const chats = await syncApp.inject({
          method: "GET",
          url: "/whatsapp/sync/chats?accountId=ops-main",
          headers,
        });
        const messages = await syncApp.inject({
          method: "GET",
          url: "/whatsapp/sync/messages?accountId=ops-main&chatJid=83038931275996%40lid",
          headers,
        });
        const messageCounts = await syncApp.inject({
          method: "GET",
          url: "/whatsapp/sync/message-counts?accountId=ops-main",
          headers,
        });
        const contacts = await syncApp.inject({
          method: "GET",
          url: "/whatsapp/sync/contacts?accountId=ops-main",
          headers,
        });
        const mappings = await syncApp.inject({
          method: "GET",
          url: "/whatsapp/sync/lid-mappings?accountId=ops-main",
          headers,
        });
        const batches = await syncApp.inject({
          method: "GET",
          url: "/whatsapp/sync/history-batches?accountId=ops-main",
          headers,
        });
        const events = await syncApp.inject({
          method: "GET",
          url: "/whatsapp/sync/events?accountId=ops-main",
          headers,
        });

        expect(summary.json()).toEqual({
          contacts: 1,
          chats: 1,
          messages: 1,
          messageReceipts: 0,
          messageUpdates: 0,
          mediaAssets: 0,
          lidMappings: 1,
          historySyncBatches: 1,
          syncEvents: 2,
        });
        expect(chats.json().items).toEqual([
          expect.objectContaining({
            chatJid: "83038931275996@lid",
            displayName: "Test Customer",
            chatType: "direct",
            unreadCount: 2,
          }),
        ]);
        const readChat = await syncApp.inject({
          method: "PATCH",
          url: "/whatsapp/sync/chats/read",
          headers,
          payload: {
            accountId: "ops-main",
            chatJid: "83038931275996@lid",
          },
        });
        const chatsAfterRead = await syncApp.inject({
          method: "GET",
          url: "/whatsapp/sync/chats?accountId=ops-main",
          headers,
        });
        expect(readChat.statusCode).toBe(200);
        expect(readChat.json()).toEqual(
          expect.objectContaining({
            chatJid: "83038931275996@lid",
            unreadCount: 0,
          }),
        );
        expect(chatsAfterRead.json().items).toEqual([
          expect.objectContaining({
            chatJid: "83038931275996@lid",
            unreadCount: 0,
          }),
        ]);
        expect(messages.json().items).toEqual([
          expect.objectContaining({
            chatJid: "83038931275996@lid",
            messageId: "wamid.history.1",
            text: "historical hello",
          }),
        ]);
        expect(messageCounts.json().items).toEqual([
          {
            accountId: "ops-main",
            chatJid: "83038931275996@lid",
            messageCount: 1,
          },
        ]);
        expect(contacts.json().items).toEqual([
          expect.objectContaining({
            contactJid: "83038931275996@lid",
            phoneNumber: "15551234567@s.whatsapp.net",
            lidJid: "83038931275996@lid",
          }),
        ]);
        expect(mappings.json().items).toEqual([
          expect.objectContaining({
            lidJid: "83038931275996@lid",
            pnJid: "15551234567@s.whatsapp.net",
          }),
        ]);
        expect(batches.json().items).toEqual([
          expect.objectContaining({
            accountId: "ops-main",
            syncType: "initial_bootstrap",
            chatCount: 1,
            contactCount: 1,
            messageCount: 1,
          }),
        ]);
        expect(events.json().items).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ eventType: "messaging-history.set" }),
            expect.objectContaining({ eventType: "lid-mapping.update" }),
          ]),
        );
      } finally {
        await syncApp.close();
      }
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  it("stores live WhatsApp upsert messages independently from Hermes delivery records", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "auto-bot-whatsapp-live-sync-"));
    const syncConfig = loadConfig({
      ...process.env,
      API_TOKEN: "test-token",
      BRIDGE_DATABASE_FILE: path.join(dir, "bridge-state.sqlite"),
      BRIDGE_STATE_FILE: "",
      DATABASE_URL: "postgres://postgres:postgres@127.0.0.1:5432/auto_bot",
      NODE_ENV: "test",
      PORT: "3000",
    });

    try {
      const services = createTestServices(syncConfig);
      const gateway = services.whatsappGateway as TestWhatsAppGateway;
      const syncApp = createApp({ config: syncConfig, services });

      try {
        gateway.injectSyncEvent({
          accountId: "ops-main",
          eventType: "messages.upsert",
          receivedAt: "2026-07-03T12:10:00.000Z",
          payload: {
            messages: [
              {
                key: {
                  remoteJid: "83038931275996@lid",
                  id: "wamid.live.1",
                  fromMe: false,
                },
                messageTimestamp: 1783080600,
                message: {
                  conversation: "live hello",
                },
              },
            ],
            type: "notify",
          },
        });
        await gateway.injectInboundMessage({
          accountId: "ops-main",
          chatJid: "83038931275996@lid",
          messageId: "wamid.live.1",
          senderId: "83038931275996@lid",
          text: "live hello",
        });

        const messages = await syncApp.inject({
          method: "GET",
          url: "/whatsapp/sync/messages?accountId=ops-main&chatJid=83038931275996%40lid",
          headers: {
            authorization: "Bearer test-token",
          },
        });
        const summary = await syncApp.inject({
          method: "GET",
          url: "/whatsapp/sync/summary?accountId=ops-main",
          headers: {
            authorization: "Bearer test-token",
          },
        });
        const sessions = await syncApp.inject({
          method: "GET",
          url: "/sessions?accountId=ops-main",
          headers: {
            authorization: "Bearer test-token",
          },
        });
        const deliveries = await syncApp.inject({
          method: "GET",
          url: "/deliveries?accountId=ops-main&chatJid=83038931275996%40lid",
          headers: {
            authorization: "Bearer test-token",
          },
        });

        expect(messages.json().items).toEqual([
          expect.objectContaining({
            chatJid: "83038931275996@lid",
            messageId: "wamid.live.1",
            text: "live hello",
          }),
        ]);
        expect(summary.json()).toEqual(
          expect.objectContaining({
            messages: 1,
            syncEvents: 1,
          }),
        );
        expect(sessions.json().items).toEqual([
          expect.objectContaining({
            accountId: "ops-main",
            chatJid: "83038931275996@lid",
          }),
        ]);
        expect(deliveries.json().items).toEqual([
          expect.objectContaining({
            accountId: "ops-main",
            chatJid: "83038931275996@lid",
            inboundMessageId: "wamid.live.1",
          }),
        ]);
        expect(services.deliveryStore?.listDeliveries()).toEqual([
          expect.objectContaining({
            chatJid: "83038931275996@lid",
            inboundMessageId: "wamid.live.1",
            status: "sent",
          }),
        ]);
      } finally {
        await syncApp.close();
      }
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  it("persists direct Baileys contact and group upsert arrays as typed sync rows", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "auto-bot-whatsapp-array-sync-"));
    const syncConfig = loadConfig({
      ...process.env,
      API_TOKEN: "test-token",
      BRIDGE_DATABASE_FILE: path.join(dir, "bridge-state.sqlite"),
      BRIDGE_STATE_FILE: "",
      DATABASE_URL: "postgres://postgres:postgres@127.0.0.1:5432/auto_bot",
      NODE_ENV: "test",
      PORT: "3000",
    });

    try {
      const services = createTestServices(syncConfig);
      const gateway = services.whatsappGateway as TestWhatsAppGateway;
      const syncApp = createApp({ config: syncConfig, services });

      try {
        gateway.injectSyncEvent({
          accountId: "ops-main",
          eventType: "contacts.upsert",
          receivedAt: "2026-07-03T12:20:00.000Z",
          payload: [
            {
              id: "15551234567@s.whatsapp.net",
              lid: "83038931275996@lid",
              notify: "Array Contact",
            },
          ],
        });
        gateway.injectSyncEvent({
          accountId: "ops-main",
          eventType: "groups.upsert",
          receivedAt: "2026-07-03T12:20:01.000Z",
          payload: [
            {
              id: "120363000000000000@g.us",
              subject: "Array Group",
            },
          ],
        });

        const headers = { authorization: "Bearer test-token" };
        const summary = await syncApp.inject({
          method: "GET",
          url: "/whatsapp/sync/summary?accountId=ops-main",
          headers,
        });
        const contacts = await syncApp.inject({
          method: "GET",
          url: "/whatsapp/sync/contacts?accountId=ops-main",
          headers,
        });
        const chats = await syncApp.inject({
          method: "GET",
          url: "/whatsapp/sync/chats?accountId=ops-main",
          headers,
        });

        expect(summary.json()).toEqual(
          expect.objectContaining({
            contacts: 1,
            chats: 1,
            syncEvents: 2,
          }),
        );
        expect(contacts.json().items).toEqual([
          expect.objectContaining({
            contactJid: "15551234567@s.whatsapp.net",
            lidJid: "83038931275996@lid",
            notifyName: "Array Contact",
          }),
        ]);
        expect(chats.json().items).toEqual([
          expect.objectContaining({
            chatJid: "120363000000000000@g.us",
            chatType: "group",
            displayName: "Array Group",
          }),
        ]);
      } finally {
        await syncApp.close();
      }
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  it("persists typed receipt, lifecycle update, and media asset sync rows", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "auto-bot-whatsapp-events-sync-"));
    const syncConfig = loadConfig({
      ...process.env,
      API_TOKEN: "test-token",
      BRIDGE_DATABASE_FILE: path.join(dir, "bridge-state.sqlite"),
      BRIDGE_STATE_FILE: "",
      DATABASE_URL: "postgres://postgres:postgres@127.0.0.1:5432/auto_bot",
      NODE_ENV: "test",
      PORT: "3000",
    });

    try {
      const services = createTestServices(syncConfig);
      const gateway = services.whatsappGateway as TestWhatsAppGateway;
      const syncApp = createApp({ config: syncConfig, services });

      try {
        gateway.injectSyncEvent({
          accountId: "ops-main",
          eventType: "messages.upsert",
          receivedAt: "2026-07-03T12:30:00.000Z",
          payload: {
            messages: [
              {
                key: {
                  remoteJid: "83038931275996@lid",
                  id: "wamid.media.1",
                  fromMe: false,
                },
                messageTimestamp: 1783081200,
                message: {
                  imageMessage: {
                    mimetype: "image/jpeg",
                    caption: "menu photo",
                    directPath: "/v/t62.7118/image.enc",
                  },
                },
              },
            ],
            type: "notify",
          },
        });
        gateway.injectSyncEvent({
          accountId: "ops-main",
          eventType: "message-receipt.update",
          receivedAt: "2026-07-03T12:30:01.000Z",
          payload: [
            {
              key: {
                remoteJid: "83038931275996@lid",
                id: "wamid.media.1",
              },
              userJid: "15551234567@s.whatsapp.net",
              receipt: "read",
              t: 1783081201,
            },
          ],
        });
        gateway.injectSyncEvent({
          accountId: "ops-main",
          eventType: "messages.delete",
          receivedAt: "2026-07-03T12:30:02.000Z",
          payload: {
            keys: [
              {
                remoteJid: "83038931275996@lid",
                id: "wamid.media.1",
              },
            ],
          },
        });

        const headers = { authorization: "Bearer test-token" };
        const summary = await syncApp.inject({
          method: "GET",
          url: "/whatsapp/sync/summary?accountId=ops-main",
          headers,
        });
        const receipts = await syncApp.inject({
          method: "GET",
          url: "/whatsapp/sync/message-receipts?accountId=ops-main",
          headers,
        });
        const updates = await syncApp.inject({
          method: "GET",
          url: "/whatsapp/sync/message-updates?accountId=ops-main",
          headers,
        });
        const mediaAssets = await syncApp.inject({
          method: "GET",
          url: "/whatsapp/sync/media-assets?accountId=ops-main",
          headers,
        });

        expect(summary.json()).toEqual(
          expect.objectContaining({
            messages: 1,
            messageReceipts: 1,
            messageUpdates: 1,
            mediaAssets: 1,
            syncEvents: 3,
          }),
        );
        expect(receipts.json().items).toEqual([
          expect.objectContaining({
            chatJid: "83038931275996@lid",
            messageId: "wamid.media.1",
            participantJid: "15551234567@s.whatsapp.net",
            receiptType: "read",
          }),
        ]);
        expect(updates.json().items).toEqual([
          expect.objectContaining({
            chatJid: "83038931275996@lid",
            messageId: "wamid.media.1",
            updateType: "messages.delete",
          }),
        ]);
        expect(mediaAssets.json().items).toEqual([
          expect.objectContaining({
            chatJid: "83038931275996@lid",
            messageId: "wamid.media.1",
            mediaType: "image",
            mimetype: "image/jpeg",
            caption: "menu photo",
            directPath: "/v/t62.7118/image.enc",
          }),
        ]);
      } finally {
        await syncApp.close();
      }
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  it("creates persisted Hermes API sessions and sends turns through session chat", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 201,
        json: async () => ({
          session: {
            id: "whatsapp_test",
            started_at: "2026-06-29T00:00:00.000Z",
            last_active: "2026-06-29T00:00:00.000Z",
          },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        headers: new Headers({ "x-hermes-session-id": "whatsapp_test" }),
        json: async () => ({
          session_id: "whatsapp_test",
          message: {
            content: "Hermes reply",
          },
        }),
      });
    vi.stubGlobal("fetch", fetchMock);

    const adapter = new HermesApiAdapter({
      apiKey: "test-key",
      baseUrl: "http://127.0.0.1:8642/v1/",
      model: "hermes-agent",
    });

    const session = await adapter.createSession("whatsapp:ops-main:direct:12345@s.whatsapp.net");
    const reply = await adapter.sendMessage(session.id, {
      accountId: "ops-main",
      chatJid: "12345@s.whatsapp.net",
      chatType: "direct",
      senderJid: "12345@s.whatsapp.net",
      sessionKey: "whatsapp:ops-main:direct:12345@s.whatsapp.net",
      chatId: "12345@s.whatsapp.net",
      messageId: "wamid.api",
      senderId: "12345@s.whatsapp.net",
      text: "hello hermes",
      timestamp: "2026-06-29T00:00:00.000Z",
    });

    expect(session).toEqual(
      expect.objectContaining({
        id: "whatsapp_test",
        sessionKey: "whatsapp:ops-main:direct:12345@s.whatsapp.net",
      }),
    );
    expect(reply).toEqual({
      sessionId: "whatsapp_test",
      outputText: "Hermes reply",
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:8642/api/sessions",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          authorization: "Bearer test-key",
          "x-hermes-session-key": "whatsapp:ops-main:direct:12345@s.whatsapp.net",
        }),
      }),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:8642/api/sessions/whatsapp_test/chat",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          authorization: "Bearer test-key",
          "x-hermes-session-key": "whatsapp:ops-main:direct:12345@s.whatsapp.net",
        }),
      }),
    );
  });

  it("updates mappings when Hermes API rotates the effective session ID", async () => {
    const services = createTestServices(config);
    const router = services.router;
    const session = await router.getOrCreateSession({
      accountId: "ops-main",
      chatJid: "12345@s.whatsapp.net",
    });
    const originalSessionId = session.id;

    vi.spyOn(services.hermesAdapter, "sendMessage").mockResolvedValue({
      sessionId: "hermes-rotated-session",
      outputText: "rotated reply",
    });

    await router.handleInboundMessage({
      accountId: "ops-main",
      chatJid: "12345@s.whatsapp.net",
      chatType: "direct",
      senderJid: "12345@s.whatsapp.net",
      sessionKey: "whatsapp:ops-main:direct:12345@s.whatsapp.net",
      chatId: "12345@s.whatsapp.net",
      messageId: "wamid.rotate",
      senderId: "12345@s.whatsapp.net",
      text: "rotate",
      timestamp: "2026-06-29T00:00:00.000Z",
    });

    expect(originalSessionId).not.toBe("hermes-rotated-session");
    expect(await router.getMappings()).toEqual([
      expect.objectContaining({
        hermesSessionId: "hermes-rotated-session",
      }),
    ]);
    await expect(router.getSession("whatsapp:ops-main:direct:12345@s.whatsapp.net")).resolves.toEqual(
      expect.objectContaining({ id: "hermes-rotated-session" }),
    );
  });

  it("requires an API key for the Hermes API adapter", async () => {
    const adapter = new HermesApiAdapter({
      apiKey: "",
      baseUrl: "http://127.0.0.1:8642/v1",
      model: "hermes-agent",
    });

    await expect(
      adapter.sendMessage("session-1", {
        accountId: "ops-main",
        chatJid: "12345@s.whatsapp.net",
        chatType: "direct",
        senderJid: "12345@s.whatsapp.net",
        sessionKey: "whatsapp:ops-main:direct:12345@s.whatsapp.net",
        chatId: "12345@s.whatsapp.net",
        messageId: "wamid.api",
        senderId: "12345@s.whatsapp.net",
        text: "hello hermes",
        timestamp: "2026-06-29T00:00:00.000Z",
      }),
    ).rejects.toThrow("Internal Hermes API key");
  });
});

function createTestServices(config: AppConfig): AppServices {
  const hermesAdapter = new TestHermesAdapter();
  const eventBus = new AppEventBus();
  const whatsappGateway = new TestWhatsAppGateway();
  const bridgeStore = config.BRIDGE_DATABASE_FILE
    ? new SqliteBridgeStateStore(config.BRIDGE_DATABASE_FILE)
    : config.BRIDGE_STATE_FILE
      ? new FileBridgeStateStore(config.BRIDGE_STATE_FILE)
      : undefined;
  const router = new InMemoryChatSessionRouter(
    hermesAdapter,
    bridgeStore,
    bridgeStore instanceof SqliteBridgeStateStore ? bridgeStore : undefined,
  );
  const postbackActionStore = bridgeStore instanceof SqliteBridgeStateStore ? bridgeStore : undefined;
  const hermesPlatformEventStore = bridgeStore instanceof SqliteBridgeStateStore ? bridgeStore : undefined;
  const postbackDispatcher = new PostbackActionDispatcher({
    ...(postbackActionStore ? { store: postbackActionStore } : {}),
    ...(hermesPlatformEventStore ? { hermesPlatformEventStore } : {}),
    router,
    onHermesReply: async (event, reply) => {
      await sendReplyWithDeliveryRecord({
        ...(postbackActionStore ? { deliveryStore: postbackActionStore } : {}),
        event,
        text: reply.outputText,
        whatsappGateway,
      });
    },
  });

  function recordAuditLog(input: AuditLogInput) {
    if (bridgeStore instanceof SqliteBridgeStateStore) {
      bridgeStore.recordAuditLog(input);
      eventBus.publish("logs");
    }
  }

  whatsappGateway.onStatusChange((status) => {
    const createdDefaultRule = ensureDefaultDenyAllNumberRule(
      bridgeStore instanceof SqliteBridgeStateStore ? bridgeStore : undefined,
      status,
    );
    if (createdDefaultRule) {
      eventBus.publish("rules");
    }
    eventBus.publish("accounts");
  });

  whatsappGateway.onSyncEvent((event) => {
    recordWhatsAppSyncEvent(bridgeStore instanceof SqliteBridgeStateStore ? bridgeStore : undefined, event);
    eventBus.publish("activity");
  });

  whatsappGateway.onInboundMessage(async (event) => {
    const deliveryStore = bridgeStore instanceof SqliteBridgeStateStore ? bridgeStore : undefined;
    const numberRuleStore = bridgeStore instanceof SqliteBridgeStateStore ? bridgeStore : undefined;
    const decision = evaluateNumberRules(numberRuleStore, event);
    if (!decision.allowed) {
      recordBlockedNumberDelivery(deliveryStore, event, decision.reason ?? "Blocked by number rule");
      recordAuditLog({
        action: "message.inbound",
        outcome: "ignored",
        resourceType: "whatsapp-message",
        resourceId: event.messageId,
        details: {
          accountId: event.accountId,
          chatJid: event.chatJid,
          reason: decision.reason ?? "Blocked by number rule",
        },
      });
      eventBus.publish("activity");
      return;
    }

    const configuredActions = postbackActionStore
      ?.listPostbackActions({ accountId: event.accountId, chatJid: event.chatJid })
      .filter((action) => action.enabled && action.trigger === "inbound_message") ?? [];
    if (configuredActions.length > 0) {
      const runs = await postbackDispatcher.dispatchInboundMessage(event);
      eventBus.publish("activity", {
        accountId: event.accountId,
        chatJid: event.chatJid,
        source: "postback",
        postbackRuns: runs,
      });
      recordAuditLog({
        action: "message.inbound",
        resourceType: "whatsapp-message",
        resourceId: event.messageId,
        details: {
          accountId: event.accountId,
          chatJid: event.chatJid,
          postbackActions: runs.length,
          failedPostbackActions: runs.filter((run) => run.status === "failed").length,
        },
      });
      return;
    }

    let result;
    try {
      result = await router.handleInboundMessage(event);
    } catch (error) {
      if (bridgeStore instanceof SqliteBridgeStateStore) {
        const now = new Date().toISOString();
        bridgeStore.saveDelivery({
          id: `${event.accountId}:${event.chatJid}:${event.messageId}`,
          accountId: event.accountId,
          chatJid: event.chatJid,
          chatType: event.chatType,
          sessionKey: event.sessionKey,
          inboundMessageId: event.messageId,
          inboundText: event.text,
          outboundText: "",
          status: "failed",
          attempts: 0,
          failureStage: "hermes",
          error: error instanceof Error ? error.message : "Hermes turn failed",
          createdAt: now,
          updatedAt: now,
        });
      }
      eventBus.publish("activity");
      return;
    }

    if (result.duplicate || !result.reply) {
      return;
    }

    await sendReplyWithDeliveryRecord({
      ...(bridgeStore instanceof SqliteBridgeStateStore ? { deliveryStore: bridgeStore } : {}),
      event: result.event ?? event,
      text: result.reply.outputText,
      whatsappGateway,
    }).catch(() => undefined);
    eventBus.publish("activity");
  });

  return {
    hermesAdapter,
    router,
    whatsappGateway,
    eventBus,
    ...(bridgeStore instanceof SqliteBridgeStateStore ? { deliveryStore: bridgeStore } : {}),
    ...(bridgeStore instanceof SqliteBridgeStateStore ? { numberRuleStore: bridgeStore } : {}),
    ...(bridgeStore instanceof SqliteBridgeStateStore ? { auditLogStore: bridgeStore } : {}),
    ...(bridgeStore instanceof SqliteBridgeStateStore ? { accountMetadataStore: bridgeStore } : {}),
    ...(bridgeStore instanceof SqliteBridgeStateStore ? { managerChatMetadataStore: bridgeStore } : {}),
    ...(bridgeStore instanceof SqliteBridgeStateStore ? { whatsappSyncStore: bridgeStore } : {}),
    ...(postbackActionStore ? { postbackActionStore } : {}),
    ...(hermesPlatformEventStore ? { hermesPlatformEventStore } : {}),
    postbackDispatcher,
  };
}

class TestHermesAdapter implements HermesAdapter {
  async createSession(sessionKey: string): Promise<HermesSession> {
    const now = new Date().toISOString();
    return {
      id: `hermes_${sessionKey}_${Date.now()}`,
      sessionKey,
      accountId: "unassigned",
      chatJid: sessionKey,
      chatType: "direct",
      chatId: sessionKey,
      createdAt: now,
      lastActivityAt: now,
      status: "active",
    };
  }

  async sendMessage(sessionId: string, event: WhatsAppMessageEvent): Promise<HermesReply> {
    return {
      sessionId,
      outputText: `test-hermes-response: ${event.text}`,
    };
  }

  async resetSession(_sessionId: string): Promise<void> {}
}

class TestWhatsAppGateway implements WhatsAppGateway {
  private readonly accounts = new Map<string, WhatsAppAccountStatus>();
  private readonly sentMessages: OutboundWhatsAppMessage[] = [];
  private lastConnectedAccountId: string | null = null;
  private inboundHandler: ((event: WhatsAppMessageEvent) => Promise<void>) | null = null;
  private statusHandler: ((status: WhatsAppAccountStatus) => void) | null = null;
  private syncHandler: ((event: WhatsAppSyncEvent) => void) | null = null;

  onInboundMessage(handler: (event: WhatsAppMessageEvent) => Promise<void>): void {
    this.inboundHandler = handler;
  }

  onStatusChange(handler: (status: WhatsAppAccountStatus) => void): void {
    this.statusHandler = handler;
  }

  onSyncEvent(handler: (event: WhatsAppSyncEvent) => void): void {
    this.syncHandler = handler;
  }

  async getStatus(): Promise<WhatsAppAccountStatus> {
    const accountId =
      this.lastConnectedAccountId && this.accounts.has(this.lastConnectedAccountId)
        ? this.lastConnectedAccountId
        : [...this.accounts.keys()][0];

    if (!accountId) {
      return {
        accountId: "unassigned",
        status: "disconnected",
      };
    }

    return this.accounts.get(accountId)!;
  }

  async listAccounts(): Promise<WhatsAppAccountStatus[]> {
    return [...this.accounts.values()];
  }

  async initializeAccount(accountId?: string): Promise<WhatsAppAccountStatus> {
    const resolvedAccountId = accountId?.trim() || "15551234567";
    const account: WhatsAppAccountStatus = {
      accountId: resolvedAccountId,
      status: "connected",
      connectedAt: new Date().toISOString(),
    };

    this.accounts.set(resolvedAccountId, account);
    this.lastConnectedAccountId = resolvedAccountId;
    this.statusHandler?.(account);
    return account;
  }

  async disconnectAccount(accountId: string): Promise<WhatsAppAccountStatus> {
    const account: WhatsAppAccountStatus = {
      accountId,
      status: "disconnected",
      disconnectedAt: new Date().toISOString(),
    };

    this.accounts.set(accountId, account);
    this.statusHandler?.(account);

    if (this.lastConnectedAccountId === accountId) {
      this.lastConnectedAccountId = null;
    }

    return account;
  }

  async sendMessage(message: OutboundWhatsAppMessage): Promise<void> {
    this.sentMessages.push(message);
  }

  getSentMessages(): OutboundWhatsAppMessage[] {
    return [...this.sentMessages];
  }

  async normalizeInboundEvent(payload: unknown): Promise<WhatsAppMessageEvent> {
    if (!payload || typeof payload !== "object") {
      throw new Error("Invalid inbound payload.");
    }

    const candidate = payload as Record<string, unknown>;
    const text = typeof candidate.text === "string" ? candidate.text : "";
    const chatJid =
      typeof candidate.chatJid === "string"
        ? candidate.chatJid
        : typeof candidate.chatId === "string"
          ? candidate.chatId
          : "";
    const accountId = typeof candidate.accountId === "string" ? candidate.accountId : "manual";
    const chatType =
      candidate.chatType === "group" || candidate.chatType === "direct"
        ? candidate.chatType
        : getWhatsAppChatType(chatJid);
    const participantJid =
      typeof candidate.participantJid === "string" ? candidate.participantJid : undefined;

    if (!chatJid || !text) {
      throw new Error("Inbound payload must contain chatJid/chatId and text.");
    }

    if (chatType === "group") {
      throw new Error("Group chats are not supported by this WhatsApp manager.");
    }

    const sessionKey = getWhatsAppSessionKey({
      accountId,
      chatJid,
      chatType,
      ...(participantJid ? { participantJid } : {}),
    });

    return {
      accountId,
      chatJid,
      chatType,
      senderJid: typeof candidate.senderJid === "string" ? candidate.senderJid : chatJid,
      ...(participantJid ? { participantJid } : {}),
      sessionKey,
      chatId: chatJid,
      text,
      messageId:
        typeof candidate.messageId === "string" ? candidate.messageId : `msg_${Date.now()}`,
      senderId:
        typeof candidate.senderId === "string"
          ? candidate.senderId
          : typeof candidate.senderJid === "string"
            ? candidate.senderJid
            : chatJid,
      timestamp:
        typeof candidate.timestamp === "string"
          ? candidate.timestamp
          : new Date().toISOString(),
    };
  }

  async injectInboundMessage(payload: unknown): Promise<void> {
    if (!this.inboundHandler) {
      return;
    }

    try {
      await this.inboundHandler(await this.normalizeInboundEvent(payload));
    } catch (error) {
      if (error instanceof Error && error.message === "Group chats are not supported by this WhatsApp manager.") {
        return;
      }

      throw error;
    }
  }

  injectSyncEvent(event: Omit<WhatsAppSyncEvent, "receivedAt"> & { receivedAt?: string }): void {
    this.syncHandler?.({
      ...event,
      receivedAt: event.receivedAt ?? new Date().toISOString(),
    });
  }
}
