import { describe, expect, it } from "vitest";
import { prisma } from "../../src/db/prisma.js";
import { executeUpsertAuthorizedContact } from "../../src/application/usecases/kitchens.ts";
import { seedAuthorizedContact, seedKitchen, useDbTestHooks } from "../setup/db-fixtures.js";

useDbTestHooks();

describe("upsertAuthorizedContact persistence", () => {
  it("creates a scoped user and linked phone for a new contact", async () => {
    const kitchen = await seedKitchen();
    await seedAuthorizedContact({ kitchenId: kitchen.id, phone: "+529999999999", role: "KITCHEN", name: "Admin" });

    const result = await executeUpsertAuthorizedContact({
      messageId: "db_contact_001",
      actor: {
        role: "KITCHEN",
        kitchenId: String(kitchen.id),
        contactId: "1"
      },
      kitchenId: String(kitchen.id),
      contact: {
        phone: "+52 999 111 2233",
        role: "DELIVERER",
        name: "Luis"
      }
    });

    expect(result.ok).toBe(true);
    expect(await prisma.user.count()).toBe(2);
    expect(await prisma.linkedPhone.count()).toBe(2);
    expect(await prisma.activityLog.count()).toBeGreaterThanOrEqual(1);
    expect(await prisma.processedEvent.count()).toBeGreaterThanOrEqual(1);
  });
});
