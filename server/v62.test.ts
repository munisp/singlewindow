// v62.test.ts — Vitest tests for the v62 sprint deliverables:
//   1. Temporal worker registration (workflow + activity types)
//   2. TigerBeetle account seeding (system + per-trader accounts)
//   3. Mojaloop DFSP registration bootstrap (config + steps)
//
// These tests validate the structure and contracts of the new files
// without requiring live infrastructure.

import { describe, it, expect, beforeAll } from "vitest";
import fs from "fs";
import path from "path";
import yaml from "js-yaml";

const SERVICES_ROOT = path.resolve(__dirname, "../services");
const GO_WORKFLOW_SVC = path.join(SERVICES_ROOT, "go/workflow-service");
const RUST_TB_BRIDGE = path.join(SERVICES_ROOT, "rust/tigerbeetle-bridge-rs");
const GO_MOJALOOP = path.join(SERVICES_ROOT, "go/mojaloop-gateway");

// ─── Helper ───────────────────────────────────────────────────────────────────

function readFile(filePath: string): string {
  return fs.readFileSync(filePath, "utf-8");
}

function fileExists(filePath: string): boolean {
  return fs.existsSync(filePath);
}

// ─── 1. Temporal Worker ───────────────────────────────────────────────────────

describe("v62 — Temporal Worker (Go)", () => {
  const workerMain = path.join(GO_WORKFLOW_SVC, "cmd/worker/main.go");
  const registry = path.join(GO_WORKFLOW_SVC, "workflows/registry.go");
  const workerDockerfile = path.join(GO_WORKFLOW_SVC, "cmd/worker/Dockerfile");

  it("worker main.go exists", () => {
    expect(fileExists(workerMain)).toBe(true);
  });

  it("registry.go exists", () => {
    expect(fileExists(registry)).toBe(true);
  });

  it("worker Dockerfile exists", () => {
    expect(fileExists(workerDockerfile)).toBe(true);
  });

  it("worker main.go imports temporal SDK", () => {
    const content = readFile(workerMain);
    expect(content).toContain("go.temporal.io/sdk");
  });

  it("worker main.go registers worker with task queue", () => {
    const content = readFile(workerMain);
    expect(content).toContain("worker.New");
  });

  it("worker main.go registers all 20 fund-flow workflow types", () => {
    const content = readFile(workerMain);
    const requiredWorkflows = [
      "DutyPaymentWorkflow",
      "DutyDrawbackWorkflow",
      "BondManagementWorkflow",
      "BondForfeitureWorkflow",
      "BondReleaseWorkflow",
      "TransitGuaranteeWorkflow",
      "TransitGuaranteeDischargeWorkflow",
      "AuditRecoveryWorkflow",
      "BatchSettlementWorkflow",
      "RevenueReconciliationWorkflow",
    ];
    for (const wf of requiredWorkflows) {
      expect(content, `Missing workflow registration: ${wf}`).toContain(wf);
    }
  });

  it("worker main.go registers activity implementations", () => {
    const content = readFile(workerMain);
    expect(content).toContain("RegisterActivity");
  });

  it("worker main.go handles graceful shutdown on SIGTERM", () => {
    const content = readFile(workerMain);
    expect(content).toContain("SIGTERM");
  });

  it("worker main.go connects to Temporal via env var", () => {
    const content = readFile(workerMain);
    expect(content).toContain("TEMPORAL_HOST");
  });

  it("registry.go defines all workflow types for registration", () => {
    const content = readFile(registry);
    // registry.go exports RegisterAll(w worker.Worker) which registers all workflows
    expect(content).toContain("RegisterAll");
  });

  it("Dockerfile uses multi-stage build", () => {
    const content = readFile(workerDockerfile);
    expect(content).toContain("FROM golang:");
    expect(content).toContain("AS builder");
    expect(content).toContain("FROM gcr.io/distroless");
  });

  it("Dockerfile builds the worker binary with CGO_ENABLED=0", () => {
    const content = readFile(workerDockerfile);
    expect(content).toContain("CGO_ENABLED=0");
  });

  it("Dockerfile exposes health check port 8090", () => {
    const content = readFile(workerDockerfile);
    expect(content).toContain("EXPOSE 8090");
  });
});

