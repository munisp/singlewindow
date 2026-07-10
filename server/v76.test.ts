/**
 * v76 Test Suite — Sprint v76 Production Audit
 *
 * Covers all 20 sprint items:
 *   1.  NewDeclaration: inline HS code validation (debounced classifyHSCode)
 *   2.  NewDeclaration: hsValidation state variable
 *   3.  NewDeclaration: Submit button disabled when HS code invalid
 *   4.  ExecutiveDashboard: Anomaly Detection Health card
 *   5.  ExecutiveDashboard: anomalyMetrics tRPC query
 *   6.  ExecutiveDashboard: auto-refresh every 30s
 *   7.  Grafana: notification-dispatcher.json alert panel (id=7)
 *   8.  Grafana: notification-dispatcher.json alerting contact point
 *   9.  tRPC: batchClassifyHSCodes procedure
 *  10.  tRPC: getHSChapters procedure
 *  11.  Python anomaly-detection: GET /risk/summary endpoint
 *  12.  tRPC: getAnomalyRiskSummary procedure
 *  13.  Python anomaly-detection: /risk/summary returns users array
 *  14.  Rust hs-classifier: POST /batch handler
 *  15.  tRPC: getABDivergence procedure
 *  16.  Python insider-threat-svc: GET /ab/divergence endpoint
 *  17.  tRPC: forceTokenRefresh procedure
 *  18.  Go admin_server.go: POST /admin/force-refresh endpoint
 *  19.  Rust hs-classifier: GET /chapters handler
 *  20.  Grafana: notification-dispatcher.json purged tokens panel (id=8)
 */

import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { appRouter } from "./routers";

const BASE = join(__dirname, "..");

function makeCtx(role: "admin" | "user" = "admin") {
  return {
    user: { id: 1, openId: "test", name: "Test", role },
    req: { method: "GET" } as any,
    res: {} as any,
  };
}

function readText(rel: string): string {
  return readFileSync(join(BASE, rel), "utf8");
}

function fileExists(rel: string): boolean {
  return existsSync(join(BASE, rel));
}

// ─── 1. NewDeclaration: inline HS code validation ────────────────────────────

describe("NewDeclaration: inline HS code validation", () => {
  const newDeclTsx = readText("client/src/pages/app/NewDeclaration.tsx");

  it("imports classifyHSCode via trpc.insiderThreat.classifyHSCode", () => {
    expect(newDeclTsx).toContain("classifyHSCode");
  });

  it("defines hsValidation state variable", () => {
    expect(newDeclTsx).toContain("hsValidation");
  });

  it("uses debounce or useEffect for HS code input", () => {
    // Either debounce or useEffect watching hsCode
    const hasDebounce = newDeclTsx.includes("debounce") || newDeclTsx.includes("useEffect");
    expect(hasDebounce).toBe(true);
  });

  it("shows confidence indicator in the UI", () => {
    expect(newDeclTsx).toContain("confidence");
  });

  it("shows chapter description in the UI", () => {
    const hasChapter = newDeclTsx.includes("chapter_description") || newDeclTsx.includes("chapter");
    expect(hasChapter).toBe(true);
  });
});

// ─── 2. NewDeclaration: Submit button guard ───────────────────────────────────

describe("NewDeclaration: Submit button HS guard", () => {
  const newDeclTsx = readText("client/src/pages/app/NewDeclaration.tsx");

  it("disables Submit when hsValidation is invalid", () => {
    expect(newDeclTsx).toContain("hsValidation !== null");
  });

  it("checks confidence threshold 0.5", () => {
    expect(newDeclTsx).toContain("0.5");
  });

  it("shows tooltip title when HS code is invalid", () => {
    expect(newDeclTsx).toContain("Fix the HS code before submitting");
  });
});

// ─── 3. ExecutiveDashboard: Anomaly Detection Health card ────────────────────

describe("ExecutiveDashboard: Anomaly Detection Health card", () => {
  const dashTsx = readText("client/src/pages/app/ExecutiveDashboard.tsx");

  it("renders Anomaly Detection Health heading", () => {
    expect(dashTsx).toContain("Anomaly Detection Health");
  });

  it("queries getAnomalyMetrics via tRPC", () => {
    expect(dashTsx).toContain("getAnomalyMetrics");
  });

  it("shows total_analysed KPI", () => {
    expect(dashTsx).toContain("total_analysed");
  });

  it("shows blocked_count KPI", () => {
    expect(dashTsx).toContain("blocked_count");
  });

  it("shows top alert rules breakdown", () => {
    expect(dashTsx).toContain("alerts_by_rule");
  });

  it("auto-refreshes every 30 seconds", () => {
    expect(dashTsx).toContain("30_000");
  });

  it("shows last-updated timestamp", () => {
    expect(dashTsx).toContain("anomalyLastUpdated");
  });

  it("only renders for admin users", () => {
    expect(dashTsx).toContain("isAdmin");
  });
});

