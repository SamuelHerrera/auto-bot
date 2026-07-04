import { describe, expect, it } from "vitest";
import { createHttpClient, getPrinterBridgeHeaders } from "../setup/http-app.js";
import { seedKitchen, seedPrinter, useDbTestHooks } from "../setup/db-fixtures.js";

useDbTestHooks();

describe("security: printer credential auth", () => {
  it("rejects print-queue access when only kitchenId and printerIdentifier are known", async () => {
    const kitchen = await seedKitchen();
    await seedPrinter({ kitchenId: kitchen.id, identifier: "printer-secure-queue-1" });

    const client = await createHttpClient();
    const response = await client
      .get(`/kitchens/${kitchen.id}/print-queue`)
      .query({ printerIdentifier: "printer-secure-queue-1" });

    expect(response.status).toBe(403);
    expect(response.body.error).toBe("printer_not_authorized");
  });

  it("rejects print-queue access with an invalid printer bridge token", async () => {
    const kitchen = await seedKitchen();
    await seedPrinter({ kitchenId: kitchen.id, identifier: "printer-secure-queue-2" });

    const client = await createHttpClient();
    const response = await client
      .get(`/kitchens/${kitchen.id}/print-queue`)
      .query({ printerIdentifier: "printer-secure-queue-2" })
      .set("x-printer-token", "wrong-printer-token");

    expect(response.status).toBe(403);
    expect(response.body.error).toBe("printer_not_authorized");
  });

  it("keeps print-queue access available to callers with the trusted printer bridge token", async () => {
    const kitchen = await seedKitchen();
    await seedPrinter({ kitchenId: kitchen.id, identifier: "printer-secure-queue-3" });

    const client = await createHttpClient();
    const response = await client
      .get(`/kitchens/${kitchen.id}/print-queue`)
      .query({ printerIdentifier: "printer-secure-queue-3" })
      .set(getPrinterBridgeHeaders());

    expect(response.status).toBe(200);
    expect(response.body.ok).toBe(true);
  });
});
