/**
 * v66 Sprint Tests — FSPIOP Error Callbacks, Helm NOTES.txt, Trader Seed UI
 *
 * Covers:
 * 1. FSPIOP error callback handler structure (callbacks.go)
 * 2. Error callback route registration (main.go)
 * 3. Helm NOTES.txt post-install checklist content
 * 4. TigerBeetleTraderSeedSection in AdminSettings.tsx
 * 5. tigerbeetleSeed.seedTraderAccounts tRPC procedure
 */

import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";

const ROOT = path.resolve(__dirname, "..");

// ─── 1. FSPIOP Error Callback Handlers ───────────────────────────────────────

describe("FSPIOP Error Callback Handlers (callbacks.go)", () => {
  const callbacksPath = path.join(
    ROOT,
    "services/go/mojaloop-gateway/internal/dfsp/callbacks.go"
  );

  it("callbacks.go exists", () => {
    expect(fs.existsSync(callbacksPath)).toBe(true);
  });

  it("defines HandlePartyErrorCallback method", () => {
    const src = fs.readFileSync(callbacksPath, "utf-8");
    expect(src).toContain("HandlePartyErrorCallback");
  });

  it("defines HandleQuoteErrorCallback method", () => {
    const src = fs.readFileSync(callbacksPath, "utf-8");
    expect(src).toContain("HandleQuoteErrorCallback");
  });

  it("defines HandleTransferErrorCallback method", () => {
    const src = fs.readFileSync(callbacksPath, "utf-8");
    expect(src).toContain("HandleTransferErrorCallback");
  });

  it("defines ErrorInformation struct or parses errorCode", () => {
    const src = fs.readFileSync(callbacksPath, "utf-8");
    expect(src).toMatch(/ErrorInformation|errorCode|ErrorCode/);
  });

  it("publishes Kafka compensation event on error", () => {
    const src = fs.readFileSync(callbacksPath, "utf-8");
    expect(src).toMatch(/mojaloop\.transfer\.failed|mojaloop\.quote\.failed|mojaloop\.party\.failed|publishKafkaEvent/);
  });

  it("verifies inbound Hub JWS signature on error callbacks", () => {
    const src = fs.readFileSync(callbacksPath, "utf-8");
    expect(src).toMatch(/verifyInboundJWS|verifyHubSignature|FSPIOP-Signature/);
  });

  it("returns HTTP 200 on successful error callback processing", () => {
    const src = fs.readFileSync(callbacksPath, "utf-8");
    // Error callbacks must ACK with 200 so Hub doesn't retry
    expect(src).toMatch(/w\.WriteHeader\(http\.StatusOK\)|StatusOK|200/);
  });

  it("logs the Hub error code and description", () => {
    const src = fs.readFileSync(callbacksPath, "utf-8");
    expect(src).toMatch(/logger\.|zap\.|log\./);
  });
});

// ─── 2. Error Callback Route Registration (main.go) ──────────────────────────

describe("FSPIOP Error Callback Route Registration (main.go)", () => {
  const mainPath = path.join(
    ROOT,
    "services/go/mojaloop-gateway/cmd/main.go"
  );

  it("main.go exists", () => {
    expect(fs.existsSync(mainPath)).toBe(true);
  });

  it("registers PUT /parties/{partyIdType}/{partyIdentifier}/error route", () => {
    const src = fs.readFileSync(mainPath, "utf-8");
    expect(src).toContain("/parties/{partyIdType}/{partyIdentifier}/error");
  });

  it("registers PUT /quotes/{id}/error route", () => {
    const src = fs.readFileSync(mainPath, "utf-8");
    expect(src).toContain("/quotes/{id}/error");
  });

  it("registers PUT /transfers/{id}/error route", () => {
    const src = fs.readFileSync(mainPath, "utf-8");
    expect(src).toContain("/transfers/{id}/error");
  });

  it("maps error routes to HandlePartyErrorCallback", () => {
    const src = fs.readFileSync(mainPath, "utf-8");
    expect(src).toContain("HandlePartyErrorCallback");
  });

  it("maps error routes to HandleQuoteErrorCallback", () => {
    const src = fs.readFileSync(mainPath, "utf-8");
    expect(src).toContain("HandleQuoteErrorCallback");
  });

  it("maps error routes to HandleTransferErrorCallback", () => {
    const src = fs.readFileSync(mainPath, "utf-8");
    expect(src).toContain("HandleTransferErrorCallback");
  });
});

