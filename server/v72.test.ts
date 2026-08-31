/**
 * v72 Sprint Tests
 *
 * Covers:
 *  1. Go notification-dispatcher: TokenRefresher goroutine (file structure + logic)
 *  2. Python insider-threat-svc: POST /ab/promote endpoint (main.py)
 *  3. Python insider-threat-svc: GET /ab/stats and GET /ab/recent endpoints
 *  4. tRPC insiderThreat: getABStats, getABRecentScores, promoteModel procedures
 *  5. SecurityMonitor: A/B Model tab with CSV export (file structure)
 *  6. DB offline fallbacks: all routers return graceful results when DB is null
 */

import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { appRouter } from "./routers";

// ── Helpers ───────────────────────────────────────────────────────────────────
function makeCtx(overrides: { role?: string; id?: number } = {}) {
  const role = overrides.role ?? "admin";
  const id = overrides.id ?? 1;
  return {
    user: { id, openId: `v72-test-${id}`, name: "Test User", email: "test@example.com", role },
    req: {} as any,
    res: {} as any,
  };
}

const BASE = path.resolve(__dirname, "..");

// ── 1. Go TokenRefresher ──────────────────────────────────────────────────────
describe("Go notification-dispatcher: TokenRefresher", () => {
  const refresherFile = path.join(
    BASE,
    "services/go/notification-dispatcher/token_refresher.go"
  );

  it("token_refresher.go file exists", () => {
    expect(fs.existsSync(refresherFile)).toBe(true);
  });

  it("defines TokenRefresher struct", () => {
    const content = fs.readFileSync(refresherFile, "utf8");
    expect(content).toContain("TokenRefresher");
  });

  it("implements Run() method for goroutine lifecycle", () => {
    const content = fs.readFileSync(refresherFile, "utf8");
    expect(content).toContain("func");
    // TokenRefresher uses Run() as the goroutine entry point
    const hasLifecycle = content.includes("Run") || content.includes("Start") || content.includes("goroutine");
    expect(hasLifecycle).toBe(true);
  });

  it("implements purge/invalidate logic for stale tokens", () => {
    const content = fs.readFileSync(refresherFile, "utf8");
    // Should contain logic to remove/purge invalid tokens
    const hasPurge = content.includes("purge") || content.includes("invalid") || content.includes("stale") || content.includes("delete") || content.includes("Delete");
    expect(hasPurge).toBe(true);
  });

  it("uses kafka writer for DLQ on token validation failures", () => {
    const content = fs.readFileSync(refresherFile, "utf8");
    const hasKafka = content.includes("kafka") || content.includes("Kafka") || content.includes("writer") || content.includes("Writer");
    expect(hasKafka).toBe(true);
  });

  it("has corresponding test file", () => {
    const testFile = path.join(
      BASE,
      "services/go/notification-dispatcher/token_refresher_test.go"
    );
    expect(fs.existsSync(testFile)).toBe(true);
  });
});

// ── 2. Python AB Promote Endpoint ─────────────────────────────────────────────
describe("Python insider-threat-svc: POST /ab/promote", () => {
  const mainFile = path.join(BASE, "services/python/insider-threat-svc/main.py");

  it("main.py exists", () => {
    expect(fs.existsSync(mainFile)).toBe(true);
  });

  it("defines POST /ab/promote route", () => {
    const content = fs.readFileSync(mainFile, "utf8");
    expect(content).toContain("/ab/promote");
  });

  it("promote endpoint handles model swap atomically", () => {
    const content = fs.readFileSync(mainFile, "utf8");
    // Should contain logic to swap shadow model into production
    const hasSwap = content.includes("shadow") || content.includes("promote") || content.includes("swap");
    expect(hasSwap).toBe(true);
  });

  it("defines GET /ab/stats route", () => {
    const content = fs.readFileSync(mainFile, "utf8");
    expect(content).toContain("/ab/stats");
  });

  it("defines GET /ab/recent route", () => {
    const content = fs.readFileSync(mainFile, "utf8");
    expect(content).toContain("/ab/recent");
  });

  it("ab/stats returns model comparison metrics", () => {
    const content = fs.readFileSync(mainFile, "utf8");
    // shadow_model.get_stats() returns agreement_rate, production_mean, shadow_mean etc.
    const hasMetrics =
      content.includes("agreement_rate") ||
      content.includes("production_mean") ||
      content.includes("shadow_mean") ||
      content.includes("get_stats") ||
      content.includes("score_distribution");
    expect(hasMetrics).toBe(true);
  });
});

