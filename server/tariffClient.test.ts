/**
 * tariffClient.test.ts — PRA-100 tariff-engine client behavior tests.
 *
 * Every test runs against a REAL local HTTP server that the test itself
 * starts on 127.0.0.1 (node:http, ephemeral port). No fetch mocking, no
 * production-path mocks: retries, timeouts, breaker state, idempotency-key
 * and traceparent headers are observed on the wire.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { context, propagation, trace, type SpanContext } from "@opentelemetry/api";
import { W3CTraceContextPropagator } from "@opentelemetry/core";
import {
  createTariffClient,
  getTariffClient,
  TariffConfigError,
  TariffRejectedError,
  TariffUnavailableError,
  type TariffAssessRequest,
} from "./_core/tariffClient";
import { CircuitBreaker } from "./_core/middlewareClients";

// ─── Real local test server ──────────────────────────────────────────────────

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

function reset(h: Handler) {
  captured = [];
  handler = h;
}

function json(res: ServerResponse, status: number, payload: unknown) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(payload));
}

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

function sampleAssessment(idempotencyKey: string) {
  return {
    assessmentId: `asm-${idempotencyKey}`,
    request: SAMPLE_REQUEST,
    asOf: "2026-08-30",
    lines: [
      {
        lineNo: 1,
        instrument: "NPA_SHIP_DUES",
        agency: "NPA",
        applicability: "CHARGED",
        basis: "PER_GRT_BAND",
        statutoryReference: "NPA Act s.7",
        amountMinor: 250_000,
        currency: "USD",
      },
      {
        lineNo: 2,
        instrument: "SEA_PROTECTION_LEVY_2012",
        agency: "NIMASA",
        applicability: "EXEMPT",
        basis: "statutory exemption EX-NLING-01",
        exemptionId: "EX-NLING-01",
        amountMinor: 0,
        currency: "USD",
      },
    ],
    totalUsdMinor: 250_000,
    totalNgnMinor: 0,
    requester: "dev:dev-tariff-service-token",
    correlationId: idempotencyKey,
    createdAt: "2026-08-30T12:00:00.000Z",
  };
}

/** Deterministic client knobs: no jitter randomness, tiny backoffs. */
function testClient(overrides: Partial<Parameters<typeof createTariffClient>[0]> = {}) {
  return createTariffClient({
    baseUrl,
    serviceToken: "dev-tariff-service-token",
    timeoutMs: 500,
    maxAttempts: 3,
    baseBackoffMs: 10,
    maxBackoffMs: 40,
    random: () => 0,
    ...overrides,
  });
}

// ─── Success path + header propagation ───────────────────────────────────────

describe("assess success path", () => {
  it("posts the declaration and returns the typed assessment", async () => {
    reset((_req, res) => json(res, 201, sampleAssessment("key-0001")));
    const client = testClient();
    const assessment = await client.assess(SAMPLE_REQUEST, { idempotencyKey: "key-0001" });
    expect(assessment.assessmentId).toBe("asm-key-0001");
    expect(assessment.totalUsdMinor).toBe(250_000);
    expect(assessment.lines).toHaveLength(2);
    expect(captured).toHaveLength(1);
    expect(captured[0].method).toBe("POST");
    expect(captured[0].url).toBe("/v1/tariffs/assess");
    expect(JSON.parse(captured[0].body)).toMatchObject({ vesselGrt: 52000, vesselClass: "TANKER" });
  });

  it("propagates Idempotency-Key, X-Correlation-ID and bearer auth on the wire", async () => {
    reset((_req, res) => json(res, 201, sampleAssessment("key-0002")));
    const client = testClient();
    await client.assess(SAMPLE_REQUEST, { idempotencyKey: "key-0002", correlationId: "decl-7" });
    expect(captured).toHaveLength(1);
    expect(captured[0].headers["idempotency-key"]).toBe("key-0002");
    expect(captured[0].headers["x-correlation-id"]).toBe("decl-7");
    expect(captured[0].headers["authorization"]).toBe("Bearer dev-tariff-service-token");
    expect(captured[0].headers["content-type"]).toContain("application/json");
  });

  it("server-side replay: same key + same request returns the same assessment", async () => {
    // Emulates the engine's idempotency store: replay returns the stored row.
    const store = new Map<string, { body: string; response: unknown }>();
    reset((req, res) => {
      const key = String(req.headers["idempotency-key"] ?? "");
      const existing = store.get(key);
      if (existing && existing.body === req.body) return json(res, 201, existing.response);
      if (existing) return json(res, 409, { error: "idempotency key conflict" });
      const response = sampleAssessment(key);
      store.set(key, { body: req.body, response });
      return json(res, 201, response);
    });
    const client = testClient();
    const first = await client.assess(SAMPLE_REQUEST, { idempotencyKey: "key-replay" });
    const second = await client.assess(SAMPLE_REQUEST, { idempotencyKey: "key-replay" });
    expect(second.assessmentId).toBe(first.assessmentId);
    expect(captured).toHaveLength(2);
    // A different request under the same key conflicts honestly.
    await expect(
      client.assess({ ...SAMPLE_REQUEST, vesselGrt: 9999 }, { idempotencyKey: "key-replay" })
    ).rejects.toMatchObject({ name: "TariffRejectedError", statusCode: 409 });
  });

  it("propagates W3C traceparent from the active OTel context", async () => {
    reset((_req, res) => json(res, 201, sampleAssessment("key-trace")));
    // Register the W3C propagator (what the SDK registers when telemetry is
    // enabled) and run the call inside a valid parent span context.
    propagation.setGlobalPropagator(new W3CTraceContextPropagator());
    // The NodeSDK registers this context manager in production; without one,
    // context.with does not carry the parent span across the async fetch.
    const { AsyncLocalStorageContextManager } = await import("@opentelemetry/context-async-hooks");
    const contextManager = new AsyncLocalStorageContextManager().enable();
    context.setGlobalContextManager(contextManager);
    try {
      const parent: SpanContext = {
        traceId: "4bf92f3577b34da6a3ce929d0e0e4736",
        spanId: "00f067aa0ba902b7",
        traceFlags: 1,
        isRemote: true,
      };
      const client = testClient();
      await context.with(trace.setSpanContext(context.active(), parent), () =>
        client.assess(SAMPLE_REQUEST, { idempotencyKey: "key-trace" })
      );
      expect(captured).toHaveLength(1);
      expect(captured[0].headers["traceparent"]).toBe(
        "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01"
      );
    } finally {
      // Back to the API's defaults: no-op propagator, no context manager.
      propagation.disable();
      contextManager.disable();
      context.disable();
    }
  });
});

