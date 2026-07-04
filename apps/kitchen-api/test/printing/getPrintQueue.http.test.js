import { describe, expect, it } from "vitest";
import { createHttpClient, getPrinterBridgeHeaders } from "../setup/http-app.js";
import { executeChangeOrderStatus, executeCreateOrderDraft } from "../../src/application/usecases/orders.ts";
import { publishSimpleMenu, seedKitchen, seedPrinter, useDbTestHooks } from "../setup/db-fixtures.js";

useDbTestHooks();

describe("GET /kitchens/{kitchen_id}/print-queue", () => {
  it("returns the printer queue with HTTP 200", async () => {
    const kitchen = await seedKitchen();
    await seedPrinter({ kitchenId: kitchen.id, identifier: "printer-thermal-1" });
    await publishSimpleMenu(kitchen.id, [
      { name: "Torta de asado", price: 45, stockQuantity: 5, availabilityStatus: "AVAILABLE" }
    ]);
    const draft = await executeCreateOrderDraft({
      messageId: "http_print_seed",
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
      messageId: "http_print_confirm",
      actor: { role: "CLIENT", phone: "+529991112233" },
      orderId: draft.order.id,
      targetOrderStatus: "CONFIRMED"
    });

    const client = await createHttpClient();
    const response = await client
      .get(`/kitchens/${kitchen.id}/print-queue`)
      .query({ printerIdentifier: "printer-thermal-1" })
      .set(getPrinterBridgeHeaders());

    expect(response.status).toBe(200);
    expect(response.body.orders).toHaveLength(1);
  });

  it("returns 403 for unauthorized printer access", async () => {
    const kitchen = await seedKitchen();
    const client = await createHttpClient();
    const response = await client
      .get(`/kitchens/${kitchen.id}/print-queue`)
      .query({ printerIdentifier: "missing-printer" });

    expect(response.status).toBe(403);
    expect(response.body.error).toBe("printer_not_authorized");
  });
});
