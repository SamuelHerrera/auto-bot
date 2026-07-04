import { describe, expect, it } from "vitest";
import { prisma } from "../../src/db/prisma.js";
import { executeRegisterKitchen } from "../../src/application/usecases/kitchens.ts";
import { executeCreateOrderDraft } from "../../src/application/usecases/orders.ts";
import { publishSimpleMenu, seedKitchen, useDbTestHooks } from "../setup/db-fixtures.js";

useDbTestHooks();

describe("security: idempotency replay isolation", () => {
  it("does not return a cached registerKitchen success to a different platform-support actor", async () => {
    const messageId = "security_replay_platform_001";

    const first = await executeRegisterKitchen({
      messageId,
      actor: {
        platformAccess: true,
        id: "support_1"
      },
      tenant: {
        name: "Cocina Uno"
      }
    });

    const second = await executeRegisterKitchen({
      messageId,
      actor: {
        platformAccess: true,
        id: "support_2"
      },
      tenant: {
        name: "Cocina Dos"
      }
    });

    expect(first.ok).toBe(true);
    expect(second).toEqual({
      ok: false,
      error: "action_not_allowed"
    });
    expect(await prisma.kitchen.count()).toBe(1);
  });

  it("does not return a cached createOrderDraft success to a different client actor in the same kitchen", async () => {
    const kitchen = await seedKitchen();
    await publishSimpleMenu(kitchen.id, [
      {
        name: "Taco blindado",
        price: 55,
        stockQuantity: 10,
        availabilityStatus: "AVAILABLE"
      }
    ]);

    const messageId = "security_replay_client_001";
    const first = await executeCreateOrderDraft({
      messageId,
      actor: {
        role: "CLIENT",
        phone: "+529991110101"
      },
      kitchenId: String(kitchen.id),
      items: [{ productName: "Taco blindado", quantity: 1 }],
      deliveryType: "PICKUP",
      paymentMethod: "CASH",
      comments: "Primer cliente"
    });

    const second = await executeCreateOrderDraft({
      messageId,
      actor: {
        role: "CLIENT",
        phone: "+529991110202"
      },
      kitchenId: String(kitchen.id),
      items: [{ productName: "Taco blindado", quantity: 1 }],
      deliveryType: "PICKUP",
      paymentMethod: "CASH",
      comments: "Segundo cliente"
    });

    expect(first.ok).toBe(true);
    expect(second).toEqual({
      ok: false,
      error: "action_not_allowed",
      readyToConfirm: false
    });
    expect(await prisma.order.count()).toBe(1);
  });
});
