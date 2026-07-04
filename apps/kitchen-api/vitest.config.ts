import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["test/**/*.test.js", "test/**/*.test.ts"],
    setupFiles: ["test/setup/vitest.setup.js"],
    fileParallelism: false
  }
});