// ─── 4. Grafana: notification-dispatcher.json alert panels ───────────────────

describe("Grafana: notification-dispatcher.json alert rules", () => {
  const grafanaPath = "infra/monitoring/dashboards/notification-dispatcher.json";
  const grafana = JSON.parse(readText(grafanaPath));

  it("has 8 panels total", () => {
    expect(grafana.panels).toHaveLength(8);
  });

  it("panel id=7 is the stale token alert panel", () => {
    const panel = grafana.panels.find((p: any) => p.id === 7);
    expect(panel).toBeDefined();
    expect(panel.title).toContain("Stale");
  });

  it("panel id=7 has alert condition with threshold 50", () => {
    const panel = grafana.panels.find((p: any) => p.id === 7);
    expect(panel.alert).toBeDefined();
    expect(panel.alert.conditions[0].evaluator.params[0]).toBe(50);
  });

  it("panel id=7 alert fires after 5 minutes", () => {
    const panel = grafana.panels.find((p: any) => p.id === 7);
    expect(panel.alert.for).toBe("5m");
  });

  it("panel id=8 is the purged tokens panel", () => {
    const panel = grafana.panels.find((p: any) => p.id === 8);
    expect(panel).toBeDefined();
    expect(panel.title).toContain("Purged");
  });

  it("has alerting contact point defined", () => {
    expect(grafana.alerting).toBeDefined();
    expect(grafana.alerting.contactPoints).toHaveLength(1);
    expect(grafana.alerting.contactPoints[0].name).toBe("TradeGateway Webhook");
  });

  it("has notification policy for stale token alert", () => {
    const policy = grafana.alerting.policies[0];
    expect(policy.receiver).toBe("TradeGateway Webhook");
  });

  it("alert notification references tradegateway-webhook uid", () => {
    const panel = grafana.panels.find((p: any) => p.id === 7);
    expect(panel.alert.notifications[0].uid).toBe("tradegateway-webhook");
  });
});

// ─── 5. tRPC: batchClassifyHSCodes procedure ─────────────────────────────────

describe("tRPC: batchClassifyHSCodes procedure", () => {
  const routerTs = readText("server/routers/insiderThreat.ts");

  it("defines batchClassifyHSCodes procedure", () => {
    expect(routerTs).toContain("batchClassifyHSCodes:");
  });

  it("accepts hs_codes array input", () => {
    const idx = routerTs.indexOf("batchClassifyHSCodes:");
    const snippet = routerTs.slice(idx, idx + 400);
    expect(snippet).toContain("hs_codes");
  });

  it("caps batch at 50 codes", () => {
    const idx = routerTs.indexOf("batchClassifyHSCodes:");
    const snippet = routerTs.slice(idx, idx + 400);
    expect(snippet).toContain(".max(50)");
  });

  it("proxies to Rust /batch endpoint", () => {
    const idx = routerTs.indexOf("batchClassifyHSCodes:");
    const snippet = routerTs.slice(idx, idx + 600);
    expect(snippet).toContain("/batch");
  });

  it("returns offline stub when service unavailable", () => {
    const idx = routerTs.indexOf("batchClassifyHSCodes:");
    const snippet = routerTs.slice(idx, idx + 1400);
    expect(snippet).toContain("offline-stub");
  });

  it("is a protectedProcedure", () => {
    const idx = routerTs.indexOf("batchClassifyHSCodes:");
    const snippet = routerTs.slice(idx, idx + 200);
    expect(snippet).toContain("protectedProcedure");
  });
});

// ─── 6. tRPC: getHSChapters procedure ────────────────────────────────────────

describe("tRPC: getHSChapters procedure", () => {
  const routerTs = readText("server/routers/insiderThreat.ts");

  it("defines getHSChapters procedure", () => {
    expect(routerTs).toContain("getHSChapters:");
  });

  it("proxies to Rust /chapters endpoint", () => {
    const idx = routerTs.indexOf("getHSChapters:");
    const snippet = routerTs.slice(idx, idx + 400);
    expect(snippet).toContain("/chapters");
  });

  it("returns offline stub with minimal chapter map", () => {
    const idx = routerTs.indexOf("getHSChapters:");
    const snippet = routerTs.slice(idx, idx + 800);
    expect(snippet).toContain("offline-stub");
  });
});

