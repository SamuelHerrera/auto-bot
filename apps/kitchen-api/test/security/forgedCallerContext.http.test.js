import { describe, expect, it } from "vitest";
import { createHttpClient, getPlatformSupportHeaders, getTrustedCallerContextHeaders } from "../setup/http-app.js";
import { seedKitchen, seedPrinter, useDbTestHooks } from "../setup/db-fixtures.js";

useDbTestHooks();

function getForgedCallerContextHeaders(callerContext) {
  return {
    "x-caller-context": JSON.stringify(callerContext)
  };
}

describe("security: forged caller context", () => {
  it("rejects forged platform-support claims on POST /kitchens", async () => {
    const client = await createHttpClient();
    const response = await client
      .post("/kitchens")
      .send({
        messageId: "security_forged_platform_001",
        tenant: { name: "Cocina Segura" }
      })
      .set(getForgedCallerContextHeaders({ platformAccess: true, id: "support_1" }));

    expect(response.status).toBe(403);
    expect(response.body.error).toBe("action_not_allowed");
  });

  it("rejects forged kitchen claims on POST /kitchens/{kitchen_id}/menus", async () => {
    const kitchen = await seedKitchen();
    const client = await createHttpClient();
    const response = await client
      .post(`/kitchens/${kitchen.id}/menus`)
      .send({
        messageId: "security_forged_kitchen_001",
        items: [
          { name: "Torta blindada", price: 45, stockQuantity: 10, availabilityStatus: "AVAILABLE" }
        ]
      })
      .set(getForgedCallerContextHeaders({ role: "KITCHEN", kitchenId: String(kitchen.id) }));

    expect(response.status).toBe(403);
    expect(response.body.error).toBe("action_not_allowed");
  });

  it("rejects forged client claims on POST /clients", async () => {
    const kitchen = await seedKitchen();
    const client = await createHttpClient();
    const response = await client
      .post("/clients")
      .send({
        messageId: "security_forged_client_001",
        kitchenId: String(kitchen.id),
        profile: { name: "Cliente falso" }
      })
      .set(getForgedCallerContextHeaders({ role: "CLIENT", phone: "+529991112233" }));

    expect(response.status).toBe(403);
    expect(response.body.error).toBe("action_not_allowed");
  });

  it("rejects actor-scoped caller context on GET /kitchens/{kitchen_id}/print-queue", async () => {
    const kitchen = await seedKitchen();
    await seedPrinter({ kitchenId: kitchen.id, identifier: "printer-secure-1" });
    const client = await createHttpClient();
    const response = await client
      .get(`/kitchens/${kitchen.id}/print-queue`)
      .query({ printerIdentifier: "printer-secure-1" })
      .set(getTrustedCallerContextHeaders({ role: "KITCHEN", kitchenId: String(kitchen.id) }));

    expect(response.status).toBe(403);
    expect(response.body.error).toBe("action_not_allowed");
  });

  it("does not let a trusted internal caller without the platform-support token reuse POST /kitchens", async () => {
    const client = await createHttpClient();
    const messageId = "security_forged_replay_001";

    const first = await client
      .post("/kitchens")
      .send({
        messageId,
        tenant: { name: "Cocina Cacheada" }
      })
      .set(getPlatformSupportHeaders());

    const second = await client
      .post("/kitchens")
      .send({
        messageId,
        tenant: { name: "Cocina Forjada" }
      })
      .set(getTrustedCallerContextHeaders({ platformAccess: true, id: "support_2" }));

    expect(first.status).toBe(200);
    expect(first.body.ok).toBe(true);
    expect(second.status).toBe(403);
    expect(second.body.error).toBe("action_not_allowed");
  });
});
