import { defineConfig } from "@playwright/test";

const port = 3100;
const testDatabaseUrl = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? "github" : "line",
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    trace: "retain-on-failure"
  },
  webServer: {
    command: `npm run build && npm run start -- --hostname 127.0.0.1 --port ${port}`,
    url: `http://127.0.0.1:${port}/api/v1/health/live`,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    env: {
      ...process.env,
      FORCE_COLOR: "0",
      APP_ENV: "test",
      AI_PROVIDER: "mock",
      AI_REQUESTS_PER_MINUTE: "3",
      APP_BASE_URL: `http://127.0.0.1:${port}`,
      ...(testDatabaseUrl ? { DATABASE_URL: testDatabaseUrl } : {})
    }
  }
});
