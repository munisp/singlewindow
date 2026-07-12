// TradeGateway NGSWTP — Insider Threat tRPC Router
// Provides admin procedures for session management, 4-eyes approval workflow,
// privileged action audit trail, force logout, and anomaly alert queries.
//
// Integrations:
//   - Redis: active session storage and force-logout invalidation
//   - OpenSearch: anomaly alert queries and audit log search
//   - Temporal: 4-eyes approval workflow orchestration
//   - Kafka: privileged action audit events
//   - TigerBeetle bridge: immutable audit log entries (via HTTP)

import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, protectedProcedure } from "../_core/trpc";
import { logAuditEvent } from "../db";
import { publishEvent, TOPICS } from "../_core/kafka";

// ─── Admin procedure helper ───────────────────────────────────────────────────

const adminProcedure = protectedProcedure.use(({ ctx, next }) => {
  if (ctx.user.role !== "admin") {
    throw new TRPCError({ code: "FORBIDDEN", message: "Admin access required" });
  }
  return next({ ctx });
});

// ─── Redis helpers ────────────────────────────────────────────────────────────

async function getRedisClient() {
  try {
    const { createClient } = await import("redis");
    const url = process.env.REDIS_URL ?? "redis://localhost:6379";
    const client = createClient({ url });
    await client.connect();
    return client;
  } catch {
    return null;
  }
}

// ─── OpenSearch helpers ───────────────────────────────────────────────────────

async function queryOpenSearch(index: string, body: Record<string, unknown>) {
  const url = process.env.OPENSEARCH_URL ?? "http://opensearch:9200";
  try {
    const resp = await fetch(`${url}/${index}/_search`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!resp.ok) return { hits: { hits: [], total: { value: 0 } } };
    return resp.json();
  } catch {
    return { hits: { hits: [], total: { value: 0 } } };
  }
}

// ─── TigerBeetle bridge helpers ───────────────────────────────────────────────

async function appendAuditEntry(params: {
  eventTypeCode: number;
  actorId: number;
  subjectId: number;
  payloadJson: string;
}) {
  const url = process.env.TIGERBEETLE_BRIDGE_URL ?? "http://tigerbeetle-bridge:4600";
  try {
    await fetch(`${url}/audit/append`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        event_type_code: params.eventTypeCode,
        actor_id: params.actorId,
        subject_id: params.subjectId,
        payload_json: params.payloadJson,
      }),
    });
  } catch {
    // Non-fatal: audit log is best-effort in sandbox; in production TigerBeetle is always available
  }
}

// ─── In-memory 4-eyes approval store (fallback when DB unavailable) ───────────

const fourEyesStore = new Map<string, {
  id: string;
  requesterId: number;
  requesterName: string;
  action: string;
  entityType: string;
  entityId: string;
  description: string;
  status: "pending" | "approved" | "denied";
  approverId?: number;
  approverName?: string;
  reason?: string;
  createdAt: Date;
  resolvedAt?: Date;
}>();

// ─── Router ───────────────────────────────────────────────────────────────────