// ─── Retry / timeout / breaker ───────────────────────────────────────────────

describe("resilience", () => {
  it("retries transient 5xx with bounded attempts, then succeeds", async () => {
    let calls = 0;
    reset((_req, res) => {
      calls++;
      if (calls < 3) return json(res, 500, { error: "store unavailable" });
      return json(res, 201, sampleAssessment("key-retry"));
    });
    const client = testClient();
    const assessment = await client.assess(SAMPLE_REQUEST, { idempotencyKey: "key-retry" });
    expect(assessment.assessmentId).toBe("asm-key-retry");
    expect(captured).toHaveLength(3);
  });

  it("never retries a 4xx rejection and surfaces the upstream reason", async () => {
    reset((_req, res) => json(res, 400, { error: "vesselGrt must be positive" }));
    const client = testClient();
    const err = await client
      .assess({ ...SAMPLE_REQUEST, vesselGrt: -1 }, { idempotencyKey: "key-400" })
      .catch((e) => e);
    expect(err).toBeInstanceOf(TariffRejectedError);
    expect(err.statusCode).toBe(400);
    expect(err.message).toContain("vesselGrt must be positive");
    expect(captured).toHaveLength(1);
  });

  it("times out each attempt and classifies the failure as timeout", async () => {
    reset((_req, res) => {
      // Answer long after the client's 60ms per-attempt timeout.
      setTimeout(() => json(res, 201, sampleAssessment("key-slow")), 500);
    });
    const client = testClient({ timeoutMs: 60, maxAttempts: 2 });
    const err = await client.assess(SAMPLE_REQUEST, { idempotencyKey: "key-slow" }).catch((e) => e);
    expect(err).toBeInstanceOf(TariffUnavailableError);
    expect(err.reason).toBe("timeout");
    expect(err.attempts).toBe(2);
    expect(captured).toHaveLength(2);
  });

  it("classifies an unreachable service as a network failure after bounded attempts", async () => {
    // Bind then close a throwaway server to obtain a guaranteed-closed port.
    const dead = createServer();
    await new Promise<void>((resolve) => dead.listen(0, "127.0.0.1", resolve));
    const addr = dead.address();
    if (!addr || typeof addr === "string") throw new Error("no port");
    const deadUrl = `http://127.0.0.1:${addr.port}`;
    await new Promise<void>((resolve) => dead.close(() => resolve()));

    const client = testClient({ baseUrl: deadUrl, maxAttempts: 3 });
    const err = await client.assess(SAMPLE_REQUEST, { idempotencyKey: "key-dead" }).catch((e) => e);
    expect(err).toBeInstanceOf(TariffUnavailableError);
    expect(err.reason).toBe("network");
    expect(err.attempts).toBe(3);
  });

  it("opens the circuit breaker after consecutive failures and refuses without an upstream attempt", async () => {
    reset((_req, res) => json(res, 500, { error: "down" }));
    const breaker = new CircuitBreaker({
      name: "tariff-service-test",
      failureThreshold: 2,
      successThreshold: 1,
      timeout: 60_000,
      windowMs: 60_000,
    });
    const client = testClient({ breaker, maxAttempts: 1 });
    await expect(client.assess(SAMPLE_REQUEST, { idempotencyKey: "key-cb-1" })).rejects.toBeInstanceOf(
      TariffUnavailableError
    );
    await expect(client.assess(SAMPLE_REQUEST, { idempotencyKey: "key-cb-2" })).rejects.toBeInstanceOf(
      TariffUnavailableError
    );
    expect(breaker.getStatus().state).toBe("OPEN");
    const hitsBefore = captured.length;
    const err = await client.assess(SAMPLE_REQUEST, { idempotencyKey: "key-cb-3" }).catch((e) => e);
    expect(err).toBeInstanceOf(TariffUnavailableError);
    expect(err.reason).toBe("circuit_open");
    expect(err.attempts).toBe(0);
    expect(captured.length).toBe(hitsBefore); // breaker short-circuited — no wire attempt
  });

  it("treats an unparseable 2xx body as unavailable, never as a silent zero assessment", async () => {
    reset((_req, res) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end("not json{");
    });
    const client = testClient({ maxAttempts: 1 });
    const err = await client.assess(SAMPLE_REQUEST, { idempotencyKey: "key-garbage" }).catch((e) => e);
    expect(err).toBeInstanceOf(TariffUnavailableError);
    expect(err.reason).toBe("invalid_response");
  });

  it("rejects a malformed success shape instead of trusting it", async () => {
    reset((_req, res) => json(res, 201, { unexpected: true }));
    const client = testClient({ maxAttempts: 1 });
    const err = await client.assess(SAMPLE_REQUEST, { idempotencyKey: "key-shape" }).catch((e) => e);
    expect(err).toBeInstanceOf(TariffUnavailableError);
    expect(err.reason).toBe("invalid_response");
  });
});

