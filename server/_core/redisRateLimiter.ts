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
 * Fallback: If Redis is unavailable, falls back to in-memory (single-instance safe)
 */

import type { Request, Response, NextFunction } from "express";
import Redis from "ioredis";

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
      console.warn("[Redis] Connection error (rate limiter falling back to in-memory):", err.message);
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
 */
export async function incrementRateLimit(key: string, windowMs: number): Promise<number> {
  const redis = getRedis();
  if (!redis) return memIncr(key, windowMs);

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
  } catch {
    return memIncr(key, windowMs);
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
    } catch {
      // Rate limiter failure is non-blocking — allow request through
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
 */
export async function revokeSession(sessionId: string): Promise<void> {
  const redis = getRedis();
  if (!redis) {
    console.warn("[Redis] Session revocation skipped — Redis unavailable");
    return;
  }
  try {
    await redis.set(`revoked:${sessionId}`, "1", "EX", SESSION_REVOCATION_TTL_S);
  } catch (err) {
    console.warn("[Redis] Session revocation failed:", err);
  }
}

/**
 * Checks if a session token has been revoked.
 * Returns true if the session is blacklisted (should be rejected).
 */
export async function isSessionRevoked(sessionId: string): Promise<boolean> {
  const redis = getRedis();
  if (!redis) return false; // fail-open when Redis is unavailable
  try {
    const val = await redis.get(`revoked:${sessionId}`);
    return val === "1";
  } catch {
    return false;
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
