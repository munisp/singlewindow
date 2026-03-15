import { z } from "zod";
import { notifyOwner } from "./notification";
import { adminProcedure, publicProcedure, router, getRateLimitStats } from "./trpc";
import { getServiceHealthSummary } from "../grpc-clients";
import { redisHealthCheck } from "./redis";
import { getDb } from "../db";

export const systemRouter = router({
  /**
   * Lightweight liveness probe — checks DB and Redis connectivity.
   * Used by Kubernetes liveness/readiness probes at /api/trpc/system.health.
   */
  health: publicProcedure
    .input(
      z.object({
        timestamp: z.number().min(0, "timestamp cannot be negative"),
      })
    )
    .query(async () => {
      // Check database connectivity
      let dbOk = false;
      try {
        const db = await getDb();
        if (db) {
          await db.execute("SELECT 1" as never);
          dbOk = true;
        }
      } catch {
        dbOk = false;
      }

      // Check Redis connectivity
      const redisOk = await redisHealthCheck();

      return {
        ok: dbOk,
        db: dbOk ? "healthy" : "unavailable",
        redis: redisOk ? "healthy" : "unavailable",
        uptime: Math.floor(process.uptime()),
        timestamp: Date.now(),
      };
    }),

  /**
   * Full service health — checks all Go microservices via gRPC + Redis.
   * Used by the admin Service Health dashboard page.
   */
  serviceHealth: publicProcedure
    .query(async () => {
      const [health, redisOk] = await Promise.all([
        getServiceHealthSummary(),
        redisHealthCheck(),
      ]);
      const allServices = { ...health, redis: redisOk };
      return {
        services: allServices,
        allHealthy: Object.values(allServices).every(Boolean),
        checkedAt: Date.now(),
      };
    }),

  /**
   * Rate-limit statistics for the admin overview widget.
   * Returns in-memory fallback stats (when Redis is unavailable) or Redis key counts.
   */
  rateLimitStats: adminProcedure
    .query(async () => {
      const inMemory = getRateLimitStats();
      const redisHealth = await redisHealthCheck();
      return {
        backend: redisHealth.ok ? "redis" : "in-memory",
        redis: redisHealth,
        inMemory,
        checkedAt: Date.now(),
      };
    }),

  notifyOwner: adminProcedure
    .input(
      z.object({
        title: z.string().min(1, "title is required"),
        content: z.string().min(1, "content is required"),
      })
    )
    .mutation(async ({ input }) => {
      const delivered = await notifyOwner(input);
      return {
        success: delivered,
      } as const;
    }),
});