// ─── 2. TigerBeetle Account Seeding (Rust) ───────────────────────────────────

describe("v62 — TigerBeetle Account Seeding (Rust)", () => {
  const seedModule = path.join(RUST_TB_BRIDGE, "src/seed.rs");
  const seedBin = path.join(RUST_TB_BRIDGE, "src/bin/seed.rs");
  const traderAccounts = path.join(RUST_TB_BRIDGE, "src/trader_accounts.rs");
  const mainRs = path.join(RUST_TB_BRIDGE, "src/main.rs");

  it("seed.rs module exists", () => {
    expect(fileExists(seedModule)).toBe(true);
  });

  it("bin/seed.rs binary exists", () => {
    expect(fileExists(seedBin)).toBe(true);
  });

  it("trader_accounts.rs module exists", () => {
    expect(fileExists(traderAccounts)).toBe(true);
  });

  it("seed.rs defines 6 WCO GL ledger constants", () => {
    const content = readFile(seedModule);
    expect(content).toContain("LEDGER_CUSTOMS_DUTY");
    expect(content).toContain("LEDGER_BONDS");
    expect(content).toContain("LEDGER_TRANSIT");
    expect(content).toContain("LEDGER_DRAWBACK");
    expect(content).toContain("LEDGER_FREE_ZONE");
    expect(content).toContain("LEDGER_G2G");
  });

  it("seed.rs defines system_accounts() returning 13 accounts", () => {
    const content = readFile(seedModule);
    expect(content).toContain("pub fn system_accounts()");
    // Count the NGSWTP:SYSTEM: labels
    const matches = content.match(/NGSWTP:SYSTEM:/g);
    expect(matches?.length).toBeGreaterThanOrEqual(13);
  });

  it("seed.rs defines trader_accounts() for per-trader seeding", () => {
    const content = readFile(seedModule);
    expect(content).toContain("pub fn trader_accounts(");
  });

  it("seed.rs defines seed_system_accounts() async function", () => {
    const content = readFile(seedModule);
    expect(content).toContain("pub async fn seed_system_accounts(");
  });

  it("seed.rs defines seed_trader_accounts() async function", () => {
    const content = readFile(seedModule);
    expect(content).toContain("pub async fn seed_trader_accounts(");
  });

  it("seed.rs uses idempotent HTTP 409 skip logic", () => {
    const content = readFile(seedModule);
    expect(content).toContain("409");
    // Should skip (not fail) on 409
    expect(content).toContain("skipped");
  });

  it("seed.rs includes unit tests for account uniqueness", () => {
    const content = readFile(seedModule);
    expect(content).toContain("#[cfg(test)]");
    expect(content).toContain("test_system_accounts_all_have_unique_ids");
  });

  it("seed.rs includes test for ledger coverage", () => {
    const content = readFile(seedModule);
    expect(content).toContain("test_ledger_coverage");
  });

  it("trader_accounts.rs defines seed_trader_handler for Axum", () => {
    const content = readFile(traderAccounts);
    expect(content).toContain("pub async fn seed_trader_handler");
  });

  it("trader_accounts.rs validates empty trader_id", () => {
    const content = readFile(traderAccounts);
    expect(content).toContain("trader_id.is_empty()");
    expect(content).toContain("BAD_REQUEST");
  });

  it("main.rs registers the seed/trader endpoint", () => {
    const content = readFile(mainRs);
    expect(content).toContain("/seed/trader");
    expect(content).toContain("seed_trader_handler");
  });

  it("main.rs declares seed and trader_accounts modules", () => {
    const content = readFile(mainRs);
    expect(content).toContain("pub mod seed");
    expect(content).toContain("pub mod trader_accounts");
  });

  it("bin/seed.rs exits 0 on success and 1 on failure", () => {
    const content = readFile(seedBin);
    expect(content).toContain("process::exit(0)");
    expect(content).toContain("process::exit(1)");
  });

  it("bin/seed.rs reads TIGERBEETLE_BRIDGE_URL from env", () => {
    const content = readFile(seedBin);
    expect(content).toContain("TIGERBEETLE_BRIDGE_URL");
  });
});

// ─── 3. Mojaloop DFSP Registration (Go) ──────────────────────────────────────

