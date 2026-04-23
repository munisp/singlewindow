/**
 * Playwright Global Setup — Authenticated Session Provisioning
 *
 * This file runs once before all E2E tests. It:
 *   1. Creates a demo admin session via POST /api/demo/session (works in DEMO_MODE)
 *   2. Creates a demo trader session via POST /api/demo/session
 *   3. Optionally creates E2E test sessions if E2E_TEST_MODE=1
 *
 * The saved state files are:
 *   e2e/.auth/demo.json    — authenticated as demo admin (used by most tests)
 *   e2e/.auth/trader.json  — authenticated as demo trader
 *   e2e/.auth/admin.json   — authenticated as E2E admin (requires E2E_TEST_MODE=1)
 *
 * Usage in tests:
 *   test.use({ storageState: "e2e/.auth/demo.json" });
 *   test.use({ storageState: "e2e/.auth/trader.json" });
 */

import { chromium, type FullConfig } from "@playwright/test";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

// ESM-compatible __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const BASE_URL = process.env.BASE_URL ?? "http://localhost:3000";
const AUTH_DIR = path.join(__dirname, ".auth");

export default async function globalSetup(_config: FullConfig) {
  // Create .auth directory if it doesn't exist
  if (!fs.existsSync(AUTH_DIR)) {
    fs.mkdirSync(AUTH_DIR, { recursive: true });
  }

  const emptyState = { cookies: [], origins: [] };
  const browser = await chromium.launch();

  try {
    // ── Create demo admin session (works in DEMO_MODE without E2E_TEST_MODE) ──
    const demoAdminContext = await browser.newContext();
    const demoAdminPage = await demoAdminContext.newPage();
    const demoAdminResponse = await demoAdminPage.request.post(`${BASE_URL}/api/demo/session`, {
      data: { role: "admin" },
    });
    if (demoAdminResponse.ok()) {
      console.log("[Global Setup] ✅ Demo admin session created");
      await demoAdminContext.storageState({ path: path.join(AUTH_DIR, "demo.json") });
    } else {
      console.log("[Global Setup] ⚠️  Demo admin session not available — writing empty state");
      fs.writeFileSync(path.join(AUTH_DIR, "demo.json"), JSON.stringify(emptyState));
    }
    await demoAdminContext.close();

    // ── Create demo trader session ───────────────────────────────────────────
    const demoTraderContext = await browser.newContext();
    const demoTraderPage = await demoTraderContext.newPage();
    const demoTraderResponse = await demoTraderPage.request.post(`${BASE_URL}/api/demo/session`, {
      data: { role: "trader" },
    });
    if (demoTraderResponse.ok()) {
      console.log("[Global Setup] ✅ Demo trader session created");
      await demoTraderContext.storageState({ path: path.join(AUTH_DIR, "trader.json") });
    } else {
      console.log("[Global Setup] ⚠️  Demo trader session not available — writing empty state");
      fs.writeFileSync(path.join(AUTH_DIR, "trader.json"), JSON.stringify(emptyState));
    }
    await demoTraderContext.close();

    // ── Create E2E test sessions (only if E2E_TEST_MODE=1) ───────────────────
    const isE2eMode = process.env.E2E_TEST_MODE === "1";
    if (!isE2eMode) {
      console.log("[Global Setup] E2E_TEST_MODE is not set — skipping E2E session provisioning.");
      // Write empty state for admin.json (used by journey8 which needs E2E_TEST_MODE)
      fs.writeFileSync(path.join(AUTH_DIR, "admin.json"), JSON.stringify(emptyState));
      return;
    }

    // ── Create E2E trader session ────────────────────────────────────────────
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
    console.log("[Global Setup] ✅ E2E Trader session created");
    await traderContext.storageState({ path: path.join(AUTH_DIR, "trader.json") });
    await traderContext.close();

    // ── Create E2E admin session ─────────────────────────────────────────────
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
    console.log("[Global Setup] ✅ E2E Admin session created");
    await adminContext.storageState({ path: path.join(AUTH_DIR, "admin.json") });
    await adminContext.close();

    console.log("[Global Setup] ✅ All sessions saved to e2e/.auth/");
  } finally {
    await browser.close();
  }
}
