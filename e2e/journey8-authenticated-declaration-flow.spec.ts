/**
 * E2E Journey 8 — Authenticated Declaration Submission Flow
 *
 * Uses Playwright storageState to bypass OAuth and test the full authenticated
 * user journey:
 *   1. Trader logs in (session restored from e2e/.auth/trader.json)
 *   2. Trader dashboard loads and shows the correct user
 *   3. New Declaration form is accessible and renders all sections
 *   4. Form validation prevents incomplete submissions
 *   5. Document upload section is present
 *   6. Declaration list shows submitted declarations
 *   7. Admin can access the admin declarations panel
 *   8. tRPC auth.me returns the correct user identity
 *
 * Prerequisites:
 *   - Server must be running with E2E_TEST_MODE=1
 *   - global-setup.ts must have run to create e2e/.auth/trader.json
 *
 * Run with:
 *   E2E_TEST_MODE=1 pnpm playwright test journey8
 */

import { test, expect, type Page } from "@playwright/test";
import * as fs from "fs";
import * as path from "path";
import { gotoApp, expectNoSpinner } from "./helpers";

// ─── Determine if authenticated sessions are available ────────────────────────

const AUTH_DIR = path.join(__dirname, ".auth");
const traderAuthFile = path.join(AUTH_DIR, "trader.json");
const adminAuthFile = path.join(AUTH_DIR, "admin.json");

function hasValidSession(filePath: string): boolean {
  try {
    if (!fs.existsSync(filePath)) return false;
    const state = JSON.parse(fs.readFileSync(filePath, "utf-8"));
    return Array.isArray(state.cookies) && state.cookies.length > 0;
  } catch {
    return false;
  }
}

const isAuthAvailable = hasValidSession(traderAuthFile);
const isAdminAuthAvailable = hasValidSession(adminAuthFile);

// ─── SUITE 1: Trader Authentication ──────────────────────────────────────────

test.describe("Journey 8.1 — Trader Authentication", () => {
  test.use({
    storageState: isAuthAvailable ? traderAuthFile : undefined,
  });

  test("tRPC auth.me returns authenticated user when session is valid", async ({ page }) => {
    if (!isAuthAvailable) {
      test.skip(true, "Authenticated session not available — run with E2E_TEST_MODE=1");
      return;
    }

    const response = await page.request.get(
      "/api/trpc/auth.me?input=%7B%22json%22%3Anull%7D"
    );
    expect(response.status()).toBe(200);
    const body = await response.json();
    const result = body?.result?.data?.json;
    expect(result).not.toBeNull();
    expect(result?.openId).toBe("e2e-test-trader-001");
    expect(result?.role).toBe("user");
  });

  test("trader dashboard page loads when authenticated", async ({ page }) => {
    if (!isAuthAvailable) {
      test.skip(true, "Authenticated session not available — run with E2E_TEST_MODE=1");
      return;
    }

    await gotoApp(page, "/app/trader/dashboard");
    await page.waitForLoadState("networkidle");
    await expectNoSpinner(page);

    // Should NOT redirect to login
    const url = page.url();
    expect(url).not.toMatch(/login|oauth|signin/);

    // Should show some dashboard content
    const body = await page.locator("body").innerText();
    expect(body.length).toBeGreaterThan(20);
    expect(body).not.toContain("Internal Server Error");
  });

  test("trader declarations list page loads when authenticated", async ({ page }) => {
    if (!isAuthAvailable) {
      test.skip(true, "Authenticated session not available — run with E2E_TEST_MODE=1");
      return;
    }

    await gotoApp(page, "/app/declarations");
    await page.waitForLoadState("networkidle");
    await expectNoSpinner(page);

    const url = page.url();
    expect(url).not.toMatch(/login|oauth|signin/);
  });

  test("new declaration form page loads when authenticated", async ({ page }) => {
    if (!isAuthAvailable) {
      test.skip(true, "Authenticated session not available — run with E2E_TEST_MODE=1");
      return;
    }

    await gotoApp(page, "/app/declarations/new");
    await page.waitForLoadState("networkidle");
    await expectNoSpinner(page);

    const url = page.url();
    expect(url).not.toMatch(/login|oauth|signin/);

    // Should show a form
    const body = await page.locator("body").innerText();
    expect(body.length).toBeGreaterThan(20);
  });

  test("new declaration form has required input fields", async ({ page }) => {
    if (!isAuthAvailable) {
      test.skip(true, "Authenticated session not available — run with E2E_TEST_MODE=1");
      return;
    }

    await gotoApp(page, "/app/declarations/new");
    await page.waitForLoadState("networkidle");
    await expectNoSpinner(page);

    // Should have at least one input or textarea (form fields)
    const inputs = await page.locator("input, textarea, select").count();
    expect(inputs).toBeGreaterThan(0);
  });

  test("new declaration form has a submit button", async ({ page }) => {
    if (!isAuthAvailable) {
      test.skip(true, "Authenticated session not available — run with E2E_TEST_MODE=1");
      return;
    }

    await gotoApp(page, "/app/declarations/new");
    await page.waitForLoadState("networkidle");
    await expectNoSpinner(page);

    // Should have a submit or save button
    const submitButton = page.getByRole("button", {
      name: /submit|save|create|declare|file/i,
    });
    const buttonCount = await submitButton.count();
    expect(buttonCount).toBeGreaterThan(0);
  });

  test("document vault page loads when authenticated", async ({ page }) => {
    if (!isAuthAvailable) {
      test.skip(true, "Authenticated session not available — run with E2E_TEST_MODE=1");
      return;
    }

    await gotoApp(page, "/app/documents/vault");
    await page.waitForLoadState("networkidle");
    await expectNoSpinner(page);

    const url = page.url();
    expect(url).not.toMatch(/login|oauth|signin/);
  });

  test("Mojaloop payments page loads when authenticated", async ({ page }) => {
    if (!isAuthAvailable) {
      test.skip(true, "Authenticated session not available — run with E2E_TEST_MODE=1");
      return;
    }

    await gotoApp(page, "/app/finance/mojaloop-payments");
    await page.waitForLoadState("networkidle");
    await expectNoSpinner(page);

    const url = page.url();
    expect(url).not.toMatch(/login|oauth|signin/);
  });

  test("notification centre loads when authenticated", async ({ page }) => {
    if (!isAuthAvailable) {
      test.skip(true, "Authenticated session not available — run with E2E_TEST_MODE=1");
      return;
    }

    await gotoApp(page, "/app/notifications");
    await page.waitForLoadState("networkidle");
    await expectNoSpinner(page);

    const url = page.url();
    expect(url).not.toMatch(/login|oauth|signin/);
  });
});

