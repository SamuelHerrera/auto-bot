import { describe, expect, it } from "vitest";
import { executeQueryOrders } from "../../src/application/usecases/orders.ts";
import { executeChangeOrderStatus, executeCreateOrderDraft } from "../../src/application/usecases/orders.ts";
import { publishSimpleMenu, seedAuthorizedContact, seedKitchen, useDbTestHooks } from "../setup/db-fixtures.js";

useDbTestHooks();

describe("queryOrders persistence", () => {
  it("returns persisted transfer-payment pending orders for kitchen scope", async () => {
    const kitchen = await seedKitchen();
    const admin = await seedAuthorizedContact({
      kitchenId: kitchen.id,
      phone: "+529991110404",
      role: "KITCHEN",
      name: "Consulta Cocina",
      active: true
    });
    await publishSimpleMenu(kitchen.id, [
      {
        name: "Torta de asado",
        price: 45,
        stockQuantity: 5,
        availabilityStatus: "AVAILABLE"
      }
    ]);

    const draft = await executeCreateOrderDraft({
      messageId: "db_query_orders_seed",
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
      paymentMethod: "TRANSFER",
      comments: null
    });

    await executeChangeOrderStatus({
      messageId: "db_query_orders_confirm",
      actor: {
        role: "CLIENT",
        phone: "+529991112233"
      },
      orderId: draft.order.id,
      targetOrderStatus: "CONFIRMED"
    });

    const result = await executeQueryOrders({
      actor: {
        role: "KITCHEN",
        kitchenId: String(kitchen.id),
        contactId: admin.contact.id,
        phone: admin.contact.phone
      },
      filter: "payment_pending"
    });

    expect(result.ok).toBe(true);
    expect(result.orders).toHaveLength(1);
  });

  it("shows confirmed delivery orders to a deliverer in the same kitchen even before claim", async () => {
    const kitchen = await seedKitchen();
    const deliverer = await seedAuthorizedContact({
      kitchenId: kitchen.id,
      phone: "+529991110707",
      role: "DELIVERER",
      name: "Repartidor Uno",
      active: true
    });

    await publishSimpleMenu(kitchen.id, [
      {
        name: "Taco",
        price: 75,
        stockQuantity: 5,
        availabilityStatus: "AVAILABLE"
      }
    ]);

    const draft = await executeCreateOrderDraft({
      messageId: "db_query_orders_delivery_seed",
      actor: {
        role: "CLIENT",
        phone: "+529991112233"
      },
      kitchenId: String(kitchen.id),
      orderId: null,
      items: [
        {
          productName: "Taco",
          quantity: 1
        }
      ],
      deliveryType: "DELIVERY",
      address: {
        street: "Calle 10",
        exteriorNumber: "25",
        neighborhood: "Centro"
      },
      paymentMethod: "CASH",
      comments: null
    });

    await executeChangeOrderStatus({
      messageId: "db_query_orders_delivery_confirm",
      actor: {
        role: "CLIENT",
        phone: "+529991112233"
      },
      orderId: draft.order.id,
      targetOrderStatus: "CONFIRMED"
    });

    const result = await executeQueryOrders({
      actor: {
        role: "DELIVERER",
        id: deliverer.contact.id,
        kitchenId: String(kitchen.id),
        phone: deliverer.contact.phone
      },
      filter: "active"
    });

    expect(result.ok).toBe(true);
    expect(result.orders).toHaveLength(1);
    expect(result.orders[0].id).toBe(String(draft.order.id));
  });
});
