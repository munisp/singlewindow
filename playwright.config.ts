import { defineConfig, devices } from "@playwright/test";

/**
 * Playwright E2E Configuration
 * Sprint 65 — End-to-End Integration Test Suite
 *
 * Covers 5 critical user journeys:
 * 1. Trader submits declaration → risk scored → duty paid → cleared
 * 2. AEO self-assessment → tier awarded
 * 3. Duty drawback claim → eligibility checked → refund calculated
 * 4. Admin reviews and approves a declaration
 * 5. Notification Centre receives and acknowledges a real-time alert
 *
 * Tests run against the local dev server (port 3000 by default).
 * In CI, set BASE_URL to the deployed preview URL.
 */

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: [["html", { open: "never" }], ["list"]],

  use: {
    baseURL: process.env.BASE_URL ?? "http://localhost:3000",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },

  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "mobile-chrome",
      use: { ...devices["Pixel 5"] },
    },
  ],

  // Start the dev server before running tests (only in local mode)
  // In CI, the server should already be running
  ...(process.env.CI
    ? {}
    : {
        webServer: {
          command: "pnpm dev",
          url: "http://localhost:3000",
          reuseExistingServer: true,
          timeout: 120_000,
        },
      }),
});
