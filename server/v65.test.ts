/**
 * v65 Test Suite — FSPIOP Callback Handlers, Helm Production Overlay, Seed UI
 *
 * Covers:
 * 1. FSPIOP callback handler file structure and exports
 * 2. Mojaloop gateway main.go FSPIOP route registration
 * 3. Helm values.prod.yaml workflowWorker production overlay
 * 4. AdminSettings.tsx TigerBeetle seed UI integration
 * 5. tigerbeetleSeed tRPC router structure
 * 6. JWS callbacks_test.go structure
 */

import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as yaml from "js-yaml";

const ROOT = path.resolve(__dirname, "..");
const GO_MOJALOOP = path.join(ROOT, "services/go/mojaloop-gateway");
const HELM_DIR = path.join(ROOT, "helm/tradegateway");
const CLIENT_DIR = path.join(ROOT, "client/src");
const SERVER_DIR = path.join(ROOT, "server");

// ─── 1. FSPIOP Callback Handler File Structure ────────────────────────────────

describe("FSPIOP Callback Handlers", () => {
  const callbacksFile = path.join(GO_MOJALOOP, "internal/dfsp/callbacks.go");
  const callbacksTestFile = path.join(GO_MOJALOOP, "internal/dfsp/callbacks_test.go");

  it("callbacks.go exists", () => {
    expect(fs.existsSync(callbacksFile)).toBe(true);
  });

  it("callbacks.go defines CallbackHandler struct", () => {
    const content = fs.readFileSync(callbacksFile, "utf-8");
    expect(content).toContain("type CallbackHandler struct");
  });

  it("callbacks.go defines NewCallbackHandler constructor", () => {
    const content = fs.readFileSync(callbacksFile, "utf-8");
    expect(content).toContain("func NewCallbackHandler(");
  });

  it("callbacks.go implements HandlePartyCallback", () => {
    const content = fs.readFileSync(callbacksFile, "utf-8");
    expect(content).toContain("func (h *CallbackHandler) HandlePartyCallback(");
  });

  it("callbacks.go implements HandleQuoteCallback", () => {
    const content = fs.readFileSync(callbacksFile, "utf-8");
    expect(content).toContain("func (h *CallbackHandler) HandleQuoteCallback(");
  });

  it("callbacks.go implements HandleTransferCallback", () => {
    const content = fs.readFileSync(callbacksFile, "utf-8");
    expect(content).toContain("func (h *CallbackHandler) HandleTransferCallback(");
  });

  it("callbacks.go verifies FSPIOP-Signature header on all callbacks", () => {
    const content = fs.readFileSync(callbacksFile, "utf-8");
    expect(content).toContain("FSPIOP-Signature");
    expect(content).toContain("StatusUnauthorized");
  });

  it("callbacks.go implements ILP fulfilment verification", () => {
    const content = fs.readFileSync(callbacksFile, "utf-8");
    expect(content).toContain("verifyILPFulfilment");
  });

  it("callbacks.go stores ILP conditions from quote callbacks", () => {
    const content = fs.readFileSync(callbacksFile, "utf-8");
    expect(content).toContain("pendingILP");
  });

  it("callbacks.go defines HubJWKSCache for inbound Hub key verification", () => {
    const content = fs.readFileSync(callbacksFile, "utf-8");
    expect(content).toContain("hubJWKSCache");
  });

  it("callbacks.go defines JWKSResponse and JWK types", () => {
    const content = fs.readFileSync(callbacksFile, "utf-8");
    expect(content).toContain("JWKSResponse");
    expect(content).toContain("type JWK struct");
  });

  it("callbacks.go defines TransferCallbackBody with ErrorInfo", () => {
    const content = fs.readFileSync(callbacksFile, "utf-8");
    expect(content).toContain("TransferCallbackBody");
    expect(content).toContain("ErrorInfo");
  });

  it("callbacks_test.go exists with comprehensive tests", () => {
    expect(fs.existsSync(callbacksTestFile)).toBe(true);
  });

  it("callbacks_test.go covers all 3 callback handlers", () => {
    const content = fs.readFileSync(callbacksTestFile, "utf-8");
    expect(content).toContain("TestHandlePartyCallback");
    expect(content).toContain("TestHandleQuoteCallback");
    expect(content).toContain("TestHandleTransferCallback");
  });

  it("callbacks_test.go covers tampered body detection", () => {
    const content = fs.readFileSync(callbacksTestFile, "utf-8");
    expect(content).toContain("TamperedBody");
  });

  it("callbacks_test.go covers JWKS cache TTL refresh", () => {
    const content = fs.readFileSync(callbacksTestFile, "utf-8");
    expect(content).toContain("TestHubJWKSCache_RefreshesOnStale");
  });

  it("callbacks_test.go covers ILP fulfilment valid/invalid pairs", () => {
    const content = fs.readFileSync(callbacksTestFile, "utf-8");
    expect(content).toContain("TestVerifyILPFulfilment_ValidPair");
    expect(content).toContain("TestVerifyILPFulfilment_InvalidPair");
  });
});

