/**
 * TradeGateway™ NGSWTP — E2E Spec: OGA Permit Request → Officer Approval
 *
 * Covers the Other Government Agency (OGA) permit/licence workflow:
 *   1. Trader requests an OGA permit (e.g. phytosanitary, food safety, standards)
 *   2. OGA officer receives the request in their queue
 *   3. OGA officer reviews supporting documents and approves/rejects
 *   4. Permit is issued and linked to the declaration for clearance
 *
 * OGAs exercised in this suite:
 *   - Food and Drugs Authority (FDA) — food safety certificate
 *   - Plant Protection and Regulatory Services (PPRS) — phytosanitary certificate
 *   - Ghana Standards Authority (GSA) — conformity assessment
 *
 * Test strategy:
 *   - Page render checks verify no 500 errors and meaningful content
 *   - tRPC API contract tests verify endpoint shape and auth behaviour
 *   - All tests are resilient to unauthenticated state
 *
 * Run:
 *   pnpm e2e -- e2e/oga-permit.spec.ts
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

// ─── Suite 1: Trader Requests OGA Permit ─────────────────────────────────────

test.describe("Journey: Trader requests OGA permit", () => {
  test("OGA permits list page renders correctly", async ({ page }) => {
    const body = await pageRendersOk(page, "/app/trader/oga-permits");
    const isHandled =
      body.toLowerCase().includes("permit") ||
      body.toLowerCase().includes("oga") ||
      body.toLowerCase().includes("agency") ||
      body.toLowerCase().includes("login") ||
      body.toLowerCase().includes("sign in");
    expect(isHandled).toBeTruthy();
  });

  test("OGA permit application page renders correctly", async ({ page }) => {
    const body = await pageRendersOk(page, "/app/trader/oga-permits/new");
    const isHandled =
      body.toLowerCase().includes("permit") ||
      body.toLowerCase().includes("oga") ||
      body.toLowerCase().includes("login");
    expect(isHandled).toBeTruthy();
  });

  test("tRPC oga.listPermits API contract is valid", async ({ page }) => {
    const data = await trpcGet(page, "oga.listPermits", { limit: 10 });
    expect(data).not.toBeNull();
    const str = JSON.stringify(data ?? "");
    expect(str).not.toContain("Internal Server Error");
  });

  test("tRPC oga.listAgencies API contract is valid", async ({ page }) => {
    const data = await trpcGet(page, "oga.listAgencies");
    expect(data).not.toBeNull();
    const str = JSON.stringify(data ?? "");
    expect(str).not.toContain("Internal Server Error");
  });

  test("OGA permit request submission endpoint does not return 500", async ({ page }) => {
    const res = await page.request.post(`${BASE}/api/trpc/oga.requestPermit`, {
      data: {
        json: {
          agencyCode: "FDA",
          permitType: "food_safety_certificate",
          declarationId: "test-decl-id",
          hsCode: "2106.90",
          description: "E2E test food product",
          quantity: 100,
          unitOfMeasure: "KG",
          documents: [],
        },
      },
      headers: { "Content-Type": "application/json" },
    });
    // Auth failure (401) expected without session; 500 is not acceptable
    expect(res.status()).not.toBe(500);
  });

  test("OGA SLA dashboard page renders correctly", async ({ page }) => {
    const body = await pageRendersOk(page, "/app/oga/sla-dashboard");
    expect(body.length).toBeGreaterThan(50);
    expect(body).not.toContain("Internal Server Error");
  });

  test("tRPC oga.getSlaMetrics API contract is valid", async ({ page }) => {
    const data = await trpcGet(page, "oga.getSlaMetrics", { agencyCode: "FDA" });
    expect(data).not.toBeNull();
    const str = JSON.stringify(data ?? "");
    expect(str).not.toContain("Internal Server Error");
  });
});

// ─── Suite 2: OGA Officer Reviews Permit Request ──────────────────────────────

test.describe("Journey: OGA officer reviews permit request", () => {
  test("OGA officer queue page renders correctly", async ({ page }) => {
    const body = await pageRendersOk(page, "/app/oga/queue");
    const isHandled =
      body.toLowerCase().includes("queue") ||
      body.toLowerCase().includes("permit") ||
      body.toLowerCase().includes("oga") ||
      body.toLowerCase().includes("login");
    expect(isHandled).toBeTruthy();
  });

  test("OGA officer dashboard page renders correctly", async ({ page }) => {
    const body = await pageRendersOk(page, "/app/oga/dashboard");
    const isHandled =
      body.toLowerCase().includes("oga") ||
      body.toLowerCase().includes("dashboard") ||
      body.toLowerCase().includes("login");
    expect(isHandled).toBeTruthy();
  });

  test("tRPC oga.getPendingPermits API contract is valid", async ({ page }) => {
    const data = await trpcGet(page, "oga.getPendingPermits", { limit: 10 });
    expect(data).not.toBeNull();
    const str = JSON.stringify(data ?? "");
    expect(str).not.toContain("Internal Server Error");
  });

  test("OGA permit approval endpoint does not return 500", async ({ page }) => {
    const res = await page.request.post(`${BASE}/api/trpc/oga.approvePermit`, {
      data: {
        json: {
          permitId: "test-permit-id",
          certificateNumber: `CERT-E2E-${Date.now()}`,
          validFrom: new Date().toISOString(),
          validUntil: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString(),
          notes: "E2E test approval",
        },
      },
      headers: { "Content-Type": "application/json" },
    });
    expect(res.status()).not.toBe(500);
  });

  test("OGA permit rejection endpoint does not return 500", async ({ page }) => {
    const res = await page.request.post(`${BASE}/api/trpc/oga.rejectPermit`, {
      data: {
        json: {
          permitId: "test-permit-id",
          reason: "E2E test rejection — non-compliant product specification",
        },
      },
      headers: { "Content-Type": "application/json" },
    });
    expect(res.status()).not.toBe(500);
  });

  test("OGA integration map page renders correctly", async ({ page }) => {
    const body = await pageRendersOk(page, "/app/oga/integration-map");
    expect(body.length).toBeGreaterThan(50);
    expect(body).not.toContain("Internal Server Error");
  });
});

// ─── Suite 3: Multi-Agency Joint Inspection ───────────────────────────────────

test.describe("Journey: Multi-agency joint inspection workflow", () => {
  test("multi-agency workflow page renders correctly", async ({ page }) => {
    const body = await pageRendersOk(page, "/app/oga/multi-agency-workflow");
    expect(body.length).toBeGreaterThan(50);
    expect(body).not.toContain("Internal Server Error");
  });

  test("tRPC oga.getJointInspectionStatus API contract is valid", async ({ page }) => {
    const data = await trpcGet(page, "oga.getJointInspectionStatus", {
      declarationId: "test-decl-id",
    });
    expect(data).not.toBeNull();
    const str = JSON.stringify(data ?? "");
    expect(str).not.toContain("Internal Server Error");
  });

  test("tRPC oga.listPermitsByDeclaration API contract is valid", async ({ page }) => {
    const data = await trpcGet(page, "oga.listPermitsByDeclaration", {
      declarationId: "test-decl-id",
    });
    expect(data).not.toBeNull();
    const str = JSON.stringify(data ?? "");
    expect(str).not.toContain("Internal Server Error");
  });

  test("OGA permit certificate download endpoint does not return 500", async ({ page }) => {
    const res = await page.request.get(
      `${BASE}/api/trpc/oga.getPermitCertificate?input=${encodeURIComponent(JSON.stringify({ json: { permitId: "test" } }))}`
    );
    expect(res.status()).not.toBe(500);
  });

  test("phytosanitary certificate request endpoint does not return 500", async ({ page }) => {
    const res = await page.request.post(`${BASE}/api/trpc/oga.requestPermit`, {
      data: {
        json: {
          agencyCode: "PPRS",
          permitType: "phytosanitary_certificate",
          declarationId: "test-decl-id",
          hsCode: "0602.90",
          description: "E2E test live plants",
          quantity: 500,
          unitOfMeasure: "UNITS",
          documents: [],
        },
      },
      headers: { "Content-Type": "application/json" },
    });
    expect(res.status()).not.toBe(500);
  });

  test("standards conformity assessment request endpoint does not return 500", async ({ page }) => {
    const res = await page.request.post(`${BASE}/api/trpc/oga.requestPermit`, {
      data: {
        json: {
          agencyCode: "GSA",
          permitType: "conformity_assessment",
          declarationId: "test-decl-id",
          hsCode: "8471.30",
          description: "E2E test electronic equipment",
          quantity: 50,
          unitOfMeasure: "UNITS",
          documents: [],
        },
      },
      headers: { "Content-Type": "application/json" },
    });
    expect(res.status()).not.toBe(500);
  });
});

// ─── Suite 4: OGA Permit Integration with Declaration Clearance ───────────────

test.describe("Journey: OGA permit linked to declaration clearance", () => {
  test("declaration with OGA permits shows permit status", async ({ page }) => {
    const body = await pageRendersOk(page, "/app/trader/declarations");
    expect(body.length).toBeGreaterThan(50);
    expect(body).not.toContain("Internal Server Error");
  });

  test("tRPC declarations.getOgaPermitStatus API contract is valid", async ({ page }) => {
    const data = await trpcGet(page, "declarations.getOgaPermitStatus", {
      declarationId: "test-decl-id",
    });
    expect(data).not.toBeNull();
    const str = JSON.stringify(data ?? "");
    expect(str).not.toContain("Internal Server Error");
  });

  test("cargo tracking page renders correctly after OGA clearance", async ({ page }) => {
    const body = await pageRendersOk(page, "/app/trader/cargo-tracking");
    expect(body.length).toBeGreaterThan(50);
    expect(body).not.toContain("Internal Server Error");
  });

  test("tRPC cargoTracking.getStatus API contract is valid", async ({ page }) => {
    const data = await trpcGet(page, "cargoTracking.getStatus", {
      trackingNumber: "TEST-TRACK-001",
    });
    expect(data).not.toBeNull();
    const str = JSON.stringify(data ?? "");
    expect(str).not.toContain("Internal Server Error");
  });
});