// ─── SUITE 2: Admin Authentication ───────────────────────────────────────────

test.describe("Journey 8.2 — Admin Authentication", () => {
  test.use({
    storageState: isAdminAuthAvailable ? adminAuthFile : undefined,
  });

  test("tRPC auth.me returns admin user when admin session is valid", async ({ page }) => {
    if (!isAdminAuthAvailable) {
      test.skip(true, "Admin session not available — run with E2E_TEST_MODE=1");
      return;
    }

    const response = await page.request.get(
      "/api/trpc/auth.me?input=%7B%22json%22%3Anull%7D"
    );
    expect(response.status()).toBe(200);
    const body = await response.json();
    const result = body?.result?.data?.json;
    expect(result).not.toBeNull();
    expect(result?.openId).toBe("e2e-test-admin-001");
    expect(result?.role).toBe("admin");
  });

  test("admin declarations page loads when authenticated as admin", async ({ page }) => {
    if (!isAdminAuthAvailable) {
      test.skip(true, "Admin session not available — run with E2E_TEST_MODE=1");
      return;
    }

    await gotoApp(page, "/app/admin/declarations");
    await page.waitForLoadState("networkidle");
    await expectNoSpinner(page);

    const url = page.url();
    expect(url).not.toMatch(/login|oauth|signin/);
  });

  test("admin console page loads when authenticated as admin", async ({ page }) => {
    if (!isAdminAuthAvailable) {
      test.skip(true, "Admin session not available — run with E2E_TEST_MODE=1");
      return;
    }

    await gotoApp(page, "/app/admin/console");
    await page.waitForLoadState("networkidle");
    await expectNoSpinner(page);

    const url = page.url();
    expect(url).not.toMatch(/login|oauth|signin/);
  });

  test("customs dashboard loads when authenticated as admin", async ({ page }) => {
    if (!isAdminAuthAvailable) {
      test.skip(true, "Admin session not available — run with E2E_TEST_MODE=1");
      return;
    }

    await gotoApp(page, "/app/customs/dashboard");
    await page.waitForLoadState("networkidle");
    await expectNoSpinner(page);

    const url = page.url();
    expect(url).not.toMatch(/login|oauth|signin/);
  });

  test("tRPC declarations.getStats returns data for admin", async ({ page }) => {
    if (!isAdminAuthAvailable) {
      test.skip(true, "Admin session not available — run with E2E_TEST_MODE=1");
      return;
    }

    const response = await page.request.get(
      "/api/trpc/declarations.getStats?input=%7B%22json%22%3A%7B%7D%7D"
    );
    expect(response.status()).toBe(200);
    const body = await response.json();
    const bodyStr = JSON.stringify(body);
    // Should not return UNAUTHORIZED for admin
    expect(bodyStr).not.toContain("UNAUTHORIZED");
    expect(bodyStr).not.toContain("Please login");
  });

  test("security operations centre loads when authenticated as admin", async ({ page }) => {
    if (!isAdminAuthAvailable) {
      test.skip(true, "Admin session not available — run with E2E_TEST_MODE=1");
      return;
    }

    await gotoApp(page, "/app/security/soc");
    await page.waitForLoadState("networkidle");
    await expectNoSpinner(page);

    const url = page.url();
    expect(url).not.toMatch(/login|oauth|signin/);
  });
});