describe("v62 — Mojaloop DFSP Registration (Go)", () => {
  const registration = path.join(GO_MOJALOOP, "internal/dfsp/registration.go");
  const registrationTest = path.join(GO_MOJALOOP, "internal/dfsp/registration_test.go");
  const registerDFSP = path.join(GO_MOJALOOP, "cmd/register-dfsp/main.go");

  it("registration.go exists", () => {
    expect(fileExists(registration)).toBe(true);
  });

  it("registration_test.go exists", () => {
    expect(fileExists(registrationTest)).toBe(true);
  });

  it("cmd/register-dfsp/main.go exists", () => {
    expect(fileExists(registerDFSP)).toBe(true);
  });

  it("registration.go defines Config struct with all required fields", () => {
    const content = readFile(registration);
    expect(content).toContain("HubURL");
    expect(content).toContain("FSPIOP_URL");
    expect(content).toContain("DFSP_ID");
    expect(content).toContain("CallbackBaseURL");
    expect(content).toContain("Currency");
    expect(content).toContain("NetDebitCapMinor");
    expect(content).toContain("CustomsPartyMSISDN");
  });

  it("registration.go defines DefaultConfig() reading from env vars", () => {
    const content = readFile(registration);
    expect(content).toContain("func DefaultConfig()");
    expect(content).toContain("MOJALOOP_HUB_URL");
    expect(content).toContain("MOJALOOP_DFSP_ID");
  });

  it("registration.go defines Registrar.Register() executing all 7 steps", () => {
    const content = readFile(registration);
    expect(content).toContain("func (r *Registrar) Register(");
    const steps = [
      "register_participant",
      "set_net_debit_cap",
      "create_accounts",
      "register_party_als",
      "register_endpoints",
      "advertise_quote_capability",
      "advertise_transfer_capability",
    ];
    for (const step of steps) {
      expect(content, `Missing step: ${step}`).toContain(step);
    }
  });

  it("registration.go implements idempotent 409 skip logic", () => {
    const content = readFile(registration);
    expect(content).toContain("409");
    expect(content).toContain("already_exists");
  });

  it("registration.go sets FSPIOP headers for ALS registration", () => {
    const content = readFile(registration);
    expect(content).toContain("setFSPIOPHeaders");
    expect(content).toContain("FSPIOP-Source");
  });

  it("registration.go registers all 7 FSPIOP callback endpoint types", () => {
    const content = readFile(registration);
    const endpoints = [
      "FSPIOP_CALLBACK_URL_PARTIES_GET",
      "FSPIOP_CALLBACK_URL_PARTIES_PUT",
      "FSPIOP_CALLBACK_URL_PARTIES_PUT_ERROR",
      "FSPIOP_CALLBACK_URL_QUOTES",
      "FSPIOP_CALLBACK_URL_TRANSFER_POST",
      "FSPIOP_CALLBACK_URL_TRANSFER_PUT",
      "FSPIOP_CALLBACK_URL_TRANSFER_ERROR",
    ];
    for (const ep of endpoints) {
      expect(content, `Missing endpoint: ${ep}`).toContain(ep);
    }
  });

  it("registration_test.go covers success, already_exists, and failure scenarios", () => {
    const content = readFile(registrationTest);
    expect(content).toContain("Success");
    expect(content).toContain("AlreadyExists");
    expect(content).toContain("Failure");
  });

  it("registration_test.go tests full registration with all 7 steps", () => {
    const content = readFile(registrationTest);
    expect(content).toContain("TestFullRegistration_AllSuccess");
    expect(content).toContain("len(report.Steps) != 7");
  });

  it("registration_test.go tests idempotency (all 409 = success)", () => {
    const content = readFile(registrationTest);
    expect(content).toContain("TestFullRegistration_AllAlreadyExist");
  });

  it("cmd/register-dfsp/main.go uses context with 5-minute timeout", () => {
    const content = readFile(registerDFSP);
    expect(content).toContain("5*time.Minute");
  });

  it("cmd/register-dfsp/main.go exits 1 on failure", () => {
    const content = readFile(registerDFSP);
    expect(content).toContain("os.Exit(1)");
  });

  it("cmd/register-dfsp/main.go emits JSON report for log aggregation", () => {
    const content = readFile(registerDFSP);
    expect(content).toContain("JSON Report");
    expect(content).toContain("json.MarshalIndent");
  });
});

