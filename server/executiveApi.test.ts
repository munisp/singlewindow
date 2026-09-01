/**
 * Phase 12 Mission C — executive REST surface tests.
 *
 * DB-free: verifies route registration (all seven contract paths plus the
 * mobile alias), fail-closed briefing behavior without signing keys, and the
 * SLA breach pagination cap.
 */
import { describe, it, expect, afterAll } from "vitest";
import express from "express";
import { registerExecutiveApiRoutes } from "./routes/executiveApi";
import { registerCrmMarketplaceApiRoutes } from "./routes/crmMarketplaceApi";
import { SLA_BREACH_MAX_PAGE } from "./executive/kpiPack";

function registeredPaths(app: express.Express): string[] {
  const stack = (app as any)._router?.stack ?? [];
  const paths: string[] = [];
  for (const layer of stack) {
    if (layer.route?.path) paths.push(`${Object.keys(layer.route.methods)[0]?.toUpperCase()} ${layer.route.path}`);
  }
  return paths;
}

describe("Mission C route registration", () => {
  it("exposes all executive/analytics/briefing contract paths", () => {
    const app = express();
    registerExecutiveApiRoutes(app);
    const paths = registeredPaths(app);
    for (const p of [
      "GET /v1/executive/kpi-summary",
      "GET /v1/executive/operational-kpis",
      "GET /v1/operational-kpis", // mobile alias
      "GET /v1/analytics/trade",
      "GET /v1/risk/model-metrics",
      "GET /v1/sla/breaches",
      "GET /v1/customs/summary",
      "GET /v1/briefings/weekly",
    ]) {
      expect(paths, p).toContain(p);
    }
  });

  it("exposes the CRM/marketplace contract paths (mobile case workflow)", () => {
    const app = express();
    registerCrmMarketplaceApiRoutes(app);
    const paths = registeredPaths(app);
    for (const p of [
      "GET /v1/stakeholders/search",
      "GET /v1/stakeholders/:id/360",
      "GET /v1/cases",
      "GET /v1/cases/:id",
      "POST /v1/cases/:id/transitions",
      "GET /v1/marketplace/usage/:keyId/invoice",
      "GET /v1/verification/certificates/:certNumber",
      "GET /v1/verification/declarations/:declarationNumber",
    ]) {
      expect(paths, p).toContain(p);
    }
  });
});

describe("weekly briefing fail-closed posture", () => {
  afterAll(() => {
    delete process.env.MARKETPLACE_SIGNING_PRIVATE_KEY;
    delete process.env.MARKETPLACE_SIGNING_PUBLIC_KEY;
  });

  it("refuses to issue an unsigned briefing when no signing key is configured", async () => {
    delete process.env.MARKETPLACE_SIGNING_PRIVATE_KEY;
    delete process.env.MARKETPLACE_SIGNING_PUBLIC_KEY;
    const { buildSignedWeeklyBriefing, BriefingSigningUnavailable } = await import("./executive/briefing");
    await expect(buildSignedWeeklyBriefing(7)).rejects.toThrow(BriefingSigningUnavailable);
  });
});

describe("SLA breach pagination", () => {
  it("caps the breach page size", () => {
    expect(SLA_BREACH_MAX_PAGE).toBeLessThanOrEqual(100);
  });
});