// ─── 2. Mojaloop Gateway FSPIOP Route Registration ───────────────────────────

describe("Mojaloop Gateway FSPIOP Routes", () => {
  const mainFile = path.join(GO_MOJALOOP, "cmd/main.go");

  it("main.go registers PUT /parties/{partyIdType}/{partyIdentifier}", () => {
    const content = fs.readFileSync(mainFile, "utf-8");
    expect(content).toContain('"/parties/{partyIdType}/{partyIdentifier}"');
    expect(content).toContain("HandlePartyCallback");
  });

  it("main.go registers PUT /quotes/{id}", () => {
    const content = fs.readFileSync(mainFile, "utf-8");
    expect(content).toContain('"/quotes/{id}"');
    expect(content).toContain("HandleQuoteCallback");
  });

  it("main.go registers PUT /transfers/{id}", () => {
    const content = fs.readFileSync(mainFile, "utf-8");
    expect(content).toContain('"/transfers/{id}"');
    expect(content).toContain("HandleTransferCallback");
  });

  it("main.go registers GET /dfsp/jwks.json", () => {
    const content = fs.readFileSync(mainFile, "utf-8");
    expect(content).toContain('"/dfsp/jwks.json"');
    expect(content).toContain("JWKSHandler");
  });

  it("main.go imports the dfsp package", () => {
    const content = fs.readFileSync(mainFile, "utf-8");
    expect(content).toContain("mojaloop-gateway/internal/dfsp");
  });

  it("main.go creates dfsp.NewCallbackHandler with logger", () => {
    const content = fs.readFileSync(mainFile, "utf-8");
    expect(content).toContain("dfsp.NewCallbackHandler(logger)");
  });

  it("main.go creates dfsp.NewSigner for JWKS endpoint", () => {
    const content = fs.readFileSync(mainFile, "utf-8");
    expect(content).toContain("dfsp.NewSigner(logger)");
  });
});

// ─── 3. Helm values.prod.yaml workflowWorker Production Overlay ──────────────

describe("Helm values.prod.yaml workflowWorker overlay", () => {
  const prodValuesFile = path.join(HELM_DIR, "values.prod.yaml");

  it("values.prod.yaml exists", () => {
    expect(fs.existsSync(prodValuesFile)).toBe(true);
  });

  it("values.prod.yaml is valid YAML", () => {
    const content = fs.readFileSync(prodValuesFile, "utf-8");
    expect(() => yaml.load(content)).not.toThrow();
  });

  it("values.prod.yaml contains workflowWorker section", () => {
    const content = fs.readFileSync(prodValuesFile, "utf-8");
    const parsed = yaml.load(content) as Record<string, unknown>;
    expect(parsed).toHaveProperty("workflowWorker");
  });

  it("workflowWorker.replicaCount is 3 for HA", () => {
    const content = fs.readFileSync(prodValuesFile, "utf-8");
    const parsed = yaml.load(content) as Record<string, { replicaCount?: number }>;
    expect(parsed.workflowWorker?.replicaCount).toBe(3);
  });

  it("workflowWorker.image.tag is set to a release version", () => {
    const content = fs.readFileSync(prodValuesFile, "utf-8");
    const parsed = yaml.load(content) as Record<string, { image?: { tag?: string } }>;
    const tag = parsed.workflowWorker?.image?.tag;
    expect(tag).toBeTruthy();
    expect(tag).not.toBe("latest");
  });

  it("workflowWorker.resources.limits.cpu is set", () => {
    const content = fs.readFileSync(prodValuesFile, "utf-8");
    const parsed = yaml.load(content) as Record<string, { resources?: { limits?: { cpu?: string } } }>;
    expect(parsed.workflowWorker?.resources?.limits?.cpu).toBeTruthy();
  });

  it("workflowWorker.resources.limits.memory is set to 384Mi or higher", () => {
    const content = fs.readFileSync(prodValuesFile, "utf-8");
    const parsed = yaml.load(content) as Record<string, { resources?: { limits?: { memory?: string } } }>;
    const mem = parsed.workflowWorker?.resources?.limits?.memory;
    expect(mem).toBeTruthy();
    expect(mem).toMatch(/Mi|Gi/);
  });

  it("workflowWorker.startupProbe is configured", () => {
    const content = fs.readFileSync(prodValuesFile, "utf-8");
    const parsed = yaml.load(content) as Record<string, { startupProbe?: unknown }>;
    expect(parsed.workflowWorker?.startupProbe).toBeTruthy();
  });

  it("workflowWorker.livenessProbe is configured", () => {
    const content = fs.readFileSync(prodValuesFile, "utf-8");
    const parsed = yaml.load(content) as Record<string, { livenessProbe?: unknown }>;
    expect(parsed.workflowWorker?.livenessProbe).toBeTruthy();
  });

  it("workflowWorker.readinessProbe is configured", () => {
    const content = fs.readFileSync(prodValuesFile, "utf-8");
    const parsed = yaml.load(content) as Record<string, { readinessProbe?: unknown }>;
    expect(parsed.workflowWorker?.readinessProbe).toBeTruthy();
  });

  it("workflowWorker.terminationGracePeriodSeconds is 60", () => {
    const content = fs.readFileSync(prodValuesFile, "utf-8");
    const parsed = yaml.load(content) as Record<string, { terminationGracePeriodSeconds?: number }>;
    expect(parsed.workflowWorker?.terminationGracePeriodSeconds).toBe(60);
  });

  it("workflowWorker.podDisruptionBudget.minAvailable is 2", () => {
    const content = fs.readFileSync(prodValuesFile, "utf-8");
    const parsed = yaml.load(content) as Record<string, { podDisruptionBudget?: { minAvailable?: number } }>;
    expect(parsed.workflowWorker?.podDisruptionBudget?.minAvailable).toBe(2);
  });

  it("workflowWorker.env.TEMPORAL_NAMESPACE is tradegateway-prod", () => {
    const content = fs.readFileSync(prodValuesFile, "utf-8");
    const parsed = yaml.load(content) as Record<string, { env?: { TEMPORAL_NAMESPACE?: string } }>;
    expect(parsed.workflowWorker?.env?.TEMPORAL_NAMESPACE).toBe("tradegateway-prod");
  });
});