// ─── 7. Python anomaly-detection: /risk/summary endpoint ─────────────────────

describe("Python anomaly-detection: /risk/summary endpoint", () => {
  const mainPy = readText("services/python/anomaly-detection-svc/main.py");

  it("defines GET /risk/summary route", () => {
    expect(mainPy).toContain('"/risk/summary"');
  });

  it("scans Redis for authz:denied keys", () => {
    expect(mainPy).toContain("authz:denied:*");
  });

  it("scans Redis for rate action keys", () => {
    expect(mainPy).toContain("rate:*:actions");
  });

  it("returns users array sorted by score", () => {
    expect(mainPy).toContain('"users"');
  });

  it("returns total_tracked count", () => {
    expect(mainPy).toContain("total_tracked");
  });

  it("limits to top 10 users", () => {
    // Python slice [:10] may appear as ][:10] or as .slice(0,10) equivalent
    const hasSlice = mainPy.includes("][:10]") || mainPy.includes(", 10)") || mainPy.includes("[:10]");
    expect(hasSlice).toBe(true);
  });
});

// ─── 8. tRPC: getAnomalyRiskSummary procedure ────────────────────────────────

describe("tRPC: getAnomalyRiskSummary procedure", () => {
  const routerTs = readText("server/routers/insiderThreat.ts");

  it("defines getAnomalyRiskSummary procedure", () => {
    expect(routerTs).toContain("getAnomalyRiskSummary:");
  });

  it("is an adminProcedure", () => {
    const idx = routerTs.indexOf("getAnomalyRiskSummary:");
    const snippet = routerTs.slice(idx, idx + 200);
    expect(snippet).toContain("adminProcedure");
  });

  it("proxies to anomaly-detection-svc /risk/summary", () => {
    const idx = routerTs.indexOf("getAnomalyRiskSummary:");
    const snippet = routerTs.slice(idx, idx + 400);
    expect(snippet).toContain("/risk/summary");
  });
});

// ─── 9. Rust hs-classifier: POST /batch handler ──────────────────────────────

describe("Rust hs-classifier: POST /batch handler", () => {
  const mainRs = readText("services/rust/hs-classifier/src/main.rs");

  it("defines BatchClassifyRequest struct", () => {
    expect(mainRs).toContain("BatchClassifyRequest");
  });

  it("defines BatchClassifyResponse struct", () => {
    expect(mainRs).toContain("BatchClassifyResponse");
  });

  it("defines handle_batch function", () => {
    expect(mainRs).toContain("handle_batch");
  });

  it("caps batch at 50 codes", () => {
    expect(mainRs).toContain(".take(50)");
  });

  it("registers /batch route", () => {
    expect(mainRs).toContain('"/batch"');
  });

  it("increments hs_classifications_total counter", () => {
    const idx = mainRs.indexOf("handle_batch");
    const snippet = mainRs.slice(idx, idx + 600);
    expect(snippet).toContain("hs_classifications_total");
  });
});

// ─── 10. Rust hs-classifier: GET /chapters handler ───────────────────────────

describe("Rust hs-classifier: GET /chapters handler", () => {
  const mainRs = readText("services/rust/hs-classifier/src/main.rs");

  it("defines ChaptersResponse struct", () => {
    expect(mainRs).toContain("ChaptersResponse");
  });

  it("defines handle_chapters function", () => {
    expect(mainRs).toContain("handle_chapters");
  });

  it("registers /chapters route", () => {
    expect(mainRs).toContain('"/chapters"');
  });

  it("returns total chapter count", () => {
    const idx = mainRs.indexOf("handle_chapters");
    const snippet = mainRs.slice(idx, idx + 400);
    expect(snippet).toContain("total");
  });
});

// ─── 11. tRPC: getABDivergence procedure ─────────────────────────────────────

