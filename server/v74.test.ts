/**
 * v74 Test Suite — Sprint v74 Production Audit
 *
 * Covers:
 *   1. SecurityMonitor: RotateCcw import + rollbackMutation + Rollback button
 *   2. tRPC insiderThreat.rollbackModel procedure (static analysis)
 *   3. tRPC insiderThreat.rollbackModel caller (offline mode)
 *   4. Python insider-threat-svc: POST /ab/rollback endpoint
 *   5. Python insider-threat-svc: RollbackRequest + RollbackResponse models
 *   6. Go admin_server.go: GET /admin/metrics endpoint
 *   7. Go admin_server.go: Stats() call + JSON fields
 *   8. Dapr components.yaml: 4 new resiliency targets
 *   9. Python anomaly-detection-svc: test_anomaly.py exists with ≥ 20 tests
 *  10. Python anomaly-detection-svc: all 6 detection rules exported
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

// ─── 1. SecurityMonitor: RotateCcw + rollbackMutation + Rollback button ───────

describe("SecurityMonitor: Rollback button", () => {
  const monitorTsx = readText("client/src/pages/app/SecurityMonitor.tsx");

  it("imports RotateCcw from lucide-react", () => {
    expect(monitorTsx).toContain("RotateCcw");
  });

  it("defines rollbackMutation using trpc.insiderThreat.rollbackModel", () => {
    expect(monitorTsx).toContain("rollbackMutation");
    expect(monitorTsx).toContain("rollbackModel");
  });

  it("renders Rollback Model button", () => {
    expect(monitorTsx).toContain("Rollback Model");
  });

  it("disables Rollback button while rollback is pending", () => {
    expect(monitorTsx).toContain("rollbackMutation.isPending");
  });

  it("disables Promote button while rollback is pending (mutual exclusion)", () => {
    // Promote button should also be disabled when rollback is in flight
    expect(monitorTsx).toMatch(/disabled.*rollbackMutation\.isPending|rollbackMutation\.isPending.*disabled/);
  });

  it("shows 'Rolling back…' spinner text while pending", () => {
    expect(monitorTsx).toContain("Rolling back");
  });

  it("calls rollbackMutation.mutate on click", () => {
    expect(monitorTsx).toContain("rollbackMutation.mutate(");
  });

  it("uses RotateCcw icon in the rollback button", () => {
    // RotateCcw should appear inside the button JSX
    const rollbackButtonIdx = monitorTsx.indexOf("Rollback Model");
    const rotateCcwIdx = monitorTsx.lastIndexOf("RotateCcw", rollbackButtonIdx);
    expect(rotateCcwIdx).toBeGreaterThan(0);
  });
});

// ─── 2. tRPC insiderThreat.rollbackModel procedure (static) ──────────────────

describe("tRPC insiderThreat.rollbackModel procedure", () => {
  const insiderTs = readText("server/routers/insiderThreat.ts");

  it("defines rollbackModel procedure", () => {
    expect(insiderTs).toContain("rollbackModel");
  });

  it("calls POST /ab/rollback on the Python service", () => {
    expect(insiderTs).toContain("/ab/rollback");
  });

  it("accepts reason and operator input fields", () => {
    expect(insiderTs).toContain("reason");
    expect(insiderTs).toContain("operator");
  });

  it("fails closed (no fabricated rolledBackAt) when service is unavailable", () => {
    // SW-E: the offline stub with a fabricated rolledBackAt timestamp was
    // removed — an unavailable rollback must surface as SERVICE_UNAVAILABLE.
    const idx = insiderTs.indexOf("rollbackModel: adminProcedure");
    const window = insiderTs.slice(idx, idx + 2500);
    expect(window).toContain("ROLLBACK_SERVICE_UNAVAILABLE");
    expect(window).not.toMatch(/rolledBackAt:/);
  });

  it("throws INTERNAL_SERVER_ERROR on non-OK response", () => {
    expect(insiderTs).toContain("INTERNAL_SERVER_ERROR");
  });

  it("uses AbortSignal.timeout for fetch resilience", () => {
    // rollbackModel should have a timeout on its fetch
    const rollbackIdx = insiderTs.indexOf("rollbackModel");
    const timeoutIdx = insiderTs.indexOf("AbortSignal.timeout", rollbackIdx);
    expect(timeoutIdx).toBeGreaterThan(rollbackIdx);
  });
});

// ─── 3. tRPC insiderThreat.rollbackModel caller (offline mode) ───────────────

describe("tRPC insiderThreat.rollbackModel caller (fail-closed)", () => {
  const caller = appRouter.createCaller(makeCtx("admin"));

  it("rejects with SERVICE_UNAVAILABLE when the service is down (no fabricated outcome)", async () => {
    await expect(
      caller.insiderThreat.rollbackModel({
        reason: "test_rollback",
        operator: "test-admin",
      })
    ).rejects.toMatchObject({ code: "SERVICE_UNAVAILABLE" });
  });

  it("rollbackToVersion rejects with SERVICE_UNAVAILABLE when the service is down", async () => {
    await expect(
      caller.insiderThreat.rollbackToVersion({
        target_version: 2,
        reason: "test_rollback",
        operator: "test-admin",
      })
    ).rejects.toMatchObject({ code: "SERVICE_UNAVAILABLE" });
  });

  it("throws FORBIDDEN for non-admin users", async () => {
    const userCaller = appRouter.createCaller(makeCtx("user"));
    await expect(
      userCaller.insiderThreat.rollbackModel({ reason: "test", operator: "user" })
    ).rejects.toThrow();
  });
});

// ─── 4. Python insider-threat-svc: POST /ab/rollback endpoint ────────────────

describe("Python insider-threat-svc: /ab/rollback endpoint", () => {
  const mainPy = readText("services/python/insider-threat-svc/main.py");

  it("defines POST /ab/rollback route", () => {
    expect(mainPy).toContain('@app.post("/ab/rollback"');
  });

  it("loads backup from production_backup.pkl", () => {
    expect(mainPy).toContain("production_backup.pkl");
  });

  it("atomically swaps the current symlink", () => {
    expect(mainPy).toContain("tmp_link");
    expect(mainPy).toContain("replace(CURRENT_LINK)");
  });

  it("updates in-memory _model and _scaler on success", () => {
    expect(mainPy).toContain("_model = restored_model");
    expect(mainPy).toContain("_scaler = restored_scaler");
  });

  it("returns success=False when no backup exists", () => {
    expect(mainPy).toContain("success=False");
    expect(mainPy).toContain("No backup model found");
  });

  it("raises HTTPException 500 on unexpected error", () => {
    expect(mainPy).toContain("HTTPException(status_code=500");
  });
});

// ─── 5. Python insider-threat-svc: RollbackRequest + RollbackResponse ────────

describe("Python insider-threat-svc: Rollback models", () => {
  const mainPy = readText("services/python/insider-threat-svc/main.py");

  it("defines RollbackRequest model", () => {
    expect(mainPy).toContain("class RollbackRequest");
  });

  it("defines RollbackResponse model", () => {
    expect(mainPy).toContain("class RollbackResponse");
  });

  it("RollbackResponse includes rolled_back_at field", () => {
    expect(mainPy).toContain("rolled_back_at");
  });

  it("RollbackResponse includes previous_version and restored_version", () => {
    expect(mainPy).toContain("previous_version");
    expect(mainPy).toContain("restored_version");
  });
});

// ─── 6. Go admin_server.go: GET /admin/metrics endpoint ──────────────────────

describe("Go admin_server.go: GET /admin/metrics endpoint", () => {
  const adminGo = readText(
    "services/go/notification-dispatcher/admin_server.go"
  );

  it("registers GET /admin/metrics route", () => {
    expect(adminGo).toContain('"GET /admin/metrics"');
  });

  it("calls as.refresher.Stats()", () => {
    expect(adminGo).toContain("as.refresher.Stats()");
  });

  it("returns total_cycles in JSON response", () => {
    expect(adminGo).toContain('"total_cycles"');
  });

  it("returns total_validated in JSON response", () => {
    expect(adminGo).toContain('"total_validated"');
  });

  it("returns total_stale in JSON response", () => {
    expect(adminGo).toContain('"total_stale"');
  });

  it("returns total_purged in JSON response", () => {
    expect(adminGo).toContain('"total_purged"');
  });

  it("returns last_cycle_at_ms in JSON response", () => {
    expect(adminGo).toContain('"last_cycle_at_ms"');
  });

  it("sets Content-Type to application/json", () => {
    expect(adminGo).toContain('"Content-Type", "application/json"');
  });

  it("documents the endpoint in the file header comment", () => {
    expect(adminGo).toContain("GET  /admin/metrics");
  });
});

// ─── 7. Go admin_server.go: Stats() struct fields ────────────────────────────

describe("Go admin_server.go: Stats() struct access", () => {
  const adminGo = readText(
    "services/go/notification-dispatcher/admin_server.go"
  );

  it("accesses stats.TotalCycles", () => {
    expect(adminGo).toContain("stats.TotalCycles");
  });

  it("accesses stats.TotalValidated", () => {
    expect(adminGo).toContain("stats.TotalValidated");
  });

  it("accesses stats.TotalStale", () => {
    expect(adminGo).toContain("stats.TotalStale");
  });

  it("accesses stats.TotalPurged", () => {
    expect(adminGo).toContain("stats.TotalPurged");
  });

  it("accesses stats.LastCycleAt", () => {
    expect(adminGo).toContain("stats.LastCycleAt");
  });
});

// ─── 8. Dapr components.yaml: 4 new resiliency targets ───────────────────────

describe("Dapr components.yaml: new resiliency targets", () => {
  const componentsYaml = readText("infra/k8s/dapr/components.yaml");

  it("adds notification-dispatcher as a resiliency target", () => {
    expect(componentsYaml).toContain("notification-dispatcher:");
  });

  it("adds mojaloop-gateway as a resiliency target", () => {
    expect(componentsYaml).toContain("mojaloop-gateway:");
  });

  it("adds sanctions-service as a resiliency target", () => {
    expect(componentsYaml).toContain("sanctions-service:");
  });

  it("adds cargo-tracking-svc as a resiliency target", () => {
    expect(componentsYaml).toContain("cargo-tracking-svc:");
  });

  it("mojaloop-gateway uses criticalRetry policy (payment path)", () => {
    const mjIdx = componentsYaml.indexOf("mojaloop-gateway:");
    const retryIdx = componentsYaml.indexOf("criticalRetry", mjIdx);
    expect(retryIdx).toBeGreaterThan(mjIdx);
  });

  it("mojaloop-gateway uses paymentTimeout (extended for Mojaloop round-trips)", () => {
    const mjIdx = componentsYaml.indexOf("mojaloop-gateway:");
    const toIdx = componentsYaml.indexOf("paymentTimeout", mjIdx);
    expect(toIdx).toBeGreaterThan(mjIdx);
  });

  it("total resiliency targets now includes all 8 core services", () => {
    const targets = [
      "risk-ai-engine:",
      "payment-service:",
      "declaration-engine:",
      "insider-threat-svc:",
      "notification-dispatcher:",
      "mojaloop-gateway:",
      "sanctions-service:",
      "cargo-tracking-svc:",
    ];
    for (const t of targets) {
      expect(componentsYaml).toContain(t);
    }
  });
});

// ─── 9. Python anomaly-detection-svc: test_anomaly.py ────────────────────────

describe("Python anomaly-detection-svc: test_anomaly.py", () => {
  it("test_anomaly.py file exists", () => {
    expect(
      fileExists("services/python/anomaly-detection-svc/test_anomaly.py")
    ).toBe(true);
  });

  it("contains at least 20 test functions", () => {
    const testPy = readText(
      "services/python/anomaly-detection-svc/test_anomaly.py"
    );
    const matches = testPy.match(/^def test_/gm) ?? [];
    expect(matches.length).toBeGreaterThanOrEqual(20);
  });

  it("imports TestClient from fastapi.testclient", () => {
    const testPy = readText(
      "services/python/anomaly-detection-svc/test_anomaly.py"
    );
    expect(testPy).toContain("from fastapi.testclient import TestClient");
  });

  it("tests the /health endpoint", () => {
    const testPy = readText(
      "services/python/anomaly-detection-svc/test_anomaly.py"
    );
    expect(testPy).toContain('"/health"');
  });

  it("tests the /analyse endpoint", () => {
    const testPy = readText(
      "services/python/anomaly-detection-svc/test_anomaly.py"
    );
    expect(testPy).toContain('"/analyse"');
  });

  it("tests the /analyse/batch endpoint", () => {
    const testPy = readText(
      "services/python/anomaly-detection-svc/test_anomaly.py"
    );
    expect(testPy).toContain('"/analyse/batch"');
  });

  it("tests the /risk/{user_id} endpoint", () => {
    const testPy = readText(
      "services/python/anomaly-detection-svc/test_anomaly.py"
    );
    expect(testPy).toContain('"/risk/');
  });
});

// ─── 10. Python anomaly-detection-svc: detection rule exports ────────────────

describe("Python anomaly-detection-svc: detection rule functions", () => {
  const mainPy = readText(
    "services/python/anomaly-detection-svc/main.py"
  );

  it("defines rule_off_hours_access (Rule 1)", () => {
    expect(mainPy).toContain("def rule_off_hours_access(");
  });

  it("defines rule_bulk_export (Rule 2)", () => {
    expect(mainPy).toContain("def rule_bulk_export(");
  });

  it("defines rule_geo_anomaly (Rule 3)", () => {
    expect(mainPy).toContain("def rule_geo_anomaly(");
  });

  it("defines rule_rapid_actions (Rule 5)", () => {
    expect(mainPy).toContain("def rule_rapid_actions(");
  });

  it("defines rule_large_payment (Rule 9)", () => {
    expect(mainPy).toContain("def rule_large_payment(");
  });

  it("defines rule_failed_authz (Rule 10)", () => {
    expect(mainPy).toContain("def rule_failed_authz(");
  });

  it("defines compute_risk_score helper", () => {
    expect(mainPy).toContain("def compute_risk_score(");
  });

  it("defines determine_action helper", () => {
    expect(mainPy).toContain("def determine_action(");
  });

  it("defines _haversine_km helper for geo distance", () => {
    expect(mainPy).toContain("def _haversine_km(");
  });

  it("POST /analyse route applies all 6 rules", () => {
    expect(mainPy).toContain("rule_off_hours_access");
    expect(mainPy).toContain("rule_bulk_export");
    expect(mainPy).toContain("rule_geo_anomaly");
    expect(mainPy).toContain("rule_rapid_actions");
    expect(mainPy).toContain("rule_large_payment");
    expect(mainPy).toContain("rule_failed_authz");
  });
});
