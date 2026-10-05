import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "tests-ts",
  testMatch: "**/*.spec.ts",
  workers: 1,
  timeout: 45000,
  use: {
    baseURL: "http://127.0.0.1:8091",
    channel: "msedge",
    headless: true,
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  webServer: {
    command: `"${process.execPath}" --import tsx tests-ts/browser-server.ts`,
    url: "http://127.0.0.1:8091/api/session",
    reuseExistingServer: false,
    timeout: 60000,
  },
  reporter: "list",
});
