/**
 * redisRateLimiter.ts — R3 FIX: Distributed Redis-backed rate limiting
 *
 * Replaces the in-memory express-rate-limit store with a Redis sliding-window
 * counter so limits are enforced consistently across all Node.js instances
 * in a multi-pod Kubernetes deployment.
 *
 * Also provides:
 *   - Session revocation via Redis SET with TTL (logout invalidates JWT)
 *   - Distributed idempotency key storage for payment deduplication
 *
 * Algorithm: Fixed-window counter using INCR + EXPIRE (atomic via Lua script)
 * Fallback posture (PRA-013/PRA-026, Phase 9):
 *   - PRODUCTION: Redis down => FAIL CLOSED. The limiter throws
 *     RateLimiterUnavailableError and the Express middleware answers
 *     503 { error: "RATE_LIMITER_UNAVAILABLE" }. A per-process Map fallback is
 *     NEVER correct in production: with N replicas each pod would grant its
 *     own allowance, multiplying the effective limit by N.
 *   - DEV/TEST ONLY: an in-memory per-process fallback is available behind the
 *     explicit opt-in RATE_LIMIT_ALLOW_INMEMORY_FALLBACK=true. The flag is
 *     ignored in production.
 */

import type { Request, Response, NextFunction } from "express";
import Redis from "ioredis";

/** Typed failure surfaced when the distributed limiter cannot serve. */
export class RateLimiterUnavailableError extends Error {
  readonly code = "RATE_LIMITER_UNAVAILABLE" as const;
  constructor(message = "Redis-backed rate limiter is unavailable") {
    super(message);
    this.name = "RateLimiterUnavailableError";
  }
}

/**
 * Dev/test-only escape hatch: allow the per-process in-memory fallback.
 * ALWAYS false in production regardless of the flag (fail closed).
 */
export function rateLimiterInMemoryFallbackAllowed(): boolean {
  return (
    process.env.NODE_ENV !== "production" &&
    process.env.RATE_LIMIT_ALLOW_INMEMORY_FALLBACK === "true"
  );
}

/**
 * Shared decision for every Redis-backed limiter path: either a Redis client,
 * or (dev-only, explicit flag) null meaning "caller may use in-memory", or a
 * thrown RateLimiterUnavailableError (fail closed).
 */
export function resolveLimiterBackend(redis: Redis | null): Redis | null {
  if (redis) return redis;
  if (rateLimiterInMemoryFallbackAllowed()) return null;
  throw new RateLimiterUnavailableError(
    "Redis is unavailable and the in-memory rate-limiter fallback is not enabled " +
      "(set RATE_LIMIT_ALLOW_INMEMORY_FALLBACK=true in non-production only) — failing closed"
  );
}

// ─── Redis singleton ──────────────────────────────────────────────────────────

let _redis: Redis | null = null;
let _redisFailed = false;

function getRedis(): Redis | null {
  if (_redisFailed) return null;
  if (_redis) return _redis;

  const url = process.env.REDIS_URL ?? "redis://localhost:6379";
  try {
    _redis = new Redis(url, {
      lazyConnect: true,
      connectTimeout: 3_000,
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
    });
    _redis.on("error", (err) => {
      console.error("[Redis] Connection error (rate limiter fails closed unless the dev-only in-memory fallback is enabled):", err.message);
      _redisFailed = true;
      _redis = null;
    });
    return _redis;
  } catch {
    _redisFailed = true;
    return null;
  }
}

// ─── In-memory fallback ───────────────────────────────────────────────────────

const _memStore = new Map<string, { count: number; resetAt: number }>();

function memIncr(key: string, windowMs: number): number {
  const now = Date.now();
  const entry = _memStore.get(key);
  if (!entry || now > entry.resetAt) {
    _memStore.set(key, { count: 1, resetAt: now + windowMs });
    return 1;
  }
  entry.count++;
  return entry.count;
}

// ─── Core rate-limit function ─────────────────────────────────────────────────

