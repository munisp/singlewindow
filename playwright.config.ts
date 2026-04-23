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
 * Sprint 88 additions:
 * 6. Full declaration submission flow (journey6)
 * 7. Payment & clearance flow (journey7)
 * 8. Authenticated declaration flow using storageState (journey8)
 *    — requires E2E_TEST_MODE=1 for session provisioning
 *
 * Tests run against the local dev server (port 3000 by default).
 * In CI, set BASE_URL to the deployed preview URL.
 *
 * Authenticated tests:
 *   E2E_TEST_MODE=1 pnpm playwright test
 *   This enables the /api/e2e/session endpoint and global-setup.ts will
 *   provision trader and admin sessions into e2e/.auth/*.json files.
 */

export default defineConfig({
  testDir: "./e2e",
  globalSetup: "./e2e/global-setup.ts",
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
    // Use demo admin session by default so all tests run as authenticated admin
    // Individual tests can override with test.use({ storageState: "..." })
    storageState: "e2e/.auth/demo.json",
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
          // Pass E2E_TEST_MODE through to the dev server so the test auth
          // endpoint is mounted when running authenticated E2E tests
          command: process.env.E2E_TEST_MODE === "1"
            ? "E2E_TEST_MODE=1 pnpm dev"
            : "pnpm dev",
          url: "http://localhost:3000",
          reuseExistingServer: true,
          timeout: 120_000,
        },
      }),
});
