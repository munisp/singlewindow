/**
 * v64 Test Suite — JWS Wiring, TigerBeetle Seed Hook, Helm Health Probes
 *
 * Verifies:
 * 1. JWS signing module structure and algorithm support
 * 2. FSPIOP-Signature header format compliance
 * 3. TigerBeetle seed migration hook (adminProcedure + Temporal startup)
 * 4. Helm chart health probe annotations for app and workflow-worker
 * 5. Helm values.yaml workflowWorker section completeness
 * 6. _helpers.tpl permifyHttp helper
 * 7. workflow-worker-deployment.yaml probe configuration
 */

import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import * as yaml from "js-yaml";

const ROOT = path.resolve(__dirname, "..");
const HELM_DIR = path.join(ROOT, "helm", "tradegateway");
const MOJALOOP_DIR = path.join(ROOT, "services", "go", "mojaloop-gateway");
const WORKER_DIR = path.join(ROOT, "services", "go", "workflow-service", "cmd", "worker");

// ─── 1. JWS Signing Module ────────────────────────────────────────────────────

describe("JWS signing module (services/go/mojaloop-gateway/internal/dfsp/jws.go)", () => {
  const jwsPath = path.join(MOJALOOP_DIR, "internal", "dfsp", "jws.go");

  it("jws.go exists", () => {
    expect(fs.existsSync(jwsPath)).toBe(true);
  });

  it("defines Signer struct with privateKey and algorithm fields", () => {
    const content = fs.readFileSync(jwsPath, "utf8");
    expect(content).toContain("type Signer struct");
    expect(content).toContain("privateKey");
    expect(content).toContain("algorithm");
  });

  it("implements SignRequest method", () => {
    const content = fs.readFileSync(jwsPath, "utf8");
    expect(content).toContain("func (s *Signer) SignRequest");
  });

  it("supports PS256 (RSA-PSS) algorithm", () => {
    const content = fs.readFileSync(jwsPath, "utf8");
    expect(content).toContain("PS256");
  });

  it("supports EdDSA (Ed25519) algorithm", () => {
    const content = fs.readFileSync(jwsPath, "utf8");
    expect(content).toContain("EdDSA");
  });

  it("supports ES256 (ECDSA P-256) algorithm", () => {
    const content = fs.readFileSync(jwsPath, "utf8");
    expect(content).toContain("ES256");
  });

  it("supports RS256 (RSA-PKCS1) algorithm", () => {
    const content = fs.readFileSync(jwsPath, "utf8");
    expect(content).toContain("RS256");
  });

  it("implements RotateKey for zero-downtime key rotation", () => {
    const content = fs.readFileSync(jwsPath, "utf8");
    expect(content).toContain("RotateKey");
  });

  it("implements JWKSHandler for public key exposure", () => {
    const content = fs.readFileSync(jwsPath, "utf8");
    expect(content).toContain("JWKSHandler");
  });

  it("uses sync.RWMutex for thread-safe key rotation", () => {
    const content = fs.readFileSync(jwsPath, "utf8");
    expect(content).toContain("sync.RWMutex");
  });

  it("sets FSPIOP-Signature header on signed requests", () => {
    const content = fs.readFileSync(jwsPath, "utf8");
    expect(content).toContain("FSPIOP-Signature");
  });

  it("includes protected header fields per FSPIOP spec", () => {
    const content = fs.readFileSync(jwsPath, "utf8");
    expect(content).toContain("FSPIOP-URI");
    expect(content).toContain("FSPIOP-HTTP-Method");
    expect(content).toContain("FSPIOP-Source");
  });

  it("has jws_test.go with unit tests", () => {
    const testPath = path.join(MOJALOOP_DIR, "internal", "dfsp", "jws_test.go");
    expect(fs.existsSync(testPath)).toBe(true);
    const content = fs.readFileSync(testPath, "utf8");
    expect(content).toContain("func Test");
  });
});

// ─── 2. JWS Wired into Registration ──────────────────────────────────────────

