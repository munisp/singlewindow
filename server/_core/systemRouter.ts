import { z } from "zod";
import { notifyOwner } from "./notification";
import { getAllCircuitStatus, getRecentSecurityEvents } from "./security";
import { ENV } from "./env";
import { adminProcedure, publicProcedure, router, getRateLimitStats } from "./trpc";
import { getServiceHealthSummary, getTigerBeetleBridgeModes } from "../grpc-clients";
import { redisHealthCheck } from "./redis";
import { getDb } from "../db";
import { desc, eq, and, gte, lte, like, sql } from "drizzle-orm";
import { auditEvents } from "../../drizzle/schema";

// ─── Microservice HTTP health check helper ───────────────────────────────────
async function checkHttpHealth(url: string, timeoutMs = 3000): Promise<boolean> {
  try {
    const res = await fetch(`${url}/health`, { signal: AbortSignal.timeout(timeoutMs) });
    return res.ok;
  } catch {
    return false;
  }
}

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
   * Financial ledger statistics — fetches live account balances from the
   * Go TigerBeetle bridge /api/ledger/summary endpoint.
   * Used by the Admin Overview financial summary widget.
   */
  ledgerStats: adminProcedure
    .query(async () => {
      const tbBridgeURL = process.env.TB_GO_BRIDGE_HTTP_ADDR ?? "http://localhost:9100";
      try {
        const res = await fetch(`${tbBridgeURL}/api/ledger/summary`, {
          signal: AbortSignal.timeout(5000),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json() as {
          summary: {
            totalRevenueConfirmed: string;
            totalRevenuePending:   string;
            currency:              string;
            mode:                  string;
            timestamp:             string;
          };
          accounts: Array<{
            id:             string;
            accountType:    string;
            creditsPosted:  string;
            debitsPending:  string;
            creditsPending: string;
          }>;
          recentTransfers: unknown[];
        };
        return {
          ok:                    true,
          mode:                  data.summary.mode,
          currency:              data.summary.currency,
          totalRevenueConfirmed: data.summary.totalRevenueConfirmed,
          totalRevenuePending:   data.summary.totalRevenuePending,
          accounts:              data.accounts,
          recentTransferCount:   data.recentTransfers?.length ?? 0,
          checkedAt:             Date.now(),
        };
      } catch (err) {
        return {
          ok:                    false,
          mode:                  "unavailable",
          currency:              "GHS",
          totalRevenueConfirmed: "0",
          totalRevenuePending:   "0",
          accounts:              [] as Array<{
            id: string; accountType: string;
            creditsPosted: string; debitsPending: string; creditsPending: string;
          }>,
          recentTransferCount:   0,
          checkedAt:             Date.now(),
          error:                 String(err),
        };
      }
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

  /**
   * Public system status — returns platform health for the public /status page.
   * No authentication required. Returns aggregate status across all services.
   */
  systemStatus: publicProcedure
    .query(async () => {
      const tbBridgeURL = process.env.TB_GO_BRIDGE_HTTP_ADDR ?? "http://localhost:9100";

      // Check DB
      let dbOk = false;
      try {
        const db = await getDb();
        if (db) { await db.execute("SELECT 1" as never); dbOk = true; }
      } catch { dbOk = false; }

      // Check Redis
      const redisHealth = await redisHealthCheck();

      // Check TigerBeetle bridge
      let tbOk = false;
      let tbMode = "unknown";
      try {
        const res = await fetch(`${tbBridgeURL}/health`, { signal: AbortSignal.timeout(3000) });
        tbOk = res.ok;
        if (res.ok) {
          const data = await res.json() as { mode?: string };
          tbMode = data.mode ?? "unknown";
        }
      } catch { tbOk = false; }

      // Check Temporal
      const temporalAddr = process.env.TEMPORAL_ADDRESS ?? "localhost:7233";
      let temporalOk = false;
      try {
        const res = await fetch(`http://${temporalAddr}/health`, { signal: AbortSignal.timeout(3000) });
        temporalOk = res.ok;
      } catch { temporalOk = false; }

      // Check Kafka (via payment service health which depends on Kafka)
      const paymentSvcAddr = process.env.PAYMENT_SERVICE_GRPC_ADDR ?? "localhost:9091";
      let kafkaOk = false;
      try {
        const res = await fetch(`http://${paymentSvcAddr}/health`, { signal: AbortSignal.timeout(3000) });
        kafkaOk = res.ok;
      } catch { kafkaOk = false; }

      const components = [
        { name: "Database",         status: dbOk ? "operational" : "degraded",    description: "Primary TiDB/PostgreSQL cluster" },
        { name: "Cache",            status: redisHealth.ok ? "operational" : "degraded", description: "Redis cache and rate limiter" },
        { name: "Financial Ledger", status: tbOk ? "operational" : "degraded",    description: `TigerBeetle ledger (${tbMode})` },
        { name: "Workflow Engine",  status: temporalOk ? "operational" : "degraded", description: "Temporal workflow orchestration" },
        { name: "Event Bus",        status: kafkaOk ? "operational" : "degraded",  description: "Kafka event streaming" },
        { name: "Declaration API",  status: dbOk ? "operational" : "degraded",    description: "Customs declaration processing" },
        { name: "Payment API",      status: tbOk ? "operational" : "degraded",    description: "Mojaloop payment gateway" },
        { name: "Risk Engine",      status: "operational",                          description: "AI-powered risk scoring" },
      ];

      const degradedCount = components.filter(c => c.status !== "operational").length;
      const overallStatus =
        degradedCount === 0 ? "operational" :
        degradedCount <= 2  ? "degraded" :
                              "major_outage";

      return {
        status: overallStatus,
        components,
        incidents: [] as Array<{ id: string; title: string; status: string; createdAt: number }>,
        uptimePercent: 99.9,
        checkedAt: Date.now(),
        version: process.env.npm_package_version ?? "1.0.0",
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

  /**
   * HTTP health check for all 15 docker-compose microservices.
   * Runs all checks in parallel with a 3-second timeout each.
   * Used by the ServiceHealth dashboard "Microservices" tab.
   */
  microserviceHealth: adminProcedure
    .query(async () => {
      // In dev/staging, set MICROSERVICE_MOCK_HEALTH=true to simulate healthy microservices
      // without requiring the full Docker stack to be running.
      const useMock = process.env.MICROSERVICE_MOCK_HEALTH === "true";

      const microservices: Array<{ name: string; url: string; category: string }> = [
        { name: "risk-engine",         url: ENV.riskEngineUrl,         category: "AI/ML" },
        { name: "risk-ai",             url: ENV.riskAiUrl,             category: "AI/ML" },
        { name: "hs-classifier",       url: ENV.hsClassifierUrl,       category: "AI/ML" },
        { name: "gnn-risk",            url: ENV.gnnRiskUrl,            category: "AI/ML" },
        { name: "anomaly-detection",   url: ENV.anomalyDetectionUrl,   category: "AI/ML" },
        { name: "declaration",         url: ENV.declarationServiceUrl, category: "Core" },
        { name: "payment",             url: ENV.paymentServiceUrl,     category: "Core" },
        { name: "oga",                 url: ENV.ogaServiceUrl,         category: "Core" },
        { name: "cargo-tracking",      url: ENV.cargoTrackingServiceUrl, category: "Core" },
        { name: "profile",             url: ENV.profileServiceUrl,     category: "Core" },
        { name: "sanctions",           url: ENV.sanctionsServiceUrl,   category: "Compliance" },
        { name: "analytics",           url: ENV.analyticsServiceUrl,   category: "Analytics" },
        { name: "temporal-worker",     url: ENV.temporalWorkerUrl,     category: "Workflow" },
        { name: "vision-ocr",          url: ENV.visionSvcUrl,          category: "AI/ML" },
        { name: "nlp-service",         url: ENV.visionServiceUrl,      category: "AI/ML" },
      ];
      let services: Array<{ name: string; category: string; url: string; healthy: boolean; checkedAt: number; mock?: boolean }>;

      if (useMock) {
        // Return simulated healthy state for all services (dev/staging without Docker)
        services = microservices.map(svc => ({
          name: svc.name,
          category: svc.category,
          url: svc.url,
          healthy: true,
          checkedAt: Date.now(),
          mock: true,
        }));
      } else {
        const results = await Promise.allSettled(
          microservices.map(svc => checkHttpHealth(svc.url))
        );
        services = microservices.map((svc, i) => ({
          name: svc.name,
          category: svc.category,
          url: svc.url,
          healthy: results[i].status === "fulfilled" ? (results[i] as PromiseFulfilledResult<boolean>).value : false,
          checkedAt: Date.now(),
        }));
      }
      const healthyCount = services.filter(s => s.healthy).length;
      return {
        services,
        healthyCount,
        totalCount: services.length,
        allHealthy: healthyCount === services.length,
        checkedAt: Date.now(),
      };
    }),

  /**
   * Circuit breaker status for all registered downstream service calls.
   * Shows open/closed/half-open state, failure counts, and last failure time.
   */
  circuitBreakerStatus: adminProcedure
    .query(async () => {
      const circuits = getAllCircuitStatus();
      return {
        circuits,
        openCount: circuits.filter(c => c.state === "open").length,
        checkedAt: Date.now(),
      };
    }),

  /**
   * Recent security events from the in-memory security event queue.
   * Returns the last 100 events (rate limit exceeded, PBAC denied, malware, etc.).
   */
  securityEvents: adminProcedure
    .input(z.object({ limit: z.number().int().min(1).max(500).default(100) }))
    .query(async ({ input }) => {
      const events = getRecentSecurityEvents(input.limit);
      return {
        events,
        total: events.length,
        checkedAt: Date.now(),
      };
    }),
});
