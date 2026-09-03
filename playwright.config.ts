import { defineConfig, devices } from "@playwright/test";

// Microsoft Edge is installed only in CI (or deliberately with this opt-in).
// Keeping it opt-in locally avoids making a proprietary browser a prerequisite
// for ordinary contributor test runs while ensuring the release gate uses it.
const runEdge = process.env.CI === "true" || process.env.CONSULTA_E2E_EDGE === "true";

export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  webServer: [
    {
      command: "pnpm --filter @consulta-dev/embed exec vite --host 127.0.0.1 --port 4173",
      url: "http://127.0.0.1:4173",
      reuseExistingServer: !process.env.CI,
    },
    {
      command: "pnpm --filter @consulta-dev/embed run build && node ./apps/embed/scripts/serve-versioned-build.mjs",
      url: "http://127.0.0.1:4174/embed/v0.0.0/index.html",
      reuseExistingServer: !process.env.CI,
    },
  ],
  use: {
    baseURL: "http://127.0.0.1:4173",
    trace: "retain-on-failure",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "firefox", use: { ...devices["Desktop Firefox"] } },
    { name: "webkit", use: { ...devices["Desktop Safari"] } },
    ...(runEdge ? [{ name: "edge", use: { ...devices["Desktop Edge"], channel: "msedge" } }] : []),
  ],
});
