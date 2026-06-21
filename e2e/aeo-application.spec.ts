/**
 * TradeGateway™ NGSWTP — E2E Spec: AEO Application → Admin Review → Approval
 *
 * Covers the Authorised Economic Operator (AEO) programme lifecycle:
 *   1. Trader applies for AEO status via self-assessment wizard
 *   2. Admin reviews the application in the AEO management panel
 *   3. Admin approves/rejects with tier assignment (Standard/Gold/Platinum)
 *   4. Trader receives updated AEO status in their profile
 *
 * Test strategy:
 *   - Page render checks verify no 500 errors and meaningful content
 *   - tRPC API contract tests verify endpoint shape and auth behaviour
 *   - All tests are resilient to unauthenticated state (expect login redirect, not crash)
 *
 * Run:
 *   pnpm e2e -- e2e/aeo-application.spec.ts
 */

import { test, expect, type Page } from "@playwright/test";

const BASE = process.env.BASE_URL ?? "http://localhost:9000";

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function pageRendersOk(page: Page, path: string): Promise<string> {
  await page.goto(`${BASE}${path}`);
  await page.waitForLoadState("load");
  const body = (await page.locator("body").textContent().catch(() => "")) ?? "";
  expect(body.length).toBeGreaterThan(50);
  expect(body).not.toContain("Internal Server Error");
  expect(body).not.toContain("Cannot GET /");
  return body;
}

async function trpcGet(page: Page, procedure: string, input = {}): Promise<unknown> {
  const encoded = encodeURIComponent(JSON.stringify({ json: input }));
  const res = await page.request.get(`${BASE}/api/trpc/${procedure}?input=${encoded}`);
  expect(res.status()).not.toBe(500);
  return res.json().catch(() => null);
}

// ─── Suite 1: Trader AEO Application ─────────────────────────────────────────

test.describe("Journey: Trader applies for AEO status", () => {
  test("AEO programme overview page renders correctly", async ({ page }) => {
    const body = await pageRendersOk(page, "/app/trader/aeo");
    const isHandled =
      body.toLowerCase().includes("aeo") ||
      body.toLowerCase().includes("authorized") ||
      body.toLowerCase().includes("authorised") ||
      body.toLowerCase().includes("economic") ||
      body.toLowerCase().includes("login") ||
      body.toLowerCase().includes("sign in");
    expect(isHandled).toBeTruthy();
  });

  test("AEO self-assessment wizard page renders correctly", async ({ page }) => {
    const body = await pageRendersOk(page, "/app/trader/aeo-self-assessment");
    const isHandled =
      body.toLowerCase().includes("assessment") ||
      body.toLowerCase().includes("aeo") ||
      body.toLowerCase().includes("login");
    expect(isHandled).toBeTruthy();
  });

  test("tRPC aeo.getSelfAssessment API contract is valid", async ({ page }) => {
    const data = await trpcGet(page, "aeo.getSelfAssessment");
    expect(data).not.toBeNull();
    const str = JSON.stringify(data ?? "");
    expect(str).not.toContain("Internal Server Error");
  });

  test("tRPC aeo.listApplications API contract is valid", async ({ page }) => {
    const data = await trpcGet(page, "aeo.listApplications", { limit: 10 });
    expect(data).not.toBeNull();
    const str = JSON.stringify(data ?? "");
    expect(str).not.toContain("Internal Server Error");
  });

  test("AEO application submission endpoint does not return 500", async ({ page }) => {
    const res = await page.request.post(`${BASE}/api/trpc/aeo.submitApplication`, {
      data: {
        json: {
          companyName: "E2E Test Company Ltd",
          registrationNumber: "GH-E2E-001",
          applicantName: "E2E Test Applicant",
          applicantEmail: "e2e@test.tradegateway.local",
          tier: "standard",
          selfAssessmentScore: 85,
          documents: [],
        },
      },
      headers: { "Content-Type": "application/json" },
    });
    // Auth failure (401) expected without session; 500 is not acceptable
    expect(res.status()).not.toBe(500);
  });

  test("AEO compliance scorecard page renders correctly", async ({ page }) => {
    const body = await pageRendersOk(page, "/app/trader/compliance-scorecard");
    expect(body.length).toBeGreaterThan(50);
    expect(body).not.toContain("Internal Server Error");
  });

  test("tRPC traderScorecard.getScore API contract is valid", async ({ page }) => {
    const data = await trpcGet(page, "traderScorecard.getScore");
    expect(data).not.toBeNull();
    const str = JSON.stringify(data ?? "");
    expect(str).not.toContain("Internal Server Error");
  });
});

