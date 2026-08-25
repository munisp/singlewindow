/**
 * Redis tRPC Router — Sprint v79
 * Admin/ops procedures for TTL management, cache invalidation, and key inspection.
 * All external Redis calls are stubbed in non-production environments.
 */

import { z } from "zod";
import { router, adminProcedure } from "../_core/trpc";
import { TRPCError } from "@trpc/server";

// ── Offline stubs ─────────────────────────────────────────────────────────────

interface CacheStats {
  connected_clients: number;
  used_memory_human: string;
  used_memory_peak_human: string;
  total_commands_processed: number;
  keyspace_hits: number;
  keyspace_misses: number;
  hit_rate_pct: number;
  uptime_in_seconds: number;
  db_keys: Record<string, number>;
}

interface KeyInfo {
  key: string;
  type: string;
  ttl: number;
  encoding: string;
  size_bytes: number;
  idle_seconds: number;
}

function offlineCacheStats(): CacheStats {
  return {
    connected_clients: 12,
    used_memory_human: "48.5M",
    used_memory_peak_human: "62.1M",
    total_commands_processed: 1_847_293,
    keyspace_hits: 1_623_410,
    keyspace_misses: 223_883,
    hit_rate_pct: 87.9,
    uptime_in_seconds: 604_800,
    db_keys: { db0: 4_821 },
  };
}

function offlineKeyInfo(key: string): KeyInfo {
  return {
    key,
    type: "string",
    ttl: 3600,
    encoding: "embstr",
    size_bytes: 256,
    idle_seconds: 42,
  };
}

function useRedisTestStub(): boolean {
  return (process.env.VITEST === "true" || process.env.NODE_ENV === "test") || process.env.REDIS_TEST_STUB === "true";
}

// ── Router ────────────────────────────────────────────────────────────────────

