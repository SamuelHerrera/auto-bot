import { describe, expect, it } from "vitest";
import { createHttpClient, getTrustedCallerContextHeaders } from "../setup/http-app.js";
import { executeCreateOrderDraft } from "../../src/application/usecases/orders.ts";
import { publishSimpleMenu, seedKitchen, useDbTestHooks } from "../setup/db-fixtures.js";

useDbTestHooks();

describe("POST /orders/{order_id}/status", () => {
  it("changes order status with HTTP 200", async () => {
    const kitchen = await seedKitchen();
    await publishSimpleMenu(kitchen.id, [
      { name: "Torta de asado", price: 45, stockQuantity: 5, availabilityStatus: "AVAILABLE" }
    ]);
    const draft = await executeCreateOrderDraft({
      messageId: "http_status_seed",
      actor: { role: "CLIENT", phone: "+529991112233" },
      kitchenId: String(kitchen.id),
      orderId: null,
      items: [{ productName: "Torta de asado", quantity: 1 }],
      deliveryType: "PICKUP",
      address: null,
      paymentMethod: "CASH",
      comments: null
    });

    const client = await createHttpClient();
    const response = await client.post(`/orders/${draft.order.id}/status`).send({
      messageId: "http_status_001",
      targetOrderStatus: "CONFIRMED"
    }).set(getTrustedCallerContextHeaders({ role: "CLIENT", phone: "+529991112233" }));

    expect(response.status).toBe(200);
    expect(response.body.ok).toBe(true);
  });
});
