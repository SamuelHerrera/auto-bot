import { describe, expect, it } from "vitest";
import { createHttpClient, getTrustedCallerContextHeaders } from "../setup/http-app.js";
import { executeChangeOrderStatus, executeCreateOrderDraft } from "../../src/application/usecases/orders.ts";
import { publishSimpleMenu, seedKitchen, useDbTestHooks } from "../setup/db-fixtures.js";

useDbTestHooks();

describe("GET /orders/{order_id}", () => {
  it("returns the scoped order with HTTP 200", async () => {
    const kitchen = await seedKitchen();
    await publishSimpleMenu(kitchen.id, [
      { name: "Torta de asado", price: 45, stockQuantity: 5, availabilityStatus: "AVAILABLE" }
    ]);
    const draft = await executeCreateOrderDraft({
      messageId: "http_get_order_seed",
      actor: { role: "CLIENT", phone: "+529991112233" },
      kitchenId: String(kitchen.id),
      orderId: null,
      items: [{ productName: "Torta de asado", quantity: 1 }],
      deliveryType: "PICKUP",
      address: null,
      paymentMethod: "CASH",
      comments: null
    });
    await executeChangeOrderStatus({
      messageId: "http_get_order_confirm",
      actor: { role: "CLIENT", phone: "+529991112233" },
      orderId: draft.order.id,
      targetOrderStatus: "CONFIRMED"
    });

    const client = await createHttpClient();
    const response = await client
      .get(`/orders/${draft.order.id}`)
      .set(getTrustedCallerContextHeaders({ role: "CLIENT", phone: "+529991112233" }));

    expect(response.status).toBe(200);
    expect(response.body.ok).toBe(true);
  });

  it("returns 404 outside actor scope", async () => {
    const kitchen = await seedKitchen();
    await publishSimpleMenu(kitchen.id, [
      { name: "Torta de asado", price: 45, stockQuantity: 5, availabilityStatus: "AVAILABLE" }
    ]);
    const draft = await executeCreateOrderDraft({
      messageId: "http_get_order_seed_2",
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
    const response = await client
      .get(`/orders/${draft.order.id}`)
      .set(getTrustedCallerContextHeaders({ role: "CLIENT", phone: "+529998887777" }));

    expect(response.status).toBe(404);
    expect(response.body.error).toBe("order_not_found");
  });
});
