/**
 * portInteropClient.test.ts — Phase 8 PCS port-interop client behavior tests.
 *
 * Every test runs against a REAL local HTTP server that the test itself
 * starts on 127.0.0.1 (node:http, ephemeral port). No fetch mocking, no
 * production-path mocks: retries, timeouts, breaker state, the request_id /
 * Idempotency-Key contract and the W3C traceparent header are observed on
 * the wire (tariffClient.test.ts precedent).
 */

import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { context, propagation, trace, type SpanContext } from "@opentelemetry/api";
import { W3CTraceContextPropagator } from "@opentelemetry/core";
import {
  createPortInteropClient,
  createPortInteropTokenProvider,
  getPortInteropClient,
  PortInteropConfigError,
  PortInteropRejectedError,
  PortInteropUnavailableError,
  type PortInteropBooking,
} from "./_core/portInteropClient";
import { CircuitBreaker } from "./_core/middlewareClients";
import { ENV } from "./_core/env";

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

const CTX = { principal: "pcs-trader:7" };

function sampleBooking(id: string): PortInteropBooking {
  return {
    booking_id: id,
    tenant_id: "t1",
    request_id: `req-${id}`,
    truck_plate: "KJA-1234",
    trucker_msisdn: "+2348012345678",
    terminal_id: "TIN-CT1",
    channel: "WEB",
    status: "SLOT_RESERVED",
    amount_kobo: 4500000,
    currency: "NGN",
    created_at: "2026-09-01T10:00:00.000Z",
    updated_at: "2026-09-01T10:05:00.000Z",
    expires_at: "2026-09-02T10:00:00.000Z",
    version: 2,
  };
}

function freshBreaker() {
  return new CircuitBreaker({ name: "test", failureThreshold: 2, successThreshold: 1, timeout: 60_000, windowMs: 60_000 });
}

// getPortInteropClient reads ENV, a module-level snapshot — restore per test.
const savedEnv = {
  portInteropUrl: ENV.portInteropUrl,
  portInteropToken: ENV.portInteropToken,
  keycloakTokenUrl: ENV.keycloakTokenUrl,
  portInteropClientId: ENV.portInteropClientId,
  portInteropClientSecret: ENV.portInteropClientSecret,
};
afterEach(() => {
  ENV.portInteropUrl = savedEnv.portInteropUrl;
  ENV.portInteropToken = savedEnv.portInteropToken;
  ENV.keycloakTokenUrl = savedEnv.keycloakTokenUrl;
  ENV.portInteropClientId = savedEnv.portInteropClientId;
  ENV.portInteropClientSecret = savedEnv.portInteropClientSecret;
});

