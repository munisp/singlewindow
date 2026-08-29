/**
 * Health Router — v104
 * Provides a platform health score (0–100) aggregated from REAL service probes.
 *
 * P0 remediation (audit): this router previously returned hardcoded "healthy"
 * statuses with synthesized latencies/uptimes. It now delegates to the real
 * health stack:
 *   - getServiceHealthSummary() (server/grpc-clients.ts) probes every Go
 *     microservice via gRPC and the TigerBeetle bridges via HTTP.
 *   - buildHealthReport() (server/routes/health.ts) performs deep dependency
 *     checks (DB, Redis, TigerBeetle, Temporal, Kafka, ASEAN, CEN, Permify).
 * No fabricated numbers: latencies are measured, and uptime is reported as
 * null (NOT_ASSESSED) because uptime requires historical monitoring data this
 * process does not have.
 */
import { router, protectedProcedure } from "../_core/trpc";
import { getServiceHealthSummary } from "../grpc-clients";
import { buildHealthReport } from "../routes/health";

export const healthRouter = router({
  /**
   * v104: Get aggregate platform health score (0–100) with per-service breakdown.
   * Score is derived from live probes: each reachable service scores 100, each
   * unreachable service scores 0. No probe results are synthesized.
   */
  getPlatformHealthScore: protectedProcedure.query(async () => {
    const healthMap = await getServiceHealthSummary();
    const services = Object.entries(healthMap).map(([name, healthy]) => ({
      name,
      status: (healthy ? "healthy" : "down") as "healthy" | "down",
      score: healthy ? 100 : 0,
    }));

    const score =
      services.length === 0
        ? 0
        : Math.round(services.reduce((sum, s) => sum + s.score, 0) / services.length);

    return {
      score,
      status: score >= 90 ? "healthy" : score >= 70 ? "degraded" : "critical",
      services,
      checkedAt: new Date(),
    };
  }),

  /**
   * v125: getComponentHealth — return MEASURED health status for each platform
   * component (deep dependency check). `uptime` is null (NOT_ASSESSED) because
   * historical uptime data is not available to this process.
   */
  getComponentHealth: protectedProcedure.query(async () => {
    const report = await buildHealthReport();
    const components = Object.entries(report.components).map(([name, c]) => ({
      name,
      status: c.status === "ok" ? ("healthy" as const) : c.status,
      latencyMs: c.latencyMs ?? null,
      // Honest empty state: uptime cannot be measured from a single probe.
      uptime: null as number | null,
      message: c.message ?? null,
    }));
    const healthy = components.filter((c) => c.status === "healthy").length;
    const degraded = components.filter((c) => c.status === "degraded").length;
    const down = components.filter((c) => c.status === "down").length;
    return {
      components,
      summary: { total: components.length, healthy, degraded, down },
      overallStatus:
        report.status === "ok" ? "healthy" : report.status === "degraded" ? "degraded" : "critical",
      checkedAt: report.timestamp,
    };
  }),
});
