import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { prisma } from "../../src/infrastructure/prisma.ts";
import { loadHttpApp } from "../setup/http-app.js";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("security: system route redaction", () => {
  it("redacts environment and provider details from /healthz", async () => {
    const app = await loadHttpApp();
    const response = await request(app).get("/healthz");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      ok: true,
      service: "kitchenia-backend",
      status: "healthy"
    });
  });

  it("redacts raw database and provider details from /readyz failures", async () => {
    vi.spyOn(prisma, "$queryRawUnsafe").mockRejectedValueOnce(
      new Error("password authentication failed for user postgres")
    );

    const app = await loadHttpApp();
    const response = await request(app).get("/readyz");

    expect(response.status).toBe(503);
    expect(response.body).toEqual({
      ok: false,
      service: "kitchenia-backend",
      status: "not_ready",
      error: "service_not_ready"
    });
  });
});