describe("createPortInteropClient", () => {
  it("fails closed when the base URL is missing or invalid", () => {
    expect(() => createPortInteropClient({ baseUrl: "", serviceToken: "t" })).toThrow(PortInteropConfigError);
    expect(() => createPortInteropClient({ baseUrl: "not-a-url", serviceToken: "t" })).toThrow(PortInteropConfigError);
    expect(() => createPortInteropClient({ baseUrl: "ftp://x", serviceToken: "t" })).toThrow(PortInteropConfigError);
  });

  it("fails closed when no credential is configured", () => {
    expect(() => createPortInteropClient({ baseUrl })).toThrow(PortInteropConfigError);
  });

  it("refuses ambiguous auth configuration (static token AND provider)", () => {
    expect(() =>
      createPortInteropClient({
        baseUrl,
        serviceToken: "t",
        tokenProvider: { getToken: async () => "x" },
      })
    ).toThrow(PortInteropConfigError);
  });

  it("getBooking succeeds and sends bearer + trusted-proxy + principal headers", async () => {
    reset((_req, res) => json(res, 200, sampleBooking("bk-1")));
    const client = createPortInteropClient({ baseUrl, serviceToken: "svc-token" });
    const booking = await client.getBooking("bk-1", CTX);
    expect(booking.booking_id).toBe("bk-1");
    expect(captured).toHaveLength(1);
    expect(captured[0].method).toBe("GET");
    expect(captured[0].url).toBe("/v1/bookings/bk-1");
    expect(captured[0].headers.authorization).toBe("Bearer svc-token");
    expect(captured[0].headers["x-trusted-proxy"]).toBe("loopback");
    expect(captured[0].headers["x-authenticated-Principal".toLowerCase()]).toBe("pcs-trader:7");
  });

  it("injects a W3C traceparent from the active OTel context", async () => {
    reset((_req, res) => json(res, 200, sampleBooking("bk-trace")));
    // Register the W3C propagator (what the SDK registers when telemetry is
    // enabled) and run the call inside a valid parent span context.
    propagation.setGlobalPropagator(new W3CTraceContextPropagator());
    // The NodeSDK registers this context manager in production; without one,
    // context.with does not carry the parent span across the async fetch.
    const { AsyncLocalStorageContextManager } = await import("@opentelemetry/context-async-hooks");
    const contextManager = new AsyncLocalStorageContextManager().enable();
    context.setGlobalContextManager(contextManager);
    const spanContext: SpanContext = {
      traceId: "4bf92f3577b34da6a3ce929d0e0e4736",
      spanId: "00f067aa0ba902b7",
      traceFlags: 1,
      isRemote: true,
    };
    const client = createPortInteropClient({ baseUrl, serviceToken: "svc-token" });
    await context.with(trace.setSpanContext(context.active(), spanContext), () =>
      client.getBooking("bk-trace", CTX)
    );
    expect(captured[0].headers.traceparent).toBe("00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01");
  });

  it("getPortCall validates the response shape (fail closed on garbage)", async () => {
    reset((_req, res) => json(res, 200, { nope: true }));
    const client = createPortInteropClient({ baseUrl, serviceToken: "svc-token" });
    await expect(client.getPortCall("pc-1", CTX)).rejects.toMatchObject({
      name: "PortInteropUnavailableError",
      reason: "invalid_response",
    });
  });

  it("listSlots parses the slots envelope", async () => {
    reset((_req, res) =>
      json(res, 200, {
        slots: [
          {
            slot_id: "sl-1",
            terminal_id: "TIN-CT1",
            port_code: "NGTIN",
            starts_at: "2026-09-02T08:00:00.000Z",
            ends_at: "2026-09-02T12:00:00.000Z",
            capacity: 20,
            reserved: 3,
            created_at: "2026-09-01T00:00:00.000Z",
          },
        ],
      })
    );
    const client = createPortInteropClient({ baseUrl, serviceToken: "svc-token" });
    const slots = await client.listSlots({ terminalId: "TIN-CT1", from: "2026-09-02T00:00:00Z", to: "2026-09-03T00:00:00Z" }, CTX);
    expect(slots).toHaveLength(1);
    expect(slots[0].slot_id).toBe("sl-1");
    expect(captured[0].url).toContain("/v1/slots?");
    expect(captured[0].url).toContain("terminal_id=TIN-CT1");
  });

  it("createBooking sends request_id in the body AND as Idempotency-Key header", async () => {
    reset((_req, res) => json(res, 201, sampleBooking("bk-new")));
    const client = createPortInteropClient({ baseUrl, serviceToken: "svc-token" });
    const request = {
      request_id: "pcs-7-TIN-CT1-KJA-1234-2026-09-02T08:00:00.000Z",
      truck_plate: "KJA-1234",
      trucker_msisdn: "+2348012345678",
      terminal_id: "TIN-CT1",
      channel: "WEB" as const,
      amount_kobo: 4500000,
      expires_at: "2026-09-03T08:00:00.000Z",
    };
    const booking = await client.createBooking(request, CTX);
    expect(booking.booking_id).toBe("bk-new");
    expect(captured[0].headers["idempotency-key"]).toBe(request.request_id);
    expect(JSON.parse(captured[0].body).request_id).toBe(request.request_id);
  });

  it("createBooking rejects a non-canonical request_id at the client edge", async () => {
    reset((_req, res) => json(res, 500, {}));
    const client = createPortInteropClient({ baseUrl, serviceToken: "svc-token" });
    await expect(
      client.createBooking(
        {
          request_id: "short",
          truck_plate: "KJA-1234",
          trucker_msisdn: "+2348012345678",
          terminal_id: "TIN-CT1",
          channel: "WEB",
          amount_kobo: 1,
          expires_at: "2026-09-03T08:00:00.000Z",
        },
        CTX
      )
    ).rejects.toBeInstanceOf(PortInteropConfigError);
    expect(captured).toHaveLength(0); // no upstream call made
  });

  it("retries on 5xx with bounded attempts and then fails classified", async () => {
    let calls = 0;
    reset((_req, res) => {
      calls++;
      json(res, 503, { error: "down" });
    });
    const client = createPortInteropClient({
      baseUrl,
      serviceToken: "svc-token",
      maxAttempts: 3,
      baseBackoffMs: 1,
      maxBackoffMs: 4,
      random: () => 0,
    });
    await expect(client.getBooking("bk-x", CTX)).rejects.toMatchObject({
      name: "PortInteropUnavailableError",
      reason: "upstream_5xx",
      attempts: 3,
    });
    expect(calls).toBe(3);
  });

  it("recovers when a retry succeeds after a 5xx", async () => {
    let calls = 0;
    reset((_req, res) => {
      calls++;
      if (calls === 1) return json(res, 500, {});
      return json(res, 200, sampleBooking("bk-retry"));
    });
    const client = createPortInteropClient({
      baseUrl,
      serviceToken: "svc-token",
      baseBackoffMs: 1,
      maxBackoffMs: 4,
      random: () => 0,
    });
    const booking = await client.getBooking("bk-retry", CTX);
    expect(booking.booking_id).toBe("bk-retry");
    expect(calls).toBe(2);
  });

  it("never retries a 4xx — definitive rejection with the upstream message", async () => {
    let calls = 0;
    reset((_req, res) => {
      calls++;
      json(res, 409, { error: "request id conflicts with a retained booking" });
    });
    const client = createPortInteropClient({ baseUrl, serviceToken: "svc-token", baseBackoffMs: 1, random: () => 0 });
    await expect(client.getBooking("bk-conflict", CTX)).rejects.toMatchObject({
      name: "PortInteropRejectedError",
      statusCode: 409,
    });
    expect(calls).toBe(1);
  });

  it("classifies timeouts as unavailable after bounded attempts", async () => {
    reset((_req, res) => setTimeout(() => json(res, 200, sampleBooking("late")), 200));
    const client = createPortInteropClient({
      baseUrl,
      serviceToken: "svc-token",
      timeoutMs: 30,
      maxAttempts: 2,
      baseBackoffMs: 1,
      maxBackoffMs: 4,
      random: () => 0,
    });
    await expect(client.getBooking("slow", CTX)).rejects.toMatchObject({
      name: "PortInteropUnavailableError",
      reason: "timeout",
      attempts: 2,
    });
  });

  it("fails fast with circuit_open once the breaker is open", async () => {
    reset((_req, res) => json(res, 500, {}));
    const breaker = freshBreaker();
    const client = createPortInteropClient({
      baseUrl,
      serviceToken: "svc-token",
      breaker,
      maxAttempts: 1,
      baseBackoffMs: 1,
      random: () => 0,
    });
    await expect(client.getBooking("a", CTX)).rejects.toMatchObject({ reason: "upstream_5xx" });
    await expect(client.getBooking("b", CTX)).rejects.toMatchObject({ reason: "upstream_5xx" });
    expect(breaker.isOpen).toBe(true);
    const before = captured.length;
    await expect(client.getBooking("c", CTX)).rejects.toMatchObject({ reason: "circuit_open", attempts: 0 });
    expect(captured.length).toBe(before); // refused without an upstream attempt
  });

  it("refuses to assert an empty principal", async () => {
    reset((_req, res) => json(res, 200, sampleBooking("bk")));
    const client = createPortInteropClient({ baseUrl, serviceToken: "svc-token" });
    await expect(client.getBooking("bk", { principal: "  " })).rejects.toBeInstanceOf(PortInteropConfigError);
    expect(captured).toHaveLength(0);
  });

  it("health() reports liveness without throwing", async () => {
    reset((_req, res) => json(res, 200, { status: "ok" }));
    const client = createPortInteropClient({ baseUrl, serviceToken: "svc-token" });
    await expect(client.health()).resolves.toBe(true);
    reset((_req, res) => json(res, 500, {}));
    await expect(client.health()).resolves.toBe(false);
  });
});

