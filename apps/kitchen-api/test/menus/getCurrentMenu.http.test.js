import { describe, expect, it } from "vitest";
import { createHttpClient, getTrustedCallerContextHeaders } from "../setup/http-app.js";
import { publishSimpleMenu, seedKitchen, useDbTestHooks } from "../setup/db-fixtures.js";

useDbTestHooks();

describe("GET /kitchens/{kitchen_id}/menus", () => {
  it("returns the current menu with HTTP 200", async () => {
    const kitchen = await seedKitchen();
    await publishSimpleMenu(kitchen.id, [
      {
        name: "Torta de asado",
        price: 45,
        stockQuantity: 10,
        availabilityStatus: "AVAILABLE"
      }
    ]);

    const client = await createHttpClient();
    const response = await client
      .get(`/kitchens/${kitchen.id}/menus`)
      .set(getTrustedCallerContextHeaders({ role: "CLIENT", phone: "+529991112233" }));

    expect(response.status).toBe(200);
    expect(response.body.ok).toBe(true);
    expect(response.body.menu.products).toHaveLength(1);
  });
});
