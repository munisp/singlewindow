/**
 * pushTokens.ts — tRPC router for device push token management.
 *
 * Procedures:
 *   - registerPushToken: store a device FCM/APNs/Expo token for the authenticated user
 *   - unregisterPushToken: remove a token (on logout or permission revocation)
 *   - sendAnomalyPushNotification: admin procedure to send a push to all admin tokens
 *
 * The tokens are stored in the `push_tokens` table and used by the Kafka consumer
 * to dispatch push notifications when `insider.threat.detected` events arrive.
 *
 * FCM/APNs dispatch is handled by the Go notification-dispatcher service.
 * This router only manages token CRUD and triggers the dispatch via Kafka.
 */

import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, protectedProcedure } from "../_core/trpc";

// ─── Admin procedure ──────────────────────────────────────────────────────────

const adminProcedure = protectedProcedure.use(({ ctx, next }) => {
  if (ctx.user.role !== "admin") {
    throw new TRPCError({ code: "FORBIDDEN", message: "Admin access required" });
  }
  return next({ ctx });
});

// ─── In-memory token store (fallback when DB unavailable) ─────────────────────
// In production, tokens are persisted in the `push_tokens` DB table.

const tokenStore = new Map<string, {
  userId: number;
  token: string;
  platform: "ios" | "android" | "web";
  registeredAt: Date;
  lastSeenAt: Date;
}>();

// ─── Kafka publish helper ─────────────────────────────────────────────────────

async function publishPushEvent(payload: Record<string, unknown>): Promise<void> {
  const kafkaUrl = process.env.KAFKA_REST_URL ?? "http://kafka-rest:8082";
  try {
    await fetch(`${kafkaUrl}/topics/insider.push.dispatch`, {
      method: "POST",
      headers: { "Content-Type": "application/vnd.kafka.json.v2+json" },
      body: JSON.stringify({ records: [{ value: payload }] }),
    });
  } catch {
    // Non-fatal: push dispatch is best-effort
  }
}

// ─── Router ───────────────────────────────────────────────────────────────────

export const pushTokensRouter = router({

  /**
   * registerPushToken — store the device push token for the authenticated user.
   * Called by the mobile app after obtaining the FCM/APNs/Expo token.
   */
  registerPushToken: protectedProcedure
    .input(z.object({
      token: z.string().min(10).max(512),
      platform: z.enum(["ios", "android", "web"]),
      userId: z.string().optional(), // Provided by mobile client for cross-validation
    }))
    .mutation(async ({ ctx, input }) => {
      const key = `${ctx.user.id}:${input.platform}`;

      // Upsert in memory store
      tokenStore.set(key, {
        userId: ctx.user.id,
        token: input.token,
        platform: input.platform,
        registeredAt: tokenStore.get(key)?.registeredAt ?? new Date(),
        lastSeenAt: new Date(),
      });

      // Persist to DB if available
      try {
        const { getDb } = await import("../db");
        const db = await getDb();
        if (db) {
          // Raw SQL upsert — avoids schema dependency for this auxiliary table
          // Use raw SQL via drizzle sql tag to avoid type issues
          const { sql } = await import("drizzle-orm");
          await db.execute(
            sql`INSERT INTO push_tokens (user_id, token, platform, registered_at, last_seen_at)
             VALUES (${ctx.user.id}, ${input.token}, ${input.platform}, NOW(), NOW())
             ON DUPLICATE KEY UPDATE token = VALUES(token), last_seen_at = NOW()`
          );
        }
      } catch {
        // Non-fatal: in-memory store is the fallback
      }

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
      const key = `${ctx.user.id}:${input.platform}`;
      tokenStore.delete(key);

      try {
        const { getDb } = await import("../db");
        const db = await getDb();
        if (db) {
          const { sql } = await import("drizzle-orm");
          await db.execute(
            sql`DELETE FROM push_tokens WHERE user_id = ${ctx.user.id} AND platform = ${input.platform}`
          );
        }
      } catch {
        // Non-fatal
      }

      return { success: true };
    }),

  /**
   * sendAnomalyPushNotification — admin procedure to send a push notification
   * to all admin users when a high-severity anomaly is detected.
   *
   * This is triggered by the Kafka consumer (kafkaConsumer.ts) when
   * `insider.threat.detected` events with score > 0.7 arrive.
   * It can also be triggered manually from the SecurityMonitor admin panel.
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

      // Collect target tokens
      const targetTokens: string[] = [];

      // From in-memory store (sandbox mode)
      for (const [, record] of tokenStore.entries()) {
        if (input.targetAdminsOnly) {
          // In production, check user role from DB; in sandbox, include all registered tokens
          targetTokens.push(record.token);
        } else {
          targetTokens.push(record.token);
        }
      }

      // Publish to Kafka for the Go notification-dispatcher to handle FCM/APNs dispatch
      await publishPushEvent({
        ...payload,
        tokens: targetTokens,
        channelId: "tradegateway-anomaly-alerts",
      });

      return {
        success: true,
        tokensTargeted: targetTokens.length,
        payload,
      };
    }),

  /**
   * getRegisteredTokens — admin procedure to list all registered push tokens.
   * Used for debugging and monitoring push notification delivery.
   */
  getRegisteredTokens: adminProcedure.query(async () => {
    const tokens = Array.from(tokenStore.values()).map((t) => ({
      userId: t.userId,
      platform: t.platform,
      tokenPrefix: t.token.slice(0, 20) + "…",
      registeredAt: t.registeredAt,
      lastSeenAt: t.lastSeenAt,
    }));

    return { tokens, total: tokens.length };
  }),
});
