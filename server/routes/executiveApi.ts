/**
 * Phase 12 Mission C — executive/analytics REST surface consumed by the
 * ministry portal and the mobile app. ALL endpoints are metered marketplace
 * calls guarded by requireApiKey("reports:read") and answer honest 503s when
 * their data source is down (fail-closed — never zeros-as-real).
 *
 *   GET /v1/executive/kpi-summary        — ministerial KPI pack
 *   GET /v1/executive/operational-kpis   — operational KPIs (alias below)
 *   GET /v1/operational-kpis             — thin alias (mobile contract)
 *   GET /v1/analytics/trade?days=30      — trade analytics aggregates
 *   GET /v1/risk/model-metrics           — real served-model metrics
 *   GET /v1/sla/breaches                 — SLA breach list (capped)
 *   GET /v1/customs/summary              — customs/NCS-NRS summary
 *   GET /v1/briefings/weekly             — JWS-signed weekly PDF briefing
 *   GET /v1/port-performance/report      — port performance metrics (honest nulls)
 *   GET /v1/port-performance/report.pdf  — JWS-signed port performance PDF
 */
import type { Express } from "express";
import { requireApiKey } from "../middleware/apiKeyAuth";
import { computeOperationalKpis, KpiServiceUnavailable } from "../marketplace/kpiService";
import {
  computeCustomsSummary,
  computeKpiSummary,
  computeTradeAnalytics,
  KpiPackUnavailable,
  listSlaBreaches,
  SLA_BREACH_MAX_PAGE,
} from "../executive/kpiPack";
import { BriefingSigningUnavailable, buildSignedWeeklyBriefing } from "../executive/briefing";
import {
  computePortPerformanceReport,
  isPortPerformancePeriod,
} from "../executive/portPerformance";
import { buildSignedPortPerformancePdf } from "../executive/portPerformancePdf";
import { callRiskScorer } from "../routers/riskModel";
import {
  QueuePolicyConfigError,
  QueuePolicyUnavailableError,
  getQueuePolicyStatus,
} from "../rl/queuePolicy";

const PROD_UPSTREAM = { id: "executive-api", sandbox: false } as const;

function down(res: any, err: unknown) {
  res.status(503).json({
    status: "down",
    error: err instanceof Error ? err.message : "Service unavailable",
  });
}

function boundedDays(raw: unknown, fallback: number): number {
  const n = Number(raw ?? fallback);
  return Number.isFinite(n) ? Math.min(Math.max(n, 1), 92) : fallback;
}

