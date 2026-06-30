import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createApp } from "./app.js";
import { buildServices } from "./build-services.js";
import { loadConfig } from "./config.js";
import { MockWhatsAppGateway } from "./services/whatsapp-service.js";

describe("whatsapp-manager-api", () => {
  let app: ReturnType<typeof createApp>;
  const config = loadConfig({
    API_TOKEN: "test-token",
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
});
