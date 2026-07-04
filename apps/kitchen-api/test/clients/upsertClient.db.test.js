import { describe, expect, it } from "vitest";
import { prisma } from "../../src/db/prisma.js";
import { executeUpsertClient } from "../../src/application/usecases/clients.ts";
import { seedKitchen, useDbTestHooks } from "../setup/db-fixtures.js";

useDbTestHooks();

describe("upsertClient persistence", () => {
  it("creates client identity, linked phone, address, and audit/idempotency rows", async () => {
    const kitchen = await seedKitchen();

    const result = await executeUpsertClient({
      messageId: "db_client_001",
      actor: {
        role: "CLIENT",
        phone: "+529991112233"
      },
      kitchenId: String(kitchen.id),
      profile: {
        name: "Ana",
        address: {
          street: "Calle 10",
          exteriorNumber: "25",
          neighborhood: "Centro"
        }
      }
    });

    expect(result.ok).toBe(true);
    expect(await prisma.user.count()).toBe(1);
    expect(await prisma.linkedPhone.count()).toBe(1);
    expect(await prisma.address.count()).toBe(1);
    expect(await prisma.activityLog.count()).toBe(1);
    expect(await prisma.processedEvent.count()).toBe(1);
  });

  it("returns the cached result for a repeated messageId", async () => {
    const kitchen = await seedKitchen();
    const input = {
      messageId: "db_client_002",
      actor: {
        role: "CLIENT",
        phone: "+529991112233"
      },
      kitchenId: String(kitchen.id),
      profile: {
        name: "Ana"
      }
    };

    const first = await executeUpsertClient(input);
    const second = await executeUpsertClient(input);

    expect(second).toEqual(first);
    expect(await prisma.user.count()).toBe(1);
  });
});
