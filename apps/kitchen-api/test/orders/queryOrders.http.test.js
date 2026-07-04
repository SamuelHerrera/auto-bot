import { describe, expect, it } from "vitest";
import { createHttpClient, getTrustedCallerContextHeaders } from "../setup/http-app.js";
import { executeChangeOrderStatus, executeCreateOrderDraft } from "../../src/application/usecases/orders.ts";
import { publishSimpleMenu, seedAuthorizedContact, seedKitchen, useDbTestHooks } from "../setup/db-fixtures.js";

useDbTestHooks();

describe("GET /orders", () => {
  it("returns filtered orders with HTTP 200", async () => {
    const kitchen = await seedKitchen();
    await seedAuthorizedContact({
      kitchenId: kitchen.id,
      phone: "+529991110013",
      role: "KITCHEN",
      name: "Admin Orders",
      active: true
    });
    await publishSimpleMenu(kitchen.id, [
      { name: "Torta de asado", price: 45, stockQuantity: 5, availabilityStatus: "AVAILABLE" }
    ]);
    const draft = await executeCreateOrderDraft({
      messageId: "http_query_orders_seed",
      actor: { role: "CLIENT", phone: "+529991112233" },
      kitchenId: String(kitchen.id),
      orderId: null,
      items: [{ productName: "Torta de asado", quantity: 1 }],
      deliveryType: "PICKUP",
      address: null,
      paymentMethod: "TRANSFER",
      comments: null
    });
    await executeChangeOrderStatus({
      messageId: "http_query_orders_confirm",
      actor: { role: "CLIENT", phone: "+529991112233" },
      orderId: draft.order.id,
      targetOrderStatus: "CONFIRMED"
    });

    const client = await createHttpClient();
    const response = await client
      .get("/orders")
      .query({
        filter: "payment_pending"
      })
      .set(getTrustedCallerContextHeaders({ role: "KITCHEN", kitchenId: String(kitchen.id), phone: "+529991110013" }));

    expect(response.status).toBe(200);
    expect(response.body.orders).toHaveLength(1);
  });

  it("returns 400 for unsupported filters", async () => {
    const kitchen = await seedKitchen();
    await seedAuthorizedContact({
      kitchenId: kitchen.id,
      phone: "+529991110014",
      role: "KITCHEN",
      name: "Admin Invalid Filter",
      active: true
    });
    const client = await createHttpClient();
    const response = await client
      .get("/orders")
      .query({
        filter: "everything"
      })
      .set(getTrustedCallerContextHeaders({ role: "KITCHEN", kitchenId: String(kitchen.id), phone: "+529991110014" }));

    expect(response.status).toBe(400);
    expect(response.body.error).toBe("unsupported_filter");
  });
});