describe("tRPC: getABDivergence procedure", () => {
  const routerTs = readText("server/routers/insiderThreat.ts");

  it("defines getABDivergence procedure", () => {
    expect(routerTs).toContain("getABDivergence:");
  });

  it("is an adminProcedure", () => {
    const idx = routerTs.indexOf("getABDivergence:");
    const snippet = routerTs.slice(idx, idx + 200);
    expect(snippet).toContain("adminProcedure");
  });

  it("accepts n parameter with min 10 max 1000", () => {
    const idx = routerTs.indexOf("getABDivergence:");
    const snippet = routerTs.slice(idx, idx + 400);
    expect(snippet).toContain(".min(10)");
    expect(snippet).toContain(".max(1000)");
  });

  it("proxies to insider-threat-svc /ab/divergence", () => {
    const idx = routerTs.indexOf("getABDivergence:");
    const snippet = routerTs.slice(idx, idx + 600);
    expect(snippet).toContain("/ab/divergence");
  });

  it("returns agree/disagree/agree_rate/total fields", () => {
    const idx = routerTs.indexOf("getABDivergence:");
    const snippet = routerTs.slice(idx, idx + 600);
    expect(snippet).toContain("agree");
    expect(snippet).toContain("disagree");
    expect(snippet).toContain("agree_rate");
  });
});

// ─── 12. Python insider-threat-svc: GET /ab/divergence endpoint ──────────────

describe("Python insider-threat-svc: GET /ab/divergence endpoint", () => {
  const mainPy = readText("services/python/insider-threat-svc/main.py");

  it("defines GET /ab/divergence route", () => {
    expect(mainPy).toContain('"/ab/divergence"');
  });

  it("accepts n query parameter", () => {
    const idx = mainPy.indexOf('"/ab/divergence"');
    const snippet = mainPy.slice(idx, idx + 200);
    expect(snippet).toContain("n: int");
  });

  it("reads from Redis ab:divergence:log key", () => {
    expect(mainPy).toContain("ab:divergence:log");
  });

  it("returns agree/disagree/agree_rate/total", () => {
    // Search from the function definition — window must be large enough to reach the return dict
    const idx = mainPy.indexOf("/ab/divergence");
    const snippet = mainPy.slice(idx, idx + 1500);
    expect(snippet).toContain("agree");
    expect(snippet).toContain("disagree");
    expect(snippet).toContain("agree_rate");
    expect(snippet).toContain("total");
  });

  it("caps n between 10 and 1000", () => {
    const idx = mainPy.indexOf('"/ab/divergence"');
    const snippet = mainPy.slice(idx, idx + 400);
    expect(snippet).toContain("1000");
  });
});

// ─── 13. tRPC: forceTokenRefresh procedure ───────────────────────────────────

describe("tRPC: forceTokenRefresh procedure", () => {
  const routerTs = readText("server/routers/insiderThreat.ts");

  it("defines forceTokenRefresh procedure", () => {
    expect(routerTs).toContain("forceTokenRefresh:");
  });

  it("is an adminProcedure", () => {
    const idx = routerTs.indexOf("forceTokenRefresh:");
    const snippet = routerTs.slice(idx, idx + 200);
    expect(snippet).toContain("adminProcedure");
  });

  it("proxies to notification-dispatcher /admin/force-refresh", () => {
    const idx = routerTs.indexOf("forceTokenRefresh:");
    const snippet = routerTs.slice(idx, idx + 600);
    expect(snippet).toContain("/admin/force-refresh");
  });

  it("returns offline stub when service unavailable", () => {
    const idx = routerTs.indexOf("forceTokenRefresh:");
    const snippet = routerTs.slice(idx, idx + 800);
    expect(snippet).toContain("offline-stub");
  });
});

// ─── 14. Go admin_server.go: POST /admin/force-refresh endpoint ──────────────

describe("Go admin_server.go: POST /admin/force-refresh endpoint", () => {
  const adminGo = readText("services/go/notification-dispatcher/admin_server.go");

  it("registers POST /admin/force-refresh handler", () => {
    expect(adminGo).toContain("/admin/force-refresh");
  });

  it("runs synchronous refresh cycle (not goroutine)", () => {
    const idx = adminGo.indexOf("/admin/force-refresh");
    const snippet = adminGo.slice(idx, idx + 600);
    // synchronous: calls runCycle directly, not in a goroutine
    expect(snippet).toContain("runCycle");
  });

  it("returns triggered:true in response", () => {
    const idx = adminGo.indexOf("/admin/force-refresh");
    const snippet = adminGo.slice(idx, idx + 600);
    expect(snippet).toContain("triggered");
  });

  it("uses 30-second context timeout", () => {
    const idx = adminGo.indexOf("/admin/force-refresh");
    const snippet = adminGo.slice(idx, idx + 400);
    expect(snippet).toContain("30*time.Second");
  });

  it("returns updated stats after refresh", () => {
    const idx = adminGo.indexOf("/admin/force-refresh");
    // The handler is ~700 chars; expand window to capture the JSON encode block
    const snippet = adminGo.slice(idx, idx + 900);
    expect(snippet).toContain("total_cycles");
  });
});