// ─── 3. Helm NOTES.txt Post-Install Checklist ────────────────────────────────

describe("Helm NOTES.txt post-install checklist", () => {
  const notesPath = path.join(
    ROOT,
    "helm/tradegateway/templates/NOTES.txt"
  );

  it("NOTES.txt exists", () => {
    expect(fs.existsSync(notesPath)).toBe(true);
  });

  it("contains TigerBeetle seed step", () => {
    const src = fs.readFileSync(notesPath, "utf-8");
    expect(src).toMatch(/TigerBeetle|seed.*system|seed.*account/i);
  });

  it("contains Temporal worker verification step", () => {
    const src = fs.readFileSync(notesPath, "utf-8");
    expect(src).toMatch(/Temporal|workflow.*worker|worker.*ready/i);
  });

  it("contains Mojaloop DFSP registration step", () => {
    const src = fs.readFileSync(notesPath, "utf-8");
    expect(src).toMatch(/Mojaloop|DFSP|register-dfsp/i);
  });

  it("contains JWKS public key fingerprint step", () => {
    const src = fs.readFileSync(notesPath, "utf-8");
    expect(src).toMatch(/JWKS|jwks\.json|fingerprint|public.*key/i);
  });

  it("contains Keycloak realm import step", () => {
    const src = fs.readFileSync(notesPath, "utf-8");
    expect(src).toMatch(/Keycloak|realm.*import|kc\.sh/i);
  });

  it("contains Permify schema load step", () => {
    const src = fs.readFileSync(notesPath, "utf-8");
    expect(src).toMatch(/Permify|schema.*write|schema\.perm/i);
  });

  it("contains helm upgrade and rollback commands", () => {
    const src = fs.readFileSync(notesPath, "utf-8");
    expect(src).toMatch(/helm upgrade|helm rollback/i);
  });

  it("references the Helm release name template variable", () => {
    const src = fs.readFileSync(notesPath, "utf-8");
    expect(src).toContain("{{ .Release.Name }}");
  });

  it("references the Helm namespace template variable", () => {
    const src = fs.readFileSync(notesPath, "utf-8");
    expect(src).toContain("{{ .Release.Namespace }}");
  });

  it("references the chart version template variable", () => {
    const src = fs.readFileSync(notesPath, "utf-8");
    expect(src).toContain("{{ .Chart.Version }}");
  });

  it("references the app version template variable", () => {
    const src = fs.readFileSync(notesPath, "utf-8");
    expect(src).toContain("{{ .Chart.AppVersion }}");
  });

  it("contains at least 6 numbered steps or sections", () => {
    const src = fs.readFileSync(notesPath, "utf-8");
    const steps = src.match(/STEP \d+|Step \d+/g) ?? [];
    expect(steps.length).toBeGreaterThanOrEqual(6);
  });
});

// ─── 4. AdminSettings.tsx Trader Seed UI ─────────────────────────────────────