/**
 * Increments the request counter for `key` within `windowMs`.
 * Returns the current count (1 = first request in window).
 *
 * Fail-closed (PRA-026): when Redis is unavailable this throws
 * RateLimiterUnavailableError unless the explicit dev-only in-memory fallback
 * is enabled (rateLimiterInMemoryFallbackAllowed()).
 */
export async function incrementRateLimit(key: string, windowMs: number): Promise<number> {
  const redis = resolveLimiterBackend(getRedis());
  if (!redis) return memIncr(key, windowMs); // dev-only explicit fallback

  try {
    // Lua script: INCR + PEXPIRE in a single atomic operation
    const luaScript = `
      local current = redis.call('INCR', KEYS[1])
      if current == 1 then
        redis.call('PEXPIRE', KEYS[1], ARGV[1])
      end
      return current
    `;
    const result = await redis.eval(luaScript, 1, key, String(windowMs));
    return typeof result === "number" ? result : parseInt(String(result), 10);
  } catch (err) {
    // A Redis command error mid-window is an outage too: same posture as
    // "no client" — fail closed unless the dev fallback is explicitly on.
    if (rateLimiterInMemoryFallbackAllowed()) {
      return memIncr(key, windowMs);
    }
    throw new RateLimiterUnavailableError(
      `Redis rate-limit command failed: ${err instanceof Error ? err.message : String(err)}`
    );
  }
}

// ─── Express middleware factory ───────────────────────────────────────────────

export interface RedisRateLimitOptions {
  windowMs: number;
  max: number;
  keyPrefix: string;
  message?: string;
  /** Extract the rate-limit key from the request (default: IP address) */
  keyExtractor?: (req: Request) => string;
}

export function redisRateLimit(options: RedisRateLimitOptions) {
  const {
    windowMs,
    max,
    keyPrefix,
    message = "Too many requests — please try again later.",
    keyExtractor = (req) => req.ip ?? "unknown",
  } = options;

  return async (req: Request, res: Response, next: NextFunction) => {
    const identifier = keyExtractor(req);
    const key = `rl:${keyPrefix}:${identifier}`;

    try {
      const count = await incrementRateLimit(key, windowMs);
      res.setHeader("X-RateLimit-Limit", max);
      res.setHeader("X-RateLimit-Remaining", Math.max(0, max - count));
      res.setHeader("X-RateLimit-Reset", Math.ceil((Date.now() + windowMs) / 1000));

      if (count > max) {
        res.status(429).json({ error: message, retryAfterMs: windowMs });
        return;
      }
    } catch (err) {
      if (err instanceof RateLimiterUnavailableError) {
        // PRA-026: fail closed — 503 with a typed error, never silent allow.
        res.status(503).json({
          error: "RATE_LIMITER_UNAVAILABLE",
          message: "Rate limiting is temporarily unavailable — request refused (fail-closed).",
          retryAfterMs: windowMs,
        });
        return;
      }
      // Unexpected errors: same fail-closed posture.
      res.status(503).json({
        error: "RATE_LIMITER_UNAVAILABLE",
        message: "Rate limiting check failed — request refused (fail-closed).",
        retryAfterMs: windowMs,
      });
      return;
    }

    next();
  };
}

// ─── Pre-configured rate limiters ────────────────────────────────────────────

/** Global API rate limit: 200 req / 15 min per IP */
export const globalApiRateLimit = redisRateLimit({
  windowMs: 15 * 60 * 1000,
  max: 200,
  keyPrefix: "global",
  message: "Global rate limit exceeded. Please wait before retrying.",
});

/** Financial endpoints: 20 req / 60 s per IP */
export const financialRateLimitRedis = redisRateLimit({
  windowMs: 60 * 1000,
  max: 20,
  keyPrefix: "financial",
  message: "Too many financial requests — please wait before retrying.",
});

/** Auth endpoints: 10 req / 15 min per IP (brute-force protection) */
export const authRateLimitRedis = redisRateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  keyPrefix: "auth",
  message: "Too many authentication attempts — please wait 15 minutes before retrying.",
});

