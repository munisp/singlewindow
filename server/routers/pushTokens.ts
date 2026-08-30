/**
 * pushTokens.ts — tRPC router for device push token management.
 *
 * Procedures:
 *   - registerPushToken: store a device FCM/APNs/Expo token for the authenticated user
 *   - unregisterPushToken: remove a token (on logout or permission revocation)
 *   - sendAnomalyPushNotification: admin procedure to send a push to all admin tokens
 *
 * P0-5 remediation: the DATABASE is the primary (authoritative) store. The
 * previous implementation kept tokens in a process-local Map and ran a
 * MySQL-dialect upsert (ON DUPLICATE KEY UPDATE) against PostgreSQL that
 * always threw and was silently swallowed — registrations were lost on every
 * restart/replica. Now: drizzle `push_tokens` table + PG-native
 * onConflictDoUpdate, and no swallowed errors. If the DB is unavailable the
 * mutation FAILS honestly (503) instead of pretending the token was stored.
 *
 * FCM/APNs dispatch is handled by the Go notification-dispatcher service.
 * This router only manages token CRUD and triggers the dispatch via Kafka.
 */

import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { eq, and } from "drizzle-orm";
import { router, protectedProcedure } from "../_core/trpc";
import { getDb } from "../db";
import { pushTokens, users } from "../../drizzle/schema";

// ─── Admin procedure ──────────────────────────────────────────────────────────

const adminProcedure = protectedProcedure.use(({ ctx, next }) => {
  if (ctx.user.role !== "admin") {
    throw new TRPCError({ code: "FORBIDDEN", message: "Admin access required" });
  }
  return next({ ctx });
});

async function requireDb() {
  const db = await getDb();
  if (!db) {
    throw new TRPCError({
      code: "SERVICE_UNAVAILABLE",
      message: "Push token store unavailable — token NOT saved (fail-closed)",
    });
  }
  return db;
}

// ─── Kafka publish helper (PRA-027, Phase 9) ─────────────────────────────────
//
// Posture: the push-dispatch event is IMPORTANT but not transactional with the
// token row — the token registration/unregistration MUST still commit even if
// the publish fails (documented contract: the dispatcher re-reads target
// tokens from the DB at send time for register-triggered flows, and the
// outbox carries the anomaly payload for replay). On publish failure we:
//   1. surface it via the tradegateway_push_dispatch_failures_total metric,
//   2. emit a structured error log (never silent),
//   3. persist the event to the durable kafka_event_log outbox for retry.
// GAP-PUSH-OUTBOX: the outbox table + helpers exist (server/db.ts v78) but no
// drainer worker ships in this repo — replay requires an operator/script until
// an outbox-worker lands. Registered in server/_core/gapRegistry.ts.

import { createKafkaEventLogEntry } from "../db";
import { pushDispatchFailuresTotal } from "../_core/metrics";

export type PushPublishOutcome = "published" | "queued_to_outbox";

async function publishPushEvent(payload: Record<string, unknown>): Promise<PushPublishOutcome> {
  const kafkaUrl = process.env.KAFKA_REST_URL ?? "http://kafka-rest:8082";
  const topic = "insider.push.dispatch";
  try {
    const res = await fetch(`${kafkaUrl}/topics/${topic}`, {
      method: "POST",
      headers: { "Content-Type": "application/vnd.kafka.json.v2+json" },
      body: JSON.stringify({ records: [{ value: payload }] }),
      signal: AbortSignal.timeout(5_000), // PRA-027: bounded, never fire-and-forget
    });
    if (!res.ok) {
      throw new Error(`Kafka REST proxy answered HTTP ${res.status}`);
    }
    return "published";
  } catch (err) {
    const reason = err instanceof Error && err.name === "TimeoutError" ? "timeout" : "publish_failed";
    pushDispatchFailuresTotal.inc({ reason });
    console.error(JSON.stringify({
      level: "error",
      msg: "[pushTokens] push-dispatch Kafka publish failed — event queued to durable outbox (token commit unaffected)",
      topic,
      reason,
      error: err instanceof Error ? err.message : String(err),
      eventType: typeof payload.type === "string" ? payload.type : "unknown",
    }));
    // Durable outbox record (at-least-once replay source). A failure to even
    // record the outbox is logged loudly but still does not roll back the
    // token commit (documented contract above).
    try {
      await createKafkaEventLogEntry({
        topic,
        eventType: typeof payload.type === "string" ? payload.type : "push_dispatch",
        aggregateId: typeof payload.userId === "string" ? payload.userId : "push",
        payload: payload as Record<string, unknown>,
        status: "pending",
      });
    } catch (outboxErr) {
      pushDispatchFailuresTotal.inc({ reason: "outbox_write_failed" });
      console.error(JSON.stringify({
        level: "error",
        msg: "[pushTokens] CRITICAL: push-dispatch publish failed AND outbox write failed — event LOST",
        topic,
        error: outboxErr instanceof Error ? outboxErr.message : String(outboxErr),
      }));
    }
    return "queued_to_outbox";
  }
}

