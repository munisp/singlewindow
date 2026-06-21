/**
 * TradeGateway™ NGSWTP — Playwright End-to-End Test Configuration
 *
 * Targets the local development server (or a running Docker Compose stack).
 * Set BASE_URL env var to override the default dev server URL.
 *
 * Run all tests:         pnpm e2e
 * Run with UI:           pnpm e2e:ui
 * Run specific file:     pnpm e2e -- e2e/trader-declaration.spec.ts
 * Run in headed mode:    pnpm e2e -- --headed
 * Generate report:       pnpm e2e:report
 */

import { defineConfig, devices } from "@playwright/test";

const BASE_URL = process.env.BASE_URL ?? "http://localhost:9000";

export default defineConfig({
  // Test directory
  testDir: ".",

  // Maximum time one test can run (ms)
  timeout: 60_000,

  // Maximum time for expect() assertions (ms)
  expect: {
    timeout: 10_000,
  },

  // Fail the build on CI if you accidentally left test.only in the source code
  forbidOnly: !!process.env.CI,

  // Retry on CI only
  retries: process.env.CI ? 2 : 0,

  // Opt out of parallel tests on CI — single worker keeps DB state predictable
  workers: process.env.CI ? 1 : undefined,

  // Reporter: HTML report + console output
  reporter: [
    ["html", { outputFolder: "../playwright-report", open: "never" }],
    ["list"],
  ],

  // Shared settings for all projects
  use: {
    baseURL: BASE_URL,

    // Collect trace on first retry for debugging
    trace: "on-first-retry",

    // Screenshot on failure
    screenshot: "only-on-failure",

    // Video on failure
    video: "on-first-retry",

    // Browser context options
    ignoreHTTPSErrors: true,

    // Default navigation timeout
    navigationTimeout: 30_000,
  },

  // Test projects (browsers)
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "firefox",
      use: { ...devices["Desktop Firefox"] },
    },
    // Mobile viewport smoke test
    {
      name: "mobile-chrome",
      use: { ...devices["Pixel 5"] },
      // Only run the smoke test on mobile to keep CI fast
      testMatch: "**/trader-declaration.spec.ts",
    },
  ],

  // Start the dev server automatically when running locally
  webServer: process.env.CI
    ? undefined
    : {
        command: "pnpm dev",
        url: BASE_URL,
        reuseExistingServer: true,
        timeout: 60_000,
      },
});
