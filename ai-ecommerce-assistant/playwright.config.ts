import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 30_000,
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://127.0.0.1:3000",
  },
  webServer: {
    command: "pnpm start",
    url: "http://127.0.0.1:3000",
    timeout: 60_000,
    reuseExistingServer: !process.env.CI,
  },
});