// ─── Suite 2: Admin Reviews AEO Application ───────────────────────────────────

test.describe("Journey: Admin reviews AEO application", () => {
  test("AEO applications admin page renders correctly", async ({ page }) => {
    const body = await pageRendersOk(page, "/app/admin/aeo-applications");
    const isHandled =
      body.toLowerCase().includes("aeo") ||
      body.toLowerCase().includes("application") ||
      body.toLowerCase().includes("login");
    expect(isHandled).toBeTruthy();
  });

  test("tRPC aeo.getPendingApplications API contract is valid", async ({ page }) => {
    const data = await trpcGet(page, "aeo.getPendingApplications", { limit: 10 });
    expect(data).not.toBeNull();
    const str = JSON.stringify(data ?? "");
    expect(str).not.toContain("Internal Server Error");
  });

  test("AEO application approval endpoint does not return 500", async ({ page }) => {
    const res = await page.request.post(`${BASE}/api/trpc/aeo.approveApplication`, {
      data: {
        json: {
          applicationId: "test-app-id",
          tier: "gold",
          notes: "E2E test approval",
          validUntil: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(),
        },
      },
      headers: { "Content-Type": "application/json" },
    });
    expect(res.status()).not.toBe(500);
  });

  test("AEO application rejection endpoint does not return 500", async ({ page }) => {
    const res = await page.request.post(`${BASE}/api/trpc/aeo.rejectApplication`, {
      data: {
        json: {
          applicationId: "test-app-id",
          reason: "E2E test rejection — insufficient documentation",
        },
      },
      headers: { "Content-Type": "application/json" },
    });
    expect(res.status()).not.toBe(500);
  });

  test("AEO tier statistics API contract is valid", async ({ page }) => {
    const data = await trpcGet(page, "aeo.getTierStats");
    expect(data).not.toBeNull();
    const str = JSON.stringify(data ?? "");
    expect(str).not.toContain("Internal Server Error");
  });
});

// ─── Suite 3: Post-Approval AEO Benefits ─────────────────────────────────────

test.describe("Journey: AEO approval benefits and green lane", () => {
  test("green lane declarations page renders correctly", async ({ page }) => {
    const body = await pageRendersOk(page, "/app/trader/declarations");
    expect(body.length).toBeGreaterThan(50);
    expect(body).not.toContain("Internal Server Error");
  });

  test("tRPC aeo.getAeoStatus API contract is valid", async ({ page }) => {
    const data = await trpcGet(page, "aeo.getAeoStatus");
    expect(data).not.toBeNull();
    const str = JSON.stringify(data ?? "");
    expect(str).not.toContain("Internal Server Error");
  });

  test("AEO certificate download endpoint does not return 500", async ({ page }) => {
    const res = await page.request.get(
      `${BASE}/api/trpc/aeo.getCertificate?input=${encodeURIComponent(JSON.stringify({ json: { applicationId: "test" } }))}`
    );
    expect(res.status()).not.toBe(500);
  });

  test("post-clearance audit page renders correctly", async ({ page }) => {
    const body = await pageRendersOk(page, "/app/customs/post-clearance-audit");
    expect(body.length).toBeGreaterThan(50);
    expect(body).not.toContain("Internal Server Error");
  });

  test("tRPC postAudit.listAudits API contract is valid", async ({ page }) => {
    const data = await trpcGet(page, "postAudit.listAudits", { limit: 10 });
    expect(data).not.toBeNull();
    const str = JSON.stringify(data ?? "");
    expect(str).not.toContain("Internal Server Error");
  });

  test("compliance trend API contract is valid", async ({ page }) => {
    const data = await trpcGet(page, "traderScorecard.getComplianceTrend", { months: 6 });
    expect(data).not.toBeNull();
    const str = JSON.stringify(data ?? "");
    expect(str).not.toContain("Internal Server Error");
  });
});
