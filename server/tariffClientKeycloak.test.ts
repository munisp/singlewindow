/**
 * tariffClientKeycloak.test.ts — SW-CLOSE Keycloak client-credentials token
 * flow for the tariff client (PRA-100r deferred remainder).
 *
 * Every test runs against REAL local HTTP servers that the test itself starts
 * on 127.0.0.1 (node:http, ephemeral ports): a token endpoint and a tariff
 * engine. No fetch mocking — the grant body, caching, refresh-on-expiry,
 * 401 force-refresh, and classified failures are observed on the wire.
 * Tokens/secrets are asserted NEVER to leak into error messages.
 */

import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import {
  createClientCredentialsTokenProvider,
  createTariffClient,
  getTariffClient,
  TariffConfigError,
  TariffRejectedError,
  TariffUnavailableError,
  type TariffAssessRequest,
} from "./_core/tariffClient";
import { ENV } from "./_core/env";

// ─── Real local test servers ─────────────────────────────────────────────────

interface CapturedRequest {
  method: string;
  url: string;
  headers: IncomingMessage["headers"];
  body: string;
}

type Handler = (req: CapturedRequest, res: ServerResponse) => void;

let server: Server;
let baseUrl: string;
let handler: Handler;
let captured: CapturedRequest[];

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

beforeAll(async () => {
  server = createServer((req, res) => {
    void readBody(req).then((body) => {
      const entry: CapturedRequest = { method: req.method ?? "", url: req.url ?? "", headers: req.headers, body };
      captured.push(entry);
      handler(entry, res);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address();
  if (!addr || typeof addr === "string") throw new Error("test server did not bind");
  baseUrl = `http://127.0.0.1:${addr.port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
});

// getTariffClient reads ENV, a module-level snapshot — restore it per test.
const savedEnv = {
  tariffServiceUrl: ENV.tariffServiceUrl,
  tariffServiceToken: ENV.tariffServiceToken,
  keycloakTokenUrl: ENV.keycloakTokenUrl,
  tariffServiceClientId: ENV.tariffServiceClientId,
  tariffServiceClientSecret: ENV.tariffServiceClientSecret,
};
afterEach(() => {
  ENV.tariffServiceUrl = savedEnv.tariffServiceUrl;
  ENV.tariffServiceToken = savedEnv.tariffServiceToken;
  ENV.keycloakTokenUrl = savedEnv.keycloakTokenUrl;
  ENV.tariffServiceClientId = savedEnv.tariffServiceClientId;
  ENV.tariffServiceClientSecret = savedEnv.tariffServiceClientSecret;
});

function reset(h: Handler) {
  captured = [];
  handler = h;
}

function json(res: ServerResponse, status: number, payload: unknown) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(payload));
}

const TOKEN_PATH = "/realms/tradegateway/protocol/openid-connect/token";
const CLIENT_ID = "tariff-service";
const CLIENT_SECRET = "super-secret-client-credential";

const SAMPLE_REQUEST: TariffAssessRequest = {
  vesselGrt: 52000,
  vesselClass: "TANKER",
  entityRef: "trader:42",
  cargoCategory: "2710.12",
  voyageType: "INTERNATIONAL",
  routeKind: "SEA",
  nigeriaPortCall: true,
  grossFreightUsdMinor: 1_250_000,
};

function sampleAssessment(id: string) {
  return {
    assessmentId: id,
    request: SAMPLE_REQUEST,
    asOf: "2026-08-30",
    lines: [],
    totalUsdMinor: 250_000,
    totalNgnMinor: 0,
    requester: `service-account-${CLIENT_ID}`,
    correlationId: id,
    createdAt: "2026-08-30T12:00:00.000Z",
  };
}

/** Deterministic knobs: no jitter randomness, tiny backoffs/timeouts. */
function testProvider(overrides: Partial<Parameters<typeof createClientCredentialsTokenProvider>[0]> = {}) {
  return createClientCredentialsTokenProvider({
    tokenUrl: `${baseUrl}${TOKEN_PATH}`,
    clientId: CLIENT_ID,
    clientSecret: CLIENT_SECRET,
    timeoutMs: 500,
    maxAttempts: 3,
    baseBackoffMs: 10,
    maxBackoffMs: 40,
    random: () => 0,
    ...overrides,
  });
}

function testClient(overrides: Partial<Parameters<typeof createTariffClient>[0]> = {}) {
  return createTariffClient({
    baseUrl,
    tokenProvider: testProvider(),
    timeoutMs: 500,
    maxAttempts: 3,
    baseBackoffMs: 10,
    maxBackoffMs: 40,
    random: () => 0,
    ...overrides,
  });
}

function tokenRequests() {
  return captured.filter((r) => r.url === TOKEN_PATH);
}
function engineRequests() {
  return captured.filter((r) => r.url !== TOKEN_PATH);
}

// ─── Token acquisition + caching ─────────────────────────────────────────────

describe("client_credentials token flow (real token endpoint)", () => {
  it("posts the client_credentials grant and sends the access token as bearer", async () => {
    reset((req, res) => {
      if (req.url === TOKEN_PATH) return json(res, 200, { access_token: "kc-token-1", expires_in: 300, token_type: "Bearer" });
      return json(res, 201, sampleAssessment("asm-1"));
    });
    const client = testClient();
    const assessment = await client.assess(SAMPLE_REQUEST, { idempotencyKey: "kc-1" });
    expect(assessment.assessmentId).toBe("asm-1");

    const tokens = tokenRequests();
    expect(tokens).toHaveLength(1);
    expect(tokens[0].method).toBe("POST");
    expect(tokens[0].headers["content-type"]).toContain("application/x-www-form-urlencoded");
    const grant = new URLSearchParams(tokens[0].body);
    expect(grant.get("grant_type")).toBe("client_credentials");
    expect(grant.get("client_id")).toBe(CLIENT_ID);
    expect(grant.get("client_secret")).toBe(CLIENT_SECRET);

    expect(engineRequests()[0].headers["authorization"]).toBe("Bearer kc-token-1");
  });

  it("caches the token — a second call within the lifetime issues no new token request", async () => {
    reset((req, res) => {
      if (req.url === TOKEN_PATH) return json(res, 200, { access_token: "kc-token-cache", expires_in: 300, token_type: "Bearer" });
      return json(res, 201, sampleAssessment("asm-cache"));
    });
    const client = testClient();
    await client.assess(SAMPLE_REQUEST, { idempotencyKey: "kc-cache-1" });
    await client.getAssessment("asm-cache");
    expect(engineRequests()).toHaveLength(2);
    expect(tokenRequests()).toHaveLength(1);
    expect(engineRequests()[1].headers["authorization"]).toBe("Bearer kc-token-cache");
  });

  it("refreshes the token once it expires within the safety margin", async () => {
    let clock = 1_000_000;
    let issued = 0;
    reset((req, res) => {
      if (req.url === TOKEN_PATH) {
        issued++;
        return json(res, 200, { access_token: `kc-token-${issued}`, expires_in: 60, token_type: "Bearer" });
      }
      return json(res, 201, sampleAssessment("asm-refresh"));
    });
    const provider = testProvider({ now: () => clock, refreshMarginMs: 10_000 });
    const client = testClient({ tokenProvider: provider });

    await client.assess(SAMPLE_REQUEST, { idempotencyKey: "kc-exp-1" });
    expect(tokenRequests()).toHaveLength(1);
    expect(engineRequests()[0].headers["authorization"]).toBe("Bearer kc-token-1");

    // Still valid outside the margin — cached.
    clock += 20_000;
    await client.assess(SAMPLE_REQUEST, { idempotencyKey: "kc-exp-2" });
    expect(tokenRequests()).toHaveLength(1);

    // Inside the margin (expires at t+60s, now t+55s) — refreshed.
    clock += 35_000;
    await client.assess(SAMPLE_REQUEST, { idempotencyKey: "kc-exp-3" });
    expect(tokenRequests()).toHaveLength(2);
    expect(engineRequests()[2].headers["authorization"]).toBe("Bearer kc-token-2");
  });

  it("force-refreshes exactly once when the engine answers 401, then succeeds", async () => {
    let issued = 0;
    reset((req, res) => {
      if (req.url === TOKEN_PATH) {
        issued++;
        return json(res, 200, { access_token: `kc-token-${issued}`, expires_in: 300, token_type: "Bearer" });
      }
      const auth = req.headers["authorization"];
      if (auth === "Bearer kc-token-1") return json(res, 401, { error: "token expired" });
      return json(res, 201, sampleAssessment("asm-401"));
    });
    const client = testClient();
    const assessment = await client.assess(SAMPLE_REQUEST, { idempotencyKey: "kc-401" });
    expect(assessment.assessmentId).toBe("asm-401");
    expect(tokenRequests()).toHaveLength(2);
    expect(engineRequests()).toHaveLength(2);
    expect(engineRequests()[1].headers["authorization"]).toBe("Bearer kc-token-2");
  });

  it("a second 401 after the forced refresh is a definitive rejection, not a retry loop", async () => {
    reset((req, res) => {
      if (req.url === TOKEN_PATH) return json(res, 200, { access_token: "kc-token-x", expires_in: 300, token_type: "Bearer" });
      return json(res, 401, { error: "unauthorized" });
    });
    const client = testClient({ maxAttempts: 3 });
    const err = await client.assess(SAMPLE_REQUEST, { idempotencyKey: "kc-401x" }).catch((e) => e);
    expect(err).toBeInstanceOf(TariffRejectedError);
    expect(err.statusCode).toBe(401);
    // 1 initial + 1 refreshed retry — bounded, never a loop.
    expect(engineRequests()).toHaveLength(2);
    expect(tokenRequests()).toHaveLength(2);
  });

  it("deduplicates concurrent token fetches (single-flight)", async () => {
    reset((req, res) => {
      if (req.url === TOKEN_PATH) {
        // Answer slowly so both calls overlap the in-flight fetch.
        setTimeout(() => json(res, 200, { access_token: "kc-token-sf", expires_in: 300, token_type: "Bearer" }), 50);
        return;
      }
      return json(res, 201, sampleAssessment("asm-sf"));
    });
    const provider = testProvider();
    const [a, b] = await Promise.all([provider.getToken(), provider.getToken()]);
    expect(a).toBe("kc-token-sf");
    expect(b).toBe("kc-token-sf");
    expect(tokenRequests()).toHaveLength(1);
  });
});

// ─── Classified failures ─────────────────────────────────────────────────────

describe("token-endpoint failure classification", () => {
  it("a token-endpoint 4xx is a TariffConfigError, never retried", async () => {
    reset((req, res) => {
      if (req.url === TOKEN_PATH) return json(res, 401, { error: "invalid_client" });
      return json(res, 201, sampleAssessment("asm-nope"));
    });
    const client = testClient();
    const err = await client.assess(SAMPLE_REQUEST, { idempotencyKey: "kc-badcred" }).catch((e) => e);
    expect(err).toBeInstanceOf(TariffConfigError);
    expect(err.message).toContain("invalid_client");
    expect(tokenRequests()).toHaveLength(1);
    expect(engineRequests()).toHaveLength(0);
  });

  it("an unreachable token endpoint is TariffUnavailableError(token_endpoint) after bounded attempts", async () => {
    const dead = createServer();
    await new Promise<void>((resolve) => dead.listen(0, "127.0.0.1", resolve));
    const addr = dead.address();
    if (!addr || typeof addr === "string") throw new Error("no port");
    const deadTokenUrl = `http://127.0.0.1:${addr.port}${TOKEN_PATH}`;
    await new Promise<void>((resolve) => dead.close(() => resolve()));

    const provider = testProvider({ tokenUrl: deadTokenUrl, maxAttempts: 3 });
    const client = testClient({ tokenProvider: provider });
    const err = await client.assess(SAMPLE_REQUEST, { idempotencyKey: "kc-dead" }).catch((e) => e);
    expect(err).toBeInstanceOf(TariffUnavailableError);
    expect(err.reason).toBe("token_endpoint");
    expect(err.attempts).toBe(3);
  });

  it("times out token-endpoint calls and classifies the reason", async () => {
    reset((req, res) => {
      if (req.url === TOKEN_PATH) {
        setTimeout(() => json(res, 200, { access_token: "kc-token-slow", expires_in: 300, token_type: "Bearer" }), 500);
        return;
      }
      return json(res, 201, sampleAssessment("asm-slow"));
    });
    const provider = testProvider({ timeoutMs: 60, maxAttempts: 2 });
    const client = testClient({ tokenProvider: provider });
    const err = await client.assess(SAMPLE_REQUEST, { idempotencyKey: "kc-slow" }).catch((e) => e);
    expect(err).toBeInstanceOf(TariffUnavailableError);
    expect(err.reason).toBe("token_endpoint");
    expect(tokenRequests()).toHaveLength(2);
  });

  it("a token response without expires_in fails closed (invalid_response) — no unsafe caching", async () => {
    reset((req, res) => {
      if (req.url === TOKEN_PATH) return json(res, 200, { access_token: "kc-token-noexp", token_type: "Bearer" });
      return json(res, 201, sampleAssessment("asm-noexp"));
    });
    const client = testClient();
    const err = await client.assess(SAMPLE_REQUEST, { idempotencyKey: "kc-noexp" }).catch((e) => e);
    expect(err).toBeInstanceOf(TariffUnavailableError);
    expect(err.reason).toBe("invalid_response");
    expect(engineRequests()).toHaveLength(0);
  });
});

// ─── No secret/token leakage ─────────────────────────────────────────────────

describe("no credential leakage", () => {
  it("a token-endpoint error body echoing the secret is NOT reflected in the error message", async () => {
    reset((req, res) => {
      if (req.url === TOKEN_PATH) {
        return json(res, 401, {
          error: "invalid_client",
          error_description: `bad credential ${CLIENT_SECRET}`,
          echoed: CLIENT_SECRET,
        });
      }
      return json(res, 201, sampleAssessment("asm-leak"));
    });
    const client = testClient();
    const err = await client.assess(SAMPLE_REQUEST, { idempotencyKey: "kc-leak" }).catch((e) => e);
    expect(err).toBeInstanceOf(TariffConfigError);
    expect(err.message).toContain("invalid_client");
    expect(err.message).not.toContain(CLIENT_SECRET);
  });

  it("network-exhaustion errors carry the endpoint failure, never the secret", async () => {
    const provider = testProvider({ tokenUrl: "http://127.0.0.1:1/token", maxAttempts: 1 });
    const err = await provider.getToken().catch((e) => e);
    expect(err).toBeInstanceOf(TariffUnavailableError);
    expect(err.message).not.toContain(CLIENT_SECRET);
  });
});

// ─── Environment wiring (fail-closed partial config) ─────────────────────────

describe("getTariffClient environment wiring", () => {
  it("full Keycloak env → working client_credentials flow end to end", async () => {
    reset((req, res) => {
      if (req.url === TOKEN_PATH) return json(res, 200, { access_token: "kc-env-token", expires_in: 300, token_type: "Bearer" });
      return json(res, 201, sampleAssessment("asm-env"));
    });
    ENV.tariffServiceUrl = baseUrl;
    ENV.keycloakTokenUrl = `${baseUrl}${TOKEN_PATH}`;
    ENV.tariffServiceClientId = CLIENT_ID;
    ENV.tariffServiceClientSecret = CLIENT_SECRET;
    const client = getTariffClient();
    const assessment = await client.assess(SAMPLE_REQUEST, { idempotencyKey: "kc-env" });
    expect(assessment.assessmentId).toBe("asm-env");
    expect(engineRequests()[0].headers["authorization"]).toBe("Bearer kc-env-token");
  });

  it("partial Keycloak env → classified TariffConfigError naming the missing variables", () => {
    ENV.tariffServiceUrl = baseUrl;
    ENV.keycloakTokenUrl = `${baseUrl}${TOKEN_PATH}`;
    ENV.tariffServiceClientId = "";
    ENV.tariffServiceClientSecret = "";
    // Even with a static token present, partial Keycloak config must NOT
    // silently fall back.
    ENV.tariffServiceToken = "static-fallback-token";
    expect(() => getTariffClient()).toThrowError(TariffConfigError);
    expect(() => getTariffClient()).toThrowError(/TARIFF_SERVICE_CLIENT_ID/);
    expect(() => getTariffClient()).toThrowError(/TARIFF_SERVICE_CLIENT_SECRET/);
    expect(() => getTariffClient()).toThrowError(/Partial Keycloak/);
  });

  it("partial Keycloak env (only client id) → classified error, never a silent static fallback", () => {
    ENV.tariffServiceUrl = baseUrl;
    ENV.keycloakTokenUrl = "";
    ENV.tariffServiceClientId = CLIENT_ID;
    ENV.tariffServiceClientSecret = "";
    ENV.tariffServiceToken = "static-fallback-token";
    expect(() => getTariffClient()).toThrowError(/KEYCLOAK_TOKEN_URL/);
  });

  it("no Keycloak env → documented static-token fallback still works", async () => {
    reset((_req, res) => json(res, 201, sampleAssessment("asm-static")));
    ENV.tariffServiceUrl = baseUrl;
    ENV.keycloakTokenUrl = "";
    ENV.tariffServiceClientId = "";
    ENV.tariffServiceClientSecret = "";
    ENV.tariffServiceToken = "static-fallback-token";
    const client = getTariffClient();
    await client.assess(SAMPLE_REQUEST, { idempotencyKey: "kc-static" });
    expect(engineRequests()[0].headers["authorization"]).toBe("Bearer static-fallback-token");
    expect(tokenRequests()).toHaveLength(0);
  });

  it("both a static token and a provider is a misconfiguration, not a guess", () => {
    expect(() =>
      createTariffClient({ baseUrl, serviceToken: "t", tokenProvider: testProvider() })
    ).toThrowError(TariffConfigError);
  });

  it("neither a static token nor a provider fails closed", () => {
    expect(() => createTariffClient({ baseUrl })).toThrowError(TariffConfigError);
  });
});