export const redisRouter = router({
  /**
   * getCacheStats — returns Redis INFO-style statistics.
   */
  getCacheStats: adminProcedure.query(async () => {
    if (useRedisTestStub()) return offlineCacheStats();
    // Production: call Redis INFO via ioredis
    const { default: Redis } = await import("ioredis");
    const redisUrl = process.env.REDIS_URL ?? "redis://localhost:6379";
    const client = new Redis(redisUrl, { lazyConnect: true, enableOfflineQueue: false });
    try {
      await client.connect();
      const info = await client.info();
      const lines = Object.fromEntries(
        info
          .split("\r\n")
          .filter((l) => l.includes(":"))
          .map((l) => l.split(":"))
      );
      const dbKeys: Record<string, number> = {};
      for (const [k, v] of Object.entries(lines)) {
        if (k.startsWith("db")) {
          const match = String(v).match(/keys=(\d+)/);
          if (match) dbKeys[k] = parseInt(match[1], 10);
        }
      }
      const hits = parseInt(lines["keyspace_hits"] ?? "0", 10);
      const misses = parseInt(lines["keyspace_misses"] ?? "0", 10);
      return {
        connected_clients: parseInt(lines["connected_clients"] ?? "0", 10),
        used_memory_human: lines["used_memory_human"] ?? "0B",
        used_memory_peak_human: lines["used_memory_peak_human"] ?? "0B",
        total_commands_processed: parseInt(lines["total_commands_processed"] ?? "0", 10),
        keyspace_hits: hits,
        keyspace_misses: misses,
        hit_rate_pct: hits + misses > 0 ? Math.round((hits / (hits + misses)) * 1000) / 10 : 0,
        uptime_in_seconds: parseInt(lines["uptime_in_seconds"] ?? "0", 10),
        db_keys: dbKeys,
      } satisfies CacheStats;
    } finally {
      client.disconnect();
    }
  }),

  /**
   * getKeyInfo — inspect TTL, type, and encoding of a single key.
   */
  getKeyInfo: adminProcedure
    .input(z.object({ key: z.string().min(1).max(512) }))
    .query(async ({ input }) => {
      if (useRedisTestStub()) return offlineKeyInfo(input.key);
      const { default: Redis } = await import("ioredis");
      const client = new Redis(process.env.REDIS_URL ?? "redis://localhost:6379", {
        lazyConnect: true,
        enableOfflineQueue: false,
      });
      try {
        await client.connect();
        const type = await client.type(input.key);
        const ttl = await client.ttl(input.key);
        // OBJECT ENCODING and OBJECT IDLETIME via raw send_command
        const encoding = String(await client.call("OBJECT", "ENCODING", input.key).catch(() => "unknown"));
        const idleSeconds = Number(await client.call("OBJECT", "IDLETIME", input.key).catch(() => 0));
        if (type === "none") {
          throw new TRPCError({ code: "NOT_FOUND", message: `Key not found: ${input.key}` });
        }
        return {
          key: input.key,
          type,
          ttl,
          encoding: encoding ?? "unknown",
          size_bytes: 0, // MEMORY USAGE requires Redis 4+; omit for compatibility
          idle_seconds: idleSeconds ?? 0,
        } satisfies KeyInfo;
      } finally {
        client.disconnect();
      }
    }),

  /**
   * setTTL — update the expiry (in seconds) of a key. Pass -1 to persist.
   */
  setTTL: adminProcedure
    .input(
      z.object({
        key: z.string().min(1).max(512),
        ttlSeconds: z.number().int().min(-1).max(86_400 * 30),
      })
    )
    .mutation(async ({ input }) => {
      if (useRedisTestStub()) return { success: true, key: input.key, ttlSeconds: input.ttlSeconds };
      const { default: Redis } = await import("ioredis");
      const client = new Redis(process.env.REDIS_URL ?? "redis://localhost:6379", {
        lazyConnect: true,
        enableOfflineQueue: false,
      });
      try {
        await client.connect();
        const exists = await client.exists(input.key);
        if (!exists) {
          throw new TRPCError({ code: "NOT_FOUND", message: `Key not found: ${input.key}` });
        }
        if (input.ttlSeconds === -1) {
          await client.persist(input.key);
        } else {
          await client.expire(input.key, input.ttlSeconds);
        }
        return { success: true, key: input.key, ttlSeconds: input.ttlSeconds };
      } finally {
        client.disconnect();
      }
    }),

  /**
   * invalidateKey — delete a specific key from the cache.
   */
  invalidateKey: adminProcedure
    .input(z.object({ key: z.string().min(1).max(512) }))
    .mutation(async ({ input }) => {
      if (useRedisTestStub()) return { success: true, deleted: 1, key: input.key };
      const { default: Redis } = await import("ioredis");
      const client = new Redis(process.env.REDIS_URL ?? "redis://localhost:6379", {
        lazyConnect: true,
        enableOfflineQueue: false,
      });
      try {
        await client.connect();
        const deleted = await client.del(input.key);
        return { success: true, deleted, key: input.key };
      } finally {
        client.disconnect();
      }
    }),

  /**
   * invalidatePattern — delete all keys matching a glob pattern (SCAN-based, safe for production).
   */
  invalidatePattern: adminProcedure
    .input(
      z.object({
        pattern: z.string().min(1).max(256),
        dryRun: z.boolean().optional().default(false),
      })
    )
    .mutation(async ({ input }) => {
      if (useRedisTestStub()) {
        return { success: true, pattern: input.pattern, deleted: input.dryRun ? 0 : 1, matched: 1, dryRun: input.dryRun };
      }
      const { default: Redis } = await import("ioredis");
      const client = new Redis(process.env.REDIS_URL ?? "redis://localhost:6379", {
        lazyConnect: true,
        enableOfflineQueue: false,
      });
      try {
        await client.connect();
        const keys: string[] = [];
        let cursor = "0";
        do {
          const [nextCursor, batch] = await client.scan(cursor, "MATCH", input.pattern, "COUNT", 100);
          cursor = nextCursor;
          keys.push(...batch);
        } while (cursor !== "0");

        if (!input.dryRun && keys.length > 0) {
          // Pipeline deletes in batches of 500
          for (let i = 0; i < keys.length; i += 500) {
            const batch = keys.slice(i, i + 500);
            const pipeline = client.pipeline();
            for (const k of batch) pipeline.del(k);
            await pipeline.exec();
          }
        }
        return {
          success: true,
          pattern: input.pattern,
          deleted: input.dryRun ? 0 : keys.length,
          matched: keys.length,
          dryRun: input.dryRun,
        };
      } finally {
        client.disconnect();
      }
    }),

  /**
   * flushNamespace — delete all keys under a namespace prefix (e.g. "session:", "hs-cache:").
   */
  flushNamespace: adminProcedure
    .input(
      z.object({
        namespace: z.string().min(1).max(128).regex(/^[a-zA-Z0-9_-]+:?$/),
        dryRun: z.boolean().optional().default(false),
      })
    )
    .mutation(async ({ input }) => {
      const pattern = input.namespace.endsWith(":") ? `${input.namespace}*` : `${input.namespace}:*`;
      if (useRedisTestStub()) {
        return { success: true, namespace: input.namespace, pattern, deleted: input.dryRun ? 0 : 1, dryRun: input.dryRun };
      }
      const { default: Redis } = await import("ioredis");
      const client = new Redis(process.env.REDIS_URL ?? "redis://localhost:6379", {
        lazyConnect: true,
        enableOfflineQueue: false,
      });
      try {
        await client.connect();
        const keys: string[] = [];
        let cursor = "0";
        do {
          const [nextCursor, batch] = await client.scan(cursor, "MATCH", pattern, "COUNT", 100);
          cursor = nextCursor;
          keys.push(...batch);
        } while (cursor !== "0");

        if (!input.dryRun && keys.length > 0) {
          for (let i = 0; i < keys.length; i += 500) {
            const batch = keys.slice(i, i + 500);
            const pipeline = client.pipeline();
            for (const k of batch) pipeline.del(k);
            await pipeline.exec();
          }
        }
        return {
          success: true,
          namespace: input.namespace,
          pattern,
          deleted: input.dryRun ? 0 : keys.length,
          dryRun: input.dryRun,
        };
      } finally {
        client.disconnect();
      }
    }),
});
