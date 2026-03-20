/**
 * Playwright Global Setup — Authenticated Session Provisioning
 *
 * This file runs once before all E2E tests. It:
 *   1. Starts the dev server with E2E_TEST_MODE=1 (if not already running)
 *   2. Creates a test trader session via POST /api/e2e/session
 *   3. Creates a test admin session via POST /api/e2e/session
 *   4. Saves both storageState files for use in authenticated test suites
 *
 * The saved state files are:
 *   e2e/.auth/trader.json  — authenticated as a regular trader
 *   e2e/.auth/admin.json   — authenticated as an admin/customs officer
 *
 * Usage in tests:
 *   test.use({ storageState: "e2e/.auth/trader.json" });
 */

import { chromium, type FullConfig } from "@playwright/test";
import * as fs from "fs";
import * as path from "path";

const BASE_URL = process.env.BASE_URL ?? "http://localhost:3000";
const AUTH_DIR = path.join(__dirname, ".auth");

export default async function globalSetup(_config: FullConfig) {
  // Create .auth directory if it doesn't exist
  if (!fs.existsSync(AUTH_DIR)) {
    fs.mkdirSync(AUTH_DIR, { recursive: true });
  }

  // Check if the E2E test auth endpoint is available
  const isE2eMode = process.env.E2E_TEST_MODE === "1";
  if (!isE2eMode) {
    console.log("[Global Setup] E2E_TEST_MODE is not set — skipping authenticated session creation.");
    console.log("[Global Setup] Set E2E_TEST_MODE=1 and restart the server to enable authenticated E2E tests.");
    // Write empty state files so tests that use storageState don't fail to find the file
    const emptyState = { cookies: [], origins: [] };
    fs.writeFileSync(path.join(AUTH_DIR, "trader.json"), JSON.stringify(emptyState));
    fs.writeFileSync(path.join(AUTH_DIR, "admin.json"), JSON.stringify(emptyState));
    return;
  }

  const browser = await chromium.launch();

  try {
    // ── Create trader session ────────────────────────────────────────────────
    const traderContext = await browser.newContext();
    const traderPage = await traderContext.newPage();

    const traderResponse = await traderPage.request.post(`${BASE_URL}/api/e2e/session`, {
      data: {
        openId: "e2e-test-trader-001",
        name: "E2E Test Trader",
        role: "user",
        email: "trader@e2e.tradegateway.test",
      },
    });

    if (!traderResponse.ok()) {
      const body = await traderResponse.text();
      throw new Error(`Failed to create trader session: ${traderResponse.status()} ${body}`);
    }

    console.log("[Global Setup] ✅ Trader session created");
    await traderContext.storageState({ path: path.join(AUTH_DIR, "trader.json") });
    await traderContext.close();

    // ── Create admin session ─────────────────────────────────────────────────
    const adminContext = await browser.newContext();
    const adminPage = await adminContext.newPage();

    const adminResponse = await adminPage.request.post(`${BASE_URL}/api/e2e/session`, {
      data: {
        openId: "e2e-test-admin-001",
        name: "E2E Test Admin",
        role: "admin",
        email: "admin@e2e.tradegateway.test",
      },
    });

    if (!adminResponse.ok()) {
      const body = await adminResponse.text();
      throw new Error(`Failed to create admin session: ${adminResponse.status()} ${body}`);
    }

    console.log("[Global Setup] ✅ Admin session created");
    await adminContext.storageState({ path: path.join(AUTH_DIR, "admin.json") });
    await adminContext.close();

    console.log("[Global Setup] ✅ All sessions saved to e2e/.auth/");
  } finally {
    await browser.close();
  }
}