export function registerExecutiveApiRoutes(app: Express): void {
  // ── Ministerial KPI pack ────────────────────────────────────────────────────
  app.get(
    "/v1/executive/kpi-summary",
    requireApiKey("reports:read", PROD_UPSTREAM),
    async (req, res) => {
      try {
        res.json(await computeKpiSummary(boundedDays(req.query.days, 30)));
      } catch (err) {
        down(res, err);
      }
    }
  );

  // ── Operational KPIs (+ mobile alias) ───────────────────────────────────────
  const operationalKpisHandler = async (req: any, res: any) => {
    try {
      const windowHours = Number(req.query.windowHours ?? 24);
      res.json(await computeOperationalKpis(Number.isFinite(windowHours) ? windowHours : 24));
    } catch (err) {
      if (err instanceof KpiServiceUnavailable || err instanceof KpiPackUnavailable) {
        down(res, err);
        return;
      }
      down(res, err);
    }
  };
  app.get("/v1/executive/operational-kpis", requireApiKey("reports:read", PROD_UPSTREAM), operationalKpisHandler);
  app.get("/v1/operational-kpis", requireApiKey("reports:read", PROD_UPSTREAM), operationalKpisHandler);

  // ── Trade analytics aggregates ──────────────────────────────────────────────
  app.get(
    "/v1/analytics/trade",
    requireApiKey("reports:read", PROD_UPSTREAM),
    async (req, res) => {
      try {
        res.json(await computeTradeAnalytics(boundedDays(req.query.days, 30)));
      } catch (err) {
        down(res, err);
      }
    }
  );

  // ── Real served-model metrics (ML risk engine) ──────────────────────────────
  app.get(
    "/v1/risk/model-metrics",
    requireApiKey("reports:read", PROD_UPSTREAM),
    async (_req, res) => {
      try {
        const stats = await callRiskScorer<Record<string, unknown>>("/model-stats");
        res.json({ source: "ray-risk-scorer", ...stats });
      } catch (err) {
        // Fail-closed: no synthesized metrics are ever served.
        res.status(503).json({
          status: "down",
          error: `MODEL_METRICS_UNAVAILABLE: ${err instanceof Error ? err.message : "scorer unreachable"}`,
        });
      }
    }
  );

  // ── SLA breach list (pagination-capped) ─────────────────────────────────────
  app.get(
    "/v1/sla/breaches",
    requireApiKey("reports:read", PROD_UPSTREAM),
    async (req, res) => {
      const limit = req.query.limit != null ? Number(req.query.limit) : 50;
      const offset = req.query.offset != null ? Number(req.query.offset) : 0;
      if (!Number.isFinite(limit) || !Number.isFinite(offset)) {
        res.status(400).json({ error: "limit/offset must be numeric" });
        return;
      }
      if (limit > SLA_BREACH_MAX_PAGE) {
        res.status(400).json({ error: `limit exceeds cap of ${SLA_BREACH_MAX_PAGE}` });
        return;
      }
      try {
        res.json(await listSlaBreaches(limit, offset));
      } catch (err) {
        down(res, err);
      }
    }
  );

  // ── Customs/NCS-NRS summary ─────────────────────────────────────────────────
  app.get(
    "/v1/customs/summary",
    requireApiKey("reports:read", PROD_UPSTREAM),
    async (_req, res) => {
      try {
        res.json(await computeCustomsSummary());
      } catch (err) {
        down(res, err);
      }
    }
  );

  // ── RL queue-policy shadow status (Phase 18) ────────────────────────────────
  // Honest status of the ml-stack queue-policy for the ministry RL-insights
  // card: trained/untrained, policy_version, OPE score when the registry
  // carries it. Config-gated and fail-closed — 503 when the shadow policy
  // surface is not configured or ml-stack is unreachable; untrained is a
  // first-class 200 state, never fabricated.
  app.get(
    "/v1/rl/queue-policy/status",
    requireApiKey("reports:read", PROD_UPSTREAM),
    async (_req, res) => {
      try {
        const status = await getQueuePolicyStatus();
        res.json({
          status: "ok",
          surface: "officer-export-queue",
          trained: status.trained,
          policyVersion: status.policyVersion,
          opeScore: status.opeScore,
          mode: status.mode,
          note: status.trained
            ? "Shadow policy promoted — suggestions are advisory only and never auto-applied."
            : "Policy not trained — no promoted queue policy in the ml-stack registry.",
        });
      } catch (err) {
        if (err instanceof QueuePolicyConfigError || err instanceof QueuePolicyUnavailableError) {
          res.status(503).json({
            status: "down",
            error: err.message,
          });
          return;
        }
        down(res, err);
      }
    }
  );

  // ── Port performance report (Phase 16 Wave P2) ──────────────────────────────
  // JSON metrics, fail-closed: value:null where a source has no data.
  app.get(
    "/v1/port-performance/report",
    requireApiKey("reports:read", PROD_UPSTREAM),
    async (req, res) => {
      const period = String(req.query.period ?? "weekly");
      if (!isPortPerformancePeriod(period)) {
        res.status(400).json({ error: "period must be weekly, monthly or quarterly" });
        return;
      }
      try {
        res.json(await computePortPerformanceReport(period));
      } catch (err) {
        down(res, err);
      }
    }
  );

  // Signed PDF, same JWS-EdDSA envelope/kid convention as /v1/briefings/weekly.
  app.get(
    "/v1/port-performance/report.pdf",
    requireApiKey("reports:read", PROD_UPSTREAM),
    async (req, res) => {
      const period = String(req.query.period ?? "weekly");
      if (!isPortPerformancePeriod(period)) {
        res.status(400).json({ error: "period must be weekly, monthly or quarterly" });
        return;
      }
      try {
        const report = await buildSignedPortPerformancePdf(period);
        const accept = String(req.headers.accept ?? "");
        if (accept.includes("application/pdf")) {
          res.setHeader("Content-Type", "application/pdf");
          res.setHeader("X-Content-JWS", report.signature);
          res.setHeader("X-Content-KID", report.kid);
          res.send(Buffer.from(report.payload, "base64"));
          return;
        }
        res.json({
          payload: report.payload,
          signature: report.signature,
          algorithm: report.algorithm,
          kid: report.kid,
          contentType: report.contentType,
          generatedAt: report.generatedAt,
        });
      } catch (err) {
        if (err instanceof BriefingSigningUnavailable || err instanceof KpiPackUnavailable) {
          down(res, err);
          return;
        }
        down(res, err);
      }
    }
  );

  // ── Weekly signed PDF briefing ──────────────────────────────────────────────
  app.get(
    "/v1/briefings/weekly",
    requireApiKey("reports:read", PROD_UPSTREAM),
    async (req, res) => {
      try {
        const briefing = await buildSignedWeeklyBriefing(boundedDays(req.query.days, 7));
        const accept = String(req.headers.accept ?? "");
        if (accept.includes("application/pdf")) {
          res.setHeader("Content-Type", "application/pdf");
          res.setHeader("X-Content-JWS", briefing.signature);
          res.setHeader("X-Content-KID", briefing.kid);
          res.send(Buffer.from(briefing.payload, "base64"));
          return;
        }
        // Default: JWS JSON envelope {payload: base64(pdf), signature, algorithm}
        res.json({
          payload: briefing.payload,
          signature: briefing.signature,
          algorithm: briefing.algorithm,
          kid: briefing.kid,
          contentType: briefing.contentType,
          generatedAt: briefing.generatedAt,
        });
      } catch (err) {
        if (err instanceof BriefingSigningUnavailable || err instanceof KpiPackUnavailable) {
          down(res, err);
          return;
        }
        down(res, err);
      }
    }
  );
}