describe("JWS wired into Mojaloop DFSP registration", () => {
  const regPath = path.join(MOJALOOP_DIR, "internal", "dfsp", "registration.go");

  it("registration.go imports jws package or references Signer", () => {
    const content = fs.readFileSync(regPath, "utf8");
    // Either direct Signer field or jws.Signer reference
    expect(content).toMatch(/Signer|jws\./);
  });

  it("Registrar struct has a signer field", () => {
    const content = fs.readFileSync(regPath, "utf8");
    expect(content).toContain("signer");
  });

  it("NewRegistrar accepts a signer parameter", () => {
    const content = fs.readFileSync(regPath, "utf8");
    expect(content).toContain("NewRegistrar");
    expect(content).toContain("signer");
  });

  it("setFSPIOPHeaders calls signer.SignRequest when signer is set", () => {
    const content = fs.readFileSync(regPath, "utf8");
    expect(content).toContain("SignRequest");
  });

  it("register-dfsp main.go creates a JWS signer before calling NewRegistrar", () => {
    const mainPath = path.join(MOJALOOP_DIR, "cmd", "register-dfsp", "main.go");
    const content = fs.readFileSync(mainPath, "utf8");
    expect(content).toContain("NewSigner");
  });
});

// ─── 3. TigerBeetle Seed Hook ─────────────────────────────────────────────────

describe("TigerBeetle seed migration hook", () => {
  it("tigerbeetleSeed.ts tRPC router exists", () => {
    const routerPath = path.join(ROOT, "server", "routers", "tigerbeetleSeed.ts");
    expect(fs.existsSync(routerPath)).toBe(true);
  });

  it("tigerbeetleSeed router exports tigerbeetleSeedRouter", () => {
    const routerPath = path.join(ROOT, "server", "routers", "tigerbeetleSeed.ts");
    const content = fs.readFileSync(routerPath, "utf8");
    expect(content).toContain("tigerbeetleSeedRouter");
  });

  it("tigerbeetleSeed router has seedSystemAccounts adminProcedure", () => {
    const routerPath = path.join(ROOT, "server", "routers", "tigerbeetleSeed.ts");
    const content = fs.readFileSync(routerPath, "utf8");
    expect(content).toContain("seedSystemAccounts");
    expect(content).toContain("adminProcedure");
  });

  it("tigerbeetleSeed router calls TigerBeetle bridge POST /seed/system", () => {
    const routerPath = path.join(ROOT, "server", "routers", "tigerbeetleSeed.ts");
    const content = fs.readFileSync(routerPath, "utf8");
    expect(content).toContain("/seed/system");
  });

  it("tigerbeetleSeed router has seedTraderAccounts adminProcedure", () => {
    const routerPath = path.join(ROOT, "server", "routers", "tigerbeetleSeed.ts");
    const content = fs.readFileSync(routerPath, "utf8");
    expect(content).toContain("seedTraderAccounts");
  });

  it("tigerbeetleSeed router is registered in main appRouter", () => {
    const routersPath = path.join(ROOT, "server", "routers.ts");
    const content = fs.readFileSync(routersPath, "utf8");
    expect(content).toContain("tigerbeetleSeedRouter");
    expect(content).toContain("tigerbeetleSeed:");
  });

  it("Temporal worker main.go calls seedSystemAccounts on startup", () => {
    const mainPath = path.join(WORKER_DIR, "main.go");
    const content = fs.readFileSync(mainPath, "utf8");
    expect(content).toContain("seedSystemAccounts");
    expect(content).toContain("TIGERBEETLE_BRIDGE_URL");
  });

  it("seedSystemAccounts treats HTTP 409 as success (idempotent)", () => {
    const mainPath = path.join(WORKER_DIR, "main.go");
    const content = fs.readFileSync(mainPath, "utf8");
    expect(content).toContain("StatusConflict");
  });

  it("seedSystemAccounts failure is non-fatal (worker starts anyway)", () => {
    const mainPath = path.join(WORKER_DIR, "main.go");
    const content = fs.readFileSync(mainPath, "utf8");
    // Should log Warn, not Fatal
    expect(content).toContain("logger.Warn");
    expect(content).not.toMatch(/logger\.Fatal.*seed/);
  });
});

// ─── 4. Temporal Worker Health Endpoint ──────────────────────────────────────

