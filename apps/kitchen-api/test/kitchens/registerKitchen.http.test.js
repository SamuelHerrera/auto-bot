import { describe, expect, it } from "vitest";
import { createHttpClient, getPlatformSupportHeaders, getTrustedCallerContextHeaders } from "../setup/http-app.js";
import { useDbTestHooks } from "../setup/db-fixtures.js";

useDbTestHooks();

describe("POST /kitchens", () => {
  it("registers a kitchen with HTTP 200", async () => {
    const client = await createHttpClient();
    const response = await client.post("/kitchens").send({
      messageId: "http_kitchen_001",
      tenant: { name: "Cocina Lupita" }
    }).set(getPlatformSupportHeaders());

    expect(response.status).toBe(200);
    expect(response.body.ok).toBe(true);
  });

  it("returns 403 for non-platform callers", async () => {
    const client = await createHttpClient();
    const response = await client.post("/kitchens").send({
      messageId: "http_kitchen_002",
      tenant: { name: "Cocina Lupita" }
    }).set(getTrustedCallerContextHeaders({ role: "KITCHEN", kitchenId: "1" }));

    expect(response.status).toBe(403);
    expect(response.body.error).toBe("action_not_allowed");
  });

  it("returns 403 for trusted internal callers without the platform-support token", async () => {
    const client = await createHttpClient();
    const response = await client.post("/kitchens").send({
      messageId: "http_kitchen_003",
      tenant: { name: "Cocina Lupita" }
    }).set(getTrustedCallerContextHeaders({}));

    expect(response.status).toBe(403);
    expect(response.body.error).toBe("action_not_allowed");
  });
});
