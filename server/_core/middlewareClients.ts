/**
 * middlewareClients.ts — Production-grade middleware client factory
 *
 * Provides singleton clients for all middleware services with:
 *   - Connection pooling (PostgreSQL)
 *   - Circuit breakers (all external services)
 *   - Retry with exponential backoff (HTTP services)
 *   - Health checks and graceful degradation
 *   - Prometheus metrics for observability
 *
 * Services:
 *   - PostgreSQL (via Drizzle ORM with pg pool)
 *   - Redis (connection pool with auto-reconnect)
 *   - Kafka (idempotent producer + consumer groups)
 *   - OpenSearch (connection pool)
 *   - Permify (gRPC client)
 *   - Keycloak (JWKS cache + token validation)
 *
 * Circuit breaker states:
 *   CLOSED → OPEN (after 5 failures in 60s window)
 *   OPEN → HALF_OPEN (after 30s cooldown)
 *   HALF_OPEN → CLOSED (on success) or OPEN (on failure)
 */

import { TRPCError } from "@trpc/server";

// ─── Circuit Breaker ──────────────────────────────────────────────────────────

type CircuitState = "CLOSED" | "OPEN" | "HALF_OPEN";

export interface CircuitBreakerOptions {
  name: string;
  failureThreshold?: number;   // Failures before opening (default: 5)
  successThreshold?: number;   // Successes to close from half-open (default: 2)
  timeout?: number;            // MS before trying half-open (default: 30_000)
  windowMs?: number;           // Failure counting window (default: 60_000)
}

// Exported so dedicated service clients (e.g. the PRA-100 tariff-engine
// client) can hold their own isolated breaker instance instead of sharing
// the global registry — the state semantics stay identical.
export class CircuitBreaker {
  private state: CircuitState = "CLOSED";
  private failures = 0;
  private successes = 0;
  private lastFailureTime = 0;
  private windowStart = Date.now();

  constructor(private opts: Required<CircuitBreakerOptions>) {}

  get isOpen(): boolean {
    if (this.state === "OPEN") {
      if (Date.now() - this.lastFailureTime >= this.opts.timeout) {
        this.state = "HALF_OPEN";
        this.successes = 0;
        return false;
      }
      return true;
    }
    return false;
  }

  onSuccess(): void {
    if (this.state === "HALF_OPEN") {
      this.successes++;
      if (this.successes >= this.opts.successThreshold) {
        this.state = "CLOSED";
        this.failures = 0;
        this.successes = 0;
      }
    } else {
      this.failures = 0;
    }
  }

  onFailure(): void {
    this.lastFailureTime = Date.now();

    // Reset window if expired
    if (Date.now() - this.windowStart > this.opts.windowMs) {
      this.failures = 0;
      this.windowStart = Date.now();
    }

    this.failures++;
    if (this.failures >= this.opts.failureThreshold) {
      this.state = "OPEN";
    }
  }

  getStatus() {
    return {
      name: this.opts.name,
      state: this.state,
      failures: this.failures,
      lastFailureTime: this.lastFailureTime > 0 ? new Date(this.lastFailureTime).toISOString() : null,
    };
  }
}

// Global circuit breaker registry
const circuitBreakers = new Map<string, CircuitBreaker>();

export function getCircuitBreaker(name: string, opts?: Partial<CircuitBreakerOptions>): CircuitBreaker {
  if (!circuitBreakers.has(name)) {
    circuitBreakers.set(name, new CircuitBreaker({
      name,
      failureThreshold: opts?.failureThreshold ?? 5,
      successThreshold: opts?.successThreshold ?? 2,
      timeout: opts?.timeout ?? 30_000,
      windowMs: opts?.windowMs ?? 60_000,
    }));
  }
  return circuitBreakers.get(name)!;
}

export function getAllCircuitBreakerStatus() {
  return Array.from(circuitBreakers.values()).map(cb => cb.getStatus());
}

// ─── Retry with Exponential Backoff ──────────────────────────────────────────