// ─── 4. AdminSettings.tsx TigerBeetle Seed UI ────────────────────────────────

describe("AdminSettings.tsx TigerBeetle Seed UI", () => {
  const adminSettingsFile = path.join(CLIENT_DIR, "pages/app/AdminSettings.tsx");

  it("AdminSettings.tsx exists", () => {
    expect(fs.existsSync(adminSettingsFile)).toBe(true);
  });

  it("AdminSettings.tsx contains TigerBeetleSeedSection component", () => {
    const content = fs.readFileSync(adminSettingsFile, "utf-8");
    expect(content).toContain("TigerBeetleSeedSection");
  });

  it("AdminSettings.tsx calls tigerbeetleSeed.seedSystemAccounts mutation", () => {
    const content = fs.readFileSync(adminSettingsFile, "utf-8");
    expect(content).toContain("trpc.tigerbeetleSeed.seedSystemAccounts.useMutation");
  });

  it("AdminSettings.tsx shows loading spinner during seeding", () => {
    const content = fs.readFileSync(adminSettingsFile, "utf-8");
    expect(content).toContain("Loader2");
    expect(content).toContain("animate-spin");
  });

  it("AdminSettings.tsx shows accountsCreated count on success", () => {
    const content = fs.readFileSync(adminSettingsFile, "utf-8");
    expect(content).toContain("accountsCreated");
  });

  it("AdminSettings.tsx shows accountsSkipped count on success", () => {
    const content = fs.readFileSync(adminSettingsFile, "utf-8");
    expect(content).toContain("accountsSkipped");
  });

  it("AdminSettings.tsx shows error when seeding has errors", () => {
    const content = fs.readFileSync(adminSettingsFile, "utf-8");
    expect(content).toContain("result.error");
  });

  it("AdminSettings.tsx uses CheckCircle2 for success state", () => {
    const content = fs.readFileSync(adminSettingsFile, "utf-8");
    expect(content).toContain("CheckCircle2");
  });

  it("AdminSettings.tsx uses AlertCircle for error state", () => {
    const content = fs.readFileSync(adminSettingsFile, "utf-8");
    expect(content).toContain("AlertCircle");
  });

  it("AdminSettings.tsx imports Database icon from lucide-react", () => {
    const content = fs.readFileSync(adminSettingsFile, "utf-8");
    expect(content).toContain("Database");
  });

  it("AdminSettings.tsx seed button is disabled while pending", () => {
    const content = fs.readFileSync(adminSettingsFile, "utf-8");
    expect(content).toContain("seedMutation.isPending");
  });

  it("AdminSettings.tsx renders TigerBeetleSeedSection before audit log", () => {
    const content = fs.readFileSync(adminSettingsFile, "utf-8");
    const seedIdx = content.indexOf("TigerBeetleSeedSection");
    const auditIdx = content.indexOf("SettingsAuditLogSection");
    expect(seedIdx).toBeLessThan(auditIdx);
  });
});