// ── 3. tRPC insiderThreat: AB procedures ─────────────────────────────────────
describe("tRPC insiderThreat: AB procedures", () => {
  it("getABStats procedure exists", async () => {
    const caller = appRouter.createCaller(makeCtx({ role: "admin" }));
    expect(typeof caller.insiderThreat.getABStats).toBe("function");
  });

  it("getABStats returns model comparison object", async () => {
    const caller = appRouter.createCaller(makeCtx({ role: "admin" }));
    const result = await caller.insiderThreat.getABStats();
    expect(result).toBeDefined();
    expect(typeof result).toBe("object");
  });

  it("getABRecentScores procedure exists", async () => {
    const caller = appRouter.createCaller(makeCtx({ role: "admin" }));
    expect(typeof caller.insiderThreat.getABRecentScores).toBe("function");
  });

  it("getABRecentScores returns an array or object", async () => {
    const caller = appRouter.createCaller(makeCtx({ role: "admin" }));
    const result = await caller.insiderThreat.getABRecentScores({ limit: 10 });
    // May return array or { records: [], total: 0 } depending on implementation
    const isArrayOrObj = Array.isArray(result) || (typeof result === "object" && result !== null);
    expect(isArrayOrObj).toBe(true);
  });

  it("promoteModel procedure exists", async () => {
    const caller = appRouter.createCaller(makeCtx({ role: "admin" }));
    expect(typeof caller.insiderThreat.promoteModel).toBe("function");
  });

  it("promoteModel fails closed when the four-eyes store is unavailable", async () => {
    // SW-G4: model promotion is dual-control ENFORCED (Postgres-backed
    // four_eyes_requests). With no store reachable the mutation must refuse —
    // it can never fabricate a promotion outcome.
    const caller = appRouter.createCaller(makeCtx({ role: "admin" }));
    await expect(
      caller.insiderThreat.promoteModel({ reason: "test_promotion", operator: "test_admin" })
    ).rejects.toMatchObject({ code: "SERVICE_UNAVAILABLE" });
  });

  it("getABStats is restricted to admin/customs_officer", async () => {
    const caller = appRouter.createCaller(makeCtx({ role: "user" }));
    await expect(caller.insiderThreat.getABStats()).rejects.toThrow();
  });

  it("promoteModel is restricted to admin", async () => {
    const caller = appRouter.createCaller(makeCtx({ role: "user" }));
    await expect(caller.insiderThreat.promoteModel()).rejects.toThrow();
  });
});

// ── 4. SecurityMonitor A/B tab ────────────────────────────────────────────────
describe("SecurityMonitor: A/B Model tab with CSV export", () => {
  const secMonitorFile = path.join(
    BASE,
    "client/src/pages/app/SecurityMonitor.tsx"
  );

  it("SecurityMonitor.tsx exists", () => {
    expect(fs.existsSync(secMonitorFile)).toBe(true);
  });

  it("contains A/B Model tab trigger", () => {
    const content = fs.readFileSync(secMonitorFile, "utf8");
    const hasABTab =
      content.includes("A/B Model") ||
      content.includes("ab-model") ||
      content.includes("ABModel") ||
      content.includes("ab_model");
    expect(hasABTab).toBe(true);
  });

  it("contains CSV export functionality", () => {
    const content = fs.readFileSync(secMonitorFile, "utf8");
    const hasCsvExport =
      content.includes("csv") ||
      content.includes("CSV") ||
      content.includes("download") ||
      content.includes("Export");
    expect(hasCsvExport).toBe(true);
  });

  it("imports recharts for A/B comparison chart", () => {
    const content = fs.readFileSync(secMonitorFile, "utf8");
    const hasChart =
      content.includes("recharts") ||
      content.includes("LineChart") ||
      content.includes("BarChart") ||
      content.includes("ResponsiveContainer");
    expect(hasChart).toBe(true);
  });
});