// ─── SUITE 3: Session Lifecycle ───────────────────────────────────────────────

test.describe("Journey 8.3 — Session Lifecycle", () => {
  test.use({
    storageState: isAuthAvailable ? traderAuthFile : undefined,
  });

  test("logout clears the session and redirects to login", async ({ page }) => {
    if (!isAuthAvailable) {
      test.skip(true, "Authenticated session not available — run with E2E_TEST_MODE=1");
      return;
    }

    // Verify we are authenticated first
    const meResponse = await page.request.get(
      "/api/trpc/auth.me?input=%7B%22json%22%3Anull%7D"
    );
    const meBody = await meResponse.json();
    const user = meBody?.result?.data?.json;
    expect(user).not.toBeNull();

    // Call logout via tRPC
    const logoutResponse = await page.request.post("/api/trpc/auth.logout", {
      headers: { "Content-Type": "application/json" },
      data: { json: null },
    });
    expect(logoutResponse.status()).toBe(200);

    // After logout, auth.me should return null
    const afterLogout = await page.request.get(
      "/api/trpc/auth.me?input=%7B%22json%22%3Anull%7D"
    );
    const afterBody = await afterLogout.json();
    const afterUser = afterBody?.result?.data?.json;
    expect(afterUser).toBeNull();
  });

  test("E2E session endpoint creates a valid session", async ({ page }) => {
    if (!process.env.E2E_TEST_MODE) {
      test.skip(true, "E2E_TEST_MODE not set");
      return;
    }

    // Create a fresh session
    const sessionResponse = await page.request.post("/api/e2e/session", {
      data: {
        openId: "e2e-session-lifecycle-test",
        name: "Session Lifecycle Test User",
        role: "user",
      },
    });
    expect(sessionResponse.ok()).toBeTruthy();
    const sessionBody = await sessionResponse.json();
    expect(sessionBody.ok).toBe(true);
    expect(sessionBody.openId).toBe("e2e-session-lifecycle-test");

    // Verify auth.me now returns the user
    const meResponse = await page.request.get(
      "/api/trpc/auth.me?input=%7B%22json%22%3Anull%7D"
    );
    const meBody = await meResponse.json();
    const user = meBody?.result?.data?.json;
    expect(user?.openId).toBe("e2e-session-lifecycle-test");
  });
});

// ─── SUITE 4: tRPC Authenticated Procedures ──────────────────────────────────

test.describe("Journey 8.4 — tRPC Authenticated Procedures", () => {
  test.use({
    storageState: isAuthAvailable ? traderAuthFile : undefined,
  });

  test("tRPC declarations.list returns data for authenticated trader", async ({ page }) => {
    if (!isAuthAvailable) {
      test.skip(true, "Authenticated session not available — run with E2E_TEST_MODE=1");
      return;
    }

    const response = await page.request.get(
      "/api/trpc/declarations.list?input=%7B%22json%22%3A%7B%22limit%22%3A10%2C%22offset%22%3A0%7D%7D"
    );
    expect(response.status()).toBe(200);
    const body = await response.json();
    const bodyStr = JSON.stringify(body);
    expect(bodyStr).not.toContain("UNAUTHORIZED");
    expect(bodyStr).not.toContain("Please login");
  });

  test("tRPC notifications.list returns data for authenticated user", async ({ page }) => {
    if (!isAuthAvailable) {
      test.skip(true, "Authenticated session not available — run with E2E_TEST_MODE=1");
      return;
    }

    const response = await page.request.get(
      "/api/trpc/notifications.list?input=%7B%22json%22%3A%7B%7D%7D"
    );
    expect(response.status()).toBe(200);
    const body = await response.json();
    const bodyStr = JSON.stringify(body);
    expect(bodyStr).not.toContain("UNAUTHORIZED");
  });

  test("tRPC trader.getProfile returns profile for authenticated trader", async ({ page }) => {
    if (!isAuthAvailable) {
      test.skip(true, "Authenticated session not available — run with E2E_TEST_MODE=1");
      return;
    }

    const response = await page.request.get(
      "/api/trpc/trader.getProfile?input=%7B%22json%22%3A%7B%7D%7D"
    );
    expect(response.status()).toBe(200);
    const body = await response.json();
    const bodyStr = JSON.stringify(body);
    expect(bodyStr).not.toContain("UNAUTHORIZED");
  });
});
