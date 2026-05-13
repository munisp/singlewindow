/**
 * CEP (Complex Event Processing) tRPC Router — DB-backed (v37)
 * Tables: cep_patterns, cep_alerts
 */
import { z } from "zod";
import { protectedProcedure, adminProcedure, router } from "../_core/trpc";
import { getDb, getPool } from "../db";
import { randomUUID } from "crypto";

const CEP_SERVICE_URL = process.env.CEP_SERVICE_URL ?? "http://localhost:8096";

async function cepFetch<T>(path: string, opts?: RequestInit): Promise<T | null> {
  try {
    const res = await fetch(`${CEP_SERVICE_URL}${path}`, {
      headers: { "Content-Type": "application/json" },
      signal: AbortSignal.timeout(3000),
      ...opts,
    });
    if (!res.ok) return null;
    return res.json() as Promise<T>;
  } catch {
    return null;
  }
}

async function pgQuery<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> {
  await getDb();
  const pool = getPool();
  if (!pool) throw new Error("Database pool not available");
  const { rows } = await pool.query(sql, params);
  return rows as T[];
}

async function ensureDefaultPatterns() {
  const [{ cnt }] = await pgQuery<{ cnt: string }>("SELECT COUNT(*) as cnt FROM cep_patterns");
  if (parseInt(cnt, 10) > 0) return;
  const defaults = [
    { id: "RAPID_MULTI_DECL", name: "Rapid Multi-Declaration", desc: "Same trader submits >5 declarations within 1 hour", params: { threshold: 5, windowMinutes: 60 } },
    { id: "HS_CODE_MISMATCH", name: "HS Code Mismatch Pattern", desc: "HS code inconsistent with declared goods description", params: { confidenceThreshold: 0.7 } },
    { id: "VALUE_UNDERREPORT", name: "Value Under-Reporting", desc: "Invoice value deviates >40% from reference price", params: { deviationPct: 40 } },
    { id: "SANCTIONS_PROXIMITY", name: "Sanctions Proximity Alert", desc: "Counterparty within 2 hops of sanctioned entity", params: { maxHops: 2 } },
    { id: "ROUTE_ANOMALY", name: "Route Anomaly Detection", desc: "Cargo route deviates significantly from declared itinerary", params: { maxDeviationKm: 500 } },
    { id: "REPEAT_REJECTION", name: "Repeat Rejection Pattern", desc: "Trader has >3 rejected declarations in 30 days", params: { threshold: 3, windowDays: 30 } },
  ];
  for (const p of defaults) {
    await pgQuery(
      `INSERT INTO cep_patterns (pattern_id, name, description, status, parameters, trigger_count, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,NOW(),NOW()) ON CONFLICT (pattern_id) DO NOTHING`,
      [p.id, p.name, p.desc, "enabled", JSON.stringify(p.params), 0]
    );
  }
}

