import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Keep the legacy node:test suite out of the Vitest runner.
    include: ["tests/**/*.spec.ts"],
    environment: "node",
  },
});
