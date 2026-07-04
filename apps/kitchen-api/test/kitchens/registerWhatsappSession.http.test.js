import { describe, expect, it } from "vitest";
import { createHttpClient, getPlatformSupportHeaders, getTrustedCallerContextHeaders } from "../setup/http-app.js";
import { seedKitchen, useDbTestHooks } from "../setup/db-fixtures.js";

useDbTestHooks();

describe("POST /kitchens/{kitchen_id}/register-whatsapp-sessions", () => {
  it("registers a WhatsApp session with HTTP 200", async () => {
    const kitchen = await seedKitchen();
    const client = await createHttpClient();
    const response = await client
      .post(`/kitchens/${kitchen.id}/register-whatsapp-sessions`)
      .send({
        messageId: "http_session_001",
        providerSession: { qrMediaRef: "media_qr_123" }
      })
      .set(getPlatformSupportHeaders());

    expect(response.status).toBe(200);
    expect(response.body.ok).toBe(true);
  });

  it("returns 404 when the kitchen is missing", async () => {
    const client = await createHttpClient();
    const response = await client
      .post("/kitchens/999/register-whatsapp-sessions")
      .send({
        messageId: "http_session_002",
        providerSession: { qrMediaRef: "media_qr_123" }
      })
      .set(getPlatformSupportHeaders());

    expect(response.status).toBe(404);
    expect(response.body.error).toBe("order_not_found");
  });

  it("returns 403 for trusted internal callers without the platform-support token", async () => {
    const kitchen = await seedKitchen();
    const client = await createHttpClient();
    const response = await client
      .post(`/kitchens/${kitchen.id}/register-whatsapp-sessions`)
      .send({
        messageId: "http_session_003",
        providerSession: { qrMediaRef: "media_qr_123" }
      })
      .set(getTrustedCallerContextHeaders({}));

    expect(response.status).toBe(403);
    expect(response.body.error).toBe("action_not_allowed");
  });
});
