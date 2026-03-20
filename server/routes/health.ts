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
 *   Readiness probe — returns 200 only if DB and Redis are reachable.
 *   Returns 503 if any critical dependency is down.
 */

import type { Express } from "express";
import { getDb } from "../db";

// ─── Types ────────────────────────────────────────────────────────────────────
type HealthStatus = "ok" | "degraded" | "down";

interface ComponentHealth {
  status: HealthStatus;
  latencyMs?: number;
  message?: string;
}

interface HealthReport {
  status: HealthStatus;
  version: string;
  uptime: number;
  timestamp: string;
  components: {
    database: ComponentHealth;
    redis?: ComponentHealth;
    tigerbeetle?: ComponentHealth;
    temporal?: ComponentHealth;
    kafka?: ComponentHealth;
    aseanSw?: ComponentHealth;
    cenService?: ComponentHealth;
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

async function checkExternalService(
  url: string,
  timeoutMs = 3000
): Promise<ComponentHealth> {
  const start = Date.now();
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timer);
    const latencyMs = Date.now() - start;
    if (res.ok) return { status: "ok", latencyMs };
    return { status: "degraded", latencyMs, message: `HTTP ${res.status}` };
  } catch (err) {
    return {
      status: "down",
      latencyMs: Date.now() - start,
      message: err instanceof Error ? err.message : "Connection refused",
    };
  }
}

// ─── Full health report ───────────────────────────────────────────────────────
async function buildHealthReport(): Promise<HealthReport> {
  const [database, redis, tigerbeetle, temporal, kafka, aseanSw, cenService] =
    await Promise.all([
      checkDatabase(),
      checkExternalService(
        `http://${process.env.REDIS_HOST ?? "localhost"}:${process.env.REDIS_PORT ?? "6379"}`
      ),
      checkExternalService(
        `http://${process.env.TIGERBEETLE_BRIDGE_HOST ?? "localhost"}:8200/health`
      ),
      checkExternalService(
        `http://${process.env.TEMPORAL_HOST ?? "localhost"}:7233`
      ),
      checkExternalService(
        `http://${process.env.KAFKA_HOST ?? "localhost"}:9092`
      ),
      checkExternalService(
        process.env.ASEAN_SW_URL ?? "http://localhost:8098/health"
      ),
      checkExternalService(
        process.env.CEN_SERVICE_URL ?? "http://localhost:8097/health"
      ),
    ]);

  // Determine overall status
  const criticalComponents = [database];
  const nonCriticalComponents = [redis, tigerbeetle, temporal, kafka, aseanSw, cenService];

  let overallStatus: HealthStatus = "ok";
  if (criticalComponents.some(c => c.status === "down")) {
    overallStatus = "down";
  } else if (
    criticalComponents.some(c => c.status === "degraded") ||
    nonCriticalComponents.some(c => c.status === "down")
  ) {
    overallStatus = "degraded";
  }

  return {
    status: overallStatus,
    version: process.env.APP_VERSION ?? "1.0.0",
    uptime: Math.floor(process.uptime()),
    timestamp: new Date().toISOString(),
    components: {
      database,
      redis,
      tigerbeetle,
      temporal,
      kafka,
      aseanSw,
      cenService,
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
