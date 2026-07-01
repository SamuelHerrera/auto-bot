import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createApp } from "./app.js";
import { buildServices } from "./build-services.js";
import { loadConfig } from "./config.js";
import { HermesApiAdapter } from "./services/hermes-adapter.js";
import { MockWhatsAppGateway } from "./services/whatsapp-service.js";

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

  it("passes optional account IDs to outbound WhatsApp messages", async () => {
    const services = buildServices(config);
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
    expect((services.whatsappGateway as MockWhatsAppGateway).getSentMessages()).toEqual([
      {
        accountId: "ops-main",
        chatId: "12345@s.whatsapp.net",
        text: "manual outbound",
      },
    ]);
  });

  it("routes gateway inbound messages to Hermes and sends replies back to WhatsApp", async () => {
    const services = buildServices(config);
    const gateway = services.whatsappGateway as MockWhatsAppGateway;

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
        text: "mock-hermes-response: hello through gateway",
      },
    ]);
  });

  it("deduplicates repeated WhatsApp messages before routing to Hermes", async () => {
    const services = buildServices(config);
    const gateway = services.whatsappGateway as MockWhatsAppGateway;

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
        text: "mock-hermes-response: only process once",
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
      const firstServices = buildServices(persistedConfig);
      const firstGateway = firstServices.whatsappGateway as MockWhatsAppGateway;
      const payload = {
        accountId: "ops-main",
        chatId: "12345@s.whatsapp.net",
        messageId: "wamid.persisted",
        senderId: "12345@s.whatsapp.net",
        text: "persist me",
        timestamp: "2026-06-29T00:00:00.000Z",
      };

      await firstGateway.injectInboundMessage(payload);

      const secondServices = buildServices(persistedConfig);
      const secondGateway = secondServices.whatsappGateway as MockWhatsAppGateway;

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
      const firstServices = buildServices(persistedConfig);
      const firstGateway = firstServices.whatsappGateway as MockWhatsAppGateway;
      await firstGateway.injectInboundMessage({
        accountId: "ops-main",
        chatId: "12345@s.whatsapp.net",
        messageId: "wamid.sqlite",
        senderId: "12345@s.whatsapp.net",
        text: "persist in sqlite",
        timestamp: "2026-06-29T00:00:00.000Z",
      });

      const secondServices = buildServices(persistedConfig);

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

  it("routes group messages by participant when the group policy requires it", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "auto-bot-group-policy-"));
    const services = buildServices(
      loadConfig({
        ...process.env,
        API_TOKEN: "test-token",
        BRIDGE_DATABASE_FILE: path.join(dir, "bridge-state.sqlite"),
        BRIDGE_STATE_FILE: "",
        DATABASE_URL: "postgres://postgres:postgres@127.0.0.1:5432/auto_bot",
        NODE_ENV: "test",
        PORT: "3000",
      }),
    );

    try {
      await services.router.setGroupPolicy({
        accountId: "ops-main",
        groupJid: "120363000000000000@g.us",
        policy: "participant",
      });

      const gateway = services.whatsappGateway as MockWhatsAppGateway;
      await gateway.injectInboundMessage({
        accountId: "ops-main",
        chatId: "120363000000000000@g.us",
        chatType: "group",
        participantJid: "15550000001@s.whatsapp.net",
        messageId: "wamid.group.1",
        text: "group participant hello",
      });

      expect(await services.router.getMappings()).toEqual([
        expect.objectContaining({
          sessionKey:
            "whatsapp:ops-main:group:120363000000000000@g.us:user:15550000001@s.whatsapp.net",
        }),
      ]);
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
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
      const services = buildServices(retryConfig);
      const gateway = services.whatsappGateway as MockWhatsAppGateway;
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
      const services = buildServices(retryConfig);
      const gateway = services.whatsappGateway as MockWhatsAppGateway;
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
      ).rejects.toThrow("forced Hermes failure");

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
    const services = buildServices(config);
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
    ).rejects.toThrow("HERMES_API_KEY");
  });
});