/** Admin operations: 30 req / 60 s per user ID */
export const adminRateLimitRedis = redisRateLimit({
  windowMs: 60 * 1000,
  max: 30,
  keyPrefix: "admin",
  keyExtractor: (req) => {
    // Use user ID from session cookie if available, fall back to IP
    const userId = (req as any).user?.id;
    return userId ? `user:${userId}` : (req.ip ?? "unknown");
  },
  message: "Admin operation rate limit exceeded.",
});

// ─── Session revocation (logout token blacklist) ──────────────────────────────

const SESSION_REVOCATION_TTL_S = 24 * 60 * 60; // 24 hours (matches JWT expiry)

/**
 * Adds a session token to the Redis revocation blacklist.
 * Called on logout to immediately invalidate the JWT.
 * Fail-closed in production: if the revocation cannot be durably recorded the
 * caller gets an error (the logout MUST surface as failed) instead of a
 * silently-not-revoked session.
 */
export async function revokeSession(sessionId: string): Promise<void> {
  const redis = getRedis();
  if (!redis) {
    if (process.env.NODE_ENV === "production") {
      throw new RateLimiterUnavailableError(
        "Redis unavailable — session revocation NOT recorded (fail-closed)"
      );
    }
    console.warn("[Redis] Session revocation skipped — Redis unavailable (dev)");
    return;
  }
  try {
    await redis.set(`revoked:${sessionId}`, "1", "EX", SESSION_REVOCATION_TTL_S);
  } catch (err) {
    if (process.env.NODE_ENV === "production") {
      throw new RateLimiterUnavailableError(
        `Redis revocation write failed — session NOT revoked (fail-closed): ${err instanceof Error ? err.message : err}`
      );
    }
    console.warn("[Redis] Session revocation failed (dev):", err);
  }
}

/**
 * Checks if a session token has been revoked.
 * Returns true if the session is blacklisted (should be rejected).
 * Fail-closed in production: Redis down => treat every presented session as
 * revoked (deny) rather than letting logged-out tokens back in.
 */
export async function isSessionRevoked(sessionId: string): Promise<boolean> {
  const redis = getRedis();
  if (!redis) {
    return process.env.NODE_ENV === "production"; // prod: deny; dev: allow
  }
  try {
    const val = await redis.get(`revoked:${sessionId}`);
    return val === "1";
  } catch {
    return process.env.NODE_ENV === "production";
  }
}

// ─── Distributed idempotency key store ───────────────────────────────────────

const IDEMPOTENCY_TTL_S = 24 * 60 * 60; // 24 hours

/**
 * Stores an idempotency key result in Redis.
 * Returns true if this is a new key (first request), false if duplicate.
 */
export async function setIdempotencyKey(
  key: string,
  responseSnapshot: unknown
): Promise<boolean> {
  const redis = getRedis();
  if (!redis) return true; // fail-open

  try {
    const serialized = JSON.stringify(responseSnapshot);
    // NX = only set if not exists; returns OK on success, null if already exists
    const result = await redis.set(`idem:${key}`, serialized, "EX", IDEMPOTENCY_TTL_S, "NX");
    return result === "OK";
  } catch {
    return true;
  }
}

/**
 * Retrieves a previously stored idempotency key response.
 * Returns null if not found or Redis is unavailable.
 */
export async function getIdempotencyKey(key: string): Promise<unknown | null> {
  const redis = getRedis();
  if (!redis) return null;

  try {
    const val = await redis.get(`idem:${key}`);
    return val ? JSON.parse(val) : null;
  } catch {
    return null;
  }
}

// ─── Redis health check ───────────────────────────────────────────────────────

export async function redisHealthCheck(): Promise<{ ok: boolean; latencyMs?: number }> {
  const redis = getRedis();
  if (!redis) return { ok: false };
  try {
    const start = Date.now();
    await redis.ping();
    return { ok: true, latencyMs: Date.now() - start };
  } catch {
    return { ok: false };
  }
}

export async function closeRedis(): Promise<void> {
  if (_redis) {
    await _redis.quit().catch(() => {});
    _redis = null;
  }
}
