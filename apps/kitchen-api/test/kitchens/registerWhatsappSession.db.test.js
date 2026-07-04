import { describe, expect, it } from "vitest";
import { prisma } from "../../src/db/prisma.js";
import { executeRegisterWhatsappSession } from "../../src/application/usecases/kitchens.ts";
import { seedKitchen, useDbTestHooks } from "../setup/db-fixtures.js";

useDbTestHooks();

describe("registerWhatsappSession persistence", () => {
  it("stores the safe QR reference and processed-event record", async () => {
    const kitchen = await seedKitchen();

    const result = await executeRegisterWhatsappSession({
      messageId: "db_whatsapp_session_001",
      actor: {
        platformAccess: true,
        id: "support_1"
      },
      kitchenId: String(kitchen.id),
      providerSession: {
        qrMediaRef: "media_qr_123"
      }
    });

    expect(result.ok).toBe(true);
    const session = await prisma.whatsappSession.findFirstOrThrow();
    expect(session.qrCode).toBe("media_qr_123");
    expect(await prisma.activityLog.count()).toBe(1);
    expect(await prisma.processedEvent.count()).toBe(1);
  });

  it("does not create duplicate session writes for the same messageId", async () => {
    const kitchen = await seedKitchen();
    const input = {
      messageId: "db_whatsapp_session_002",
      actor: {
        platformAccess: true,
        id: "support_1"
      },
      kitchenId: String(kitchen.id),
      providerSession: {
        qrMediaRef: "media_qr_123"
      }
    };

    const first = await executeRegisterWhatsappSession(input);
    const second = await executeRegisterWhatsappSession(input);

    expect(second).toEqual(first);
    expect(await prisma.whatsappSession.count()).toBe(1);
  });
});
