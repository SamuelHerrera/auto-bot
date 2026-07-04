import { describe, expect, it } from "vitest";
import { createHttpClient, getPlatformSupportHeaders, getTrustedCallerContextHeaders } from "../setup/http-app.js";
import { seedAuthorizedContact, seedKitchen, useDbTestHooks } from "../setup/db-fixtures.js";

useDbTestHooks();

describe("security: privileged identity binding", () => {
  it("keeps POST /kitchens available to verified platform-support callers", async () => {
    const client = await createHttpClient();
    const response = await client
      .post("/kitchens")
      .send({
        messageId: "security_platform_bound_001",
        tenant: { name: "Cocina Plataforma" }
      })
      .set(getPlatformSupportHeaders());

    expect(response.status).toBe(200);
    expect(response.body.ok).toBe(true);
  });

  it("keeps POST /kitchens/{kitchen_id}/register-whatsapp-sessions available to verified platform-support callers", async () => {
    const kitchen = await seedKitchen();
    const client = await createHttpClient();
    const response = await client
      .post(`/kitchens/${kitchen.id}/register-whatsapp-sessions`)
      .send({
        messageId: "security_platform_bound_002",
        providerSession: { qrMediaRef: "media_qr_456" }
      })
      .set(getPlatformSupportHeaders());

    expect(response.status).toBe(200);
    expect(response.body.ok).toBe(true);
  });

  it("allows an active kitchen contact to update its own kitchen configuration", async () => {
    const kitchen = await seedKitchen();
    await seedAuthorizedContact({
      kitchenId: kitchen.id,
      phone: "+529991110001",
      role: "KITCHEN",
      name: "Admin Activo",
      active: true
    });
    const client = await createHttpClient();
    const response = await client
      .post(`/kitchens/${kitchen.id}`)
      .send({
        messageId: "security_identity_bound_001",
        configuration: { orderingStatus: "PAUSED" }
      })
      .set(
        getTrustedCallerContextHeaders({
          role: "KITCHEN",
          kitchenId: String(kitchen.id),
          phone: "+529991110001"
        })
      );

    expect(response.status).toBe(200);
    expect(response.body.ok).toBe(true);
  });

  it("rejects a kitchen caller whose trusted phone belongs to another kitchen", async () => {
    const kitchenA = await seedKitchen({ name: "Kitchen A" });
    const kitchenB = await seedKitchen({ name: "Kitchen B" });
    await seedAuthorizedContact({
      kitchenId: kitchenA.id,
      phone: "+529991110002",
      role: "KITCHEN",
      name: "Admin A",
      active: true
    });
    const client = await createHttpClient();
    const response = await client
      .post(`/kitchens/${kitchenB.id}`)
      .send({
        messageId: "security_identity_bound_002",
        configuration: { orderingStatus: "PAUSED" }
      })
      .set(
        getTrustedCallerContextHeaders({
          role: "KITCHEN",
          kitchenId: String(kitchenB.id),
          phone: "+529991110002"
        })
      );

    expect(response.status).toBe(403);
    expect(response.body.error).toBe("action_not_allowed");
  });

  it("rejects an inactive kitchen contact even when the caller claims the correct kitchen scope", async () => {
    const kitchen = await seedKitchen();
    await seedAuthorizedContact({
      kitchenId: kitchen.id,
      phone: "+529991110003",
      role: "KITCHEN",
      name: "Admin Inactivo",
      active: false
    });
    const client = await createHttpClient();
    const response = await client
      .post(`/kitchens/${kitchen.id}/menus`)
      .send({
        messageId: "security_identity_bound_003",
        items: [
          { name: "Menu Seguro", price: 60, stockQuantity: 5, availabilityStatus: "AVAILABLE" }
        ]
      })
      .set(
        getTrustedCallerContextHeaders({
          role: "KITCHEN",
          kitchenId: String(kitchen.id),
          phone: "+529991110003"
        })
      );

    expect(response.status).toBe(403);
    expect(response.body.error).toBe("action_not_allowed");
  });

  it("rejects a trusted internal caller on POST /kitchens when the platform-support token is missing", async () => {
    const client = await createHttpClient();
    const response = await client
      .post("/kitchens")
      .send({
        messageId: "security_platform_bound_003",
        tenant: { name: "Cocina Token Faltante" }
      })
      .set(getTrustedCallerContextHeaders({ id: "support_2", platformAccess: true }));

    expect(response.status).toBe(403);
    expect(response.body.error).toBe("action_not_allowed");
  });
});
