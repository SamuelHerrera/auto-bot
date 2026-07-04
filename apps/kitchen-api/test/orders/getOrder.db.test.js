import { describe, expect, it } from "vitest";
import { executeGetOrder } from "../../src/application/usecases/orders.ts";
import { executeCreateOrderDraft, executeChangeOrderStatus } from "../../src/application/usecases/orders.ts";
import { publishSimpleMenu, seedKitchen, useDbTestHooks } from "../setup/db-fixtures.js";

useDbTestHooks();

describe("getOrder persistence", () => {
  it("reads a persisted order through the scoped use case", async () => {
    const kitchen = await seedKitchen();
    await publishSimpleMenu(kitchen.id, [
      {
        name: "Torta de asado",
        price: 45,
        stockQuantity: 3,
        availabilityStatus: "AVAILABLE"
      }
    ]);

    const draft = await executeCreateOrderDraft({
      messageId: "db_get_order_seed",
      actor: {
        role: "CLIENT",
        phone: "+529991112233"
      },
      kitchenId: String(kitchen.id),
      orderId: null,
      items: [
        {
          productName: "Torta de asado",
          quantity: 1
        }
      ],
      deliveryType: "PICKUP",
      address: null,
      paymentMethod: "CASH",
      comments: null
    });

    await executeChangeOrderStatus({
      messageId: "db_get_order_confirm",
      actor: {
        role: "CLIENT",
        phone: "+529991112233"
      },
      orderId: draft.order.id,
      targetOrderStatus: "CONFIRMED"
    });

    const result = await executeGetOrder({
      actor: {
        role: "CLIENT",
        phone: "+529991112233"
      },
      orderId: draft.order.id
    });

    expect(result.ok).toBe(true);
    expect(result.order.items).toHaveLength(1);
  });
});
