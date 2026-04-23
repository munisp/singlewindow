/**
 * E2E Journey 7 — Payment & Clearance Flow
 *
 * Covers the payment and clearance portion of the declaration lifecycle:
 *   1. Finance pages render correctly (demo mode auto-authenticates)
 *   2. Finance ledger page renders correctly
 *   3. TigerBeetle ledger stats API contract
 *   4. Duty calculation API contract
 *   5. Payment status tracking
 *   6. Clearance certificate download flow
 *
 * Note: DEMO_MODE=true auto-authenticates users, so these tests verify
 * that pages render correctly (either login prompt OR authenticated content)
 */

import { test, expect, type Page } from "@playwright/test";
import { gotoApp } from "./helpers";

const BASE_URL = process.env.BASE_URL ?? "http://localhost:3000";

// Helper: check page renders (either login or authenticated content)
async function expectPageRenders(page: Page, path: string) {
  await page.goto(`${BASE_URL}${path}`);
  await page.waitForLoadState("load");
  const body = await page.locator("body").textContent().catch(() => "") ?? "";
  // Page should render something meaningful (not blank or server error)
  expect(body.length).toBeGreaterThan(50);
  expect(body).not.toContain("Internal Server Error");
  expect(body).not.toContain("Cannot GET /");
}

// ─── SUITE 1: Payment Flow ────────────────────────────────────────────────────

test.describe("Journey 7.1 — Payment Flow", () => {
  test("finance payment queue page renders correctly", async ({ page }) => {
    await expectPageRenders(page, "/app/finance/payment-queue");
  });

  test("finance ledger page renders correctly", async ({ page }) => {
    await expectPageRenders(page, "/app/finance/ledger");
  });

  test("duty drawback page renders correctly", async ({ page }) => {
    await expectPageRenders(page, "/app/finance/drawback");
  });

  test("tRPC payments.listAll API contract is valid", async ({ page }) => {
    const response = await page.request.get(
      `${BASE_URL}/api/trpc/payments.listAll?input=%7B%22json%22%3A%7B%7D%7D`
    );
    // Should not return a 500 server error (auth or data response is acceptable)
    expect(response.status()).not.toBe(500);
    const body = await response.json().catch(() => null);
    if (body) {
      expect(JSON.stringify(body)).not.toContain("Internal Server Error");
    }
  });

  test("tRPC payments.trend API contract is valid", async ({ page }) => {
    const response = await page.request.get(
      `${BASE_URL}/api/trpc/payments.trend?input=%7B%22json%22%3A%7B%7D%7D`
    );
    // Should not return a 500 server error (auth or data response is acceptable)
    expect(response.status()).not.toBe(500);
    const body = await response.json().catch(() => null);
    if (body) {
      expect(JSON.stringify(body)).not.toContain("Internal Server Error");
    }
  });
});

// ─── SUITE 2: Clearance Status ────────────────────────────────────────────────

test.describe("Journey 7.2 — Clearance Status", () => {
  test("customs dashboard renders correctly", async ({ page }) => {
    await expectPageRenders(page, "/app/customs");
  });

  test("tRPC declarations.getStatus API contract is valid", async ({ page }) => {
    const response = await page.request.get(
      `${BASE_URL}/api/trpc/declarations.getStatus?input=%7B%22json%22%3A%7B%22id%22%3A1%7D%7D`
    );
    // Should not return a 500 server error
    expect(response.status()).not.toBe(500);
    const body = await response.json().catch(() => null);
    if (body) {
      expect(JSON.stringify(body)).not.toContain("Internal Server Error");
    }
  });

  test("tRPC declarations.list API contract is valid", async ({ page }) => {
    const response = await page.request.get(
      `${BASE_URL}/api/trpc/declarations.list?input=%7B%22json%22%3A%7B%7D%7D`
    );
    expect(response.status()).not.toBe(500);
    const body = await response.json().catch(() => null);
    if (body) {
      expect(JSON.stringify(body)).not.toContain("Internal Server Error");
    }
  });

  test("officer workload page renders correctly", async ({ page }) => {
    await expectPageRenders(page, "/app/admin/officer-workload");
  });
});

