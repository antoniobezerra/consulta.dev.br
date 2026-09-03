import { defineConfig, devices } from "@playwright/test";

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
  ],
});
