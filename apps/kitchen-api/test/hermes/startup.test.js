import request from "supertest";
import { describe, expect, it } from "vitest";
import { loadHttpApp } from "../setup/http-app.js";

describe("deployment startup smoke", () => {
  it("serves a health check without starting an external server", async () => {
    const app = await loadHttpApp();
    const response = await request(app).get("/healthz");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      ok: true,
      service: "kitchenia-backend",
      status: "healthy"
    });
  });
});