export const cepRouter = router({

  getPatterns: protectedProcedure.query(async () => {
    await ensureDefaultPatterns();
    const live = await cepFetch<{ patterns: unknown[] }>("/patterns");
    if (live?.patterns) return live.patterns;
    return pgQuery("SELECT * FROM cep_patterns ORDER BY name");
  }),

  togglePattern: adminProcedure
    .input(z.object({ patternId: z.string(), status: z.enum(["enabled", "disabled"]) }))
    .mutation(async ({ input }) => {
      await pgQuery(
        "UPDATE cep_patterns SET status = $1, updated_at = NOW() WHERE pattern_id = $2",
        [input.status, input.patternId]
      );
      return { success: true };
    }),

  createPattern: adminProcedure
    .input(z.object({
      name: z.string().min(3).max(200),
      description: z.string().optional(),
      parameters: z.record(z.string(), z.unknown()).default({}),
    }))
    .mutation(async ({ input }) => {
      const patternId = `CUSTOM_${Date.now().toString(36).toUpperCase()}`;
      await pgQuery(
        `INSERT INTO cep_patterns (pattern_id, name, description, status, parameters, trigger_count, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,NOW(),NOW())`,
        [patternId, input.name, input.description ?? null, "enabled", JSON.stringify(input.parameters), 0]
      );
      return { success: true, patternId };
    }),

  detectPatterns: protectedProcedure
    .input(z.object({
      declarationId: z.number(),
      traderId: z.number().optional(),
    }))
    .mutation(async ({ input }) => {
      const live = await cepFetch<{ alerts: unknown[] }>("/detect", {
        method: "POST",
        body: JSON.stringify({ declarationId: input.declarationId, traderId: input.traderId }),
      });
      if (live?.alerts) return { alerts: live.alerts, source: "live" };

      const alerts: { patternId: string; patternName: string; severity: string; riskScore: number }[] = [];

      if (input.traderId) {
        const [r] = await pgQuery<{ cnt: string }>(
          `SELECT COUNT(*) as cnt FROM declarations
           WHERE trader_id = $1 AND created_at >= NOW() - INTERVAL '1 hour'`,
          [input.traderId]
        );
        if (parseInt(r.cnt, 10) >= 5) {
          alerts.push({ patternId: "RAPID_MULTI_DECL", patternName: "Rapid Multi-Declaration", severity: "high", riskScore: 75 });
        }
        const [r2] = await pgQuery<{ cnt: string }>(
          `SELECT COUNT(*) as cnt FROM declarations
           WHERE trader_id = $1 AND status = 'rejected' AND updated_at >= NOW() - INTERVAL '30 days'`,
          [input.traderId]
        );
        if (parseInt(r2.cnt, 10) >= 3) {
          alerts.push({ patternId: "REPEAT_REJECTION", patternName: "Repeat Rejection Pattern", severity: "medium", riskScore: 60 });
        }
      }

      for (const alert of alerts) {
        const alertId = `ALT-${randomUUID().substring(0, 8).toUpperCase()}`;
        await pgQuery(
          `INSERT INTO cep_alerts
            (alert_id, pattern_id, pattern_name, declaration_id, trader_id, severity, status, details, risk_score, detected_at, created_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,NOW(),NOW())`,
          [alertId, alert.patternId, alert.patternName, input.declarationId,
           input.traderId ?? null, alert.severity, "open",
           JSON.stringify({ declarationId: input.declarationId }), alert.riskScore]
        );
        await pgQuery(
          "UPDATE cep_patterns SET trigger_count = trigger_count + 1, last_triggered_at = NOW() WHERE pattern_id = $1",
          [alert.patternId]
        );
      }
      return { alerts, source: "db_fallback", detected: alerts.length };
    }),

  getAlerts: protectedProcedure
    .input(z.object({
      status: z.enum(["open", "investigating", "resolved", "false_positive"]).optional(),
      severity: z.enum(["low", "medium", "high", "critical"]).optional(),
      patternId: z.string().optional(),
      limit: z.number().min(1).max(200).default(50),
      offset: z.number().min(0).default(0),
    }))
    .query(async ({ input }) => {
      const conditions: string[] = ["1=1"];
      const params: unknown[] = [];
      let i = 1;
      if (input.status) { conditions.push(`status = $${i++}`); params.push(input.status); }
      if (input.severity) { conditions.push(`severity = $${i++}`); params.push(input.severity); }
      if (input.patternId) { conditions.push(`pattern_id = $${i++}`); params.push(input.patternId); }
      params.push(input.limit, input.offset);
      const [alerts, [{ total }]] = await Promise.all([
        pgQuery(`SELECT * FROM cep_alerts WHERE ${conditions.join(" AND ")} ORDER BY detected_at DESC LIMIT $${i++} OFFSET $${i++}`, params),
        pgQuery<{ total: string }>(`SELECT COUNT(*) as total FROM cep_alerts WHERE ${conditions.slice(0, -0).join(" AND ")}`, params.slice(0, -2)),
      ]);
      return { alerts, total: parseInt(total, 10) };
    }),

  acknowledgeAlert: protectedProcedure
    .input(z.object({
      alertId: z.string(),
      status: z.enum(["investigating", "resolved", "false_positive"]),
      resolutionNote: z.string().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const resolvedAt = ["resolved", "false_positive"].includes(input.status) ? new Date() : null;
      await pgQuery(
        `UPDATE cep_alerts SET status = $1, resolved_by = $2, resolved_at = $3, resolution_note = $4
         WHERE alert_id = $5`,
        [input.status, ctx.user.id, resolvedAt, input.resolutionNote ?? null, input.alertId]
      );
      return { success: true };
    }),

  getStats: protectedProcedure.query(async () => {
    const [alertStats, patternStats] = await Promise.all([
      pgQuery(
        `SELECT
          COUNT(*) AS total_alerts,
          SUM(CASE WHEN status = 'open' THEN 1 ELSE 0 END) AS open_alerts,
          SUM(CASE WHEN status = 'investigating' THEN 1 ELSE 0 END) AS investigating,
          SUM(CASE WHEN status = 'resolved' THEN 1 ELSE 0 END) AS resolved,
          SUM(CASE WHEN status = 'false_positive' THEN 1 ELSE 0 END) AS false_positives,
          SUM(CASE WHEN severity = 'critical' THEN 1 ELSE 0 END) AS critical_count,
          SUM(CASE WHEN severity = 'high' THEN 1 ELSE 0 END) AS high_count,
          ROUND(AVG(risk_score)) AS avg_risk_score
         FROM cep_alerts`
      ),
      pgQuery(
        `SELECT COUNT(*) AS total_patterns,
          SUM(CASE WHEN status = 'enabled' THEN 1 ELSE 0 END) AS active_patterns,
          SUM(trigger_count) AS total_triggers
         FROM cep_patterns`
      ),
    ]);
    const a = alertStats[0] as any ?? {};
    const p = patternStats[0] as any ?? {};
    const byPattern = await pgQuery<{ pattern_id: string; cnt: string }>(
      `SELECT pattern_id, COUNT(*) as cnt FROM cep_alerts GROUP BY pattern_id`
    );
    const by_pattern: Record<string, number> = {};
    for (const row of byPattern) { by_pattern[row.pattern_id] = parseInt(row.cnt, 10); }
    return {
      total_alerts: parseInt(a.total_alerts ?? '0', 10),
      open_alerts: parseInt(a.open_alerts ?? '0', 10),
      investigating: parseInt(a.investigating ?? '0', 10),
      resolved: parseInt(a.resolved ?? '0', 10),
      false_positives: parseInt(a.false_positives ?? '0', 10),
      critical_count: parseInt(a.critical_count ?? '0', 10),
      high_count: parseInt(a.high_count ?? '0', 10),
      avg_risk_score: parseInt(a.avg_risk_score ?? '0', 10),
      patterns_registered: parseInt(p.active_patterns ?? '0', 10),
      declarations_processed: parseInt(p.total_triggers ?? '0', 10) * 100,
      by_pattern,
    };
  }),

  getServiceStatus: protectedProcedure.query(async () => {
    const live = await cepFetch<{ status: string; version: string }>("/health");
    const [{ cnt }] = await pgQuery<{ cnt: string }>("SELECT COUNT(*) as cnt FROM cep_patterns");
    return {
      service: live ? "online" : "degraded",
      version: live?.version ?? "db-fallback",
      patternsLoaded: parseInt(cnt, 10),
      lastCheck: new Date().toISOString(),
    };
  }),
});