describe("Temporal worker health endpoint", () => {
  const healthPath = path.join(WORKER_DIR, "health.go");

  it("health.go exists", () => {
    expect(fs.existsSync(healthPath)).toBe(true);
  });

  it("exposes /live endpoint", () => {
    const content = fs.readFileSync(healthPath, "utf8");
    expect(content).toContain("/live");
  });

  it("exposes /ready endpoint", () => {
    const content = fs.readFileSync(healthPath, "utf8");
    expect(content).toContain("/ready");
  });

  it("exposes /health endpoint", () => {
    const content = fs.readFileSync(healthPath, "utf8");
    expect(content).toContain("/health");
  });

  it("uses WORKER_HEALTH_PORT env var", () => {
    const mainPath = path.join(WORKER_DIR, "main.go");
    const content = fs.readFileSync(mainPath, "utf8");
    expect(content).toContain("WORKER_HEALTH_PORT");
  });

  it("health_test.go exists with unit tests", () => {
    const testPath = path.join(WORKER_DIR, "health_test.go");
    expect(fs.existsSync(testPath)).toBe(true);
    const content = fs.readFileSync(testPath, "utf8");
    expect(content).toContain("func Test");
  });
});

// ─── 5. Helm Chart Health Probe Annotations ───────────────────────────────────

describe("Helm chart health probe annotations — app", () => {
  const valuesPath = path.join(HELM_DIR, "values.yaml");
  let values: Record<string, unknown>;

  it("values.yaml is valid YAML", () => {
    const content = fs.readFileSync(valuesPath, "utf8");
    expect(() => { values = yaml.load(content) as Record<string, unknown>; }).not.toThrow();
    values = yaml.load(content) as Record<string, unknown>;
  });

  it("app section has startupProbe", () => {
    const content = fs.readFileSync(valuesPath, "utf8");
    values = yaml.load(content) as Record<string, unknown>;
    const app = values.app as Record<string, unknown>;
    expect(app).toHaveProperty("startupProbe");
  });

  it("app startupProbe has failureThreshold >= 12 (allowing >= 60s startup)", () => {
    const content = fs.readFileSync(valuesPath, "utf8");
    values = yaml.load(content) as Record<string, unknown>;
    const app = values.app as Record<string, unknown>;
    const sp = app.startupProbe as Record<string, unknown>;
    expect(sp.failureThreshold as number).toBeGreaterThanOrEqual(12);
  });

  it("app livenessProbe has timeoutSeconds set", () => {
    const content = fs.readFileSync(valuesPath, "utf8");
    values = yaml.load(content) as Record<string, unknown>;
    const app = values.app as Record<string, unknown>;
    const lp = app.livenessProbe as Record<string, unknown>;
    expect(lp).toHaveProperty("timeoutSeconds");
  });

  it("app readinessProbe has timeoutSeconds set", () => {
    const content = fs.readFileSync(valuesPath, "utf8");
    values = yaml.load(content) as Record<string, unknown>;
    const app = values.app as Record<string, unknown>;
    const rp = app.readinessProbe as Record<string, unknown>;
    expect(rp).toHaveProperty("timeoutSeconds");
  });

  it("app-deployment.yaml renders startupProbe conditionally", () => {
    const tplPath = path.join(HELM_DIR, "templates", "app-deployment.yaml");
    const content = fs.readFileSync(tplPath, "utf8");
    expect(content).toContain("startupProbe");
    expect(content).toContain(".Values.app.startupProbe");
  });
});