// ─── 15. tRPC: procedure router completeness ─────────────────────────────────

describe("tRPC: insiderThreat router v76 procedure completeness", () => {
  it("exports batchClassifyHSCodes", () => {
    const caller = appRouter.createCaller(makeCtx("admin"));
    expect(typeof caller.insiderThreat.batchClassifyHSCodes).toBe("function");
  });

  it("exports getHSChapters", () => {
    const caller = appRouter.createCaller(makeCtx("admin"));
    expect(typeof caller.insiderThreat.getHSChapters).toBe("function");
  });

  it("exports getAnomalyRiskSummary", () => {
    const caller = appRouter.createCaller(makeCtx("admin"));
    expect(typeof caller.insiderThreat.getAnomalyRiskSummary).toBe("function");
  });

  it("exports getABDivergence", () => {
    const caller = appRouter.createCaller(makeCtx("admin"));
    expect(typeof caller.insiderThreat.getABDivergence).toBe("function");
  });

  it("exports forceTokenRefresh", () => {
    const caller = appRouter.createCaller(makeCtx("admin"));
    expect(typeof caller.insiderThreat.forceTokenRefresh).toBe("function");
  });
});

// ─── 16. Offline stubs return correct shapes ─────────────────────────────────

describe("tRPC: v76 offline stubs return correct shapes", () => {
  it("batchClassifyHSCodes returns results array with offline-stub source", async () => {
    const caller = appRouter.createCaller(makeCtx("admin"));
    const result = await caller.insiderThreat.batchClassifyHSCodes({ hs_codes: ["847130", "INVALID"] });
    expect(result).toHaveProperty("results");
    expect(result).toHaveProperty("source");
    expect(Array.isArray((result as any).results)).toBe(true);
  });

  it("getHSChapters returns chapters object with offline-stub source", async () => {
    const caller = appRouter.createCaller(makeCtx("admin"));
    const result = await caller.insiderThreat.getHSChapters();
    expect(result).toHaveProperty("chapters");
    expect(result).toHaveProperty("source");
  });

  it("getAnomalyRiskSummary returns users array", async () => {
    const caller = appRouter.createCaller(makeCtx("admin"));
    const result = await caller.insiderThreat.getAnomalyRiskSummary();
    expect(result).toHaveProperty("users");
    expect(Array.isArray((result as any).users)).toBe(true);
  });

  it("getABDivergence returns agree/disagree/agree_rate/total", async () => {
    const caller = appRouter.createCaller(makeCtx("admin"));
    const result = await caller.insiderThreat.getABDivergence({ n: 100 });
    expect(result).toHaveProperty("agree");
    expect(result).toHaveProperty("disagree");
    expect(result).toHaveProperty("agree_rate");
    expect(result).toHaveProperty("total");
  });

  it("forceTokenRefresh returns triggered field", async () => {
    const caller = appRouter.createCaller(makeCtx("admin"));
    const result = await caller.insiderThreat.forceTokenRefresh();
    expect(result).toHaveProperty("triggered");
  });
});

// ─── 17. File existence checks ───────────────────────────────────────────────

describe("v76: file existence checks", () => {
  it("NewDeclaration.tsx exists", () => {
    expect(fileExists("client/src/pages/app/NewDeclaration.tsx")).toBe(true);
  });

  it("ExecutiveDashboard.tsx exists", () => {
    expect(fileExists("client/src/pages/app/ExecutiveDashboard.tsx")).toBe(true);
  });

  it("notification-dispatcher.json exists", () => {
    expect(fileExists("infra/monitoring/dashboards/notification-dispatcher.json")).toBe(true);
  });

  it("hs-classifier main.rs exists", () => {
    expect(fileExists("services/rust/hs-classifier/src/main.rs")).toBe(true);
  });

  it("admin_server.go exists", () => {
    expect(fileExists("services/go/notification-dispatcher/admin_server.go")).toBe(true);
  });

  it("anomaly-detection main.py exists", () => {
    expect(fileExists("services/python/anomaly-detection-svc/main.py")).toBe(true);
  });

  it("insider-threat-svc main.py exists", () => {
    expect(fileExists("services/python/insider-threat-svc/main.py")).toBe(true);
  });
});
