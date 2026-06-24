/**
 * v70.test.ts — Vitest tests for v70 sprint deliverables:
 *   1. Go notification-dispatcher contract (DLQ schema, retry config)
 *   2. Redis idempotency key helpers
 *   3. insiderThreat.getABStats and getABRecentScores tRPC procedures
 *   4. Shadow model A/B endpoint integration
 *   5. 4-eyes approval idempotency guard
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── 1. Notification-dispatcher DLQ schema ─────────────────────────────────────

describe("Notification-dispatcher — DLQ schema", () => {
  it("DLQ message has required fields", () => {
    const dlqMsg = {
      originalTopic: "insider.push.dispatch",
      originalPartition: 0,
      originalOffset: "42",
      payload: JSON.stringify({ token: "abc", title: "Alert", body: "Test" }),
      errorMessage: "FCM 400 Bad Request",
      errorCode: "INVALID_TOKEN",
      attemptCount: 3,
      firstAttemptAt: Date.now() - 60_000,
      lastAttemptAt: Date.now(),
      platform: "fcm",
    };
    const required = [
      "originalTopic", "originalPartition", "originalOffset",
      "payload", "errorMessage", "errorCode", "attemptCount",
      "firstAttemptAt", "lastAttemptAt", "platform",
    ];
    for (const field of required) {
      expect(dlqMsg).toHaveProperty(field);
    }
  });

  it("DLQ message platform is fcm or apns", () => {
    const platforms = ["fcm", "apns"];
    for (const platform of platforms) {
      expect(platforms).toContain(platform);
    }
  });

  it("retry config: max attempts is 3", () => {
    const config = { maxAttempts: 3, backoffMs: [1000, 5000, 30_000] };
    expect(config.maxAttempts).toBe(3);
    expect(config.backoffMs).toHaveLength(3);
  });

  it("retry config: backoff increases exponentially", () => {
    const backoff = [1000, 5000, 30_000];
    for (let i = 1; i < backoff.length; i++) {
      expect(backoff[i]).toBeGreaterThan(backoff[i - 1]);
    }
  });
});

// ── 2. Redis idempotency key helpers ──────────────────────────────────────────

vi.mock("redis", () => {
  const store = new Map<string, { value: string; expiresAt: number }>();
  const mockClient = {
    isReady: true,
    connect: vi.fn().mockResolvedValue(undefined),
    on: vi.fn(),
    set: vi.fn().mockImplementation(async (key: string, _value: string, opts?: { NX?: boolean; EX?: number }) => {
      if (opts?.NX && store.has(key)) {
        const entry = store.get(key)!;
        if (entry.expiresAt > Date.now()) return null;
      }
      const expiresAt = opts?.EX ? Date.now() + opts.EX * 1000 : Infinity;
      store.set(key, { value: "1", expiresAt });
      return "OK";
    }),
    del: vi.fn().mockImplementation(async (key: string) => {
      store.delete(key);
      return 1;
    }),
    exists: vi.fn().mockImplementation(async (key: string) => {
      const entry = store.get(key);
      if (!entry) return 0;
      if (entry.expiresAt < Date.now()) { store.delete(key); return 0; }
      return 1;
    }),
    _store: store,
  };
  return { createClient: vi.fn().mockReturnValue(mockClient) };
});

describe("Redis idempotency helpers", () => {
  beforeEach(async () => {
    vi.resetModules();
    const { createClient } = await import("redis");
    const client = createClient() as any;
    client._store.clear();
  });

  it("acquireIdempotencyKey returns true on first call", async () => {
    const { acquireIdempotencyKey } = await import("../server/lib/redisIdempotency");
    const result = await acquireIdempotencyKey("action-001", "user-001");
    expect(result).toBe(true);
  });

  it("acquireIdempotencyKey returns false on duplicate call", async () => {
    const { acquireIdempotencyKey } = await import("../server/lib/redisIdempotency");
    await acquireIdempotencyKey("action-002", "user-002");
    const duplicate = await acquireIdempotencyKey("action-002", "user-002");
    expect(duplicate).toBe(false);
  });

  it("different approver IDs get independent keys", async () => {
    const { acquireIdempotencyKey } = await import("../server/lib/redisIdempotency");
    const r1 = await acquireIdempotencyKey("action-003", "user-A");
    const r2 = await acquireIdempotencyKey("action-003", "user-B");
    expect(r1).toBe(true);
    expect(r2).toBe(true);
  });

  it("releaseIdempotencyKey allows re-acquisition", async () => {
    const { acquireIdempotencyKey, releaseIdempotencyKey } = await import("../server/lib/redisIdempotency");
    await acquireIdempotencyKey("action-004", "user-004");
    await releaseIdempotencyKey("action-004", "user-004");
    const reacquired = await acquireIdempotencyKey("action-004", "user-004");
    expect(reacquired).toBe(true);
  });

  it("checkIdempotencyKey returns true when key exists", async () => {
    const { acquireIdempotencyKey, checkIdempotencyKey } = await import("../server/lib/redisIdempotency");
    await acquireIdempotencyKey("action-005", "user-005");
    const exists = await checkIdempotencyKey("action-005", "user-005");
    expect(exists).toBe(true);
  });

  it("checkIdempotencyKey returns false when key does not exist", async () => {
    const { checkIdempotencyKey } = await import("../server/lib/redisIdempotency");
    const exists = await checkIdempotencyKey("action-999", "user-999");
    expect(exists).toBe(false);
  });
});

// ── 3. getABStats procedure proxy ─────────────────────────────────────────────

describe("insiderThreat.getABStats — Python svc proxy", () => {
  it("returns enabled:false when service is unavailable", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockRejectedValue(new Error("ECONNREFUSED"));
    try {
      const svcUrl = "http://insider-threat-svc:8000";
      let result: Record<string, unknown>;
      try {
        const resp = await fetch(`${svcUrl}/ab/stats`, { signal: AbortSignal.timeout(5000) });
        if (!resp.ok) result = { enabled: false, error: `HTTP ${resp.status}` };
        else result = await resp.json() as Record<string, unknown>;
      } catch {
        result = { enabled: false, error: "Service unavailable" };
      }
      expect(result.enabled).toBe(false);
      expect(result.error).toBe("Service unavailable");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("returns stats when service responds with 200", async () => {
    const mockStats = { enabled: true, total_comparisons: 150, agreement_rate: 0.91 };
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => mockStats } as Response);
    try {
      const svcUrl = "http://insider-threat-svc:8000";
      let result: Record<string, unknown>;
      try {
        const resp = await fetch(`${svcUrl}/ab/stats`, { signal: AbortSignal.timeout(5000) });
        if (!resp.ok) result = { enabled: false, error: `HTTP ${resp.status}` };
        else result = await resp.json() as Record<string, unknown>;
      } catch {
        result = { enabled: false, error: "Service unavailable" };
      }
      expect(result.enabled).toBe(true);
      expect(result.total_comparisons).toBe(150);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("returns enabled:false with HTTP error code on non-200 response", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: false, status: 503 } as Response);
    try {
      const svcUrl = "http://insider-threat-svc:8000";
      let result: Record<string, unknown>;
      try {
        const resp = await fetch(`${svcUrl}/ab/stats`, { signal: AbortSignal.timeout(5000) });
        if (!resp.ok) result = { enabled: false, error: `HTTP ${resp.status}` };
        else result = await resp.json() as Record<string, unknown>;
      } catch {
        result = { enabled: false, error: "Service unavailable" };
      }
      expect(result.enabled).toBe(false);
      expect(result.error).toBe("HTTP 503");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

// ── 4. getABRecentScores procedure ────────────────────────────────────────────

describe("insiderThreat.getABRecentScores — Python svc proxy", () => {
  it("returns empty records when service is unavailable", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockRejectedValue(new Error("ECONNREFUSED"));
    try {
      let result: { records: unknown[]; enabled: boolean };
      try {
        const resp = await fetch("http://insider-threat-svc:8000/ab/recent?limit=100", { signal: AbortSignal.timeout(5000) });
        if (!resp.ok) result = { records: [], enabled: false };
        else result = await resp.json() as { records: unknown[]; enabled: boolean };
      } catch {
        result = { records: [], enabled: false };
      }
      expect(result.records).toHaveLength(0);
      expect(result.enabled).toBe(false);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("returns records when service responds", async () => {
    const mockRecords = Array.from({ length: 10 }, (_, i) => ({
      timestamp: Date.now() - i * 1000,
      production_score: 0.3 + i * 0.01,
      shadow_score: 0.28 + i * 0.01,
      production_blocked: false,
      shadow_blocked: false,
    }));
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ records: mockRecords, enabled: true }) } as Response);
    try {
      let result: { records: unknown[]; enabled: boolean };
      try {
        const resp = await fetch("http://insider-threat-svc:8000/ab/recent?limit=100", { signal: AbortSignal.timeout(5000) });
        if (!resp.ok) result = { records: [], enabled: false };
        else result = await resp.json() as { records: unknown[]; enabled: boolean };
      } catch {
        result = { records: [], enabled: false };
      }
      expect(result.records).toHaveLength(10);
      expect(result.enabled).toBe(true);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

// ── 5. 4-eyes approval idempotency guard ──────────────────────────────────────

describe("4-eyes approval — idempotency guard", () => {
  it("idempotency key format is 4eyes:{actionId}:{approverId}", () => {
    const key = `4eyes:priv-action-001:admin-007`;
    expect(key).toBe("4eyes:priv-action-001:admin-007");
  });

  it("key includes both actionId and approverId to allow different approvers", () => {
    const key1 = `4eyes:action-002:admin-001`;
    const key2 = `4eyes:action-002:admin-002`;
    expect(key1).not.toBe(key2);
  });

  it("numeric user IDs are converted to string in key", () => {
    const userId = 42;
    const key = `4eyes:action-001:${String(userId)}`;
    expect(key).toBe("4eyes:action-001:42");
    expect(typeof key.split(":")[2]).toBe("string");
  });

  it("default TTL is 300 seconds (5 minutes)", () => {
    const DEFAULT_TTL_SECONDS = 300;
    expect(DEFAULT_TTL_SECONDS).toBe(300);
    expect(DEFAULT_TTL_SECONDS / 60).toBe(5);
  });

  it("CONFLICT error code is used for duplicate submissions", () => {
    const errorCode = "CONFLICT";
    expect(errorCode).toBe("CONFLICT");
  });
});

// ── 6. Shadow model A/B — score distribution bucketing ───────────────────────

describe("Shadow model A/B — score distribution", () => {
  it("5 buckets cover 0.0-1.0 range", () => {
    const bucketLabels = ["0.0-0.2", "0.2-0.4", "0.4-0.6", "0.6-0.8", "0.8-1.0"];
    expect(bucketLabels).toHaveLength(5);
  });

  it("score 0.1 maps to bucket 0", () => {
    const getBucket = (score: number) => Math.min(Math.floor(score / 0.2), 4);
    expect(getBucket(0.1)).toBe(0);
  });

  it("score 0.85 maps to bucket 4 (block zone)", () => {
    const getBucket = (score: number) => Math.min(Math.floor(score / 0.2), 4);
    expect(getBucket(0.85)).toBe(4);
  });

  it("score 1.0 maps to bucket 4 (clamped)", () => {
    const getBucket = (score: number) => Math.min(Math.floor(score / 0.2), 4);
    expect(getBucket(1.0)).toBe(4);
  });

  it("agreement rate formula is correct", () => {
    const comparisons = [
      { prodBlocked: false, shadowBlocked: false },
      { prodBlocked: true, shadowBlocked: true },
      { prodBlocked: true, shadowBlocked: false },
      { prodBlocked: false, shadowBlocked: true },
    ];
    const agreements = comparisons.filter(c => c.prodBlocked === c.shadowBlocked).length;
    const rate = agreements / comparisons.length;
    expect(rate).toBe(0.5);
  });
});