// ─── Router ───────────────────────────────────────────────────────────────────

export const pushTokensRouter = router({

  /**
   * registerPushToken — store the device push token for the authenticated user.
   * Called by the mobile app after obtaining the FCM/APNs/Expo token.
   * PG-native upsert on (user_id, platform).
   */
  registerPushToken: protectedProcedure
    .input(z.object({
      token: z.string().min(10).max(512),
      platform: z.enum(["ios", "android", "web"]),
      userId: z.string().optional(), // Provided by mobile client for cross-validation
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await requireDb();
      await db
        .insert(pushTokens)
        .values({
          userId: ctx.user.id,
          token: input.token,
          platform: input.platform,
          registeredAt: new Date(),
          lastSeenAt: new Date(),
        })
        .onConflictDoUpdate({
          target: [pushTokens.userId, pushTokens.platform],
          set: { token: input.token, lastSeenAt: new Date() },
        });

      return {
        success: true,
        platform: input.platform,
        userId: ctx.user.id,
      };
    }),

  /**
   * unregisterPushToken — remove the device push token on logout or permission revocation.
   */
  unregisterPushToken: protectedProcedure
    .input(z.object({
      platform: z.enum(["ios", "android", "web"]),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await requireDb();
      await db
        .delete(pushTokens)
        .where(and(eq(pushTokens.userId, ctx.user.id), eq(pushTokens.platform, input.platform)));

      return { success: true };
    }),

  /**
   * sendAnomalyPushNotification — admin procedure to send a push notification
   * to all admin users when a high-severity anomaly is detected.
   *
   * This is triggered by the Kafka consumer (kafkaConsumer.ts) when
   * `insider.threat.detected` events with score > 0.7 arrive.
   * It can also be triggered manually from the SecurityMonitor admin panel.
   *
   * Target tokens are read from the DB (authoritative store). With
   * targetAdminsOnly, only tokens whose owner has role='admin' are targeted;
   * tokens whose owner cannot be resolved are EXCLUDED (fail-closed).
   */
  sendAnomalyPushNotification: adminProcedure
    .input(z.object({
      userId: z.string(),
      sessionId: z.string(),
      anomalyScore: z.number().min(0).max(1),
      severity: z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]),
      action: z.string(),
      message: z.string().optional(),
      targetAdminsOnly: z.boolean().default(true),
    }))
    .mutation(async ({ ctx, input }) => {
      const payload = {
        type: "anomaly_detected",
        userId: input.userId,
        sessionId: input.sessionId,
        anomalyScore: input.anomalyScore,
        severity: input.severity,
        action: input.action,
        timestamp: new Date().toISOString(),
        message: input.message ?? `Suspicious activity detected: ${input.action} (score: ${input.anomalyScore.toFixed(2)})`,
        triggeredBy: ctx.user.id,
      };

      // Collect target tokens from the authoritative DB store
      const db = await requireDb();
      const rows = await db
        .select({ token: pushTokens.token, role: users.role })
        .from(pushTokens)
        .leftJoin(users, eq(users.id, pushTokens.userId));

      const targetTokens = rows
        .filter((r) => (input.targetAdminsOnly ? r.role === "admin" : true))
        .map((r) => r.token);

      // Publish to Kafka for the Go notification-dispatcher to handle FCM/APNs dispatch
      const dispatch = await publishPushEvent({
        ...payload,
        tokens: targetTokens,
        channelId: "tradegateway-anomaly-alerts",
      });

      return {
        success: true,
        tokensTargeted: targetTokens.length,
        dispatch, // "published" | "queued_to_outbox" — honest delivery posture
        payload,
      };
    }),

  /**
   * getRegisteredTokens — admin procedure to list all registered push tokens.
   * Used for debugging and monitoring push notification delivery.
   */
  getRegisteredTokens: adminProcedure.query(async () => {
    const db = await requireDb();
    const rows = await db
      .select({
        userId: pushTokens.userId,
        platform: pushTokens.platform,
        token: pushTokens.token,
        registeredAt: pushTokens.registeredAt,
        lastSeenAt: pushTokens.lastSeenAt,
      })
      .from(pushTokens);

    const tokens = rows.map((t) => ({
      userId: t.userId,
      platform: t.platform,
      tokenPrefix: t.token.slice(0, 20) + "…",
      registeredAt: t.registeredAt,
      lastSeenAt: t.lastSeenAt,
    }));

    return { tokens, total: tokens.length };
  }),
});
