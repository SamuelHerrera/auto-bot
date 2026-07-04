import { describe, expect, it } from "vitest";
import { prisma } from "../../src/db/prisma.js";
import { executeChangeOrderStatus } from "../../src/application/usecases/orders.ts";
import { executeUpsertMenuProduct } from "../../src/application/usecases/menus.ts";
import { publishSimpleMenu, seedKitchen, useDbTestHooks } from "../setup/db-fixtures.js";
import { executeCreateOrderDraft } from "../../src/application/usecases/orders.ts";
import { seedAuthorizedContact } from "../setup/db-fixtures.js";

useDbTestHooks();

describe("changeOrderStatus persistence", () => {
  it("confirms a draft, decrements stock, and stores audit/idempotency rows", async () => {
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
      messageId: "db_order_status_seed",
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
      deliveryType: "PICKUP",
      address: null,
      paymentMethod: "CASH",
      comments: null
    });

    const result = await executeChangeOrderStatus({
      messageId: "db_order_status_001",
      actor: {
        role: "CLIENT",
        phone: "+529991112233"
      },
      orderId: draft.order.id,
      targetOrderStatus: "CONFIRMED"
    });

    expect(result.ok).toBe(true);
    const order = await prisma.order.findFirstOrThrow();
    const menuItem = await prisma.menuItem.findFirstOrThrow();
    expect(order.status).toBe("CONFIRMED");
    expect(order.printStatus).toBe("PENDING");
    expect(menuItem.stockQuantity).toBe(1);
    expect(await prisma.activityLog.count()).toBe(3);
    expect(await prisma.processedEvent.count()).toBe(3);
  });

  it("keeps shared stock in sync across portions when one portion is ordered", async () => {
    const kitchen = await seedKitchen();
    const admin = await seedAuthorizedContact({
      kitchenId: kitchen.id,
      phone: "+529991110606",
      role: "KITCHEN",
      name: "Shared Stock Admin",
      active: true
    });

    await executeUpsertMenuProduct({
      messageId: "db_order_status_portions_seed",
      actor: {
        role: "KITCHEN",
        kitchenId: String(kitchen.id),
        contactId: admin.contact.id,
        phone: admin.contact.phone
      },
      kitchenId: String(kitchen.id),
      product: {
        name: "Taco",
        stockQuantity: 6,
        portions: [
          {
            label: "Chico",
            price: 45
          },
          {
            label: "Grande",
            price: 75
          }
        ]
      }
    });

    const draft = await executeCreateOrderDraft({
      messageId: "db_order_status_portions_draft",
      actor: {
        role: "CLIENT",
        phone: "+529991112233"
      },
      kitchenId: String(kitchen.id),
      orderId: null,
      items: [
        {
          productName: "Taco",
          portionLabel: "Grande",
          quantity: 2
        }
      ],
      deliveryType: "PICKUP",
      address: null,
      paymentMethod: "CASH",
      comments: null
    });

    const result = await executeChangeOrderStatus({
      messageId: "db_order_status_portions_confirm",
      actor: {
        role: "CLIENT",
        phone: "+529991112233"
      },
      orderId: draft.order.id,
      targetOrderStatus: "CONFIRMED"
    });

    expect(result.ok).toBe(true);

    const product = await prisma.product.findFirstOrThrow({
      where: {
        kitchenId: kitchen.id
      }
    });
    const menuItems = await prisma.menuItem.findMany({
      orderBy: { id: "asc" }
    });

    expect(product.stock).toBe(4);
    expect(menuItems.map((item) => item.stockQuantity)).toEqual([4, 4]);
  });
});
