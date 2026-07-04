import { describe, expect, it } from "vitest";
import { prisma } from "../../src/db/prisma.js";
import { executeRegisterKitchen } from "../../src/application/usecases/kitchens.ts";
import { useDbTestHooks } from "../setup/db-fixtures.js";

useDbTestHooks();

describe("registerKitchen persistence", () => {
  it("creates a kitchen plus activity and processed-event records", async () => {
    const result = await executeRegisterKitchen({
      messageId: "db_register_kitchen_001",
      actor: {
        platformAccess: true,
        id: "support_1"
      },
      tenant: {
        name: "Cocina Lupita"
      }
    });

    expect(result.ok).toBe(true);
    expect(await prisma.kitchen.count()).toBe(1);
    expect(await prisma.activityLog.count()).toBe(1);
    expect(await prisma.processedEvent.count()).toBe(1);
  });

  it("returns the cached result for a repeated messageId without creating a second kitchen", async () => {
    const input = {
      messageId: "db_register_kitchen_002",
      actor: {
        platformAccess: true,
        id: "support_1"
      },
      tenant: {
        name: "Cocina Uno"
      }
    };

    const first = await executeRegisterKitchen(input);
    const second = await executeRegisterKitchen({
      ...input,
      tenant: { name: "Cocina Dos" }
    });

    expect(second).toEqual(first);
    expect(await prisma.kitchen.count()).toBe(1);
  });
});
