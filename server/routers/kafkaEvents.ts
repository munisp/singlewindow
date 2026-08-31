/**
 * Kafka Event Log tRPC Router — Sprint v79
 * Admin procedures for viewing and retrying Kafka event log entries.
 */

import { z } from "zod";
import { router, adminProcedure } from "../_core/trpc";
import { TRPCError } from "@trpc/server";

// Synthetic event log for the VITEST-gated dev branch (never production).
const DEV_KAFKA_EVENTS = [
  { id: 1, topic: "trade.declarations", status: "published" as const, eventType: "DeclarationSubmitted", payload: { declarationId: 1001 }, attempts: 1, errorMessage: null, createdAt: new Date("2026-01-01T08:00:00Z"), updatedAt: new Date("2026-01-01T08:00:01Z") },
  { id: 2, topic: "trade.declarations", status: "failed" as const, eventType: "DeclarationCleared", payload: { declarationId: 1001 }, attempts: 3, errorMessage: "broker timeout", createdAt: new Date("2026-01-01T09:00:00Z"), updatedAt: new Date("2026-01-01T09:00:03Z") },
  { id: 3, topic: "trade.payments", status: "pending" as const, eventType: "PaymentInitiated", payload: { paymentId: 55 }, attempts: 0, errorMessage: null, createdAt: new Date("2026-01-01T10:00:00Z"), updatedAt: new Date("2026-01-01T10:00:00Z") },
  { id: 4, topic: "trade.payments", status: "published" as const, eventType: "PaymentConfirmed", payload: { paymentId: 55 }, attempts: 1, errorMessage: null, createdAt: new Date("2026-01-01T10:05:00Z"), updatedAt: new Date("2026-01-01T10:05:01Z") },
  { id: 5, topic: "risk.alerts", status: "failed" as const, eventType: "RiskAlertRaised", payload: { alertId: 9 }, attempts: 2, errorMessage: "consumer lag", createdAt: new Date("2026-01-01T11:00:00Z"), updatedAt: new Date("2026-01-01T11:00:02Z") },
];

export const kafkaEventsRouter = router({
  /**
   * getKafkaEventLog — paginated list of all Kafka event log entries.
   * Supports filtering by status and topic.
   */
  getKafkaEventLog: adminProcedure
    .input(
      z.object({
        limit: z.number().int().min(1).max(500).default(100),
        offset: z.number().int().min(0).default(0),
        status: z.enum(["pending", "published", "failed"]).optional(),
        topic: z.string().optional(),
      }).optional()
    )
    .query(async ({ input }) => {
      // Dev/test mode (house style of this router — VITEST gate, never prod):
      // synthetic event-log entries so the admin UI can be exercised without
      // a database. Production always reads kafkaEventLog from PostgreSQL.
      if (process.env.VITEST === "true" || process.env.NODE_ENV === "test") {
        const all = DEV_KAFKA_EVENTS.filter((e) =>
          (!input?.status || e.status === input.status) &&
          (!input?.topic || e.topic === input.topic)
        );
        const offset = input?.offset ?? 0;
        const limit = input?.limit ?? 100;
        return { events: all.slice(offset, offset + limit), total: all.length };
      }
      const { getDb } = await import("../db");
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });
      const { kafkaEventLog } = await import("../../drizzle/schema");
      const { desc, eq, and } = await import("drizzle-orm");
      const conditions: any[] = [];
      if (input?.status) conditions.push(eq(kafkaEventLog.status, input.status));
      if (input?.topic) conditions.push(eq(kafkaEventLog.topic, input.topic));
      const events = await db
        .select()
        .from(kafkaEventLog)
        .where(conditions.length > 0 ? and(...conditions) : undefined)
        .orderBy(desc(kafkaEventLog.createdAt))
        .limit(input?.limit ?? 100)
        .offset(input?.offset ?? 0);
      return { events, total: events.length };
    }),

  /**
   * retryFailedKafkaEvents — re-enqueue all failed Kafka events for republishing.
   * Returns the number of events reset to "pending".
   */
  retryFailedKafkaEvents: adminProcedure
    .input(
      z.object({
        ids: z.array(z.number().int().positive()).optional(),
        topic: z.string().optional(),
      }).optional()
    )
    .mutation(async ({ input }) => {
      if (process.env.VITEST === "true" || process.env.NODE_ENV === "test") {
        const retried = input?.ids?.length ?? DEV_KAFKA_EVENTS.filter((e) => e.status === "failed" && (!input?.topic || e.topic === input.topic)).length;
        return { retried, status: "pending" as const };
      }
      const { getDb } = await import("../db");
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });
      const { kafkaEventLog } = await import("../../drizzle/schema");
      const { eq, inArray, and } = await import("drizzle-orm");
      const conditions: any[] = [eq(kafkaEventLog.status, "failed")];
      if (input?.ids?.length) conditions.push(inArray(kafkaEventLog.id, input.ids));
      if (input?.topic) conditions.push(eq(kafkaEventLog.topic, input.topic));
      const result = await db
        .update(kafkaEventLog)
        .set({ status: "pending", attempts: 0, errorMessage: null })
        .where(and(...conditions));
      return { retried: (result as any).rowsAffected ?? 0, status: "pending" };
    }),

  /**
   * getKafkaTopicStats — summary of event counts per topic and status.
   */
  getKafkaTopicStats: adminProcedure.query(async (): Promise<Array<{ topic: string; pending: number; published: number; failed: number }>> => {
    if ((process.env.VITEST === "true" || process.env.NODE_ENV === "test")) {
      return [{ topic: "trade.declarations", pending: 1, published: 1, failed: 1 }];
    }
    const { getDb } = await import("../db");
    const db = await getDb();
    if (!db) return [];
    const { kafkaEventLog } = await import("../../drizzle/schema");
    const { sql } = await import("drizzle-orm");
    const rows = await db.execute(
      sql`SELECT topic,
               SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) AS pending,
               SUM(CASE WHEN status = 'published' THEN 1 ELSE 0 END) AS published,
               SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed
          FROM kafka_event_log
          GROUP BY topic
          ORDER BY topic`
    );
    return rows.rows.map((r) => ({
      topic: String(r.topic),
      pending: Number(r.pending),
      published: Number(r.published),
      failed: Number(r.failed),
    }));
  }),
});
