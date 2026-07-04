import { describe, expect, it } from "vitest";
import { loadHttpApp } from "./http-app.js";

describe("test/setup/http-app", () => {
  it("loads the Express app without starting a server", async () => {
    const app = await loadHttpApp();

    expect(app).toBeDefined();
    expect(typeof app.use).toBe("function");
  });
});
