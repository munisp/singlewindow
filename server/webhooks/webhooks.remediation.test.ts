/**
 * webhooks.remediation.test.ts — Phase-6 regression tests (Group 1)
 *
 * SW-5:    OGA webhook requires a valid HMAC signature ALWAYS (no fail-open),
 *          and replays are deduped by delivery id / body hash.
 * SW-S2-1: sanctions webhook requires the shared secret (timing-safe) even when
 *          configured, dedupes by screeningId, and holds (not rejects) declarations.
 * SW-S2-3: CEP webhook has no dev-default secret path, always verifies HMAC,
 *          allocates alert ids from a DB sequence (no COUNT+1 race), dedupes.
 * SW-MP10: webhook secret validator refuses boot in production on unset/dev secrets.
 * SW-24:   production gates refuse DEMO_MODE / E2E_TEST_MODE / MICROSERVICE_MOCK_HEALTH.
 * SW-MP14: production config rejects known dev secret values (e.g. REDIS_PASSWORD).
 * SW-S2-8: upload validation derives type from magic bytes, not client claims.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import nodeCrypto from "crypto";
import express from "express";
import type { AddressInfo } from "net";

// ── Shared mock state ────────────────────────────────────────────────────────
const state = {
  deliveries: new Set<string>(),
  poolQueries: [] as string[],
  alertInserts: [] as unknown[],
  declarationUpdates: [] as Array<Record<string, unknown>>,
  permitUpdates: [] as Array<Record<string, unknown>>,
  declarationSets: [] as Array<Record<string, unknown>>,
  securityAlerts: [] as Array<Record<string, unknown>>,
  permit: null as null | Record<string, unknown>,
  allPermits: [] as Array<Record<string, unknown>>,
};

function poolQuery(query: string, params?: unknown[]) {
  state.poolQueries.push(query);
  if (query.includes("webhook_receipts")) {
    const key = `${params?.[0]}:${params?.[1]}`;
    if (state.deliveries.has(key)) return { rowCount: 0, rows: [] };
    state.deliveries.add(key);
    return { rowCount: 1, rows: [] };
  }
  if (query.includes("nextval")) return { rows: [{ seq: 7 }], rowCount: 1 };
  if (query.includes("INSERT INTO cep_alerts")) {
    state.alertInserts.push(params);
    return { rows: [], rowCount: 1 };
  }
  return { rows: [], rowCount: 0 };
}

vi.mock("../db", () => ({
  getPool: vi.fn(() => ({ query: poolQuery })),
  getDb: vi.fn(async () => ({
    select: () => ({
      from: (table: unknown) => ({
        where: () => ({
          limit: async () => (state.permit ? [state.permit] : []),
          // Allows `await db.select().from(t).where(...)` (no .limit) — resolves
          // to the full permit list for the declaration.
          then: (resolve: (v: unknown) => unknown) => resolve(state.allPermits),
        }),
      }),
    }),
    update: (table: unknown) => ({
      set: (v: Record<string, unknown>) => ({
        where: async () => {
          if (v && "respondedAt" in v) state.permitUpdates.push(v);
          else state.declarationSets.push(v);
        },
      }),
    }),
  })),
  createSecurityAlert: vi.fn(async (d: Record<string, unknown>) => {
    state.securityAlerts.push(d);
    return { id: 99 };
  }),
  updateDeclaration: vi.fn(async (id: number, d: Record<string, unknown>) => {
    state.declarationUpdates.push({ id, ...d });
  }),
  getUsersByRole: vi.fn(async () => []),
  createUserNotification: vi.fn(async () => {}),
}));

vi.mock("../_core/notification", () => ({
  notifyOwner: vi.fn(async () => true),
}));

// ── Helpers ──────────────────────────────────────────────────────────────────
function hmac(secret: string, body: string): string {
  return "sha256=" + nodeCrypto.createHmac("sha256", secret).update(body).digest("hex");
}

async function startApp(register: (app: express.Express) => void, opts: { json?: boolean } = {}) {
  const app = express();
  // Only the sanctions webhook consumes a parsed JSON body; OGA/CEP register
  // their own express.raw parsers for HMAC over the exact payload bytes.
  if (opts.json) app.use(express.json());
  register(app);
  const server = app.listen(0);
  await new Promise((r) => server.once("listening", r));
  const port = (server.address() as AddressInfo).port;
  return { url: `http://127.0.0.1:${port}`, close: () => server.close() };
}

const OGA_SECRET = "tradegateway-oga-webhook-secret-dev";
const CEP_SECRET = "tradegateway-cep-webhook-secret-dev";
const SANCTIONS_SECRET = "tradegateway-sanctions-webhook-secret-dev";

beforeEach(() => {
  state.deliveries.clear();
  state.poolQueries = [];
  state.alertInserts = [];
  state.declarationUpdates = [];
  state.permitUpdates = [];
  state.declarationSets = [];
  state.securityAlerts = [];
  state.permit = { id: 11, declarationId: 5, agencyCode: "FDA", status: "pending", permitNumber: null };
});

describe("SW-5: OGA webhook signature enforcement", () => {
  async function app() {
    const { registerOgaWebhookRoute } = await import("./oga");
    return startApp(registerOgaWebhookRoute);
  }
  const body = JSON.stringify({
    agencyCode: "FDA", declarationId: 5, decision: "approved", decidedAt: "2026-01-01T00:00:00Z",
  });

  it("rejects requests with NO signature (fail closed, even in dev)", async () => {
    const a = await app();
    const res = await fetch(`${a.url}/api/webhooks/oga`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body,
    });
    expect(res.status).toBe(401);
    expect(state.permitUpdates).toHaveLength(0);
    a.close();
  });

  it("rejects a forged signature", async () => {
    const a = await app();
    const res = await fetch(`${a.url}/api/webhooks/oga`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-OGA-Signature": hmac("wrong-secret", body) },
      body,
    });
    expect(res.status).toBe(401);
    a.close();
  });

  it("processes a validly-signed decision once and dedupes the replay", async () => {
    state.allPermits = [state.permit!];
    const a = await app();
    const headers = { "Content-Type": "application/json", "X-OGA-Signature": hmac(OGA_SECRET, body) };
    const res1 = await fetch(`${a.url}/api/webhooks/oga`, { method: "POST", headers, body });
    expect(res1.status).toBe(200);
    const json1 = await res1.json() as any;
    expect(json1.newStatus).toBe("approved");
    const res2 = await fetch(`${a.url}/api/webhooks/oga`, { method: "POST", headers, body });
    expect(res2.status).toBe(200);
    const json2 = await res2.json() as any;
    expect(json2.duplicate).toBe(true);
    expect(state.permitUpdates).toHaveLength(1); // side effects applied exactly once
    a.close();
  });
});

describe("SW-S2-1/SW-22: sanctions webhook", () => {
  async function app() {
    const { registerSanctionsWebhookRoute } = await import("./sanctions");
    return startApp(registerSanctionsWebhookRoute, { json: true });
  }
  const payload = {
    entityName: "ACME Trading", matchedList: "OFAC", matchScore: 0.97,
    matchedEntry: "ACME TRADING LLC", screeningId: "SCR-1", timestamp: "2026-01-01T00:00:00Z",
    declarationId: 5,
  };

  it("rejects when the secret header is missing", async () => {
    const a = await app();
    const res = await fetch(`${a.url}/api/webhooks/sanctions-hit`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload),
    });
    expect(res.status).toBe(401);
    expect(state.securityAlerts).toHaveLength(0);
    a.close();
  });

  it("rejects a wrong secret", async () => {
    const a = await app();
    const res = await fetch(`${a.url}/api/webhooks/sanctions-hit`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Sanctions-Secret": "nope" },
      body: JSON.stringify(payload),
    });
    expect(res.status).toBe(401);
    a.close();
  });

  it("holds the declaration as held_sanctions (never 'rejected') and dedupes by screeningId", async () => {
    const a = await app();
    const headers = { "Content-Type": "application/json", "X-Sanctions-Secret": SANCTIONS_SECRET };
    const res1 = await fetch(`${a.url}/api/webhooks/sanctions-hit`, {
      method: "POST", headers, body: JSON.stringify(payload),
    });
    expect(res1.status).toBe(200);
    expect(state.declarationUpdates).toHaveLength(1);
    expect(state.declarationUpdates[0].status).toBe("held_sanctions");
    const res2 = await fetch(`${a.url}/api/webhooks/sanctions-hit`, {
      method: "POST", headers, body: JSON.stringify(payload),
    });
    expect(res2.status).toBe(200);
    expect((await res2.json() as any).duplicate).toBe(true);
    expect(state.securityAlerts).toHaveLength(1);
    a.close();
  });
});

describe("SW-S2-3/SW-23: CEP webhook", () => {
  async function app() {
    const { registerCepWebhookRoute } = await import("./cep");
    return startApp(registerCepWebhookRoute);
  }
  const body = JSON.stringify({
    patternId: "WCO-CEP-001", patternName: "Split Shipment", severity: "high",
    details: { trader: "T-1" }, riskScore: 80,
  });

  it("rejects unsigned events (no dev skip path)", async () => {
    const a = await app();
    const res = await fetch(`${a.url}/api/webhooks/cep-event`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body,
    });
    expect(res.status).toBe(401);
    expect(state.alertInserts).toHaveLength(0);
    a.close();
  });

  it("allocates alert ids from the cep_alert_seq sequence, not COUNT(*)+1", async () => {
    const a = await app();
    const res = await fetch(`${a.url}/api/webhooks/cep-event`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-CEP-Signature": hmac(CEP_SECRET, body) },
      body,
    });
    expect(res.status).toBe(201);
    const json = await res.json() as any;
    expect(json.alertId).toBe(`CEP-${new Date().getFullYear()}-0007`);
    expect(state.poolQueries.some((q) => q.includes("COUNT(*)"))).toBe(false);
    a.close();
  });

  it("dedupes a replayed delivery", async () => {
    const a = await app();
    const headers = { "Content-Type": "application/json", "X-CEP-Signature": hmac(CEP_SECRET, body) };
    await fetch(`${a.url}/api/webhooks/cep-event`, { method: "POST", headers, body });
    const res2 = await fetch(`${a.url}/api/webhooks/cep-event`, { method: "POST", headers, body });
    expect(res2.status).toBe(200);
    expect((await res2.json() as any).duplicate).toBe(true);
    expect(state.alertInserts).toHaveLength(1);
    a.close();
  });
});

describe("SW-MP10/SW-5: webhook secret validator", () => {
  it("getWebhookSecret throws in production when unset", async () => {
    const { getWebhookSecret } = await import("../_core/webhookSecretsValidator");
    const old = process.env.NODE_ENV;
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("TOTALLY_UNSET_SECRET", "");
    delete process.env.TOTALLY_UNSET_SECRET;
    expect(() => getWebhookSecret("TOTALLY_UNSET_SECRET", "x".repeat(40))).toThrow();
    vi.stubEnv("NODE_ENV", old ?? "test");
    vi.unstubAllEnvs();
  });

  it("getWebhookSecret throws in production on a known dev value", async () => {
    const { getWebhookSecret } = await import("../_core/webhookSecretsValidator");
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("SOME_HOOK_SECRET", "tradegateway-oga-webhook-secret-dev");
    expect(() => getWebhookSecret("SOME_HOOK_SECRET", "x".repeat(40))).toThrow();
    vi.unstubAllEnvs();
  });

  it("validateWebhookSecrets throws in production when secrets are unset", async () => {
    const { validateWebhookSecrets } = await import("../_core/webhookSecretsValidator");
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("MOJALOOP_WEBHOOK_SECRET", "");
    vi.stubEnv("CEP_WEBHOOK_SECRET", "");
    vi.stubEnv("OGA_WEBHOOK_SECRET", "");
    vi.stubEnv("SANCTIONS_WEBHOOK_SECRET", "");
    expect(() => validateWebhookSecrets()).toThrow(/FATAL/);
    vi.unstubAllEnvs();
  });
});

describe("SW-24/O1/MP-18/MP-13: production demo-surface gates", () => {
  it("refuses boot in production when DEMO_MODE is set (any truthy value)", async () => {
    const { assertNoDemoSurfacesInProduction } = await import("../_core/productionGates");
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("DEMO_MODE", "true");
    expect(() => assertNoDemoSurfacesInProduction()).toThrow(/demo\/test surfaces/);
    vi.stubEnv("DEMO_MODE", "1");
    expect(() => assertNoDemoSurfacesInProduction()).toThrow();
    vi.unstubAllEnvs();
  });

  it("refuses boot in production for E2E_TEST_MODE and MICROSERVICE_MOCK_HEALTH", async () => {
    const { assertNoDemoSurfacesInProduction } = await import("../_core/productionGates");
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("E2E_TEST_MODE", "1");
    expect(() => assertNoDemoSurfacesInProduction()).toThrow(/E2E_TEST_MODE/);
    vi.stubEnv("E2E_TEST_MODE", "");
    vi.stubEnv("MICROSERVICE_MOCK_HEALTH", "true");
    expect(() => assertNoDemoSurfacesInProduction()).toThrow(/MICROSERVICE_MOCK_HEALTH/);
    vi.unstubAllEnvs();
  });

  it("allows the flags outside production and reports demo mode off in production", async () => {
    const { assertNoDemoSurfacesInProduction, isDemoModeEnabled } = await import("../_core/productionGates");
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("DEMO_MODE", "true");
    expect(() => assertNoDemoSurfacesInProduction()).not.toThrow();
    expect(isDemoModeEnabled()).toBe(true);
    vi.stubEnv("NODE_ENV", "production");
    expect(isDemoModeEnabled()).toBe(false);
    vi.unstubAllEnvs();
  });
});

describe("SW-MP14: known dev secret values rejected in production config", () => {
  const goodConfig = {
    databaseUrl: "postgresql://u:p@db.internal:5432/tg",
    cookieSecret: "a-real-jwt-secret-value-32charsxx",
    apiKeyHashSecret: "a-real-api-key-hash-secret-32ch",
    keycloakUrl: "https://keycloak.internal",
    keycloakClientSecret: "real-keycloak-secret-0123456789ab",
    permifyUrl: "http://permify.internal:3476",
    permifyApiKey: "real-permify-key-0123456789abcdef",
    redisUrl: "redis://:realpw@redis.internal:6379",
    redisPassword: "real-redis-password-0123456789",
    mojaloopUrl: "http://mojaloop.internal",
    tariffServiceUrl: "http://tariff-engine.internal:8080",
    temporalAddress: "temporal.internal:7233",
    tigerBeetleAddresses: ["tb.internal:3000"],
  };

  it("rejects the historical hardcoded REDIS_PASSWORD", async () => {
    const { validateProductionConfig } = await import("../_core/env");
    expect(() =>
      validateProductionConfig({ ...goodConfig, redisPassword: "tradegateway_redis_2026" } as any)
    ).toThrow(/dev placeholder/);
  });

  it("rejects a JWT_SECRET of 'changeme'", async () => {
    const { validateProductionConfig } = await import("../_core/env");
    expect(() =>
      validateProductionConfig({ ...goodConfig, cookieSecret: "changeme" } as any)
    ).toThrow(/dev placeholder/);
  });

  it("accepts a fully real configuration", async () => {
    const { validateProductionConfig } = await import("../_core/env");
    expect(() => validateProductionConfig(goodConfig as any)).not.toThrow();
  });
});

describe("SW-S2-8: magic-byte upload validation", () => {
  it("detects real types from content, not client claims", async () => {
    const { sniffFileType } = await import("../_core/security");
    expect(sniffFileType(Buffer.from("%PDF-1.7 ..."))).toBe("pdf");
    expect(sniffFileType(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2]))).toBe("png");
    expect(sniffFileType(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2]))).toBe("jpeg");
    expect(sniffFileType(Buffer.concat([Buffer.from("RIFF"), Buffer.alloc(4), Buffer.from("WEBP")]))).toBe("webp");
    expect(sniffFileType(Buffer.from([0x50, 0x4b, 0x03, 0x04, 1, 2]))).toBe("zip");
    expect(sniffFileType(Buffer.from("hs_code,description\n1234,Tea\n"))).toBe("text");
    // A PE executable must never be accepted, whatever the client claims
    expect(sniffFileType(Buffer.from([0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00]))).toBe("unknown");
  });
});
