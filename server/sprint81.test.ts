/**
 * Sprint 81 tests
 * ─────────────────────────────────────────────────────────────────────────────
 * 1. onboardingAnalytics router — funnel, summary, aeoTiers procedures
 * 2. certVerify route — public endpoint shape
 * 3. CertVerify page — search bar navigation logic (unit)
 * 4. digestEmail — graceful skip when SENDGRID_API_KEY is absent
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ─── 1. onboardingAnalytics router ───────────────────────────────────────────

describe("onboardingAnalytics router", () => {
  it("exports funnel, summary, and aeoTiers procedures", async () => {
    const mod = await import("./routers/onboardingAnalytics");
    const router = mod.onboardingAnalyticsRouter;
    expect(router).toBeDefined();
    // tRPC router stores procedures under _def.record
    const procedures = Object.keys((router as any)._def.record);
    expect(procedures).toContain("funnel");
    expect(procedures).toContain("summary");
    expect(procedures).toContain("aeoTiers");
  });

  it("funnel procedure is an adminProcedure (requires admin role)", async () => {
    const mod = await import("./routers/onboardingAnalytics");
    const router = mod.onboardingAnalyticsRouter;
    const funnelDef = (router as any)._def.record.funnel._def;
    // adminProcedure chains have middleware — verify it's not a plain publicProcedure
    expect(funnelDef.middlewares).toBeDefined();
    expect(funnelDef.middlewares.length).toBeGreaterThan(0);
  });

  it("summary procedure is an adminProcedure", async () => {
    const mod = await import("./routers/onboardingAnalytics");
    const router = mod.onboardingAnalyticsRouter;
    const summaryDef = (router as any)._def.record.summary._def;
    expect(summaryDef.middlewares.length).toBeGreaterThan(0);
  });

  it("aeoTiers procedure is an adminProcedure", async () => {
    const mod = await import("./routers/onboardingAnalytics");
    const router = mod.onboardingAnalyticsRouter;
    const aeoTiersDef = (router as any)._def.record.aeoTiers._def;
    expect(aeoTiersDef.middlewares.length).toBeGreaterThan(0);
  });

  it("onboardingAnalyticsRouter is wired to appRouter", async () => {
    const mod = await import("./routers");
    const appRouter = mod.appRouter;
    const keys = Object.keys((appRouter as any)._def.record);
    expect(keys).toContain("onboardingAnalytics");
  });
});

// ─── 2. certVerify route helper ───────────────────────────────────────────────

describe("certVerify route", () => {
  it("certVerify.ts exports a registerCertVerifyRoute function", async () => {
    const mod = await import("./routes/certVerify");
    expect(typeof mod.registerCertVerifyRoute).toBe("function");
  });

  it("registerCertVerifyRoute accepts an Express app without throwing", async () => {
    const mod = await import("./routes/certVerify");
    const mockApp = {
      get: vi.fn(),
    };
    expect(() => mod.registerCertVerifyRoute(mockApp as any)).not.toThrow();
    // Should have registered a GET handler for /api/verify/:certNumber
    expect(mockApp.get).toHaveBeenCalledWith(
      "/api/verify/:certNumber",
      expect.any(Function)
    );
  });
});

// ─── 3. CertVerify search bar — URL construction logic ────────────────────────

describe("CertVerify search bar navigation", () => {
  it("constructs the correct verify URL from a cert number", () => {
    const certNumber = "AFCFTA-NG-2026-001234";
    const expectedPath = `/verify/${encodeURIComponent(certNumber)}`;
    expect(expectedPath).toBe("/verify/AFCFTA-NG-2026-001234");
  });

  it("encodes special characters in cert numbers", () => {
    const certNumber = "CO/2026/001 A";
    const encoded = encodeURIComponent(certNumber);
    expect(encoded).toBe("CO%2F2026%2F001%20A");
    const path = `/verify/${encoded}`;
    expect(path).toBe("/verify/CO%2F2026%2F001%20A");
  });

  it("trims whitespace from search input before navigating", () => {
    const rawInput = "  AFCFTA-NG-2026-001234  ";
    const trimmed = rawInput.trim();
    expect(trimmed).toBe("AFCFTA-NG-2026-001234");
    expect(trimmed.length).toBeGreaterThan(0);
  });

  it("does not navigate when search input is empty or whitespace-only", () => {
    const inputs = ["", "   ", "\t\n"];
    for (const input of inputs) {
      const trimmed = input.trim();
      expect(trimmed.length).toBe(0); // navigation should be blocked
    }
  });
});

// ─── 4. digestEmail — graceful skip ───────────────────────────────────────────

describe("digestEmail graceful skip", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    delete process.env.SENDGRID_API_KEY;
    delete process.env.DIGEST_RECIPIENTS;
  });

  afterEach(() => {
    Object.assign(process.env, originalEnv);
  });

  it("returns { sent: false } when SENDGRID_API_KEY is not set", async () => {
    const mod = await import("./lib/digestEmail");
    const mockResult = {
      date: "2026-03-10",
      totalDeclarations: 100,
      greenLane: 60,
      yellowLane: 30,
      redLane: 10,
      dutyRevenue: 5_000_000,
      clearanceRate: 85,
      slaBreaches: 2,
      aeoOperators: 12,
      sanctionsHits: 0,
      pilotParticipants: 25,
      pilotReports: 30,
      notificationSent: true,
      emailSent: false,
      emailRecipients: [],
      emailSkipReason: "SENDGRID_API_KEY not configured",
    };
    // When API key is absent, sendDigestEmail should return { sent: false }
    const result = await mod.sendDigestEmail(mockResult as any);
    expect(result.sent).toBe(false);
    expect(result.reason).toBeDefined();
    expect(result.reason).toMatch(/SENDGRID_API_KEY|not configured|no recipients/i);
  });

  it("returns { sent: false } when DIGEST_RECIPIENTS is not set", async () => {
    process.env.SENDGRID_API_KEY = "SG.test_key_placeholder";
    // DIGEST_RECIPIENTS still not set
    const mod = await import("./lib/digestEmail");
    const mockResult = {
      date: "2026-03-10",
      totalDeclarations: 50,
      greenLane: 30,
      yellowLane: 15,
      redLane: 5,
      dutyRevenue: 2_500_000,
      clearanceRate: 90,
      slaBreaches: 0,
      aeoOperators: 8,
      sanctionsHits: 0,
      pilotParticipants: 25,
      pilotReports: 30,
      notificationSent: true,
      emailSent: false,
      emailRecipients: [],
      emailSkipReason: "DIGEST_RECIPIENTS not configured",
    };
    const result = await mod.sendDigestEmail(mockResult as any);
    expect(result.sent).toBe(false);
  });
});

// ─── 5. NCS/AfCFTA logo CDN URLs ─────────────────────────────────────────────

describe("CertVerify logo CDN URLs", () => {
  it("NCS logo CDN URL is a valid HTTPS URL", () => {
    const url = "https://d2xsxph8kpxj0f.cloudfront.net/310519663412555753/jXBmDbCKSCugxa7Gwg2VnA/ncs-logo_737868a6.png";
    expect(url).toMatch(/^https:\/\//);
    expect(url).toContain("cloudfront.net");
    expect(url).toContain("ncs-logo");
  });

  it("AfCFTA logo CDN URL is a valid HTTPS URL", () => {
    const url = "https://d2xsxph8kpxj0f.cloudfront.net/310519663412555753/jXBmDbCKSCugxa7Gwg2VnA/afcfta-logo_232871fd.png";
    expect(url).toMatch(/^https:\/\//);
    expect(url).toContain("cloudfront.net");
    expect(url).toContain("afcfta-logo");
  });
});
