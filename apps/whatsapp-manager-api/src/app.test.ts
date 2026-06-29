import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "./app.js";
import { loadConfig } from "./config.js";

describe("whatsapp-manager-api", () => {
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    app = createApp({
      config: loadConfig({
        API_TOKEN: "test-token",
        DATABASE_URL: "postgres://postgres:postgres@127.0.0.1:5432/auto_bot",
        NODE_ENV: "test",
        PORT: "3000",
      }),
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
        chatId: "12345@s.whatsapp.net",
        text: "follow up",
      },
    });

    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);

    const firstBody = first.json();
    const secondBody = second.json();

    expect(firstBody.session.id).toBe(secondBody.session.id);
    expect(secondBody.reply.outputText).toContain("follow up");
  });

  it("rejects protected routes without auth", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/sessions",
    });

    expect(response.statusCode).toBe(401);
  });
});
