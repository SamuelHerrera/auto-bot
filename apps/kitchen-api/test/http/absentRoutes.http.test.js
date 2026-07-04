import { describe, expect, it } from "vitest";
import { createHttpClient } from "../setup/http-app.js";
import { useDbTestHooks } from "../setup/db-fixtures.js";

useDbTestHooks();

describe("absent route surface", () => {
  it("does not expose removed or forbidden generic surfaces", async () => {
    const client = await createHttpClient();

    const responses = await Promise.all([
      client.get("/conversations/1/handoff"),
      client.post("/execute"),
      client.post("/shell"),
      client.get("/filesystem"),
      client.get("/fetch"),
      client.get("/db")
    ]);

    for (const response of responses) {
      expect(response.status).toBe(404);
      expect(response.body.error).toBe("route_not_found");
    }
  });
});
