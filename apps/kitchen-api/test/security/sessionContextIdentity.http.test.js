import { describe, expect, it } from "vitest";
import { createHttpClient, getTrustedSessionHeaders } from "../setup/http-app.js";
import {
  publishSimpleMenu,
  seedAuthorizedContact,
  seedKitchen,
  seedWhatsAppManagerConversationState,
  useDbTestHooks
} from "../setup/db-fixtures.js";

useDbTestHooks();

describe("security: session context identity", () => {
  it("allows a verified WhatsApp session to create an order without internal auth headers", async () => {
    const kitchen = await seedKitchen();
    await publishSimpleMenu(kitchen.id, [
      { name: "Taco", price: 60, stockQuantity: 10, availabilityStatus: "AVAILABLE" }
    ]);
    await seedWhatsAppManagerConversationState({
      conversationId: "wa-session-client-1",
      phone: "+529991112233",
      kitchenId: String(kitchen.id),
      actorRole: "CLIENT"
    });

    const client = await createHttpClient();
    const response = await client
      .post("/orders/draft")
      .set(getTrustedSessionHeaders({
        conversationId: "wa-session-client-1",
        phone: "+529991112233",
        kitchenId: String(kitchen.id),
        actorRole: "CLIENT"
      }))
      .send({
        messageId: "session-order-001",
        kitchenId: String(kitchen.id),
        orderId: null,
        items: [{ productName: "Taco", quantity: 1 }],
        deliveryType: "PICKUP",
        address: null,
        paymentMethod: "CASH",
        comments: "session-auth smoke"
      });

    expect(response.status).toBe(200);
    expect(response.body.ok).toBe(true);
    expect(response.body.order.status).toBe("DRAFT");
  });

  it("rejects forged session context that does not match persisted manager state", async () => {
    const kitchen = await seedKitchen();
    await seedWhatsAppManagerConversationState({
      conversationId: "wa-session-client-2",
      phone: "+529991110000",
      kitchenId: String(kitchen.id),
      actorRole: "CLIENT"
    });

    const client = await createHttpClient();
    const response = await client
      .get("/orders/123")
      .set(getTrustedSessionHeaders({
        conversationId: "wa-session-client-2",
        phone: "+529991119999",
        kitchenId: String(kitchen.id),
        actorRole: "CLIENT"
      }));

    expect(response.status).toBe(403);
    expect(response.body.error).toBe("action_not_allowed");
  });

  it("rejects inactive privileged identities even when a persisted session claims the right kitchen scope", async () => {
    const kitchen = await seedKitchen();
    await seedAuthorizedContact({
      kitchenId: kitchen.id,
      phone: "+529991110003",
      role: "KITCHEN",
      name: "Admin Inactivo",
      active: false
    });
    await seedWhatsAppManagerConversationState({
      conversationId: "wa-session-kitchen-1",
      phone: "+529991110003",
      kitchenId: String(kitchen.id),
      actorRole: "KITCHEN"
    });

    const client = await createHttpClient();
    const response = await client
      .get("/orders")
      .query({ filter: "pending" })
      .set(getTrustedSessionHeaders({
        conversationId: "wa-session-kitchen-1",
        phone: "+529991110003",
        kitchenId: String(kitchen.id),
        actorRole: "KITCHEN"
      }));

    expect(response.status).toBe(403);
    expect(response.body.error).toBe("action_not_allowed");
  });
});
