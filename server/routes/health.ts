/**
 * TradeGateway™ NGSWTP — Deep Health Check Endpoint
 *
 * GET /api/health
 *   Returns a comprehensive health report for all dependencies.
 *   Used by Kubernetes liveness/readiness probes and the public /status page.
 *
 * GET /api/health/live
 *   Lightweight liveness probe — returns 200 if the process is alive.
 *
 * GET /api/health/ready
 *   Readiness probe — returns 200 only if DB is reachable.
 *   Returns 503 if database is down. Optional services (Redis, Kafka, etc.) do not block readiness.
 */

import type { Express } from "express";
import { getDb } from "../db";
import { redisHealthCheck } from "../_core/redis";
import { getWorkerStatus } from "../paymentWorker";

// ─── Types ────────────────────────────────────────────────────────────────────
type HealthStatus = "ok" | "degraded" | "down";

interface ComponentHealth {
  status: HealthStatus;
  latencyMs?: number;
  message?: string;
  optional?: boolean;
}

interface HealthReport {
  status: HealthStatus;
  version: string;
  uptime: number;
  timestamp: string;
  components: {
    database: ComponentHealth;
    redis: ComponentHealth;
    tigerbeetle: ComponentHealth;
    temporal: ComponentHealth;
    kafka: ComponentHealth;
    aseanSw: ComponentHealth;
    cenService: ComponentHealth;
    permify: ComponentHealth;
  };
  demoMode: boolean;
  workerStatus: {
    running: boolean;
    startedAt: Date | null;
    lastCycleAt: Date | null;
    itemsProcessedTotal: number;
  };
}

// ─── Probe helpers ────────────────────────────────────────────────────────────
async function checkDatabase(): Promise<ComponentHealth> {
  const start = Date.now();
  try {
    const db = await getDb();
    if (!db) return { status: "down", message: "Database client unavailable" };
    // Execute a lightweight query
    await db.execute("SELECT 1" as any);
    return { status: "ok", latencyMs: Date.now() - start };
  } catch (err) {
    return {
      status: "down",
      latencyMs: Date.now() - start,
      message: err instanceof Error ? err.message : "Unknown error",
    };
  }
}

async function checkOptionalService(
  url: string,
  name: string,
  timeoutMs = 2000
): Promise<ComponentHealth> {
  const start = Date.now();
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timer);
    const latencyMs = Date.now() - start;
    if (res.ok) return { status: "ok", latencyMs, optional: true };
    return { status: "degraded", latencyMs, message: `HTTP ${res.status}`, optional: true };
  } catch (_err) {
    // Optional services that are unavailable are "degraded", not "down"
    return {
      status: "degraded",
      latencyMs: Date.now() - start,
      message: `${name} not reachable (optional in demo mode)`,
      optional: true,
    };
  }
}

// ─── Full health report ───────────────────────────────────────────────────────
async function buildHealthReport(): Promise<HealthReport> {
  const isDemoMode = process.env.DEMO_MODE === "true";

  const [database, redis, tigerbeetle, temporal, kafka, aseanSw, cenService, permify] =
    await Promise.all([
      checkDatabase(),
      // Use the ioredis client directly for Redis health check (not HTTP)
      redisHealthCheck().then((r): ComponentHealth => ({
        status: r.ok ? "ok" : "degraded",
        latencyMs: r.latencyMs,
        message: r.ok ? undefined : `Redis not reachable${isDemoMode ? " (optional in demo mode)" : ""}`,
        optional: true,
      })),
      checkOptionalService(
        `http://${process.env.TIGERBEETLE_BRIDGE_HOST ?? "localhost"}:${process.env.TIGERBEETLE_BRIDGE_PORT ?? "8200"}/health`,
        "TigerBeetle"
      ),
      checkOptionalService(
        `http://${process.env.TEMPORAL_HOST ?? "localhost"}:${process.env.TEMPORAL_PORT ?? "7233"}`,
        "Temporal"
      ),
      checkOptionalService(
        `http://${process.env.KAFKA_HOST ?? "localhost"}:${process.env.KAFKA_REST_PORT ?? "8082"}/topics`,
        "Kafka"
      ),
      checkOptionalService(
        process.env.ASEAN_SW_URL ?? "http://localhost:8098/health",
        "ASEAN Single Window"
      ),
      checkOptionalService(
        process.env.CEN_SERVICE_URL ?? "http://localhost:8097/health",
        "WCO CEN Service"
      ),
      checkOptionalService(
        `http://${process.env.PERMIFY_HOST ?? "localhost"}:${process.env.PERMIFY_PORT ?? "3476"}/healthz`,
        "Permify"
      ),
    ]);

  // Only database is critical — everything else is optional
  let overallStatus: HealthStatus = "ok";
  if (database.status === "down") {
    overallStatus = "down";
  } else if (database.status === "degraded") {
    overallStatus = "degraded";
  }
  // Optional services being degraded does NOT make overall status worse
  // This prevents false alarms in demo/dev environments

  return {
    status: overallStatus,
    version: process.env.APP_VERSION ?? "1.0.0",
    uptime: Math.floor(process.uptime()),
    timestamp: new Date().toISOString(),
    demoMode: isDemoMode,
    workerStatus: getWorkerStatus(),
    components: {
      database,
      redis,
      tigerbeetle,
      temporal,
      kafka,
      aseanSw,
      cenService,
      permify,
    },
  };
}

// ─── Route registration ───────────────────────────────────────────────────────
export function registerHealthRoutes(app: Express): void {
  /**
   * GET /api/health/live
   * Kubernetes liveness probe — always returns 200 if the process is running.
   */
  app.get("/api/health/live", (_req, res) => {
    res.json({ status: "ok", uptime: Math.floor(process.uptime()) });
  });

  /**
   * GET /api/health/ready
   * Kubernetes readiness probe — returns 503 if DB is unreachable.
   */
  app.get("/api/health/ready", async (_req, res) => {
    const db = await checkDatabase();
    if (db.status === "down") {
      res.status(503).json({
        status: "not_ready",
        reason: "Database unavailable",
        latencyMs: db.latencyMs,
      });
      return;
    }
    res.json({ status: "ready", dbLatencyMs: db.latencyMs });
  });

  /**
   * GET /api/health
   * Full deep health check — used by the /status page and monitoring systems.
   * Returns 200 for ok/degraded, 503 for down.
   */
  app.get("/api/health", async (_req, res) => {
    try {
      const report = await buildHealthReport();
      const httpStatus = report.status === "down" ? 503 : 200;
      res.status(httpStatus).json(report);
    } catch (err) {
      res.status(500).json({
        status: "down",
        error: err instanceof Error ? err.message : "Health check failed",
        timestamp: new Date().toISOString(),
      });
    }
  });
}
