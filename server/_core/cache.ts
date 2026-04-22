/**
 * cache.ts — Redis-backed query result cache for TradeGateway NGSWTP
 *
 * Provides:
 *   - cacheGet<T>()       — get a cached value by key
 *   - cacheSet()          — set a value with TTL
 *   - cacheDel()          — invalidate one or more keys
 *   - cacheWrap<T>()      — cache-aside pattern: get or compute and cache
 *   - cacheInvalidate()   — invalidate by prefix pattern
 *
 * All operations degrade gracefully when Redis is unavailable.
 * TTL constants are exported for consistent cache lifetimes across routers.
 */
import { getRedis } from "./redis";

// ── TTL constants (seconds) ────────────────────────────────────────────────────
export const TTL = {
  /** Short-lived: dashboard stats, port congestion, vessel positions */
  SHORT: 30,
  /** Medium: declarations list, trader profiles, OGA permits */
  MEDIUM: 120,
  /** Long: HS code lookups, country lists, static reference data */
  LONG: 600,
  /** Very long: AEO status, compliance scorecards */
  VERY_LONG: 1800,
} as const;

const CACHE_PREFIX = "tg:cache:";

/**
 * Build a namespaced cache key.
 */
export function cacheKey(...parts: (string | number)[]): string {
  return `${CACHE_PREFIX}${parts.join(":")}`;
}

/**
 * Get a cached value. Returns null if not found or Redis unavailable.
 */
export async function cacheGet<T>(key: string): Promise<T | null> {
  const redis = getRedis();
  if (!redis) return null;
  try {
    const raw = await redis.get(key);
    if (!raw) return null;
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

/**
 * Set a value in cache with TTL (seconds).
 */
export async function cacheSet(key: string, value: unknown, ttlSeconds: number): Promise<void> {
  const redis = getRedis();
  if (!redis) return;
  try {
    await redis.setex(key, ttlSeconds, JSON.stringify(value));
  } catch {
    // Non-fatal
  }
}

/**
 * Delete one or more cache keys.
 */
export async function cacheDel(...keys: string[]): Promise<void> {
  const redis = getRedis();
  if (!redis || keys.length === 0) return;
  try {
    await redis.del(...keys);
  } catch {
    // Non-fatal
  }
}

/**
 * Cache-aside pattern: return cached value if available, otherwise compute,
 * cache the result, and return it.
 *
 * @param key     Cache key
 * @param ttl     TTL in seconds
 * @param fn      Async function to compute the value on cache miss
 */
export async function cacheWrap<T>(
  key: string,
  ttl: number,
  fn: () => Promise<T>
): Promise<T> {
  const cached = await cacheGet<T>(key);
  if (cached !== null) return cached;
  const value = await fn();
  // Fire-and-forget cache write — don't block the response
  cacheSet(key, value, ttl).catch(() => {});
  return value;
}

/**
 * Invalidate all keys matching a prefix pattern.
 * Uses SCAN to avoid blocking the Redis server.
 */
export async function cacheInvalidate(prefix: string): Promise<number> {
  const redis = getRedis();
  if (!redis) return 0;
  try {
    const pattern = `${CACHE_PREFIX}${prefix}*`;
    let cursor = "0";
    let deleted = 0;
    do {
      const [nextCursor, keys] = await redis.scan(cursor, "MATCH", pattern, "COUNT", 100);
      cursor = nextCursor;
      if (keys.length > 0) {
        await redis.del(...keys);
        deleted += keys.length;
      }
    } while (cursor !== "0");
    return deleted;
  } catch {
    return 0;
  }
}
