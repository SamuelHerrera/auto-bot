import { describe, expect, it } from "vitest";
import { createHttpClient, getTrustedCallerContextHeaders } from "../setup/http-app.js";
import { seedKitchen, useDbTestHooks } from "../setup/db-fixtures.js";

useDbTestHooks();

describe("POST /clients", () => {
  it("upserts client data with HTTP 200", async () => {
    const kitchen = await seedKitchen();
    const client = await createHttpClient();
    const response = await client.post("/clients").send({
      messageId: "http_client_001",
      kitchenId: String(kitchen.id),
      profile: { name: "Ana" }
    }).set(getTrustedCallerContextHeaders({ role: "CLIENT", phone: "+529991112233" }));

    expect(response.status).toBe(200);
    expect(response.body.ok).toBe(true);
  });

  it("returns 409 for protected phone changes", async () => {
    const kitchen = await seedKitchen();
    const client = await createHttpClient();
    const response = await client.post("/clients").send({
      messageId: "http_client_002",
      kitchenId: String(kitchen.id),
      profile: { phone: "+529998887777" }
    }).set(getTrustedCallerContextHeaders({ role: "CLIENT", phone: "+529991112233" }));

    expect(response.status).toBe(409);
    expect(response.body.error).toBe("confirmation_required");
  });
});
