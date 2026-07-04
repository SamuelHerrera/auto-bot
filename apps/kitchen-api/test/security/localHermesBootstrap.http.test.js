import { describe, expect, it } from "vitest";
import { createHttpClient, getLocalIdentityHeaders } from "../setup/http-app.js";
import { publishSimpleMenu, seedKitchen, useDbTestHooks } from "../setup/db-fixtures.js";

useDbTestHooks();

describe("security: local Hermes bootstrap", () => {
  it("lets a local platform-support identity bootstrap a kitchen operator for manual Hermes tests", async () => {
    const kitchen = await seedKitchen();
    await publishSimpleMenu(kitchen.id, [
      { name: "Taco", price: 30, stockQuantity: 10, availabilityStatus: "AVAILABLE" }
    ]);

    const client = await createHttpClient();
    const bootstrapResponse = await client
      .post("/hermes/local/bootstrap-identity")
      .set(getLocalIdentityHeaders({
        role: "PLATFORM_SUPPORT",
        id: "hermes_local_platform_support",
        platformAccess: true
      }))
      .send({
        role: "KITCHEN",
        kitchenId: String(kitchen.id),
        phone: "+529991112233",
        name: "Kitchen Local Admin"
      });

    expect(bootstrapResponse.status).toBe(200);
    expect(bootstrapResponse.body.ok).toBe(true);
    expect(bootstrapResponse.body.actor.contactId).toBeTruthy();

    const ordersResponse = await client
      .get("/orders?filter=active")
      .set(getLocalIdentityHeaders({
        role: "KITCHEN",
        kitchenId: String(kitchen.id),
        phone: "+529991112233"
      }));

    expect(ordersResponse.status).toBe(200);
    expect(ordersResponse.body.ok).toBe(true);
    expect(Array.isArray(ordersResponse.body.orders)).toBe(true);
  });
});