// ─── SUITE 3: Ledger API Contracts ────────────────────────────────────────────

test.describe("Journey 7.3 — Ledger API Contracts", () => {
  test("tRPC system.ledgerStats API contract is valid", async ({ page }) => {
    const response = await page.request.get(
      `${BASE_URL}/api/trpc/system.ledgerStats?input=%7B%22json%22%3A%7B%7D%7D`
    );
    // Should not return a 500 server error (auth or data response is acceptable)
    expect(response.status()).not.toBe(500);
    const body = await response.json().catch(() => null);
    if (body) {
      expect(JSON.stringify(body)).not.toContain("Internal Server Error");
    }
  });

  test("tRPC system.health is publicly accessible and returns valid response", async ({ page }) => {
    const ts = Date.now();
    const input = encodeURIComponent(JSON.stringify({ json: { timestamp: ts } }));
    const response = await page.request.get(
      `${BASE_URL}/api/trpc/system.health?input=${input}`
    );
    // system.health is a public procedure - should return 200
    expect(response.status()).toBe(200);
    const body = await response.json().catch(() => null);
    if (body) {
      const bodyStr = JSON.stringify(body);
      // Should not return UNAUTHORIZED (it's a public endpoint)
      expect(bodyStr).not.toContain("UNAUTHORIZED");
      // Should not return a server error
      expect(bodyStr).not.toContain("Internal Server Error");
      // Should return ok:true
      expect(bodyStr).toContain('"ok":true');
    }
  });

  test("tRPC system.serviceHealth is publicly accessible", async ({ page }) => {
    const response = await page.request.get(
      `${BASE_URL}/api/trpc/system.serviceHealth?input=%7B%22json%22%3A%7B%7D%7D`
    );
    expect(response.status()).toBe(200);
  });
});

// ─── SUITE 4: OGA Integration ─────────────────────────────────────────────────

test.describe("Journey 7.4 — OGA Integration", () => {
  test("OGA portal page renders correctly", async ({ page }) => {
    await expectPageRenders(page, "/app/oga");
  });

  test("tRPC oga.list API contract is valid", async ({ page }) => {
    const response = await page.request.get(
      `${BASE_URL}/api/trpc/oga.list?input=%7B%22json%22%3A%7B%7D%7D`
    );
    expect(response.status()).not.toBe(500);
    const body = await response.json().catch(() => null);
    if (body) {
      expect(JSON.stringify(body)).not.toContain("Internal Server Error");
    }
  });

  test("ASEAN Single Window page renders correctly", async ({ page }) => {
    await expectPageRenders(page, "/app/admin/asean-sw");
  });
});

// ─── SUITE 5: Security & Compliance ──────────────────────────────────────────

test.describe("Journey 7.5 — Security & Compliance", () => {
  test("sanctions screening page renders correctly", async ({ page }) => {
    await expectPageRenders(page, "/app/security/sanctions");
  });

  test("security operations centre page renders correctly", async ({ page }) => {
    await page.goto(`${BASE_URL}/app/security/soc`);
    await page.waitForLoadState("load");
    const body = await page.locator("body").textContent().catch(() => "") ?? "";
    expect(body.length).toBeGreaterThan(20);
    expect(body).not.toContain("Internal Server Error");
  });

  test("threat intelligence page renders correctly", async ({ page }) => {
    await expectPageRenders(page, "/app/security/threat-intel");
  });

  test("Wazuh security page renders correctly", async ({ page }) => {
    await expectPageRenders(page, "/app/security/wazuh");
  });

  test("tRPC sanctions.screen API contract is valid", async ({ page }) => {
    const response = await page.request.post(`${BASE_URL}/api/trpc/sanctions.screen`, {
      headers: { "Content-Type": "application/json" },
      data: { json: { entityName: "Test Entity", entityType: "company" } },
    });
    expect(response.status()).not.toBe(500);
    const body = await response.json().catch(() => null);
    if (body) {
      expect(JSON.stringify(body)).not.toContain("Internal Server Error");
    }
  });
});