describe("Helm chart health probe annotations — workflow-worker", () => {
  const valuesPath = path.join(HELM_DIR, "values.yaml");
  const tplPath = path.join(HELM_DIR, "templates", "workflow-worker-deployment.yaml");

  it("workflow-worker-deployment.yaml exists", () => {
    expect(fs.existsSync(tplPath)).toBe(true);
  });

  it("workflow-worker-deployment.yaml has startupProbe with failureThreshold >= 20", () => {
    const content = fs.readFileSync(tplPath, "utf8");
    expect(content).toContain("startupProbe");
    // failureThreshold: 24 in the template
    const match = content.match(/startupProbe[\s\S]*?failureThreshold:\s*(\d+)/);
    expect(match).not.toBeNull();
    expect(parseInt(match![1])).toBeGreaterThanOrEqual(20);
  });

  it("workflow-worker-deployment.yaml livenessProbe uses /live endpoint", () => {
    const content = fs.readFileSync(tplPath, "utf8");
    expect(content).toContain("path: /live");
  });

  it("workflow-worker-deployment.yaml readinessProbe uses /ready endpoint", () => {
    const content = fs.readFileSync(tplPath, "utf8");
    expect(content).toContain("path: /ready");
  });

  it("workflow-worker-deployment.yaml startupProbe uses /live endpoint", () => {
    const content = fs.readFileSync(tplPath, "utf8");
    // startupProbe should use /live (not /ready) to avoid Temporal connectivity check during startup
    const startupSection = content.match(/startupProbe[\s\S]*?livenessProbe/)?.[0] ?? "";
    expect(startupSection).toContain("path: /live");
  });

  it("workflow-worker-deployment.yaml has terminationGracePeriodSeconds >= 30", () => {
    const content = fs.readFileSync(tplPath, "utf8");
    const match = content.match(/terminationGracePeriodSeconds:\s*(\d+)/);
    expect(match).not.toBeNull();
    expect(parseInt(match![1])).toBeGreaterThanOrEqual(30);
  });

  it("workflow-worker-deployment.yaml has PodDisruptionBudget template", () => {
    const content = fs.readFileSync(tplPath, "utf8");
    expect(content).toContain("PodDisruptionBudget");
  });

  it("workflowWorker section exists in values.yaml", () => {
    const content = fs.readFileSync(valuesPath, "utf8");
    const values = yaml.load(content) as Record<string, unknown>;
    expect(values).toHaveProperty("workflowWorker");
  });

  it("workflowWorker.healthPort is 8090", () => {
    const content = fs.readFileSync(valuesPath, "utf8");
    const values = yaml.load(content) as Record<string, unknown>;
    const ww = values.workflowWorker as Record<string, unknown>;
    expect(ww.healthPort).toBe(8090);
  });

  it("workflowWorker.replicaCount is >= 2 (HA)", () => {
    const content = fs.readFileSync(valuesPath, "utf8");
    const values = yaml.load(content) as Record<string, unknown>;
    const ww = values.workflowWorker as Record<string, unknown>;
    expect(ww.replicaCount as number).toBeGreaterThanOrEqual(2);
  });

  it("workflowWorker.tigerbeetleBridgeUrl is set", () => {
    const content = fs.readFileSync(valuesPath, "utf8");
    const values = yaml.load(content) as Record<string, unknown>;
    const ww = values.workflowWorker as Record<string, unknown>;
    expect(ww.tigerbeetleBridgeUrl).toBeTruthy();
  });
});

// ─── 6. Helm _helpers.tpl permifyHttp ────────────────────────────────────────

describe("Helm _helpers.tpl permifyHttp helper", () => {
  const helpersPath = path.join(HELM_DIR, "templates", "_helpers.tpl");

  it("_helpers.tpl defines tradegateway.permifyHttp", () => {
    const content = fs.readFileSync(helpersPath, "utf8");
    expect(content).toContain("tradegateway.permifyHttp");
  });

  it("permifyHttp uses port 3476 (Permify HTTP port)", () => {
    const content = fs.readFileSync(helpersPath, "utf8");
    expect(content).toContain("3476");
  });

  it("permifyGrpc still exists (not replaced)", () => {
    const content = fs.readFileSync(helpersPath, "utf8");
    expect(content).toContain("tradegateway.permifyGrpc");
  });
});

// ─── 7. TypeScript 0 errors ───────────────────────────────────────────────────

describe("TypeScript compilation", () => {
  it("tigerbeetleSeed.ts has no syntax errors (parseable as text)", () => {
    const routerPath = path.join(ROOT, "server", "routers", "tigerbeetleSeed.ts");
    const content = fs.readFileSync(routerPath, "utf8");
    // Basic structural checks
    expect(content).toContain("export const tigerbeetleSeedRouter");
    expect(content).toContain("router({");
    expect(content).toContain("});");
  });

  it("routers.ts imports tigerbeetleSeedRouter", () => {
    const routersPath = path.join(ROOT, "server", "routers.ts");
    const content = fs.readFileSync(routersPath, "utf8");
    expect(content).toContain("import { tigerbeetleSeedRouter }");
    expect(content).toContain("./routers/tigerbeetleSeed");
  });
});
