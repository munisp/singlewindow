/**
 * redisIdempotency.ts
 *
 * Redis-backed idempotency key helper for the 4-eyes approval flow.
 * Prevents duplicate approval submissions within a 5-minute window.
 *
 * Key format: 4eyes:{actionId}:{approverId}
 * TTL: 300 seconds (5 minutes)
 */

import { createClient } from "redis";
import { ENV } from "../_core/env";

const DEFAULT_TTL_SECONDS = 300;

let _client: ReturnType<typeof createClient> | null = null;

async function getClient() {
  if (_client && _client.isReady) return _client;
  const redisUrl = (ENV as any).redisUrl ?? process.env.REDIS_URL ?? "redis://localhost:6379";
  _client = createClient({ url: redisUrl });
  _client.on("error", (err: Error) => {
    console.error("[redisIdempotency] Redis error:", err.message);
  });
  await _client.connect();
  return _client;
}

function buildKey(actionId: string | number, approverId: string | number): string {
  return `4eyes:${actionId}:${approverId}`;
}

/**
 * Attempt to acquire an idempotency key.
 * Returns true if the key was set (first submission), false if it already exists (duplicate).
 */
export async function acquireIdempotencyKey(
  actionId: string | number,
  approverId: string | number,
  ttlSeconds = DEFAULT_TTL_SECONDS
): Promise<boolean> {
  try {
    const client = await getClient();
    const key = buildKey(actionId, approverId);
    // NX = only set if not exists; EX = expire in ttlSeconds
    const result = await client.set(key, "1", { NX: true, EX: ttlSeconds });
    return result === "OK";
  } catch (err) {
    // Fail open: if Redis is unavailable, allow the request through
    console.error("[redisIdempotency] acquireIdempotencyKey error:", err);
    return true;
  }
}

/**
 * Release an idempotency key (e.g., after a successful approval).
 */
export async function releaseIdempotencyKey(
  actionId: string | number,
  approverId: string | number
): Promise<void> {
  try {
    const client = await getClient();
    await client.del(buildKey(actionId, approverId));
  } catch (err) {
    console.error("[redisIdempotency] releaseIdempotencyKey error:", err);
  }
}

/**
 * Check whether an idempotency key currently exists.
 */
export async function checkIdempotencyKey(
  actionId: string | number,
  approverId: string | number
): Promise<boolean> {
  try {
    const client = await getClient();
    const exists = await client.exists(buildKey(actionId, approverId));
    return exists > 0;
  } catch (err) {
    console.error("[redisIdempotency] checkIdempotencyKey error:", err);
    return false;
  }
}
