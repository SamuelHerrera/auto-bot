import { describe, expect, it } from "vitest";
import { createHttpClient, getTrustedCallerContextHeaders } from "../setup/http-app.js";
import { seedAuthorizedContact, seedKitchen, useDbTestHooks } from "../setup/db-fixtures.js";

useDbTestHooks();

describe("POST /kitchens/{kitchen_id}", () => {
  it("updates kitchen configuration with HTTP 200", async () => {
    const kitchen = await seedKitchen();
    await seedAuthorizedContact({
      kitchenId: kitchen.id,
      phone: "+529991110010",
      role: "KITCHEN",
      name: "Admin HTTP",
      active: true
    });
    const client = await createHttpClient();
    const response = await client.post(`/kitchens/${kitchen.id}`).send({
      messageId: "http_kitchen_config_001",
      configuration: { orderingStatus: "PAUSED" }
    }).set(getTrustedCallerContextHeaders({ role: "KITCHEN", kitchenId: String(kitchen.id), phone: "+529991110010" }));

    expect(response.status).toBe(200);
    expect(response.body.ok).toBe(true);
  });
});
