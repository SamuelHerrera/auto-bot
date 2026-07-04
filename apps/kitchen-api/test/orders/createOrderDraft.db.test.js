import { describe, expect, it } from "vitest";
import { prisma } from "../../src/db/prisma.js";
import { executeCreateOrderDraft } from "../../src/application/usecases/orders.ts";
import { publishSimpleMenu, seedKitchen, useDbTestHooks } from "../setup/db-fixtures.js";

useDbTestHooks();

describe("createOrderDraft persistence", () => {
  it("persists draft order state, minimum client identity, and idempotency rows", async () => {
    const kitchen = await seedKitchen();
    await publishSimpleMenu(kitchen.id, [
      {
        name: "Torta de asado",
        price: 45,
        stockQuantity: 10,
        availabilityStatus: "AVAILABLE"
      }
    ]);

    const result = await executeCreateOrderDraft({
      messageId: "db_order_draft_001",
      actor: {
        role: "CLIENT",
        phone: "+529991112233"
      },
      kitchenId: String(kitchen.id),
      orderId: null,
      items: [
        {
          productName: "Torta de asado",
          quantity: 2
        }
      ],
      deliveryType: "DELIVERY",
      address: {
        street: "Calle 55",
        neighborhood: "Centro",
        reference: "Casa azul"
      },
      paymentMethod: "TRANSFER",
      comments: "Sin cebolla"
    });

    expect(result.ok).toBe(true);
    expect(await prisma.order.count()).toBe(1);
    expect(await prisma.orderProductPortion.count()).toBe(1);
    expect(await prisma.address.count()).toBe(1);
    expect(await prisma.activityLog.count()).toBe(2);
    expect(await prisma.processedEvent.count()).toBe(2);
  });

  it("does not create a second draft for the same messageId", async () => {
    const kitchen = await seedKitchen();
    await publishSimpleMenu(kitchen.id, [
      {
        name: "Torta de asado",
        price: 45,
        stockQuantity: 10,
        availabilityStatus: "AVAILABLE"
      }
    ]);
    const input = {
      messageId: "db_order_draft_002",
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
    };

    await executeCreateOrderDraft(input);
    await executeCreateOrderDraft(input);

    expect(await prisma.order.count()).toBe(1);
  });
});