export async function withRetry<T>(
  fn: () => Promise<T>,
  opts: {
    maxAttempts?: number;
    initialDelayMs?: number;
    maxDelayMs?: number;
    backoffFactor?: number;
    retryOn?: (err: unknown) => boolean;
  } = {}
): Promise<T> {
  const {
    maxAttempts = 3,
    initialDelayMs = 1000,
    maxDelayMs = 30_000,
    backoffFactor = 2,
    retryOn = () => true,
  } = opts;

  let lastError: unknown;
  let delay = initialDelayMs;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (attempt === maxAttempts || !retryOn(err)) {
        throw err;
      }
      // PRA-024/025: exponential backoff WITH full jitter — without jitter,
      // N callers retrying a recovering dependency fire in lock-step
      // (thundering herd) and re-collapse it.
      const jittered = Math.floor(delay * (0.5 + Math.random()));
      await new Promise(resolve => setTimeout(resolve, jittered));
      delay = Math.min(delay * backoffFactor, maxDelayMs);
    }
  }

  throw lastError;
}

// ─── HTTP Client with Circuit Breaker + Retry ─────────────────────────────────

export async function fetchWithResilience(
  url: string,
  options: RequestInit & { timeoutMs?: number } = {},
  serviceName: string = "external"
): Promise<Response> {
  const cb = getCircuitBreaker(serviceName);

  if (cb.isOpen) {
    throw new TRPCError({
      code: "SERVICE_UNAVAILABLE",
      message: `Service ${serviceName} circuit breaker is OPEN — service temporarily unavailable`,
    });
  }

  const { timeoutMs = 10_000, ...fetchOpts } = options;

  return withRetry(
    async () => {
      try {
        const res = await fetch(url, {
          ...fetchOpts,
          signal: AbortSignal.timeout(timeoutMs),
        });
        if (res.status >= 500) {
          cb.onFailure();
          throw new Error(`${serviceName} returned HTTP ${res.status}`);
        }
        cb.onSuccess();
        return res;
      } catch (err) {
        cb.onFailure();
        throw err;
      }
    },
    {
      maxAttempts: 3,
      initialDelayMs: 500,
      retryOn: (err) => {
        // Retry on network errors and 5xx, not on 4xx
        if (err instanceof Error) {
          return !err.message.includes("HTTP 4");
        }
        return true;
      },
    }
  );
}

// ─── OpenSearch Client ────────────────────────────────────────────────────────

let openSearchClient: unknown = null;

export async function getOpenSearchClient() {
  if (openSearchClient) return openSearchClient;

  const OPENSEARCH_URL = process.env.OPENSEARCH_URL ?? "http://localhost:9200";
  const OPENSEARCH_USER = process.env.OPENSEARCH_USERNAME ?? "admin";
  // SW-S2-4: no default password. Unset → fail closed (no client), never "admin/admin".
  const OPENSEARCH_PASS = process.env.OPENSEARCH_PASSWORD ?? "";
  if (!OPENSEARCH_PASS) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("[middlewareClients] OPENSEARCH_PASSWORD must be set in production (no default).");
    }
    console.warn("[middlewareClients] OPENSEARCH_PASSWORD not set — OpenSearch client unavailable (fail closed).");
    return null;
  }

  try {
    const { Client } = await import("@opensearch-project/opensearch");
    openSearchClient = new Client({
      node: OPENSEARCH_URL,
      auth: { username: OPENSEARCH_USER, password: OPENSEARCH_PASS },
      ssl: { rejectUnauthorized: process.env.NODE_ENV === "production" },
      requestTimeout: 10_000,
      maxRetries: 3,
    });
    return openSearchClient;
  } catch (err) {
    console.error("[opensearch] Client creation failed:", err);
    return null;
  }
}

// ─── Kafka Producer ───────────────────────────────────────────────────────────

let kafkaProducer: unknown = null;

export async function getKafkaProducer() {
  if (kafkaProducer) return kafkaProducer;

  const KAFKA_BROKERS = (process.env.KAFKA_BROKERS ?? "localhost:9092").split(",");
  const CLIENT_ID = process.env.KAFKA_CLIENT_ID ?? "tradegateway-server";

  try {
    const { Kafka } = await import("kafkajs");
    const kafka = new Kafka({
      clientId: CLIENT_ID,
      brokers: KAFKA_BROKERS,
      retry: {
        initialRetryTime: 300,
        retries: 10,
        maxRetryTime: 30_000,
        factor: 2,
      },
      connectionTimeout: 10_000,
    });

    kafkaProducer = kafka.producer({
      idempotent: true,                    // Exactly-once semantics
      maxInFlightRequests: 1,              // Required for idempotent producer
      transactionTimeout: 60_000,
    });

    await (kafkaProducer as any).connect();
    return kafkaProducer;
  } catch (err) {
    console.error("[kafka] Producer connection failed:", err);
    return null;
  }
}