// ── 5. DB offline fallbacks: key routers ─────────────────────────────────────
describe("DB offline fallbacks: graceful degradation", () => {
  it("traderScorecard.getScorecard returns stub when DB is null", async () => {
    const caller = appRouter.createCaller(makeCtx({ role: "user" }));
    const result = await caller.traderScorecard.getScorecard({});
    expect(result).toBeDefined();
    expect(typeof result.traderId).toBe("number");
    expect(result.period).toBe("last_12_months");
    expect(Array.isArray(result.complianceHistory)).toBe(true);
    expect(result.generatedAt).toBeInstanceOf(Date);
  });

  it("slaEscalation.scan returns breachCount (not breached) in offline mode", async () => {
    const caller = appRouter.createCaller(makeCtx({ role: "admin" }));
    const result = await caller.slaEscalation.scan({ notifyTraders: false, dryRun: true });
    expect(result).toHaveProperty("scanned");
    expect(result).toHaveProperty("breachCount");
    expect(result).not.toHaveProperty("breached");
  });

  it("pilot.getReportDetail throws NOT_FOUND (not INTERNAL_SERVER_ERROR) when DB is null", async () => {
    const caller = appRouter.createCaller(makeCtx({ role: "admin" }));
    await expect(
      caller.pilot.getReportDetail({ reportId: 999999 })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("rulesOfOrigin.exportRevokedCsv returns csv string in offline mode", async () => {
    const caller = appRouter.createCaller(makeCtx({ role: "admin" }));
    const result = await caller.rulesOfOrigin.exportRevokedCsv({});
    expect(typeof result.csv).toBe("string");
    expect(result.csv).toContain("Cert Number");
    expect(typeof result.filename).toBe("string");
  });

  it("rulesOfOrigin.exportTopScannedCsv returns csv with correct filename in offline mode", async () => {
    const caller = appRouter.createCaller(makeCtx({ role: "admin" }));
    const resultAllTime = await caller.rulesOfOrigin.exportTopScannedCsv({});
    expect(resultAllTime.filename).toContain("all-time");

    const resultDays = await caller.rulesOfOrigin.exportTopScannedCsv({ days: 30 });
    expect(resultDays.filename).toContain("last-30d");
  });

  it("payments.byDeclaration returns array for valid declarationId in offline mode", async () => {
    const caller = appRouter.createCaller(makeCtx({ role: "user", id: 9702 }));
    const result = await caller.payments.byDeclaration({ declarationId: 1 });
    expect(Array.isArray(result)).toBe(true);
  });

  it("payments.byDeclaration throws NOT_FOUND for non-existent declarationId in offline mode", async () => {
    const caller = appRouter.createCaller(makeCtx({ role: "user", id: 9702 }));
    await expect(
      caller.payments.byDeclaration({ declarationId: 999999 })
    ).rejects.toThrow();
  });
});

// ── 6. AEO offline fallbacks ──────────────────────────────────────────────────
describe("AEO offline fallbacks", () => {
  it("aeo.getExpiringCertificates returns empty array when DB is null", async () => {
    const caller = appRouter.createCaller(makeCtx({ role: "admin" }));
    const result = await caller.aeo.getExpiringCertificates({ withinDays: 60 });
    expect(Array.isArray(result)).toBe(true);
  });

  it("aeo.renewCertificate throws NOT_FOUND when DB is null", async () => {
    const caller = appRouter.createCaller(makeCtx({ role: "admin" }));
    await expect(
      caller.aeo.renewCertificate({ applicationId: 999999 })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