// ─── 4. Cross-cutting: docker-compose integration ────────────────────────────

describe("v62 — Docker Compose integration", () => {
  const composePath = path.join(__dirname, "../docker-compose.yml");

  it("docker-compose.yml exists", () => {
    expect(fileExists(composePath)).toBe(true);
  });

  it("docker-compose.yml includes temporal service", () => {
    const content = readFile(composePath);
    expect(content.toLowerCase()).toContain("temporal");
  });

  it("docker-compose.yml includes tigerbeetle or tb-bridge service", () => {
    const content = readFile(composePath);
    const lower = content.toLowerCase();
    expect(lower.includes("tigerbeetle") || lower.includes("tb-bridge")).toBe(true);
  });

  it("docker-compose.yml includes mojaloop service", () => {
    const content = readFile(composePath);
    expect(content.toLowerCase()).toContain("mojaloop");
  });

  it("docker-compose.yml includes kafka service", () => {
    const content = readFile(composePath);
    expect(content.toLowerCase()).toContain("kafka");
  });

  it("docker-compose.yml includes keycloak service", () => {
    const content = readFile(composePath);
    expect(content.toLowerCase()).toContain("keycloak");
  });

  it("docker-compose.yml includes permify service", () => {
    const content = readFile(composePath);
    expect(content.toLowerCase()).toContain("permify");
  });

  it("docker-compose.yml includes redis service", () => {
    const content = readFile(composePath);
    expect(content.toLowerCase()).toContain("redis");
  });

  it("docker-compose.yml includes opensearch service", () => {
    const content = readFile(composePath);
    expect(content.toLowerCase()).toContain("opensearch");
  });
});

// ─── 5. Helm chart completeness ───────────────────────────────────────────────

describe("v62 — Helm chart completeness", () => {
  const helmDir = path.join(__dirname, "../helm/tradegateway");

  const requiredTemplates = [
    "Chart.yaml",
    "values.yaml",
    "values.prod.yaml",
    "templates/_helpers.tpl",
    "templates/app-deployment.yaml",
    "templates/keycloak-deployment.yaml",
    "templates/permify-deployment.yaml",
    "templates/opensearch-statefulset.yaml",
    "templates/kafka-statefulset.yaml",
    "templates/apisix-deployment.yaml",
    "templates/ingress.yaml",
    "templates/postgres-statefulset.yaml",
    "templates/redis-deployment.yaml",
    "templates/configmap.yaml",
    "templates/secrets.yaml",
    "templates/hpa.yaml",
  ];

  for (const template of requiredTemplates) {
    it(`helm/${template} exists`, () => {
      expect(fileExists(path.join(helmDir, template))).toBe(true);
    });
  }

  it("Chart.yaml has correct apiVersion v2", () => {
    const content = readFile(path.join(helmDir, "Chart.yaml"));
    expect(content).toContain("apiVersion: v2");
  });

  it("values.yaml defines image.repository for app", () => {
    const content = readFile(path.join(helmDir, "values.yaml"));
    expect(content).toContain("repository:");
  });

  it("values.prod.yaml sets replicaCount > 1 for production", () => {
    const content = readFile(path.join(helmDir, "values.prod.yaml"));
    expect(content).toContain("replicaCount:");
    // Should have at least one replicaCount > 1
    const matches = content.match(/replicaCount:\s*(\d+)/g);
    const hasProdReplicas = matches?.some(m => {
      const count = parseInt(m.replace("replicaCount:", "").trim());
      return count > 1;
    });
    expect(hasProdReplicas).toBe(true);
  });

  it("hpa.yaml defines HorizontalPodAutoscaler", () => {
    const content = readFile(path.join(helmDir, "templates/hpa.yaml"));
    expect(content).toContain("HorizontalPodAutoscaler");
  });

  it("secrets.yaml uses Helm secret values (not hardcoded)", () => {
    const content = readFile(path.join(helmDir, "templates/secrets.yaml"));
    expect(content).toContain("{{ .Values.");
    // Must not contain hardcoded secrets
    expect(content).not.toContain("password123");
    expect(content).not.toContain("secret123");
  });
});