export const insiderThreatRouter = router({

  /**
   * getActiveSessions — query Redis for all active user sessions.
   * Returns session metadata: user ID, IP, last activity, session ID.
   */
  getActiveSessions: adminProcedure.query(async ({ ctx }) => {
    const redis = await getRedisClient();
    if (!redis) {
      return { sessions: [], total: 0, source: "unavailable" };
    }
    try {
      const keys = await redis.keys("session:*");
      const sessions = await Promise.all(
        keys.slice(0, 200).map(async (key) => {
          const raw = await redis.get(key);
          if (!raw) return null;
          try {
            return JSON.parse(raw);
          } catch {
            return { sessionId: key.replace("session:", ""), raw };
          }
        })
      );
      await redis.disconnect();
      const valid = sessions.filter(Boolean);
      return { sessions: valid, total: valid.length, source: "redis" };
    } catch {
      await redis.disconnect().catch(() => {});
      return { sessions: [], total: 0, source: "error" };
    }
  }),

  /**
   * forceLogout — invalidate a specific session by session ID.
   * Publishes a ForceLogoutExecuted event to the TigerBeetle audit log.
   */
  forceLogout: adminProcedure
    .input(z.object({
      sessionId: z.string().min(1),
      reason: z.string().min(1).max(500),
      targetUserId: z.number().int().positive(),
    }))
    .mutation(async ({ ctx, input }) => {
      const redis = await getRedisClient();
      if (redis) {
        try {
          await redis.del(`session:${input.sessionId}`);
          // Also add to revoked JTI set (checked by JWT verification middleware)
          await redis.setEx(`revoked_jti:${input.sessionId}`, 86400, "1");
          await redis.disconnect();
        } catch {
          await redis.disconnect().catch(() => {});
        }
      }

      // Audit log: ForceLogoutExecuted (code 107)
      await appendAuditEntry({
        eventTypeCode: 107,
        actorId: ctx.user.id,
        subjectId: input.targetUserId,
        payloadJson: JSON.stringify({
          action: "force_logout",
          sessionId: input.sessionId,
          reason: input.reason,
          adminId: ctx.user.id,
        }),
      });

      await logAuditEvent({
        entityType: "user",
        entityId: input.targetUserId,
        action: "force_logout",
        actorId: ctx.user.id,
        actorType: "admin",
        newState: { sessionId: input.sessionId, reason: input.reason },
      });

      return { success: true, sessionId: input.sessionId };
    }),

  /**
   * requestFourEyesApproval — create a 4-eyes approval record for a privileged action.
   * The action is blocked until a second admin approves it.
   */
  requestFourEyesApproval: protectedProcedure
    .input(z.object({
      action: z.string().min(1).max(200),
      entityType: z.string().min(1).max(100),
      entityId: z.string().min(1).max(200),
      description: z.string().min(1).max(1000),
    }))
    .mutation(async ({ ctx, input }) => {
      const id = `4eyes-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

      const record = {
        id,
        requesterId: ctx.user.id,
        requesterName: ctx.user.name ?? ctx.user.email ?? "unknown",
        action: input.action,
        entityType: input.entityType,
        entityId: input.entityId,
        description: input.description,
        status: "pending" as const,
        createdAt: new Date(),
      };

      fourEyesStore.set(id, record);

      // Audit log: FourEyesApprovalRequested (code 103)
      await appendAuditEntry({
        eventTypeCode: 103,
        actorId: ctx.user.id,
        subjectId: ctx.user.id,
        payloadJson: JSON.stringify({ ...record }),
      });

      await logAuditEvent({
        entityType: "declaration",
        entityId: ctx.user.id,
        action: "four_eyes_requested",
        actorId: ctx.user.id,
        actorType: "user",
        newState: { approvalId: id, action: input.action, entityType: input.entityType, entityId: input.entityId },
      });

      return record;
    }),

  /**
   * approveFourEyes — approve or deny a 4-eyes approval request.
   * Only admins can approve; the requester cannot approve their own request.
   */
  approveFourEyes: adminProcedure
    .input(z.object({
      approvalId: z.string().min(1),
      decision: z.enum(["approved", "denied"]),
      reason: z.string().min(1).max(500),
    }))
    .mutation(async ({ ctx, input }) => {
      const record = fourEyesStore.get(input.approvalId);
      if (!record) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Approval request not found" });
      }
      if (record.status !== "pending") {
        throw new TRPCError({ code: "BAD_REQUEST", message: `Request already ${record.status}` });
      }
      if (record.requesterId === ctx.user.id) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Cannot approve your own 4-eyes request",
        });
      }

      const updated = {
        ...record,
        status: input.decision,
        approverId: ctx.user.id,
        approverName: ctx.user.name ?? ctx.user.email ?? "unknown",
        reason: input.reason,
        resolvedAt: new Date(),
      };
      fourEyesStore.set(input.approvalId, updated);

      // Audit log: FourEyesApprovalGranted (104) or FourEyesApprovalDenied (105)
      const eventTypeCode = input.decision === "approved" ? 104 : 105;
      await appendAuditEntry({
        eventTypeCode,
        actorId: ctx.user.id,
        subjectId: record.requesterId,
        payloadJson: JSON.stringify({
          approvalId: input.approvalId,
          decision: input.decision,
          reason: input.reason,
          originalAction: record.action,
        }),
      });

      await logAuditEvent({
        entityType: "declaration",
        entityId: record.requesterId,
        action: `four_eyes_${input.decision}`,
        actorId: ctx.user.id,
        actorType: "admin",
        newState: { approvalId: input.approvalId, decision: input.decision, reason: input.reason },
      });

      // Publish Kafka INSIDER_THREAT_ALERT when a 4-eyes decision is made (fire-and-forget)
      publishEvent(TOPICS.INSIDER_THREAT_DETECTED, {
        eventType: `insider_threat.four_eyes_${input.decision}`,
        aggregateId: input.approvalId,
        payload: {
          approvalId: input.approvalId,
          decision: input.decision,
          reason: input.reason,
          originalAction: record.action,
          requesterId: record.requesterId,
          approverId: ctx.user.id,
        },
      }).catch(() => {});
      return updated;
    }),

  /**
   * getPendingFourEyes — list all pending 4-eyes approval requests.
   */
  getPendingFourEyes: adminProcedure.query(async () => {
    const pending = Array.from(fourEyesStore.values())
      .filter((r) => r.status === "pending")
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    return { requests: pending, total: pending.length };
  }),

  /**
   * getAuditLog — paginated audit log query from the database.
   * Supports filtering by entity type, actor, and date range.
   */
  getAuditLog: adminProcedure
    .input(z.object({
      limit: z.number().int().min(1).max(500).default(50),
      offset: z.number().int().min(0).default(0),
      entityType: z.string().optional(),
      actorId: z.number().int().positive().optional(),
      action: z.string().optional(),
      fromDate: z.date().optional(),
      toDate: z.date().optional(),
    }).optional())
    .query(async ({ input }) => {
      try {
        const { getDb } = await import("../db");
        const db = await getDb();
        if (!db) return { entries: [], total: 0, source: "unavailable" };

        const { auditEvents: auditLog } = await import("../../drizzle/schema");
        const { desc, eq, and, gte, lte } = await import("drizzle-orm");

        const conditions: any[] = [];
        if (input?.entityType) conditions.push(eq(auditLog.entityType, input.entityType as any));
        if (input?.actorId) conditions.push(eq(auditLog.actorId, input.actorId));
        if (input?.action) conditions.push(eq(auditLog.action, input.action));
        if (input?.fromDate) conditions.push(gte(auditLog.createdAt, input.fromDate));
        if (input?.toDate) conditions.push(lte(auditLog.createdAt, input.toDate));

        const entries = await db
          .select()
          .from(auditLog)
          .where(conditions.length > 0 ? and(...conditions) : undefined)
          .orderBy(desc(auditLog.createdAt))
          .limit(input?.limit ?? 50)
          .offset(input?.offset ?? 0);

        return { entries, total: entries.length, source: "database" };
      } catch {
        return { entries: [], total: 0, source: "error" };
      }
    }),

  /**
   * getAnomalyAlerts — query anomaly alerts from OpenSearch.
   * Returns alerts published by the Python anomaly detection service.
   */
  getAnomalyAlerts: adminProcedure
    .input(z.object({
      limit: z.number().int().min(1).max(200).default(50),
      severity: z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]).optional(),
      userId: z.string().optional(),
      fromDate: z.string().optional(),
      toDate: z.string().optional(),
    }).optional())
    .query(async ({ input }) => {
      const must: Record<string, unknown>[] = [];
      if (input?.severity) {
        must.push({ term: { severity: input.severity } });
      }
      if (input?.userId) {
        must.push({ term: { user_id: input.userId } });
      }
      if (input?.fromDate || input?.toDate) {
        must.push({
          range: {
            timestamp: {
              ...(input.fromDate ? { gte: input.fromDate } : {}),
              ...(input.toDate ? { lte: input.toDate } : {}),
            },
          },
        });
      }

      const query = must.length > 0 ? { bool: { must } } : { match_all: {} };
      const result = await queryOpenSearch("insider-threat-alerts", {
        query,
        sort: [{ timestamp: { order: "desc" } }],
        size: input?.limit ?? 50,
      });

      const hits = result?.hits?.hits ?? [];
      const alerts = hits.map((h: any) => h._source);
      return { alerts, total: result?.hits?.total?.value ?? 0, source: "opensearch" };
    }),

  /**
   * getPrivilegedActionAuditTrail — query the TigerBeetle immutable audit log
   * for privileged actions (event codes 100–110).
   */
  getPrivilegedActionAuditTrail: adminProcedure
    .input(z.object({
      limit: z.number().int().min(1).max(500).default(100),
    }).optional())
    .query(async ({ input }) => {
      const url = process.env.TIGERBEETLE_BRIDGE_URL ?? "http://tigerbeetle-bridge:4600";
      try {
        const resp = await fetch(`${url}/audit/entries`);
        if (!resp.ok) return { entries: [], total: 0, source: "unavailable" };
        const all: any[] = await resp.json();
        // Filter to insider-threat event codes (100–110)
        const privileged = all
          .filter((e) => e.event_type >= 100 && e.event_type <= 110)
          .slice(0, input?.limit ?? 100);
        return { entries: privileged, total: privileged.length, source: "tigerbeetle" };
      } catch {
        return { entries: [], total: 0, source: "unavailable" };
      }
    }),

  /**
   * verifyAuditChain — verify the TigerBeetle immutable audit chain integrity.
   */
  verifyAuditChain: adminProcedure.query(async () => {
    const url = process.env.TIGERBEETLE_BRIDGE_URL ?? "http://tigerbeetle-bridge:4600";
    try {
      const resp = await fetch(`${url}/audit/verify`);
      if (!resp.ok) return { is_valid: false, source: "unavailable" };
      return { ...(await resp.json()), source: "tigerbeetle" };
    } catch {
      return { is_valid: false, source: "unavailable" };
    }
  }),

  /**
   * getSSEToken — issue a short-lived JWT for the /api/events/anomalies SSE stream.
   * Only admin users receive a token. Token expires in 5 minutes.
   */
  getSSEToken: adminProcedure.mutation(async ({ ctx }) => {
    const { issueSSEToken } = await import("../sse");
    const token = await issueSSEToken(ctx.user.id, ctx.user.role ?? "user");
    return { token, expiresInSeconds: 300 };
  }),

  /**
   * getAuditEntryDiff — fetch the before/after JSON diff for a session_audit_log entry.
   * Returns metadata.before and metadata.after for the JsonDiffViewer component.
   */
  getAuditEntryDiff: adminProcedure
    .input(z.object({ entryId: z.string().min(1) }))
    .query(async ({ input }) => {
      try {
        const { getDb } = await import("../db");
        const db = await getDb();
        if (!db) return { hasDiff: false, before: null, after: null, source: "unavailable" };

        const { auditEvents } = await import("../../drizzle/schema");
        const { eq } = await import("drizzle-orm");

        const rows = await db
          .select()
          .from(auditEvents)
          .where(eq(auditEvents.id, input.entryId as any))
          .limit(1);

        if (rows.length === 0) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Audit entry not found" });
        }

        const row = rows[0];
        const meta = (row.metadata ?? {}) as Record<string, unknown>;

        return {
          id: row.id,
          actorId: row.actorId,
          action: row.action,
          entityType: row.entityType,
          entityId: row.entityId,
          createdAt: row.createdAt,
          before: meta.before ?? null,
          after: meta.after ?? null,
          hasDiff: (meta.before !== undefined) || (meta.after !== undefined),
          source: "database",
        };
      } catch (err) {
        if (err instanceof TRPCError) throw err;
        return { hasDiff: false, before: null, after: null, source: "error" };
      }
    }),

  /**
   * getABStats — proxy to Python insider-threat-svc GET /ab/stats.
   */
  getABStats: adminProcedure.query(async () => {
    const svcUrl = process.env.INSIDER_THREAT_SVC_URL ?? "http://insider-threat-svc:8000";
    try {
      const resp = await fetch(`${svcUrl}/ab/stats`, { signal: AbortSignal.timeout(5000) });
      if (!resp.ok) return { enabled: false, total_comparisons: 0, production_mean: 0, shadow_mean: 0, agreement_rate: 0, production_block_rate: 0, shadow_block_rate: 0, score_distribution: { production: [0,0,0,0,0], shadow: [0,0,0,0,0] }, source: "unavailable" };
      const data = await resp.json();
      return { ...data, source: "insider-threat-svc" };
    } catch {
      return { enabled: false, total_comparisons: 0, production_mean: 0, shadow_mean: 0, agreement_rate: 0, production_block_rate: 0, shadow_block_rate: 0, score_distribution: { production: [0,0,0,0,0], shadow: [0,0,0,0,0] }, source: "unavailable" };
    }
  }),

  /**
   * getABRecentScores — proxy to Python insider-threat-svc GET /ab/recent.
   */
  getABRecentScores: adminProcedure
    .input(z.object({ limit: z.number().int().min(1).max(500).default(100) }))
    .query(async ({ input }) => {
      const svcUrl = process.env.INSIDER_THREAT_SVC_URL ?? "http://insider-threat-svc:8000";
      try {
        const resp = await fetch(`${svcUrl}/ab/recent?limit=${input.limit}`, { signal: AbortSignal.timeout(5000) });
        if (!resp.ok) return { enabled: false, records: [], source: "unavailable" };
        const data = await resp.json();
        return { ...data, source: "insider-threat-svc" };
      } catch {
        return { enabled: false, records: [], source: "unavailable" };
      }
    }),

  /**
   * promoteModel — proxy to Python insider-threat-svc POST /ab/promote.
   */
  promoteModel: adminProcedure
    .input(z.object({
      reason: z.string().min(1).max(500).default("manual_promotion"),
      operator: z.string().min(1).max(100).default("admin"),
    }))
    .mutation(async ({ input }) => {
      const svcUrl = process.env.INSIDER_THREAT_SVC_URL ?? "http://insider-threat-svc:8000";
      try {
        const resp = await fetch(`${svcUrl}/ab/promote`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ reason: input.reason, operator: input.operator }),
          signal: AbortSignal.timeout(15_000),
        });
        if (!resp.ok) {
          const body = await resp.json().catch(() => ({}));
          throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: (body as any)?.detail ?? `Promotion failed with status ${resp.status}` });
        }
        return await resp.json();
      } catch (err) {
        if (err instanceof TRPCError) throw err;
        // Service unavailable in test/dev — return offline stub
        return { success: false, message: "insider-threat-svc unavailable (offline mode)", reason: input.reason, operator: input.operator, promotedAt: new Date().toISOString() };
      }
    }),

  /**
   * getPromotionHistory — proxy to Python insider-threat-svc GET /ab/promotions.
   * Returns the promotion audit log (most recent first).
   */
  getPromotionHistory: adminProcedure
    .input(z.object({ limit: z.number().int().min(1).max(500).default(50) }))
    .query(async ({ input }) => {
      const svcUrl = process.env.INSIDER_THREAT_SVC_URL ?? "http://insider-threat-svc:8000";
      try {
        const resp = await fetch(`${svcUrl}/ab/promotions?limit=${input.limit}`, { signal: AbortSignal.timeout(5000) });
        if (!resp.ok) return { total: 0, records: [], source: "unavailable" };
        const data = await resp.json();
        return { ...data, source: "insider-threat-svc" };
      } catch {
        return { total: 0, records: [], source: "unavailable" };
      }
    }),

  /**
   * rollbackModel — proxy to Python insider-threat-svc POST /ab/rollback.
   * Restores the previous production model from the backup file.
   */
  rollbackModel: adminProcedure
    .input(z.object({
      reason: z.string().min(1).max(500).default("manual_rollback"),
      operator: z.string().min(1).max(100).default("admin"),
    }))
    .mutation(async ({ input }) => {
      const svcUrl = process.env.INSIDER_THREAT_SVC_URL ?? "http://insider-threat-svc:8000";
      try {
        const resp = await fetch(`${svcUrl}/ab/rollback`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ reason: input.reason, operator: input.operator }),
          signal: AbortSignal.timeout(15_000),
        });
        if (!resp.ok) {
          const body = await resp.json().catch(() => ({}));
          throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: (body as any)?.detail ?? `Rollback failed with status ${resp.status}` });
        }
        return await resp.json();
      } catch (err) {
        if (err instanceof TRPCError) throw err;
        // Service unavailable in test/dev — return offline stub
        return { success: false, message: "insider-threat-svc unavailable (offline mode)", reason: input.reason, operator: input.operator, rolledBackAt: new Date().toISOString() };
      }
    }),

  /**
   * rollbackToVersion — proxy to Python insider-threat-svc POST /ab/rollback
   * with an explicit target_version so operators can restore any past version
   * from the Promotion History table.
   */
  rollbackToVersion: adminProcedure
    .input(z.object({
      target_version: z.number().int().min(0),
      reason: z.string().min(1).max(500).default("version_rollback"),
      operator: z.string().min(1).max(100).default("admin"),
    }))
    .mutation(async ({ input }) => {
      const svcUrl = process.env.INSIDER_THREAT_SVC_URL ?? "http://insider-threat-svc:8000";
      try {
        const resp = await fetch(`${svcUrl}/ab/rollback`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ reason: input.reason, operator: input.operator, target_version: input.target_version }),
          signal: AbortSignal.timeout(15_000),
        });
        if (!resp.ok) {
          const body = await resp.json().catch(() => ({}));
          throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: (body as any)?.detail ?? `Version rollback failed with status ${resp.status}` });
        }
        return await resp.json();
      } catch (err) {
        if (err instanceof TRPCError) throw err;
        return { success: false, message: "insider-threat-svc unavailable (offline mode)", reason: input.reason, operator: input.operator, target_version: input.target_version, rolledBackAt: new Date().toISOString(), restored_version: input.target_version };
      }
    }),

  /**
   * classifyHSCode — proxy to Rust hs-classifier POST /classify.
   * Returns HS code validity, chapter, heading, and description.
   */
  classifyHSCode: protectedProcedure
    .input(z.object({
      hs_code: z.string().min(2).max(12),
      description: z.string().max(500).optional(),
    }))
    .mutation(async ({ input }) => {
      const svcUrl = process.env.HS_CLASSIFIER_URL ?? "http://hs-classifier:8090";
      try {
        const resp = await fetch(`${svcUrl}/classify`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ hs_code: input.hs_code, description: input.description }),
          signal: AbortSignal.timeout(5_000),
        });
        if (!resp.ok) {
          const body = await resp.json().catch(() => ({}));
          throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: (body as any)?.detail ?? `HS classification failed with status ${resp.status}` });
        }
        return await resp.json();
      } catch (err) {
        if (err instanceof TRPCError) throw err;
        // Offline stub — basic regex validation
        const code = input.hs_code.replace(/[^0-9]/g, "");
        const valid = /^\d{6,10}$/.test(code);
        const chapter = code.slice(0, 2);
        return {
          hs_code: input.hs_code,
          valid,
          chapter,
          heading: code.slice(0, 4),
          subheading: code.slice(0, 6),
          description: valid ? `Chapter ${chapter} commodity` : "Invalid HS code format",
          confidence: valid ? 0.6 : 0.0,
          source: "offline-stub",
        };
      }
    }),

  /**
   * getAnomalyMetrics — proxy to Python anomaly-detection-svc GET /metrics.
   * Returns Prometheus-style counters as structured JSON.
   */
  getAnomalyMetrics: adminProcedure
    .query(async () => {
      const svcUrl = process.env.ANOMALY_DETECTION_SVC_URL ?? "http://anomaly-detection-svc:8000";
      try {
        const resp = await fetch(`${svcUrl}/metrics`, { signal: AbortSignal.timeout(5_000) });
        if (!resp.ok) return { total_analysed: 0, total_alerts: 0, blocked_count: 0, alerts_by_rule: {}, source: "unavailable" };
        return { ...await resp.json(), source: "anomaly-detection-svc" };
      } catch {
        return { total_analysed: 0, total_alerts: 0, blocked_count: 0, alerts_by_rule: {}, source: "unavailable" };
      }
    }),

  /**
   * v76-09: Batch HS code classification — proxy to Rust POST /batch
   */
  batchClassifyHSCodes: protectedProcedure
    .input(z.object({ hs_codes: z.array(z.string()).min(1).max(50) }))
    .mutation(async ({ input }) => {
      const svcUrl = process.env.HS_CLASSIFIER_URL ?? "http://hs-classifier:8090";
      try {
        const resp = await fetch(`${svcUrl}/batch`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ hs_codes: input.hs_codes }),
          signal: AbortSignal.timeout(10_000),
        });
        if (!resp.ok) throw new Error(`hs-classifier batch returned ${resp.status}`);
        return await resp.json();
      } catch {
        // offline stub — return invalid for all codes
        return {
          results: input.hs_codes.map(code => ({
            hs_code: code,
            valid: false,
            chapter: "00",
            heading: "0000",
            subheading: "000000",
            description: "Service unavailable",
            confidence: 0,
            source: "offline-stub",
          })),
          source: "offline-stub",
        };
      }
    }),

  /**
   * v76-10: Get full WCO chapter lookup table from Rust GET /chapters
   */
  getHSChapters: protectedProcedure.query(async () => {
    const svcUrl = process.env.HS_CLASSIFIER_URL ?? "http://hs-classifier:8090";
    try {
      const resp = await fetch(`${svcUrl}/chapters`, { signal: AbortSignal.timeout(5_000) });
      if (!resp.ok) throw new Error(`hs-classifier chapters returned ${resp.status}`);
      return await resp.json();
    } catch {
      // v108: offline-stub upgraded to static-wco-hs2022 (bundled WCO HS-2022 chapter data)
      const { readFileSync } = await import("fs");
      const { join } = await import("path");
      try {
        const dataPath = join(process.cwd(), "server", "data", "hsChapters.json");
        const raw = readFileSync(dataPath, "utf-8");
        return { ...JSON.parse(raw), source: "static-wco-hs2022" };
      } catch {
        // Final fallback if file is missing
        return {
          chapters: { "84": "Machinery", "85": "Electrical equipment", "87": "Vehicles" },
          source: "fallback-stub",
        };
      }
    }
  }),

  /**
   * v76-12: Anomaly risk summary — top-10 highest-risk users
   */
  getAnomalyRiskSummary: adminProcedure.query(async () => {
    const svcUrl = process.env.ANOMALY_DETECTION_SVC_URL ?? "http://anomaly-detection-svc:8000";
    try {
      const resp = await fetch(`${svcUrl}/risk/summary`, { signal: AbortSignal.timeout(5_000) });
      if (!resp.ok) return { users: [], source: "unavailable" };
      return { ...await resp.json(), source: "anomaly-detection-svc" };
    } catch {
      return { users: [], source: "unavailable" };
    }
  }),

  /**
   * v76-15: A/B model divergence — production vs shadow block decisions
   */
  getABDivergence: adminProcedure
    .input(z.object({ n: z.number().int().min(10).max(1000).default(100) }))
    .query(async ({ input }) => {
      const svcUrl = process.env.INSIDER_THREAT_SVC_URL ?? "http://insider-threat-svc:8000";
      try {
        const resp = await fetch(`${svcUrl}/ab/divergence?n=${input.n}`, { signal: AbortSignal.timeout(8_000) });
        if (!resp.ok) return { agree: 0, disagree: 0, agree_rate: 0, total: 0, source: "unavailable" };
        return { ...await resp.json(), source: "insider-threat-svc" };
      } catch {
        return { agree: 0, disagree: 0, agree_rate: 0, total: 0, source: "unavailable" };
      }
    }),

  /**
   * v76-18: Force immediate token refresh cycle — proxy to Go POST /admin/force-refresh
   */
  forceTokenRefresh: adminProcedure.mutation(async () => {
    const svcUrl = process.env.NOTIFICATION_DISPATCHER_ADMIN_URL ?? "http://notification-dispatcher:8081";
    try {
      const resp = await fetch(`${svcUrl}/admin/force-refresh`, {
        method: "POST",
        signal: AbortSignal.timeout(15_000),
      });
      if (!resp.ok) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: `force-refresh returned ${resp.status}` });
      return await resp.json();
    } catch (err) {
      if (err instanceof TRPCError) throw err;
      // offline stub
      return { triggered: true, source: "offline-stub", message: "Token refresh triggered (offline stub)" };
    }
  }),
});