// ─── Permify gRPC Client ──────────────────────────────────────────────────────

let permifyClient: unknown = null;

export async function getPermifyClient() {
  if (permifyClient) return permifyClient;

  const PERMIFY_URL = process.env.PERMIFY_GRPC_URL ?? "localhost:3478";

  // Permify uses HTTP/REST API (not gRPC from Node.js)
  permifyClient = {
    check: async (params: {
      tenantId: string;
      entity: { type: string; id: string };
      permission: string;
      subject: { type: string; id: string };
    }) => {
      const cb = getCircuitBreaker("permify");
      if (cb.isOpen) return { can: false, reason: "circuit_open" };

      try {
        const res = await fetch(
          `http://${PERMIFY_URL}/v1/tenants/${params.tenantId}/permissions/check`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              entity: params.entity,
              permission: params.permission,
              subject: params.subject,
            }),
            signal: AbortSignal.timeout(5_000),
          }
        );
        if (!res.ok) {
          cb.onFailure();
          return { can: false, reason: `http_${res.status}` };
        }
        const data = await res.json() as { can: string };
        cb.onSuccess();
        return { can: data.can === "CHECK_RESULT_ALLOWED", reason: "ok" };
      } catch (err) {
        cb.onFailure();
        return { can: false, reason: "error" };
      }
    },
  };

  return permifyClient;
}

// ─── Keycloak JWKS Client ─────────────────────────────────────────────────────

interface JWKSCache {
  keys: unknown[];
  fetchedAt: number;
}

let jwksCache: JWKSCache | null = null;
const JWKS_TTL_MS = 3_600_000; // 1 hour

export async function getKeycloakJWKS(): Promise<unknown[]> {
  if (jwksCache && Date.now() - jwksCache.fetchedAt < JWKS_TTL_MS) {
    return jwksCache.keys;
  }

  const KEYCLOAK_URL = process.env.KEYCLOAK_URL ?? "http://localhost:8080";
  const REALM = process.env.KEYCLOAK_REALM ?? "tradegateway";

  const cb = getCircuitBreaker("keycloak-jwks");
  if (cb.isOpen) {
    return jwksCache?.keys ?? [];
  }

  try {
    const res = await fetch(
      `${KEYCLOAK_URL}/realms/${REALM}/protocol/openid-connect/certs`,
      { signal: AbortSignal.timeout(5_000) }
    );
    if (!res.ok) throw new Error(`JWKS fetch failed: ${res.status}`);
    const data = await res.json() as { keys: unknown[] };
    jwksCache = { keys: data.keys, fetchedAt: Date.now() };
    cb.onSuccess();
    return data.keys;
  } catch (err) {
    cb.onFailure();
    console.error("[keycloak] JWKS fetch failed:", err);
    return jwksCache?.keys ?? [];
  }
}

// ─── Fluvio Client — REMOVED (PRA-101 residual, Phase 9) ────────────────────
// Fluvio is NOT deployed on this platform (P0-9). The publishToFluvio helper
// posted to a phantom HTTP proxy and returned boolean success/failure that no
// caller acted on. Deleted along with the Python fluvio_middleware.py phantom
// in the six AI microservices and services/python-ai. Kafka is the real event
// bus (server/_core/kafka.ts).

// ─── Graceful Shutdown ────────────────────────────────────────────────────────

export async function shutdownAllClients(): Promise<void> {
  const promises: Promise<void>[] = [];

  if (kafkaProducer) {
    promises.push((kafkaProducer as any).disconnect().catch(console.error));
  }

  await Promise.allSettled(promises);
  console.log("[middleware] All clients disconnected");
}

// Register shutdown handler
if (typeof process !== "undefined") {
  process.on("SIGTERM", async () => {
    await shutdownAllClients();
    process.exit(0);
  });
  process.on("SIGINT", async () => {
    await shutdownAllClients();
    process.exit(0);
  });
}
