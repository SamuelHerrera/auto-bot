import { describe, expect, it } from "vitest";
import { prisma } from "../../src/db/prisma.js";
import { executeUpdateKitchenConfiguration } from "../../src/application/usecases/kitchens.ts";
import { seedKitchen, useDbTestHooks } from "../setup/db-fixtures.js";

useDbTestHooks();

describe("updateKitchenConfiguration persistence", () => {
  it("updates evidenced kitchen fields and records audit/idempotency state", async () => {
    const kitchen = await seedKitchen({
      businessVoice: "warm"
    });

    const result = await executeUpdateKitchenConfiguration({
      messageId: "db_kitchen_config_001",
      actor: {
        role: "KITCHEN",
        kitchenId: String(kitchen.id),
        contactId: "1"
      },
      kitchenId: String(kitchen.id),
      configuration: {
        orderingStatus: "PAUSED",
        businessVoice: "friendly and concise"
      }
    });

    expect(result.ok).toBe(true);
    const persisted = await prisma.kitchen.findUniqueOrThrow({
      where: { id: kitchen.id }
    });
    expect(persisted.orderingStatus).toBe("PAUSED");
    expect(persisted.businessVoice).toBe("friendly and concise");
    expect(await prisma.activityLog.count()).toBe(1);
    expect(await prisma.processedEvent.count()).toBe(1);
  });

  it("persists the kitchen schedule when provided", async () => {
    const kitchen = await seedKitchen();

    const result = await executeUpdateKitchenConfiguration({
      messageId: "db_kitchen_config_002",
      actor: {
        role: "KITCHEN",
        kitchenId: String(kitchen.id),
        contactId: "1"
      },
      kitchenId: String(kitchen.id),
      configuration: {
        schedule: "Lunes a viernes 09:00-18:00"
      }
    });

    expect(result.ok).toBe(true);
    const persisted = await prisma.kitchen.findUniqueOrThrow({
      where: { id: kitchen.id }
    });
    expect(persisted.schedule).toBe("Lunes a viernes 09:00-18:00");
  });
});
