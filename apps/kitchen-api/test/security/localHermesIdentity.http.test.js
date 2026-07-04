import { describe, expect, it } from "vitest";
import { createHttpClient, getLocalIdentityHeaders } from "../setup/http-app.js";
import { publishSimpleMenu, seedKitchen, useDbTestHooks } from "../setup/db-fixtures.js";

useDbTestHooks();

describe("security: local Hermes identity", () => {
  it("allows local Hermes-driven client calls without shared auth headers", async () => {
    const kitchen = await seedKitchen();
    await publishSimpleMenu(kitchen.id, [
      { name: "Taco", price: 30, stockQuantity: 10, availabilityStatus: "AVAILABLE" }
    ]);

    const client = await createHttpClient();
    const response = await client
      .post("/orders/draft")
      .set(getLocalIdentityHeaders({
        role: "CLIENT",
        phone: "+529991112233"
      }))
      .send({
        messageId: "local-hermes-order-001",
        kitchenId: String(kitchen.id),
        items: [
          {
            productName: "Taco",
            quantity: 1
          }
        ],
        deliveryType: "PICKUP",
        paymentMethod: "CASH",
        comments: "local Hermes identity smoke"
      });

    expect(response.status).toBe(200);
    expect(response.body.ok).toBe(true);
    expect(response.body.order.status).toBe("DRAFT");
  });

  it("still rejects forged privileged kitchen identities without DB-backed authorization", async () => {
    const kitchen = await seedKitchen();
    const client = await createHttpClient();
    const response = await client
      .post(`/kitchens/${kitchen.id}`)
      .set(getLocalIdentityHeaders({
        role: "KITCHEN",
        kitchenId: String(kitchen.id),
        phone: "+529998887766"
      }))
      .send({
        messageId: "local-hermes-kitchen-001",
        configuration: {
          orderingStatus: "PAUSED"
        }
      });

    expect(response.status).toBe(403);
    expect(response.body.error).toBe("action_not_allowed");
  });
});
