import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts", "tests/**/*.test.mjs", "packages/*/src/**/*.test.ts", "apps/*/src/**/*.test.ts"],
    environment: "node",
    passWithNoTests: false,
  },
});
