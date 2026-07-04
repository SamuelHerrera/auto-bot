import { describe, expect, it } from "vitest";
import { createHttpClient, getTrustedCallerContextHeaders } from "../setup/http-app.js";
import { seedAuthorizedContact, seedKitchen, useDbTestHooks } from "../setup/db-fixtures.js";

useDbTestHooks();

describe("POST /kitchens/{kitchen_id}/menus", () => {
  it("publishes a menu with HTTP 200", async () => {
    const kitchen = await seedKitchen();
    await seedAuthorizedContact({
      kitchenId: kitchen.id,
      phone: "+529991110011",
      role: "KITCHEN",
      name: "Admin Menu",
      active: true
    });
    const client = await createHttpClient();
    const response = await client.post(`/kitchens/${kitchen.id}/menus`).send({
      messageId: "http_menu_001",
      items: [
        { name: "Torta de asado", price: 45, stockQuantity: 10, availabilityStatus: "AVAILABLE" }
      ]
    }).set(getTrustedCallerContextHeaders({ role: "KITCHEN", kitchenId: String(kitchen.id), phone: "+529991110011" }));

    expect(response.status).toBe(200);
    expect(response.body.ok).toBe(true);
  });

  it("returns 409 for duplicate normalized products", async () => {
    const kitchen = await seedKitchen();
    await seedAuthorizedContact({
      kitchenId: kitchen.id,
      phone: "+529991110012",
      role: "KITCHEN",
      name: "Admin Menu Duplicates",
      active: true
    });
    const client = await createHttpClient();
    const response = await client.post(`/kitchens/${kitchen.id}/menus`).send({
      messageId: "http_menu_002",
      items: [
        { name: "Torta de Asado", price: 45, stockQuantity: 10, availabilityStatus: "AVAILABLE" },
        { name: "  torta de asado ", price: 50, stockQuantity: 5, availabilityStatus: "AVAILABLE" }
      ]
    }).set(getTrustedCallerContextHeaders({ role: "KITCHEN", kitchenId: String(kitchen.id), phone: "+529991110012" }));

    expect(response.status).toBe(409);
    expect(response.body.error).toBe("duplicate_product");
  });
});