describe("createPortInteropTokenProvider (Keycloak client_credentials)", () => {
  it("fetches, caches and refreshes tokens against a real token endpoint", async () => {
    let tokenCalls = 0;
    reset((req, res) => {
      if (req.url === "/token") {
        tokenCalls++;
        const params = new URLSearchParams(req.body);
        expect(params.get("grant_type")).toBe("client_credentials");
        expect(params.get("client_id")).toBe("pcs-portal");
        expect(params.get("client_secret")).toBe("super-secret");
        return json(res, 200, { access_token: `tok-${tokenCalls}`, token_type: "Bearer", expires_in: 3600 });
      }
      json(res, 200, sampleBooking("bk-cc"));
    });
    const provider = createPortInteropTokenProvider({
      tokenUrl: `${baseUrl}/token`,
      clientId: "pcs-portal",
      clientSecret: "super-secret",
    });
    const client = createPortInteropClient({ baseUrl, serviceToken: undefined, tokenProvider: provider });
    await client.getBooking("bk-cc", CTX);
    await client.getBooking("bk-cc", CTX);
    expect(tokenCalls).toBe(1); // cached
    expect(captured.filter((r) => r.url !== "/token")[0].headers.authorization).toBe("Bearer tok-1");
    // Forced refresh bypasses the cache.
    await provider.getToken(true);
    expect(tokenCalls).toBe(2);
  });

  it("force-refreshes once after an engine 401, then succeeds", async () => {
    let tokenCalls = 0;
    let bookingCalls = 0;
    reset((req, res) => {
      if (req.url === "/token") {
        tokenCalls++;
        return json(res, 200, { access_token: `tok-${tokenCalls}`, token_type: "Bearer", expires_in: 3600 });
      }
      bookingCalls++;
      if (bookingCalls === 1) return json(res, 401, { error: "expired" });
      json(res, 200, sampleBooking("bk-401"));
    });
    const client = createPortInteropClient({
      baseUrl,
      tokenProvider: createPortInteropTokenProvider({
        tokenUrl: `${baseUrl}/token`,
        clientId: "pcs-portal",
        clientSecret: "super-secret",
      }),
    });
    const booking = await client.getBooking("bk-401", CTX);
    expect(booking.booking_id).toBe("bk-401");
    expect(tokenCalls).toBe(2);
    expect(captured.filter((r) => r.url !== "/token")[1].headers.authorization).toBe("Bearer tok-2");
  });

  it("classifies a token-endpoint 4xx as a config error and never leaks the secret", async () => {
    reset((_req, res) => json(res, 400, { error: "invalid_client", error_description: "super-secret must rotate" }));
    const provider = createPortInteropTokenProvider({
      tokenUrl: `${baseUrl}/token`,
      clientId: "pcs-portal",
      clientSecret: "super-secret",
    });
    try {
      await provider.getToken();
      expect.unreachable("must throw");
    } catch (err) {
      expect(err).toBeInstanceOf(PortInteropConfigError);
      expect((err as Error).message).toContain("invalid_client");
      expect((err as Error).message).not.toContain("super-secret");
    }
  });

  it("classifies token-endpoint exhaustion as token_endpoint unavailable", async () => {
    reset((_req, res) => json(res, 500, {}));
    const provider = createPortInteropTokenProvider({
      tokenUrl: `${baseUrl}/token`,
      clientId: "pcs-portal",
      clientSecret: "super-secret",
      maxAttempts: 2,
      baseBackoffMs: 1,
      maxBackoffMs: 4,
      random: () => 0,
    });
    await expect(provider.getToken()).rejects.toMatchObject({
      name: "PortInteropUnavailableError",
      reason: "token_endpoint",
    });
  });

  it("fails closed on malformed token responses (no access_token / no expires_in)", async () => {
    reset((_req, res) => json(res, 200, { access_token: "tok" }));
    const provider = createPortInteropTokenProvider({
      tokenUrl: `${baseUrl}/token`,
      clientId: "pcs-portal",
      clientSecret: "super-secret",
    });
    await expect(provider.getToken()).rejects.toMatchObject({ reason: "invalid_response" });
  });
});

