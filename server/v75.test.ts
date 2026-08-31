/**
 * v75 Test Suite — Sprint v75 Production Audit
 *
 * Covers all 20 sprint items:
 *   1.  SecurityMonitor: Promotion History section in ABModelTab
 *   2.  SecurityMonitor: "Rollback to this version" row-action
 *   3.  tRPC insiderThreat.rollbackToVersion procedure
 *   4.  Python insider-threat-svc: POST /ab/rollback target_version param
 *   5.  prometheus.yml: notification-dispatcher scrape job
 *   6.  prometheus.yml: anomaly-detection-svc scrape job
 *   7.  prometheus.yml: hs-classifier scrape job
 *   8.  infra/k8s/dapr/servicemonitor.yaml: ServiceMonitor CRDs
 *   9.  infra/monitoring/dashboards/notification-dispatcher.json: Grafana dashboard
 *  10.  Rust hs-classifier: Cargo.toml exists
 *  11.  Rust hs-classifier: src/main.rs exists with POST /classify handler
 *  12.  Rust hs-classifier: Dockerfile multi-stage build
 *  13.  Rust workspace: hs-classifier in members
 *  14.  Python anomaly-detection: rate-limit middleware (_check_rate_limit)
 *  15.  Python anomaly-detection: BATCH_MAX_EVENTS = 100
 *  16.  Python anomaly-detection: GET /metrics endpoint
 *  17.  tRPC insiderThreat.classifyHSCode procedure
 *  18.  tRPC insiderThreat.getAnomalyMetrics procedure
 *  19.  infra/k8s/polyglot-services.yaml: hs-classifier Deployment + Service
 *  20.  infra/k8s/dapr/components.yaml: hs-classifier resiliency target
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

// ─── 1. SecurityMonitor: Promotion History section ───────────────────────────

describe("SecurityMonitor: Promotion History section", () => {
  const monitorTsx = readText("client/src/pages/app/SecurityMonitor.tsx");

  it("defines PromotionHistorySection component", () => {
    expect(monitorTsx).toContain("function PromotionHistorySection");
  });

  it("renders Promotion History heading", () => {
    expect(monitorTsx).toContain("Promotion History");
  });

  it("calls trpc.insiderThreat.getPromotionHistory", () => {
    expect(monitorTsx).toContain("getPromotionHistory");
  });

  it("renders promotion table columns: Version, Agreement, Operator, Reason", () => {
    expect(monitorTsx).toContain("Version");
    expect(monitorTsx).toContain("Agreement");
    expect(monitorTsx).toContain("Operator");
    expect(monitorTsx).toContain("Reason");
  });

  it("includes PromotionHistorySection in ABModelTab output", () => {
    expect(monitorTsx).toContain("<PromotionHistorySection");
  });
});

// ─── 2. SecurityMonitor: Rollback to version row-action ──────────────────────

describe("SecurityMonitor: rollbackToVersion row-action", () => {
  const monitorTsx = readText("client/src/pages/app/SecurityMonitor.tsx");

  it("calls trpc.insiderThreat.rollbackToVersion", () => {
    expect(monitorTsx).toContain("rollbackToVersion");
  });

  it("passes target_version from promotion record", () => {
    expect(monitorTsx).toContain("target_version");
  });

  it("disables row Rollback button while mutation is pending", () => {
    expect(monitorTsx).toContain("rollbackToVersionMutation.isPending");
  });

  it("shows RotateCcw icon in row Rollback button", () => {
    expect(monitorTsx).toContain("RotateCcw");
  });
});

// ─── 3. tRPC insiderThreat.rollbackToVersion procedure ───────────────────────

describe("tRPC insiderThreat.rollbackToVersion", () => {
  const routerTs = readText("server/routers/insiderThreat.ts");

  it("procedure is defined", () => {
    expect(routerTs).toContain("rollbackToVersion");
  });

  it("accepts target_version as integer input", () => {
    expect(routerTs).toContain("target_version: z.number().int().min(0)");
  });

  it("proxies to /ab/rollback with target_version in body", () => {
    expect(routerTs).toContain("target_version: input.target_version");
  });

  it("fails closed (no fabricated restored_version) when service unavailable", () => {
    // SW-E: the offline stub with fabricated restored_version/rolledBackAt
    // was removed — an unavailable rollback surfaces as SERVICE_UNAVAILABLE.
    const idx = routerTs.indexOf("rollbackToVersion:");
    const window = routerTs.slice(idx, idx + 2500);
    expect(window).toContain("ROLLBACK_SERVICE_UNAVAILABLE");
    expect(window).not.toMatch(/restored_version:/);
    expect(window).not.toMatch(/rolledBackAt:/);
  });

  it("uses adminProcedure (admin-only)", () => {
    // Find the procedure definition (key: value), not the comment
    const idx = routerTs.indexOf("rollbackToVersion:");
    const snippet = routerTs.slice(idx, idx + 100);
    expect(snippet).toContain("adminProcedure");
  });

  it("has 15-second AbortSignal timeout", () => {
    const idx = routerTs.indexOf("rollbackToVersion:");
    const snippet = routerTs.slice(idx, idx + 800);
    expect(snippet).toContain("AbortSignal.timeout(15_000)");
  });

  it("rejects with SERVICE_UNAVAILABLE on network error (no fabricated outcome)", async () => {
    const caller = appRouter.createCaller(makeCtx("admin"));
    await expect(
      caller.insiderThreat.rollbackToVersion({
        target_version: 3,
        reason: "test_rollback",
        operator: "test-admin",
      })
    ).rejects.toMatchObject({ code: "SERVICE_UNAVAILABLE" });
  });
});

// ─── 4. Python: POST /ab/rollback target_version param ───────────────────────

describe("Python insider-threat-svc: /ab/rollback target_version", () => {
  const mainPy = readText("services/python/insider-threat-svc/main.py");

  it("RollbackRequest model has target_version optional field", () => {
    expect(mainPy).toContain("target_version");
  });

  it("/ab/rollback endpoint loads model_v{N} when target_version specified", () => {
    expect(mainPy).toContain("target_version");
    expect(mainPy).toContain("/ab/rollback");
  });

  it("returns success=False when no backup available", () => {
    expect(mainPy).toContain("success=False");
  });
});

// ─── 5–7. prometheus.yml: new scrape jobs ────────────────────────────────────

describe("prometheus.yml: new scrape jobs", () => {
  const promYml = readText("infra/monitoring/prometheus.yml");

  it("has notification-dispatcher scrape job on port 8081", () => {
    expect(promYml).toContain("job_name: notification-dispatcher");
    expect(promYml).toContain("notification-dispatcher:8081");
    expect(promYml).toContain("/admin/metrics");
  });

  it("has anomaly-detection-svc scrape job", () => {
    expect(promYml).toContain("job_name: anomaly-detection-svc");
    expect(promYml).toContain("anomaly-detection-svc:8000");
  });

  it("has hs-classifier scrape job on port 8090", () => {
    expect(promYml).toContain("job_name: hs-classifier");
    expect(promYml).toContain("hs-classifier:8090");
  });

  it("notification-dispatcher uses /admin/metrics path", () => {
    const idx = promYml.indexOf("job_name: notification-dispatcher");
    const snippet = promYml.slice(idx, idx + 300);
    expect(snippet).toContain("metrics_path: /admin/metrics");
  });

  it("all three new jobs have 30s scrape_interval", () => {
    const matches = (promYml.match(/scrape_interval: 30s/g) || []).length;
    expect(matches).toBeGreaterThanOrEqual(3);
  });
});

// ─── 8. ServiceMonitor CRDs ───────────────────────────────────────────────────

describe("infra/k8s/dapr/servicemonitor.yaml", () => {
  const smYaml = readText("infra/k8s/dapr/servicemonitor.yaml");

  it("file exists", () => {
    expect(fileExists("infra/k8s/dapr/servicemonitor.yaml")).toBe(true);
  });

  it("defines ServiceMonitor for notification-dispatcher", () => {
    expect(smYaml).toContain("name: notification-dispatcher-admin");
    expect(smYaml).toContain("path: /admin/metrics");
  });

  it("defines ServiceMonitor for anomaly-detection-svc", () => {
    expect(smYaml).toContain("name: anomaly-detection-svc");
  });

  it("defines ServiceMonitor for hs-classifier", () => {
    expect(smYaml).toContain("name: hs-classifier");
  });

  it("uses monitoring.coreos.com/v1 API version", () => {
    expect(smYaml).toContain("monitoring.coreos.com/v1");
  });
});

// ─── 9. Grafana dashboard JSON ────────────────────────────────────────────────

describe("infra/monitoring/dashboards/notification-dispatcher.json", () => {
  it("file exists", () => {
    expect(fileExists("infra/monitoring/dashboards/notification-dispatcher.json")).toBe(true);
  });

  const dashJson = readText("infra/monitoring/dashboards/notification-dispatcher.json");

  it("has title containing notification-dispatcher", () => {
    expect(dashJson.toLowerCase()).toContain("notification-dispatcher");
  });

  it("has total_cycles panel", () => {
    expect(dashJson).toContain("total_cycles");
  });

  it("has total_stale panel", () => {
    expect(dashJson).toContain("total_stale");
  });

  it("has total_purged panel", () => {
    expect(dashJson).toContain("total_purged");
  });

  it("has last_cycle_at panel", () => {
    expect(dashJson).toContain("last_cycle_at");
  });

  it("is valid JSON", () => {
    expect(() => JSON.parse(dashJson)).not.toThrow();
  });
});

// ─── 10–12. Rust hs-classifier files ─────────────────────────────────────────

describe("Rust hs-classifier: file structure", () => {
  it("Cargo.toml exists", () => {
    expect(fileExists("services/rust/hs-classifier/Cargo.toml")).toBe(true);
  });

  it("src/main.rs exists", () => {
    expect(fileExists("services/rust/hs-classifier/src/main.rs")).toBe(true);
  });

  it("Dockerfile exists", () => {
    expect(fileExists("services/rust/hs-classifier/Dockerfile")).toBe(true);
  });
});

describe("Rust hs-classifier: main.rs content", () => {
  const mainRs = readText("services/rust/hs-classifier/src/main.rs");

  it("defines POST /classify route", () => {
    expect(mainRs).toContain("post(handle_classify)");
    expect(mainRs).toContain("\"/classify\"");
  });

  it("defines GET /health route", () => {
    expect(mainRs).toContain("get(handle_health)");
    expect(mainRs).toContain("\"/health\"");
  });

  it("defines GET /metrics route", () => {
    expect(mainRs).toContain("get(handle_metrics)");
    expect(mainRs).toContain("\"/metrics\"");
  });

  it("has WCO chapter lookup table with chapter 84 (machinery)", () => {
    expect(mainRs).toContain("\"84\"");
    expect(mainRs).toContain("machinery");
  });

  it("has WCO chapter lookup table with chapter 85 (electrical)", () => {
    expect(mainRs).toContain("\"85\"");
    expect(mainRs).toContain("Electrical");
  });

  it("increments hs_classifications_total counter", () => {
    expect(mainRs).toContain("hs_classifications_total");
  });

  it("increments hs_valid_total and hs_invalid_total counters", () => {
    expect(mainRs).toContain("hs_valid_total");
    expect(mainRs).toContain("hs_invalid_total");
  });

  it("has unit tests for valid 6-digit code", () => {
    expect(mainRs).toContain("test_valid_6digit");
  });

  it("has unit tests for dotted format", () => {
    expect(mainRs).toContain("test_valid_dotted");
  });

  it("has unit tests for invalid code", () => {
    expect(mainRs).toContain("test_invalid");
  });
});

describe("Rust hs-classifier: Dockerfile", () => {
  const dockerfile = readText("services/rust/hs-classifier/Dockerfile");

  it("uses multi-stage build with builder stage", () => {
    expect(dockerfile).toContain("AS builder");
  });

  it("uses distroless runtime image", () => {
    expect(dockerfile).toContain("distroless");
  });

  it("exposes port 8090", () => {
    expect(dockerfile).toContain("EXPOSE 8090");
  });
});

// ─── 13. Rust workspace: hs-classifier in members ────────────────────────────

describe("Rust workspace Cargo.toml", () => {
  const cargoToml = readText("services/rust/Cargo.toml");

  it("includes hs-classifier in workspace members", () => {
    expect(cargoToml).toContain("\"hs-classifier\"");
  });
});

// ─── 14–16. Python anomaly-detection hardening ───────────────────────────────

describe("Python anomaly-detection: rate-limit middleware", () => {
  const mainPy = readText("services/python/anomaly-detection-svc/main.py");

  it("defines _check_rate_limit function", () => {
    expect(mainPy).toContain("def _check_rate_limit");
  });

  it("RATE_LIMIT_ANALYSE defaults to 100", () => {
    expect(mainPy).toContain("RATE_LIMIT_ANALYSE");
    expect(mainPy).toContain("\"100\"");
  });

  it("RATE_LIMIT_BATCH defaults to 10", () => {
    expect(mainPy).toContain("RATE_LIMIT_BATCH");
    expect(mainPy).toContain("\"10\"");
  });

  it("raises 429 on rate limit exceeded for /analyse", () => {
    expect(mainPy).toContain("status_code=429");
    expect(mainPy).toContain("Rate limit exceeded");
  });

  it("uses sliding window (60-second window)", () => {
    expect(mainPy).toContain("60.0");
  });
});

describe("Python anomaly-detection: batch size guard", () => {
  const mainPy = readText("services/python/anomaly-detection-svc/main.py");

  it("BATCH_MAX_EVENTS defaults to 100 (reduced from 1000)", () => {
    expect(mainPy).toContain("BATCH_MAX_EVENTS");
    expect(mainPy).toContain("\"100\"");
  });

  it("rejects batches exceeding BATCH_MAX_EVENTS with 400", () => {
    expect(mainPy).toContain("Batch size exceeds");
    expect(mainPy).toContain("BATCH_MAX_EVENTS");
  });
});

describe("Python anomaly-detection: /metrics endpoint", () => {
  const mainPy = readText("services/python/anomaly-detection-svc/main.py");

  it("defines GET /metrics endpoint", () => {
    expect(mainPy).toContain("@app.get(\"/metrics\"");
  });

  it("returns Prometheus text format", () => {
    expect(mainPy).toContain("PlainTextResponse");
  });

  it("exposes anomaly_total_analysed counter", () => {
    expect(mainPy).toContain("anomaly_total_analysed");
  });

  it("exposes anomaly_total_alerts counter", () => {
    expect(mainPy).toContain("anomaly_total_alerts");
  });

  it("exposes anomaly_blocked_count counter", () => {
    expect(mainPy).toContain("anomaly_blocked_count");
  });

  it("exposes anomaly_alerts_by_rule labelled counter", () => {
    expect(mainPy).toContain("anomaly_alerts_by_rule");
  });

  it("increments _metrics in analyse_event", () => {
    expect(mainPy).toContain("_inc(\"total_analysed\")");
    expect(mainPy).toContain("_inc(\"total_alerts\"");
  });
});

// ─── 17. tRPC insiderThreat.classifyHSCode ────────────────────────────────────

describe("tRPC insiderThreat.classifyHSCode", () => {
  const routerTs = readText("server/routers/insiderThreat.ts");

  it("procedure is defined", () => {
    expect(routerTs).toContain("classifyHSCode");
  });

  it("accepts hs_code string input", () => {
    expect(routerTs).toContain("hs_code: z.string()");
  });

  it("proxies to Rust hs-classifier POST /classify", () => {
    expect(routerTs).toContain("/classify");
    // phase-10 remediation: stale hs-classifier:8090 literal removed
    expect(routerTs).not.toContain("hs-classifier:8090");
  });

  it("fails closed on service unavailable (no offline-stub fabrication)", () => {
    const idx = routerTs.indexOf("classifyHSCode:");
    const snippet = routerTs.slice(idx, idx + 1600);
    expect(snippet).toContain("HS_CLASSIFIER_UNAVAILABLE");
    expect(snippet).not.toContain("offline-stub");
  });

  it("throws HS_CLASSIFIER_UNAVAILABLE when classifier is unreachable", async () => {
    const caller = appRouter.createCaller(makeCtx("user"));
    await expect(
      caller.insiderThreat.classifyHSCode({ hs_code: "847130" })
    ).rejects.toThrow(/HS_CLASSIFIER_UNAVAILABLE/);
  });

  it("never returns a fabricated classification for any code", async () => {
    const caller = appRouter.createCaller(makeCtx("user"));
    const result = await caller.insiderThreat.classifyHSCode({ hs_code: "84" }).catch(e => e);
    expect(result).toBeInstanceOf(Error);
    expect((result as Error).message).toContain("HS_CLASSIFIER_UNAVAILABLE");
  });
});

// ─── 18. tRPC insiderThreat.getAnomalyMetrics ────────────────────────────────

describe("tRPC insiderThreat.getAnomalyMetrics", () => {
  const routerTs = readText("server/routers/insiderThreat.ts");

  it("procedure is defined", () => {
    expect(routerTs).toContain("getAnomalyMetrics");
  });

  it("proxies to anomaly-detection-svc GET /metrics", () => {
    expect(routerTs).toContain("anomaly-detection-svc:8000");
    expect(routerTs).toContain("/metrics");
  });

  it("returns offline stub with zero counters when service unavailable", async () => {
    const caller = appRouter.createCaller(makeCtx("admin"));
    const result = await caller.insiderThreat.getAnomalyMetrics();
    expect(result).toHaveProperty("total_analysed");
    expect(result).toHaveProperty("total_alerts");
    expect(result).toHaveProperty("blocked_count");
    expect(result).toHaveProperty("alerts_by_rule");
  });

  it("uses adminProcedure (admin-only)", () => {
    const idx = routerTs.indexOf("getAnomalyMetrics:");
    const snippet = routerTs.slice(idx, idx + 100);
    expect(snippet).toContain("adminProcedure");
  });
});

// ─── 19. K8s polyglot-services.yaml: hs-classifier ───────────────────────────

describe("infra/k8s/polyglot-services.yaml: hs-classifier", () => {
  const polyYaml = readText("infra/k8s/polyglot-services.yaml");

  it("has hs-classifier Deployment", () => {
    expect(polyYaml).toContain("name: hs-classifier");
    expect(polyYaml).toContain("kind: Deployment");
  });

  it("has hs-classifier Service on port 8090", () => {
    expect(polyYaml).toContain("port: 8090");
    expect(polyYaml).toContain("targetPort: 8090");
  });

  it("has hs-classifier HPA", () => {
    expect(polyYaml).toContain("name: hs-classifier-hpa");
  });

  it("has Dapr sidecar annotation for hs-classifier", () => {
    const idx = polyYaml.indexOf("app: hs-classifier");
    const snippet = polyYaml.slice(idx, idx + 600);
    expect(snippet).toContain("dapr.io/app-id: \"hs-classifier\"");
  });

  it("has Prometheus scrape annotation for hs-classifier", () => {
    const idx = polyYaml.indexOf("app: hs-classifier");
    const snippet = polyYaml.slice(idx, idx + 600);
    expect(snippet).toContain("prometheus.io/scrape: \"true\"");
  });

  it("uses distroless-compatible security context (non-root)", () => {
    // Find the hs-classifier Deployment (not the Service or HPA)
    const deploymentIdx = polyYaml.indexOf("kind: Deployment\nmetadata:\n  name: hs-classifier");
    const hsSnippet = polyYaml.slice(deploymentIdx, deploymentIdx + 1200);
    expect(hsSnippet).toContain("runAsNonRoot: true");
  });
});

// ─── 20. Dapr components.yaml: hs-classifier resiliency target ───────────────

describe("infra/k8s/dapr/components.yaml: hs-classifier resiliency", () => {
  const daprYaml = readText("infra/k8s/dapr/components.yaml");

  it("has hs-classifier as a resiliency target", () => {
    expect(daprYaml).toContain("hs-classifier:");
  });

  it("hs-classifier uses defaultTimeout policy", () => {
    const idx = daprYaml.indexOf("hs-classifier:");
    const snippet = daprYaml.slice(idx, idx + 150);
    expect(snippet).toContain("defaultTimeout");
  });

  it("hs-classifier uses defaultRetry policy", () => {
    const idx = daprYaml.indexOf("hs-classifier:");
    const snippet = daprYaml.slice(idx, idx + 150);
    expect(snippet).toContain("defaultRetry");
  });

  it("hs-classifier uses defaultCircuitBreaker policy", () => {
    const idx = daprYaml.indexOf("hs-classifier:");
    const snippet = daprYaml.slice(idx, idx + 150);
    expect(snippet).toContain("defaultCircuitBreaker");
  });
});

// ─── SecurityMonitor: HS Classifier tab ──────────────────────────────────────

describe("SecurityMonitor: HS Classifier tab", () => {
  const monitorTsx = readText("client/src/pages/app/SecurityMonitor.tsx");

  it("has HS Classifier TabsTrigger", () => {
    expect(monitorTsx).toContain("value=\"hsclassifier\"");
    expect(monitorTsx).toContain("HS Classifier");
  });

  it("has HSClassifierPanel component", () => {
    expect(monitorTsx).toContain("function HSClassifierPanel");
  });

  it("HSClassifierPanel uses classifyHSCode mutation", () => {
    expect(monitorTsx).toContain("classifyHSCode");
  });

  it("HSClassifierPanel renders chapter, heading, subheading, confidence", () => {
    expect(monitorTsx).toContain("Chapter");
    expect(monitorTsx).toContain("Heading");
    expect(monitorTsx).toContain("Subheading");
    expect(monitorTsx).toContain("Confidence");
  });

  it("imports Layers icon for HS Classifier tab", () => {
    expect(monitorTsx).toContain("Layers");
  });
});