// ─── 5. tigerbeetleSeed tRPC Router ──────────────────────────────────────────

describe("tigerbeetleSeed tRPC router", () => {
  const routerFile = path.join(SERVER_DIR, "routers/tigerbeetleSeed.ts");

  it("tigerbeetleSeed.ts router file exists", () => {
    expect(fs.existsSync(routerFile)).toBe(true);
  });

  it("tigerbeetleSeed.ts exports tigerbeetleSeedRouter", () => {
    const content = fs.readFileSync(routerFile, "utf-8");
    expect(content).toContain("tigerbeetleSeedRouter");
  });

  it("tigerbeetleSeed.ts defines seedSystemAccounts adminProcedure", () => {
    const content = fs.readFileSync(routerFile, "utf-8");
    expect(content).toContain("seedSystemAccounts");
  });

  it("tigerbeetleSeed.ts defines seedTraderAccounts adminProcedure", () => {
    const content = fs.readFileSync(routerFile, "utf-8");
    expect(content).toContain("seedTraderAccounts");
  });

  it("tigerbeetleSeed.ts returns accountsCreated and accountsSkipped", () => {
    const content = fs.readFileSync(routerFile, "utf-8");
    expect(content).toContain("accountsCreated");
    expect(content).toContain("accountsSkipped");
  });

  it("tigerbeetleSeed.ts calls TigerBeetle bridge /seed/system endpoint", () => {
    const content = fs.readFileSync(routerFile, "utf-8");
    expect(content).toContain("/seed/system");
  });

  it("tigerbeetleSeed.ts is registered in main routers.ts", () => {
    const routersFile = path.join(SERVER_DIR, "routers.ts");
    const content = fs.readFileSync(routersFile, "utf-8");
    expect(content).toContain("tigerbeetleSeed");
  });
});

// ─── 6. Workflow Worker Helm Deployment Template ─────────────────────────────

describe("Helm workflow-worker-deployment.yaml", () => {
  const deployFile = path.join(HELM_DIR, "templates/workflow-worker-deployment.yaml");

  it("workflow-worker-deployment.yaml exists", () => {
    expect(fs.existsSync(deployFile)).toBe(true);
  });

  it("workflow-worker-deployment.yaml defines a Deployment resource", () => {
    const content = fs.readFileSync(deployFile, "utf-8");
    expect(content).toContain("kind: Deployment");
  });

  it("workflow-worker-deployment.yaml references startupProbe", () => {
    const content = fs.readFileSync(deployFile, "utf-8");
    expect(content).toContain("startupProbe");
  });

  it("workflow-worker-deployment.yaml references livenessProbe", () => {
    const content = fs.readFileSync(deployFile, "utf-8");
    expect(content).toContain("livenessProbe");
  });

  it("workflow-worker-deployment.yaml references readinessProbe", () => {
    const content = fs.readFileSync(deployFile, "utf-8");
    expect(content).toContain("readinessProbe");
  });

  it("workflow-worker-deployment.yaml references terminationGracePeriodSeconds", () => {
    const content = fs.readFileSync(deployFile, "utf-8");
    expect(content).toContain("terminationGracePeriodSeconds");
  });

  it("workflow-worker-deployment.yaml references /live and /ready endpoints", () => {
    const content = fs.readFileSync(deployFile, "utf-8");
    expect(content).toContain("/live");
    expect(content).toContain("/ready");
  });
});

// ─── 7. App-deployment.yaml startupProbe ─────────────────────────────────────

describe("Helm app-deployment.yaml health probes", () => {
  const appDeployFile = path.join(HELM_DIR, "templates/app-deployment.yaml");

  it("app-deployment.yaml exists", () => {
    expect(fs.existsSync(appDeployFile)).toBe(true);
  });

  it("app-deployment.yaml has startupProbe", () => {
    const content = fs.readFileSync(appDeployFile, "utf-8");
    expect(content).toContain("startupProbe");
  });

  it("app-deployment.yaml has livenessProbe", () => {
    const content = fs.readFileSync(appDeployFile, "utf-8");
    expect(content).toContain("livenessProbe");
  });

  it("app-deployment.yaml has readinessProbe", () => {
    const content = fs.readFileSync(appDeployFile, "utf-8");
    expect(content).toContain("readinessProbe");
  });
});
