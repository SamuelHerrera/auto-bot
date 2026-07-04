import { describe, expect, it } from "vitest";
import { createHttpClient, getTrustedCallerContextHeaders } from "../setup/http-app.js";
import { seedAuthorizedContact, seedKitchen, useDbTestHooks } from "../setup/db-fixtures.js";

useDbTestHooks();

describe("POST /kitchens/{kitchen_id}/authorized-contacts", () => {
  it("upserts a contact with HTTP 200", async () => {
    const kitchen = await seedKitchen();
    await seedAuthorizedContact({ kitchenId: kitchen.id, phone: "+529999999999", role: "KITCHEN", name: "Admin" });
    const client = await createHttpClient();
    const response = await client.post(`/kitchens/${kitchen.id}/authorized-contacts`).send({
      messageId: "http_contact_001",
      contact: { phone: "+52 999 111 2233", role: "DELIVERER", name: "Luis" }
    }).set(getTrustedCallerContextHeaders({ role: "KITCHEN", kitchenId: String(kitchen.id), phone: "+529999999999" }));

    expect(response.status).toBe(200);
    expect(response.body.ok).toBe(true);
  });
});
