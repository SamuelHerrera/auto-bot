import { describe, expect, it } from "vitest";
import { createHttpClient, getTrustedCallerContextHeaders } from "../setup/http-app.js";
import { publishSimpleMenu, seedKitchen, useDbTestHooks } from "../setup/db-fixtures.js";

useDbTestHooks();

describe("POST /orders/draft", () => {
  it("creates a draft with HTTP 200", async () => {
    const kitchen = await seedKitchen();
    await publishSimpleMenu(kitchen.id, [
      { name: "Torta de asado", price: 45, stockQuantity: 5, availabilityStatus: "AVAILABLE" }
    ]);

    const client = await createHttpClient();
    const response = await client.post("/orders/draft").send({
      messageId: "http_order_draft_001",
      kitchenId: String(kitchen.id),
      orderId: null,
      items: [{ productName: "Torta de asado", quantity: 1 }],
      deliveryType: "PICKUP",
      address: null,
      paymentMethod: "CASH",
      comments: null
    }).set(getTrustedCallerContextHeaders({ role: "CLIENT", phone: "+529991112233" }));

    expect(response.status).toBe(200);
    expect(response.body.ok).toBe(true);
  });

  it("returns 400 for unsupported payment methods", async () => {
    const kitchen = await seedKitchen();
    await publishSimpleMenu(kitchen.id, [
      { name: "Torta de asado", price: 45, stockQuantity: 5, availabilityStatus: "AVAILABLE" }
    ]);

    const client = await createHttpClient();
    const response = await client.post("/orders/draft").send({
      messageId: "http_order_draft_002",
      kitchenId: String(kitchen.id),
      orderId: null,
      items: [{ productName: "Torta de asado", quantity: 1 }],
      deliveryType: "PICKUP",
      address: null,
      paymentMethod: "CRYPTO",
      comments: null
    }).set(getTrustedCallerContextHeaders({ role: "CLIENT", phone: "+529991112233" }));

    expect(response.status).toBe(400);
    expect(response.body.error).toBe("unsupported_payment_method");
  });
});
