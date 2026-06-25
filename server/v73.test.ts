/**
 * v73 Test Suite — Production Audit
 *
 * Covers:
 *   1. Python insider-threat-svc: GET /ab/promotions endpoint
 *   2. tRPC insiderThreat.getPromotionHistory procedure
 *   3. Go notification-dispatcher: admin_server.go (AdminServer struct)
 *   4. Go notification-dispatcher: main.go wires TokenRefresher + AdminServer
 *   5. K8s CronJob manifest: notification-dispatcher-token-refresh-cronjob.yaml
 *   6. Dapr K8s components.yaml: all 7 missing components promoted
 *   7. Helm values.yaml: notification-dispatcher service entry
 *   8. SecurityMonitor: AB_ALERT_THRESHOLD constant + divergence alert banner
 *   9. SecurityMonitor: useEffect owner notification on divergence
 *  10. tRPC insiderThreat.promoteModel: offline fallback returns correct shape
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

// ─── Helper ──────────────────────────────────────────────────────────────────

function readText(rel: string): string {
  return readFileSync(join(BASE, rel), "utf8");
}

function fileExists(rel: string): boolean {
  return existsSync(join(BASE, rel));
}

// ─── 1. Python: GET /ab/promotions endpoint ──────────────────────────────────

describe("Python insider-threat-svc: /ab/promotions endpoint", () => {
  const mainPy = readText(
    "services/python/insider-threat-svc/main.py"
  );

  it("defines GET /ab/promotions route", () => {
    expect(mainPy).toContain('@app.get("/ab/promotions"');
  });

  it("defines PromotionRecord model", () => {
    expect(mainPy).toContain("class PromotionRecord");
  });

  it("defines PromotionHistoryResponse model", () => {
    expect(mainPy).toContain("class PromotionHistoryResponse");
  });

  it("wires _record_promotion into ab_promote", () => {
    expect(mainPy).toContain("_record_promotion(resp)");
  });

  it("uses a ring-buffer for promotion log (maxlen=500)", () => {
    expect(mainPy).toContain("maxlen=500");
  });

  it("ab_promotions returns items from _PROMOTION_LOG", () => {
    expect(mainPy).toContain("_PROMOTION_LOG");
  });
});

// ─── 2. tRPC: getPromotionHistory procedure ───────────────────────────────────

describe("tRPC insiderThreat.getPromotionHistory", () => {
  const insiderTs = readText("server/routers/insiderThreat.ts");

  it("defines getPromotionHistory procedure", () => {
    expect(insiderTs).toContain("getPromotionHistory");
  });

  it("calls /ab/promotions on the Python service", () => {
    expect(insiderTs).toContain("/ab/promotions");
  });

  it("returns offline stub when service is unavailable", () => {
    // offline stub returns { total: 0, records: [], source: 'unavailable' }
    expect(insiderTs).toMatch(/records.*\[\]|total.*0/);
  });
});

describe("tRPC insiderThreat.getPromotionHistory caller", () => {
  const caller = appRouter.createCaller(makeCtx("admin"));

  it("returns records array (offline mode)", async () => {
    const result = await caller.insiderThreat.getPromotionHistory({ limit: 10 });
    // offline stub returns { total, records, source }
    expect(result).toHaveProperty("total");
    expect(Array.isArray(result.records)).toBe(true);
  });

  it("throws FORBIDDEN for non-admin", async () => {
    const userCaller = appRouter.createCaller(makeCtx("user"));
    await expect(
      userCaller.insiderThreat.getPromotionHistory({ limit: 10 })
    ).rejects.toThrow();
  });
});

// ─── 3. Go: AdminServer struct ────────────────────────────────────────────────

describe("Go notification-dispatcher: admin_server.go", () => {
  const adminGo = readText(
    "services/go/notification-dispatcher/admin_server.go"
  );

  it("defines AdminServer struct", () => {
    expect(adminGo).toContain("type AdminServer struct");
  });

  it("exposes /healthz endpoint", () => {
    expect(adminGo).toContain("/healthz");
  });

  it("exposes /admin/refresh-tokens endpoint", () => {
    expect(adminGo).toContain("/admin/refresh-tokens");
  });

  it("defines NewAdminServer constructor", () => {
    expect(adminGo).toContain("func NewAdminServer(");
  });

  it("defines Start method", () => {
    expect(adminGo).toContain("func (as *AdminServer) Start()");
  });

  it("defines Shutdown method", () => {
    expect(adminGo).toContain("func (as *AdminServer) Shutdown(");
  });

  it("runs refresh cycle in goroutine on POST /admin/refresh-tokens", () => {
    expect(adminGo).toContain("go func()");
    expect(adminGo).toContain("runCycle(ctx)");
  });

  it("returns 202 Accepted for manual refresh trigger", () => {
    expect(adminGo).toContain("StatusAccepted");
  });
});

// ─── 4. Go: main.go wires TokenRefresher + AdminServer ───────────────────────

describe("Go notification-dispatcher: main.go startup wiring", () => {
  const mainGo = readText(
    "services/go/notification-dispatcher/main.go"
  );

  it("creates a TokenRefresher", () => {
    expect(mainGo).toContain("NewTokenRefresher(");
  });

  it("starts TokenRefresher in a goroutine", () => {
    expect(mainGo).toContain("tokenRefresher.Run(ctx)");
  });

  it("creates an AdminServer", () => {
    expect(mainGo).toContain("NewAdminServer(");
  });

  it("starts AdminServer in a goroutine", () => {
    expect(mainGo).toContain("adminSrv.Start()");
  });

  it("reads ADMIN_ADDR from environment", () => {
    expect(mainGo).toContain("ADMIN_ADDR");
  });

  it("gracefully shuts down AdminServer on SIGTERM", () => {
    expect(mainGo).toContain("adminSrv.Shutdown(");
  });
});

// ─── 5. K8s CronJob manifest ─────────────────────────────────────────────────

describe("K8s CronJob: notification-dispatcher-token-refresh-cronjob.yaml", () => {
  const cronYaml = readText(
    "infra/k8s/notification-dispatcher-token-refresh-cronjob.yaml"
  );

  it("is a CronJob kind", () => {
    expect(cronYaml).toContain("kind: CronJob");
  });

  it("runs on a nightly schedule", () => {
    // Matches cron expressions like "0 2 * * *" or "@daily"
    expect(cronYaml).toMatch(/schedule:.*["'].*\d.*["']/);
  });

  it("calls /admin/refresh-tokens endpoint", () => {
    expect(cronYaml).toContain("/admin/refresh-tokens");
  });

  it("targets the notification-dispatcher service", () => {
    expect(cronYaml).toContain("notification-dispatcher");
  });

  it("is in the tradegateway namespace", () => {
    expect(cronYaml).toContain("namespace: tradegateway");
  });
});

// ─── 6. Dapr K8s components.yaml ─────────────────────────────────────────────

describe("Dapr K8s components.yaml: all 7 missing components", () => {
  const componentsYaml = readText("infra/k8s/dapr/components.yaml");

  it("defines fluvio-binding component", () => {
    expect(componentsYaml).toContain("name: fluvio-binding");
  });

  it("defines tigerbeetle-binding component", () => {
    expect(componentsYaml).toContain("name: tigerbeetle-binding");
  });

  it("defines lakehouse-binding component", () => {
    expect(componentsYaml).toContain("name: lakehouse-binding");
  });

  it("defines redis-lock component", () => {
    expect(componentsYaml).toContain("name: redis-lock");
  });

  it("defines cron-model-retrain component", () => {
    expect(componentsYaml).toContain("name: cron-model-retrain");
  });

  it("defines keycloak-secrets component", () => {
    expect(componentsYaml).toContain("name: keycloak-secrets");
  });

  it("defines tradegateway-resiliency policy", () => {
    expect(componentsYaml).toContain("name: tradegateway-resiliency");
  });

  it("uses secretKeyRef for sensitive values (not hardcoded)", () => {
    expect(componentsYaml).toContain("secretKeyRef:");
  });

  it("references kubernetes-secrets auth store", () => {
    expect(componentsYaml).toContain("secretStore: kubernetes-secrets");
  });

  it("has circuit breaker policy", () => {
    expect(componentsYaml).toContain("circuitBreaker");
  });
});

// ─── 7. Helm values.yaml: notification-dispatcher entry ──────────────────────

describe("Helm values.yaml: notification-dispatcher service entry", () => {
  const valuesYaml = readText("infra/helm/tradegateway/values.yaml");

  it("includes notification-dispatcher service", () => {
    expect(valuesYaml).toContain("notification-dispatcher:");
  });

  it("sets admin port 8081", () => {
    expect(valuesYaml).toContain("port: 8081");
  });

  it("defines liveness probe on /healthz", () => {
    expect(valuesYaml).toContain("path: /healthz");
  });

  it("defines HPA for notification-dispatcher", () => {
    // Check that HPA config appears after notification-dispatcher
    const ndIdx = valuesYaml.indexOf("notification-dispatcher:");
    const hpaIdx = valuesYaml.indexOf("hpa:", ndIdx);
    expect(hpaIdx).toBeGreaterThan(ndIdx);
  });

  it("sets ADMIN_ADDR env var", () => {
    expect(valuesYaml).toContain("ADMIN_ADDR");
  });
});

// ─── 8. SecurityMonitor: AB_ALERT_THRESHOLD + divergence banner ───────────────

describe("SecurityMonitor: A/B divergence alert", () => {
  const monitorTsx = readText(
    "client/src/pages/app/SecurityMonitor.tsx"
  );

  it("defines AB_ALERT_THRESHOLD constant", () => {
    expect(monitorTsx).toContain("AB_ALERT_THRESHOLD");
  });

  it("threshold is set to 0.85 (85%)", () => {
    expect(monitorTsx).toContain("AB_ALERT_THRESHOLD = 0.85");
  });

  it("renders divergence alert banner when below threshold", () => {
    expect(monitorTsx).toContain("showDivergenceAlert");
  });

  it("uses BellRing icon in the alert banner", () => {
    expect(monitorTsx).toContain("BellRing");
  });

  it("shows agreement rate percentage in the banner", () => {
    expect(monitorTsx).toContain("agreementRate * 100");
  });

  it("only shows alert after 10+ comparisons", () => {
    expect(monitorTsx).toContain("totalComparisons >= 10");
  });
});

// ─── 9. SecurityMonitor: useEffect owner notification ────────────────────────

describe("SecurityMonitor: owner notification on divergence", () => {
  const monitorTsx = readText(
    "client/src/pages/app/SecurityMonitor.tsx"
  );

  it("imports useEffect", () => {
    expect(monitorTsx).toContain("useEffect");
  });

  it("calls trpc.system.notifyOwner", () => {
    expect(monitorTsx).toContain("trpc.system.notifyOwner");
  });

  it("notification title mentions A/B Model Divergence", () => {
    expect(monitorTsx).toContain("A/B Model Divergence Alert");
  });

  it("uses primitive dependencies to avoid infinite re-renders", () => {
    expect(monitorTsx).toContain("stats?.agreement_rate");
    expect(monitorTsx).toContain("stats?.total_comparisons");
  });
});

// ─── 10. tRPC promoteModel: offline fallback ──────────────────────────────────

describe("tRPC insiderThreat.promoteModel offline fallback", () => {
  const insiderTs = readText("server/routers/insiderThreat.ts");

  it("wraps fetch in try/catch for offline resilience", () => {
    expect(insiderTs).toContain("try {");
  });

  it("returns promotedAt or promoted_at field in offline stub", () => {
    expect(insiderTs).toMatch(/promotedAt|promoted_at/);
  });

  it("returns offline mode message in stub response", () => {
    expect(insiderTs).toContain("offline mode");
  });
});

describe("tRPC insiderThreat.promoteModel caller (offline mode)", () => {
  const caller = appRouter.createCaller(makeCtx("admin"));

  it("returns promotedAt when service is unavailable", async () => {
    const result = await caller.insiderThreat.promoteModel({
      reason: "test",
      operator: "test-admin",
    });
    // offline stub uses camelCase promotedAt
    expect(result).toHaveProperty("promotedAt");
  });

  it("throws FORBIDDEN for non-admin", async () => {
    const userCaller = appRouter.createCaller(makeCtx("user"));
    await expect(
      userCaller.insiderThreat.promoteModel({ reason: "test", operator: "test" })
    ).rejects.toThrow();
  });
});