// ─── Fail-closed configuration ───────────────────────────────────────────────

describe("fail-closed configuration", () => {
  it("throws TariffConfigError when TARIFF_SERVICE_URL is unset (no phantom endpoint)", () => {
    // This test file never sets TARIFF_SERVICE_URL, so the env-derived
    // singleton must refuse explicitly.
    expect(() => getTariffClient()).toThrowError(TariffConfigError);
    expect(() => getTariffClient()).toThrowError(/TARIFF_SERVICE_URL is not configured/);
  });

  it("rejects garbage and non-http base URLs", () => {
    expect(() => createTariffClient({ baseUrl: "", serviceToken: "t" })).toThrowError(TariffConfigError);
    expect(() => createTariffClient({ baseUrl: "not-a-url", serviceToken: "t" })).toThrowError(TariffConfigError);
    expect(() => createTariffClient({ baseUrl: "ftp://x:21", serviceToken: "t" })).toThrowError(/http/);
  });

  it("requires an idempotency key at the client edge", async () => {
    const client = testClient();
    await expect(client.assess(SAMPLE_REQUEST, { idempotencyKey: "" })).rejects.toBeInstanceOf(
      TariffConfigError
    );
  });

  it("getAssessment / getExemptionAudits hit the real routes", async () => {
    reset((req, res) => {
      if (req.url === "/v1/tariffs/assessments/asm-1") {
        return json(res, 200, { ...sampleAssessment("asm-1"), assessmentId: "asm-1" });
      }
      if (req.url === "/v1/tariffs/assessments/asm-1/exemption-audits") {
        return json(res, 200, {
          audits: [
            {
              auditId: "aud-1",
              assessmentId: "asm-1",
              exemptionId: "EX-NLING-01",
              instrument: "SEA_PROTECTION_LEVY_2012",
              matchKind: "ENTITY",
              matchValue: "NLNG",
              statutoryBasis: "NLNG Act (fiscal incentives; Supreme Court affirmed)",
              evidenceRequirement: "cert",
              requester: "dev:x",
              createdAt: "2026-08-30T12:00:00.000Z",
            },
          ],
        });
      }
      return json(res, 404, { error: "not found" });
    });
    const client = testClient();
    const assessment = await client.getAssessment("asm-1");
    expect(assessment.assessmentId).toBe("asm-1");
    const audits = await client.getExemptionAudits("asm-1");
    expect(audits).toHaveLength(1);
    expect(audits[0].exemptionId).toBe("EX-NLING-01");
  });

  it("health() reports liveness without throwing", async () => {
    reset((_req, res) => json(res, 200, { status: "ok" }));
    const client = testClient();
    await expect(client.health()).resolves.toBe(true);
  });
});