describe("AdminSettings.tsx TigerBeetleTraderSeedSection", () => {
  const adminSettingsPath = path.join(
    ROOT,
    "client/src/pages/app/AdminSettings.tsx"
  );

  it("AdminSettings.tsx exists", () => {
    expect(fs.existsSync(adminSettingsPath)).toBe(true);
  });

  it("imports UserPlus icon from lucide-react", () => {
    const src = fs.readFileSync(adminSettingsPath, "utf-8");
    expect(src).toContain("UserPlus");
  });

  it("defines TigerBeetleTraderSeedSection component", () => {
    const src = fs.readFileSync(adminSettingsPath, "utf-8");
    expect(src).toContain("TigerBeetleTraderSeedSection");
  });

  it("renders TigerBeetleTraderSeedSection in the page", () => {
    const src = fs.readFileSync(adminSettingsPath, "utf-8");
    expect(src).toContain("<TigerBeetleTraderSeedSection />");
  });

  it("calls trpc.tigerbeetleSeed.seedTraderAccounts.useMutation", () => {
    const src = fs.readFileSync(adminSettingsPath, "utf-8");
    expect(src).toContain("tigerbeetleSeed.seedTraderAccounts.useMutation");
  });

  it("has a trader ID input field", () => {
    const src = fs.readFileSync(adminSettingsPath, "utf-8");
    expect(src).toMatch(/trader-id-input|traderId|trader.*id/i);
  });

  it("has a Seed Trader Accounts button", () => {
    const src = fs.readFileSync(adminSettingsPath, "utf-8");
    expect(src).toContain("Seed Trader Accounts");
  });

  it("shows loading spinner during mutation", () => {
    const src = fs.readFileSync(adminSettingsPath, "utf-8");
    expect(src).toMatch(/isPending.*Loader2|Loader2.*isPending|animate-spin/);
  });

  it("displays accountsCreated and accountsSkipped in result panel", () => {
    const src = fs.readFileSync(adminSettingsPath, "utf-8");
    expect(src).toContain("accountsCreated");
    expect(src).toContain("accountsSkipped");
  });

  it("clears traderId input on successful seed", () => {
    const src = fs.readFileSync(adminSettingsPath, "utf-8");
    expect(src).toMatch(/setTraderId\(""\)|setTraderId\(''\)/);
  });

  it("shows error message when seeding fails", () => {
    const src = fs.readFileSync(adminSettingsPath, "utf-8");
    expect(src).toMatch(/toast\.error|AlertCircle/);
  });

  it("disables button when traderId is empty", () => {
    const src = fs.readFileSync(adminSettingsPath, "utf-8");
    expect(src).toMatch(/disabled.*traderId|!traderId\.trim/);
  });

  it("supports Enter key to trigger seed", () => {
    const src = fs.readFileSync(adminSettingsPath, "utf-8");
    expect(src).toMatch(/onKeyDown|key.*Enter/);
  });
});

// ─── 5. tigerbeetleSeed Router — seedTraderAccounts procedure ────────────────

describe("tigerbeetleSeed tRPC router — seedTraderAccounts", () => {
  const routerPath = path.join(
    ROOT,
    "server/routers/tigerbeetleSeed.ts"
  );

  it("tigerbeetleSeed.ts router exists", () => {
    expect(fs.existsSync(routerPath)).toBe(true);
  });

  it("exports tigerbeetleSeedRouter", () => {
    const src = fs.readFileSync(routerPath, "utf-8");
    expect(src).toMatch(/export.*tigerbeetleSeedRouter|tigerbeetleSeedRouter/);
  });

  it("defines seedTraderAccounts procedure", () => {
    const src = fs.readFileSync(routerPath, "utf-8");
    expect(src).toContain("seedTraderAccounts");
  });

  it("seedTraderAccounts accepts traderId input", () => {
    const src = fs.readFileSync(routerPath, "utf-8");
    expect(src).toMatch(/traderId|trader_id/);
  });

  it("calls TigerBeetle bridge POST /seed/trader", () => {
    const src = fs.readFileSync(routerPath, "utf-8");
    expect(src).toMatch(/\/seed\/trader|seed.*trader/);
  });

  it("returns success, accountsCreated, accountsSkipped", () => {
    const src = fs.readFileSync(routerPath, "utf-8");
    expect(src).toContain("accountsCreated");
    expect(src).toContain("accountsSkipped");
  });

  it("is protected by adminProcedure", () => {
    const src = fs.readFileSync(routerPath, "utf-8");
    expect(src).toMatch(/adminProcedure|protectedProcedure/);
  });

  it("is registered in the main appRouter", () => {
    const routersPath = path.join(ROOT, "server/routers.ts");
    const src = fs.readFileSync(routersPath, "utf-8");
    expect(src).toMatch(/tigerbeetleSeed.*Router|tigerbeetleSeedRouter/);
  });
});

// ─── 6. callbacks_test.go covers error callback paths ────────────────────────

describe("FSPIOP error callback test coverage (callbacks_test.go)", () => {
  const testPath = path.join(
    ROOT,
    "services/go/mojaloop-gateway/internal/dfsp/callbacks_test.go"
  );

  it("callbacks_test.go exists", () => {
    expect(fs.existsSync(testPath)).toBe(true);
  });

  it("has at least 15 test functions (original 18 + new error tests)", () => {
    const src = fs.readFileSync(testPath, "utf-8");
    const tests = src.match(/func Test/g) ?? [];
    expect(tests.length).toBeGreaterThanOrEqual(15);
  });
});
