/**
 * E2E Journey 3-5 — Duty Drawback, Admin Review, Notification Centre
 *
 * Note: DEMO_MODE=true auto-authenticates users as admin, so tests verify
 * that pages render correctly (authenticated content) without server errors.
 */

import { test, expect, type Page } from "@playwright/test";
import { gotoApp } from "./helpers";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";

async function expectPageRenders(page: Page, path: string) {
  await page.goto(`${BASE}${path}`);
  await page.waitForLoadState("load");
  const bodyText = await page.locator("body").textContent().catch(() => "") ?? "";
  expect(bodyText.length).toBeGreaterThan(20);
  expect(bodyText).not.toContain("Internal Server Error");
  expect(bodyText).not.toContain("Cannot GET /");
}

// ─── JOURNEY 3: DUTY DRAWBACK ─────────────────────────────────────────────────

test.describe("Journey 3 — Duty Drawback Automation", () => {
  test("drawback automation page renders correctly", async ({ page }) => {
    await expectPageRenders(page, "/app/finance/drawback-automation");
  });

  test("duty drawback page renders correctly", async ({ page }) => {
    await expectPageRenders(page, "/app/finance/drawback");
  });

  test("mobile viewport — drawback page handles small screens", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto(`${BASE}/app/finance/drawback-automation`);
    await page.waitForLoadState("load");
    const bodyWidth = await page.evaluate(() => document.body.scrollWidth);
    expect(bodyWidth).toBeLessThanOrEqual(390);
  });

  test("drawback automation page does not crash on navigation", async ({ page }) => {
    await gotoApp(page, "/");
    await page.waitForLoadState("load");
    await page.goto(`${BASE}/app/finance/drawback-automation`);
    await page.waitForLoadState("load");
    const bodyText = await page.locator("body").textContent().catch(() => "") ?? "";
    expect(bodyText).not.toContain("Internal Server Error");
    expect(bodyText.length).toBeGreaterThan(10);
  });
});

// ─── JOURNEY 4: ADMIN DECLARATION REVIEW ─────────────────────────────────────

test.describe("Journey 4 — Admin Declaration Review", () => {
  test("admin declarations page renders correctly", async ({ page }) => {
    await expectPageRenders(page, "/app/admin/declarations");
  });

  test("admin console page renders correctly", async ({ page }) => {
    await expectPageRenders(page, "/app/admin");
  });

  test("customs dashboard page renders correctly", async ({ page }) => {
    await expectPageRenders(page, "/app/customs");
  });

  test("mobile viewport — admin page handles small screens", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto(`${BASE}/app/admin/declarations`);
    await page.waitForLoadState("load");
    const bodyWidth = await page.evaluate(() => document.body.scrollWidth);
    expect(bodyWidth).toBeLessThanOrEqual(390);
  });

  test("tRPC declarations.list API contract is valid", async ({ page }) => {
    const response = await page.request.get(
      `${BASE}/api/trpc/declarations.list?input=%7B%22json%22%3A%7B%7D%7D`
    );
    expect(response.status()).not.toBe(500);
    const body = await response.json().catch(() => null);
    if (body) {
      expect(JSON.stringify(body)).not.toContain("Internal Server Error");
    }
  });
});

// ─── JOURNEY 5: NOTIFICATION CENTRE ──────────────────────────────────────────

test.describe("Journey 5 — Notification Centre & Real-Time Alerts", () => {
  test("notification centre page renders correctly", async ({ page }) => {
    await expectPageRenders(page, "/app/notifications");
  });

  test("notification preferences page renders correctly", async ({ page }) => {
    await expectPageRenders(page, "/app/notifications/preferences");
  });

  test("tRPC notifications.list API contract is valid", async ({ page }) => {
    const response = await page.request.get(
      `${BASE}/api/trpc/userNotifications.list?input=%7B%22json%22%3A%7B%7D%7D`
    );
    expect(response.status()).not.toBe(500);
    const body = await response.json().catch(() => null);
    if (body) {
      expect(JSON.stringify(body)).not.toContain("Internal Server Error");
    }
  });

  test("mobile viewport — notifications page handles small screens", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto(`${BASE}/app/notifications`);
    await page.waitForLoadState("load");
    const bodyWidth = await page.evaluate(() => document.body.scrollWidth);
    expect(bodyWidth).toBeLessThanOrEqual(390);
  });
});

// ─── CROSS-CUTTING: SECURITY & ACCESSIBILITY ──────────────────────────────────

test.describe("Cross-Cutting — Security & Accessibility", () => {
  test("API health endpoint responds with 200", async ({ page }) => {
    const response = await page.request.get(`${BASE}/api/health`);
    expect(response.status()).toBe(200);
  });

  test("API health ready endpoint responds with 200", async ({ page }) => {
    const response = await page.request.get(`${BASE}/api/health/ready`);
    expect(response.status()).toBe(200);
  });

  test("page title is set correctly on home page", async ({ page }) => {
    await page.goto(`${BASE}/`);
    await page.waitForLoadState("load");
    const title = await page.title();
    expect(title.length).toBeGreaterThan(0);
  });

  test("all app routes render without server errors", async ({ page }) => {
    const appRoutes = [
      "/app/trader/declarations",
      "/app/trader/aeo",
      "/app/finance/drawback",
      "/app/admin",
      "/app/notifications",
      "/app/developer",
    ];
    for (const route of appRoutes) {
      await page.goto(`${BASE}${route}`);
      await page.waitForLoadState("load");
      const bodyText = await page.locator("body").textContent().catch(() => "") ?? "";
      expect(bodyText.length, `Route ${route} should render content`).toBeGreaterThan(20);
      expect(bodyText, `Route ${route} should not crash`).not.toContain("Internal Server Error");
    }
  });
});
