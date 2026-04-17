/**
 * redis.ts — Production Redis client singleton using ioredis.
 *
 * Provides:
 *   - getRedis()           — lazy singleton Redis client
 *   - redisRateLimit()     — sliding-window rate limiter using INCR + EXPIRE
 *   - redisHealthCheck()   — ping check for /api/health endpoint
 *
 * Falls back gracefully when REDIS_URL is not set (dev/test environments).
 */

import Redis from "ioredis";
import { ENV } from "./env";

let _redis: Redis | null = null;
let _connectionFailed = false;

/**
 * Returns the Redis singleton, or null if Redis is unavailable.
 * Uses ENV.redisUrl (which includes password default) so it works out-of-the-box.
 * Errors are caught and logged — the app continues without Redis.
 */
export function getRedis(): Redis | null {
  if (_connectionFailed) return null;
  if (_redis) return _redis;

  // Use ENV.redisUrl which has the password-authenticated default
  const url = ENV.redisUrl;
  if (!url || url === "redis://localhost:6379") {
    // Legacy no-password URL — try anyway but don't block startup
  }

  try {
    _redis = new Redis(url, {
      maxRetriesPerRequest: 3,
      enableReadyCheck: true,
      lazyConnect: false,
      connectTimeout: 5_000,
      commandTimeout: 2_000,
      retryStrategy: (times) => {
        if (times > 5) {
          console.warn("[Redis] Max retries exceeded — disabling Redis client");
          _connectionFailed = true;
          return null; // stop retrying
        }
        return Math.min(times * 200, 2_000);
      },
    });

    _redis.on("connect", () => console.log("[Redis] Connected"));
    _redis.on("error", (err) => {
      console.error("[Redis] Connection error:", err.message);
    });
    _redis.on("close", () => console.warn("[Redis] Connection closed"));

    return _redis;
  } catch (err) {
    console.error("[Redis] Failed to initialise client:", err);
    _connectionFailed = true;
    return null;
  }
}

/**
 * Sliding-window rate limiter backed by Redis INCR + EXPIRE.
 *
 * Uses a fixed-window approach per windowMs:
 *   key = `rl:{namespace}:{identifier}:{window_bucket}`
 *
 * Returns true if the request is allowed, false if the limit is exceeded.
 * Falls back to always-allow (true) when Redis is unavailable.
 */
export async function redisRateLimit(
  namespace: string,
  identifier: string,
  windowMs: number,
  max: number
): Promise<boolean> {
  const redis = getRedis();
  if (!redis) return true; // no Redis — allow all (in-memory fallback handles it)

  const windowBucket = Math.floor(Date.now() / windowMs);
  const key = `rl:${namespace}:${identifier}:${windowBucket}`;

  try {
    const pipeline = redis.pipeline();
    pipeline.incr(key);
    pipeline.pexpire(key, windowMs * 2); // TTL = 2x window to handle clock skew
    const results = await pipeline.exec();

    if (!results) return true;
    const count = results[0]?.[1] as number;
    return count <= max;
  } catch (err) {
    console.error("[Redis] Rate limit check failed:", err);
    return true; // fail open — don't block requests on Redis errors
  }
}

/**
 * Health check — returns true if Redis is reachable.
 */
export async function redisHealthCheck(): Promise<{ ok: boolean; latencyMs?: number; error?: string }> {
  const redis = getRedis();
  if (!redis) return { ok: false, error: "Redis not configured" };

  try {
    const start = Date.now();
    const pong = await redis.ping();
    return { ok: pong === "PONG", latencyMs: Date.now() - start };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Gracefully close the Redis connection (for graceful shutdown).
 */
export async function closeRedis(): Promise<void> {
  if (_redis) {
    await _redis.quit();
    _redis = null;
  }
}
