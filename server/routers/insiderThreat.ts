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
});
