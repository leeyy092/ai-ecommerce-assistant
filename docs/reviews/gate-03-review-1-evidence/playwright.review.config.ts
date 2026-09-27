import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 30_000,
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  globalSetup: "./tests/e2e/auth.global-setup.ts",
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://127.0.0.1:33183",
  },
  webServer: {
    command: "pnpm exec next start -p 33183",
    url: "http://127.0.0.1:33183",
    timeout: 60_000,
    reuseExistingServer: !process.env.CI,
  },
});
