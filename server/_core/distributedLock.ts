/**
 * distributedLock.ts — Redis-backed distributed locks for TradeGateway NGSWTP
 *
 * Implements the Redlock algorithm (single-node variant) to prevent:
 *   - Double-spending: Two concurrent payment requests for the same declaration
 *   - Race conditions: Concurrent status updates on the same declaration
 *   - Duplicate processing: Multiple workers processing the same payment event
 *
 * Usage:
 *   const lock = await acquireLock(`payment:declaration:${declarationId}`, 30_000);
 *   try {
 *     // critical section
 *   } finally {
 *     await releaseLock(lock);
 *   }
 *
 * If the lock cannot be acquired (another process holds it), a TRPCError
 * with code CONFLICT is thrown immediately — no retry, no waiting.
 */

import { createClient, type RedisClientType } from "redis";
import { TRPCError } from "@trpc/server";
import crypto from "crypto";

// ─── Redis client singleton ───────────────────────────────────────────────────

let redisClient: RedisClientType | null = null;
let redisConnecting = false;

async function getRedis(): Promise<RedisClientType | null> {
  if (redisClient?.isReady) return redisClient;
  if (redisConnecting) return null;

  const redisUrl = process.env.REDIS_URL ?? "redis://localhost:6379";

  try {
    redisConnecting = true;
    redisClient = createClient({ url: redisUrl }) as RedisClientType;
    redisClient.on("error", (err) => {
      console.error("[redis-lock] Client error:", err.message);
    });
    await redisClient.connect();
    redisConnecting = false;
    return redisClient;
  } catch (err) {
    redisConnecting = false;
    console.error("[redis-lock] Connection failed:", err);
    return null;
  }
}

// ─── Lock types ───────────────────────────────────────────────────────────────

export interface DistributedLock {
  key: string;
  token: string;   // Random token to prevent releasing another process's lock
  ttlMs: number;
  acquiredAt: Date;
}

// ─── Lock acquisition ─────────────────────────────────────────────────────────

/**
 * Acquire a distributed lock on the given key.
 *
 * @param key    The resource to lock (e.g. "payment:declaration:123")
 * @param ttlMs  Lock TTL in milliseconds (auto-released after this time)
 * @returns      The lock handle (must be passed to releaseLock)
 * @throws       TRPCError(CONFLICT) if the lock is already held
 */
export async function acquireLock(key: string, ttlMs = 30_000): Promise<DistributedLock> {
  const redis = await getRedis();

  if (!redis) {
    // Financial critical sections must never proceed without their stated lock.
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Payment processing is temporarily unavailable because the idempotency lock service is unavailable.",
    });
  }

  const lockKey = `lock:${key}`;
  const token = crypto.randomBytes(32).toString("hex");

  // SET key value NX PX ttlMs — atomic acquire
  const result = await redis.set(lockKey, token, {
    NX: true,           // Only set if not exists
    PX: ttlMs,          // Expire after ttlMs milliseconds
  });

  if (result !== "OK") {
    // Lock is held by another process
    throw new TRPCError({
      code: "CONFLICT",
      message: `Resource is locked: ${key}. Another operation is in progress. Please retry in a moment.`,
    });
  }

  return { key: lockKey, token, ttlMs, acquiredAt: new Date() };
}

/**
 * Release a distributed lock.
 * Uses a Lua script to atomically check the token and delete the key,
 * preventing a process from releasing another process's lock.
 */
export async function releaseLock(lock: DistributedLock): Promise<void> {
  const redis = await getRedis();
  if (!redis) return;

  // Lua script: only delete if the token matches (atomic check-and-delete)
  const luaScript = `
    if redis.call("GET", KEYS[1]) == ARGV[1] then
      return redis.call("DEL", KEYS[1])
    else
      return 0
    end
  `;

  await redis.eval(luaScript, {
    keys: [lock.key],
    arguments: [lock.token],
  });
}

/**
 * withLock — convenience wrapper that acquires a lock, runs fn, and releases.
 * Guarantees the lock is always released even if fn throws.
 *
 * @example
 *   const result = await withLock(`payment:declaration:${id}`, 30_000, async () => {
 *     return await processPayment(id);
 *   });
 */
export async function withLock<T>(
  key: string,
  ttlMs: number,
  fn: () => Promise<T>
): Promise<T> {
  const lock = await acquireLock(key, ttlMs);
  try {
    return await fn();
  } finally {
    await releaseLock(lock);
  }
}

// ─── Payment-specific lock helpers ───────────────────────────────────────────

/**
 * Lock a declaration for payment processing.
 * Prevents double-spending when two requests arrive simultaneously.
 */
export async function lockDeclarationForPayment(declarationId: number): Promise<DistributedLock> {
  return acquireLock(`payment:declaration:${declarationId}`, 60_000);
}

/**
 * Lock a payment for status update.
 * Prevents concurrent Mojaloop callbacks from double-confirming a payment.
 */
export async function lockPaymentForUpdate(paymentId: number): Promise<DistributedLock> {
  return acquireLock(`payment:update:${paymentId}`, 30_000);
}

/**
 * Lock a declaration for status transition.
 * Prevents concurrent workflow steps from racing on declaration status.
 */
export async function lockDeclarationForTransition(declarationId: number): Promise<DistributedLock> {
  return acquireLock(`declaration:transition:${declarationId}`, 30_000);
}

/**
 * Lock an invoice for duty calculation.
 * Prevents duplicate invoices from being created for the same declaration.
 */
export async function lockInvoiceCreation(declarationId: number): Promise<DistributedLock> {
  return acquireLock(`invoice:create:${declarationId}`, 15_000);
}

// ─── Idempotency key cache ────────────────────────────────────────────────────

/**
 * Store an idempotency key with its response.
 * Returns true if this is a new key (first time seeing it).
 * Returns false if the key already exists (duplicate request).
 */
export async function setIdempotencyKey(
  key: string,
  response: unknown,
  ttlMs = 86_400_000 // 24 hours
): Promise<boolean> {
  const redis = await getRedis();
  if (!redis) return true; // Fail open

  const cacheKey = `idempotency:${key}`;
  const result = await redis.set(cacheKey, JSON.stringify(response), {
    NX: true,
    PX: ttlMs,
  });

  return result === "OK"; // true = new key, false = duplicate
}

/**
 * Get the cached response for an idempotency key.
 */
export async function getIdempotencyKey(key: string): Promise<unknown | null> {
  const redis = await getRedis();
  if (!redis) return null;

  const cacheKey = `idempotency:${key}`;
  const cached = await redis.get(cacheKey);
  if (!cached) return null;

  try {
    return JSON.parse(cached);
  } catch {
    return null;
  }
}
