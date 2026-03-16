import { z } from "zod";
import { notifyOwner } from "./notification";
import { adminProcedure, publicProcedure, router, getRateLimitStats } from "./trpc";
import { getServiceHealthSummary, getTigerBeetleBridgeModes } from "../grpc-clients";
import { redisHealthCheck } from "./redis";
import { getDb } from "../db";
import { desc, eq, and, gte, lte, like, sql } from "drizzle-orm";
import { auditEvents } from "../../drizzle/schema";

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

  /**
   * Paginated audit log query for the admin Audit Log viewer page.
   * Supports filtering by entityType, actorId, action keyword, and date range.
   */
  auditLog: adminProcedure
    .input(
      z.object({
        page:       z.number().int().min(1).default(1),
        pageSize:   z.number().int().min(1).max(100).default(25),
        entityType: z.enum(["declaration", "user", "payment", "permit", "document", "aeo_application", "kyc_verification"]).optional(),
        actorId:    z.number().int().positive().optional(),
        action:     z.string().max(128).optional(),
        fromDate:   z.number().optional(), // UTC ms
        toDate:     z.number().optional(), // UTC ms
      })
    )
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return { rows: [], total: 0, page: input.page, pageSize: input.pageSize };

      const conditions = [];
      if (input.entityType) conditions.push(eq(auditEvents.entityType, input.entityType));
      if (input.actorId)    conditions.push(eq(auditEvents.actorId, input.actorId));
      if (input.action)     conditions.push(like(auditEvents.action, `%${input.action}%`));
      if (input.fromDate)   conditions.push(gte(auditEvents.createdAt, new Date(input.fromDate)));
      if (input.toDate)     conditions.push(lte(auditEvents.createdAt, new Date(input.toDate)));

      const where = conditions.length > 0 ? and(...conditions) : undefined;

      const [rows, countResult] = await Promise.all([
        db
          .select({
            id:         auditEvents.id,
            entityType: auditEvents.entityType,
            entityId:   auditEvents.entityId,
            action:     auditEvents.action,
            actorId:    auditEvents.actorId,
            actorType:  auditEvents.actorType,
            ipAddress:     auditEvents.ipAddress,
            userAgent:     auditEvents.userAgent,
            previousState: auditEvents.previousState,
            newState:      auditEvents.newState,
            metadata:      auditEvents.metadata,
            createdAt:     auditEvents.createdAt,
          })
          .from(auditEvents)
          .where(where)
          .orderBy(desc(auditEvents.createdAt))
          .limit(input.pageSize)
          .offset((input.page - 1) * input.pageSize),
        db
          .select({ count: sql<number>`count(*)::int` })
          .from(auditEvents)
          .where(where),
      ]);

      return {
        rows,
        total: countResult[0]?.count ?? 0,
        page: input.page,
        pageSize: input.pageSize,
      };
    }),

  /**
   * TigerBeetle bridge mode query — returns whether each bridge is in
   * "live" (real TigerBeetle binary) or "simulation" (in-memory) mode.
   * Used by the Service Health page to show production readiness.
   */
  tigerbeetleModes: adminProcedure
    .query(async () => {
      const modes = await getTigerBeetleBridgeModes();
      return {
        go:   modes.go,
        rust: modes.rust,
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
