import { defineConfig } from "@playwright/test";

const port = 43174;

export default defineConfig({
  testDir: "./tests/e2e-pwa",
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  reporter: [["list"]],
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    browserName: "chromium",
    serviceWorkers: "allow",
    trace: "retain-on-failure",
    viewport: { height: 900, width: 1440 },
  },
  webServer: {
    command: `pnpm --filter @lpbot/web build && pnpm --filter @lpbot/web preview --host 127.0.0.1 --port ${port}`,
    reuseExistingServer: false,
    timeout: 120_000,
    url: `http://127.0.0.1:${port}`,
  },
});
