import { defineConfig, devices } from "@playwright/test";

const PORT = 3200;
// Use a pre-installed Chromium when one is provided (e.g. CI images); otherwise Playwright's own.
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_PATH || undefined;

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "retain-on-failure",
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], launchOptions: { executablePath } }, testIgnore: /mobile\.spec\.ts/ },
    { name: "mobile", use: { ...devices["Pixel 7"], launchOptions: { executablePath } }, testMatch: /mobile\.spec\.ts/ },
  ],
  webServer: {
    // A fresh, isolated demo database for every run. Never touches DATABASE_URL databases.
    command: `npx tsx scripts/demo-reset.ts && npx next dev -p ${PORT}`,
    url: `http://localhost:${PORT}/`,
    timeout: 240_000,
    reuseExistingServer: false,
    env: {
      APP_MODE: "demo",
      AI_PROVIDER: "demo",
      AUTH_PROVIDER: "password",
      STORAGE_PROVIDER: "local",
      DATABASE_URL: "",
      PGLITE_DIR: ".data/e2e-pglite",
      LOCAL_STORAGE_DIR: ".data/e2e-uploads",
      APP_URL: `http://localhost:${PORT}`,
      NEXT_TELEMETRY_DISABLED: "1",
    },
  },
});
