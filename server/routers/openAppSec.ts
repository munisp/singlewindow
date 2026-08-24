/**
 * OpenAppSec WAF Events tRPC Router — Sprint v81
 * Admin/security procedures for WAF event monitoring and triage.
 *
 * All procedures read directly from the openAppSecEvents table in PostgreSQL.
 * WAF events are ingested via the Kafka consumer (topic: waf-events) which
 * receives events from the OpenAppSec agent running alongside APISIX.
 * No mock data — returns empty results when no events exist.
 */
import { z } from "zod";
import { router, keycloakAdminProcedure } from "../_core/trpc";
import { TRPCError } from "@trpc/server";
import { getDb, getOpenAppSecEvents, acknowledgeOpenAppSecEvent, getOpenAppSecEventStats } from "../db";
import { openAppSecEvents } from "../../drizzle/schema";
import { gte, sql } from "drizzle-orm";
import { getWafIngestionHealth } from "../kafkaConsumer";
import { WAF_ATTACK_TYPES, WAF_SEVERITIES } from "../wafEventSchema";

export const openAppSecRouter = router({
  /**
   * getWafEvents — paginated list of WAF security events from the database.
   * Events are ingested from the OpenAppSec agent via Kafka → PostgreSQL.
   */
  getWafEvents: keycloakAdminProcedure
    .input(
      z.object({
        limit: z.number().int().min(1).max(500).default(50),
        offset: z.number().int().min(0).default(0),
        severity: z.enum(WAF_SEVERITIES).optional(),
        attackType: z.string().optional(),
        isAcknowledged: z.boolean().optional(),
        sourceIp: z.string().optional(),
      }).optional()
    )
    .query(async ({ input }) => {
      const events = await getOpenAppSecEvents({
        limit: input?.limit,
        offset: input?.offset,
        severity: input?.severity,
        attackType: input?.attackType,
        isAcknowledged: input?.isAcknowledged,
      });

      // Get total count for pagination
      const db = await getDb();
      let total = events.length;
      if (db) {
        try {
          const [countRow] = await db
            .select({ count: sql<number>`count(*)::int` })
            .from(openAppSecEvents);
          total = countRow?.count ?? events.length;
        } catch {
          // Non-fatal — use events.length as fallback
        }
      }

      return { events, total };
    }),

  /**
   * acknowledgeEvent — mark a WAF event as acknowledged by the current admin.
   */
  acknowledgeEvent: keycloakAdminProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ input, ctx }) => {
      const row = await acknowledgeOpenAppSecEvent(input.id, ctx.user.id);
      if (!row) throw new TRPCError({ code: "NOT_FOUND", message: `WAF event ${input.id} not found` });
      return { success: true, id: row.id, acknowledgedBy: row.acknowledgedBy };
    }),

  /**
   * bulkAcknowledge — acknowledge multiple WAF events at once.
   */
  bulkAcknowledge: keycloakAdminProcedure
    .input(z.object({ ids: z.array(z.number().int().positive()).min(1).max(200) }))
    .mutation(async ({ input, ctx }) => {
      const results = await Promise.allSettled(
        input.ids.map((id) => acknowledgeOpenAppSecEvent(id, ctx.user.id))
      );
      const acknowledged = results.filter(r => r.status === "fulfilled" && r.value !== null).length;
      return { success: true, acknowledged };
    }),

  /**
   * getWafStats — summary counts by severity + unacknowledged total.
   */
  getWafStats: keycloakAdminProcedure
    .query(async () => {
      const ingestion = getWafIngestionHealth();
      if (ingestion.status !== "healthy") {
        throw new TRPCError({
          code: "SERVICE_UNAVAILABLE",
          message: `WAF ingestion ${ingestion.status} — ${ingestion.lastEventAt ?? "no event received"}`,
        });
      }
      const stats = await getOpenAppSecEventStats();
      if (!stats) throw new TRPCError({ code: "SERVICE_UNAVAILABLE", message: "WAF ingestion database unavailable" });
      return stats;
    }),

  getWafIngestionHealth: keycloakAdminProcedure.query(() => getWafIngestionHealth()),

  /**
   * getAttackTypes — list of distinct attack types for filter dropdowns.
   */
  getAttackTypes: keycloakAdminProcedure
    .query(async () => {
      // Return the canonical list; in production these are also distinct values from the DB
      const db = await getDb();
      if (db) {
        try {
          const rows = await db
            .selectDistinct({ attackType: openAppSecEvents.attackType })
            .from(openAppSecEvents)
            .orderBy(openAppSecEvents.attackType);
          const dbTypes = rows.map(r => r.attackType).filter(Boolean) as string[];
          if (dbTypes.length > 0) return dbTypes;
        } catch {
          // Fall through to static list
        }
      }
      return [...WAF_ATTACK_TYPES];
    }),

  /**
   * getWafTrend — daily event counts by severity for the last N days.
   * Aggregates from the openAppSecEvents table grouped by date and severity.
   */
  getWafTrend: keycloakAdminProcedure
    .input(z.object({ days: z.number().int().min(7).max(90).default(30) }).optional())
    .query(async ({ input }) => {
      const days = input?.days ?? 30;
      const db = await getDb();
      if (!db) return [];

      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - days);

      const rows = await db
        .select({
          date: sql<string>`DATE(${openAppSecEvents.createdAt})`,
          severity: openAppSecEvents.severity,
          count: sql<number>`COUNT(*)::int`,
        })
        .from(openAppSecEvents)
        .where(gte(openAppSecEvents.createdAt, cutoff))
        .groupBy(sql`DATE(${openAppSecEvents.createdAt})`, openAppSecEvents.severity)
        .orderBy(sql`DATE(${openAppSecEvents.createdAt})`);

      const map = new Map<string, { date: string; critical: number; high: number; medium: number; low: number }>();
      for (const row of rows) {
        if (!map.has(row.date)) map.set(row.date, { date: row.date, critical: 0, high: 0, medium: 0, low: 0 });
        const entry = map.get(row.date)!;
        const sev = (row.severity ?? "").toLowerCase();
        if (["critical", "high", "medium", "low"].includes(sev)) {
          (entry as unknown as Record<string, number>)[sev] = Number(row.count);
        }
      }

      return Array.from(map.values());
    }),
});
