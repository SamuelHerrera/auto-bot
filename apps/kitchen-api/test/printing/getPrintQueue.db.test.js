import { describe, expect, it } from "vitest";
import { executeGetPrintQueue } from "../../src/application/usecases/printing.ts";
import { executeChangeOrderStatus, executeCreateOrderDraft } from "../../src/application/usecases/orders.ts";
import { publishSimpleMenu, seedKitchen, seedPrinter, useDbTestHooks } from "../setup/db-fixtures.js";

useDbTestHooks();

describe("getPrintQueue persistence", () => {
  it("reads confirmed persisted orders for an authorized printer", async () => {
    const kitchen = await seedKitchen();
    await seedPrinter({ kitchenId: kitchen.id, identifier: "printer-thermal-1" });
    await publishSimpleMenu(kitchen.id, [
      {
        name: "Torta de asado",
        price: 45,
        stockQuantity: 5,
        availabilityStatus: "AVAILABLE"
      }
    ]);

    const draft = await executeCreateOrderDraft({
      messageId: "db_print_queue_seed",
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
      messageId: "db_print_queue_confirm",
      actor: {
        role: "CLIENT",
        phone: "+529991112233"
      },
      orderId: draft.order.id,
      targetOrderStatus: "CONFIRMED"
    });

    const result = await executeGetPrintQueue({
      printerIdentifier: "printer-thermal-1",
      kitchenId: String(kitchen.id),
      printerCredential: {
        type: "service_token"
      }
    });

    expect(result.ok).toBe(true);
    expect(result.orders).toHaveLength(1);
    expect(result.orders[0].printKey).toContain(":");
  });
});