describe("getPortInteropClient (env-driven, fail closed)", () => {
  it("throws when PORT_INTEROP_URL is unset", () => {
    ENV.portInteropUrl = "";
    ENV.portInteropToken = "tok";
    ENV.keycloakTokenUrl = "";
    ENV.portInteropClientId = "";
    ENV.portInteropClientSecret = "";
    expect(() => getPortInteropClient()).toThrow(PortInteropConfigError);
  });

  it("throws on PARTIAL Keycloak client-credentials config (never a silent fallback)", () => {
    ENV.portInteropUrl = baseUrl;
    ENV.portInteropToken = "tok";
    ENV.keycloakTokenUrl = `${baseUrl}/token`;
    ENV.portInteropClientId = "pcs-portal";
    ENV.portInteropClientSecret = "";
    expect(() => getPortInteropClient()).toThrow(/PORT_INTEROP_CLIENT_SECRET/);
  });

  it("uses the static token when no Keycloak env is set", async () => {
    reset((_req, res) => json(res, 200, sampleBooking("bk-static")));
    ENV.portInteropUrl = baseUrl;
    ENV.portInteropToken = "static-token-123";
    ENV.keycloakTokenUrl = "";
    ENV.portInteropClientId = "";
    ENV.portInteropClientSecret = "";
    const client = getPortInteropClient();
    await client.getBooking("bk-static", CTX);
    expect(captured[0].headers.authorization).toBe("Bearer static-token-123");
  });

  it("uses the client-credentials flow when ALL THREE Keycloak vars are set", async () => {
    let tokenCalls = 0;
    reset((req, res) => {
      if (req.url === "/token") {
        tokenCalls++;
        return json(res, 200, { access_token: "kc-tok", token_type: "Bearer", expires_in: 3600 });
      }
      json(res, 200, sampleBooking("bk-kc"));
    });
    ENV.portInteropUrl = baseUrl;
    ENV.portInteropToken = "";
    ENV.keycloakTokenUrl = `${baseUrl}/token`;
    ENV.portInteropClientId = "pcs-portal";
    ENV.portInteropClientSecret = "super-secret";
    const client = getPortInteropClient();
    await client.getBooking("bk-kc", CTX);
    expect(tokenCalls).toBe(1);
    expect(captured.filter((r) => r.url !== "/token")[0].headers.authorization).toBe("Bearer kc-tok");
  });
});
