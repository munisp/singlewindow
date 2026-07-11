/**
 * ogaPermitAudit.ts — tRPC router for OGA Permit Audit Trail
 * Sprint v79 — OGA Permit audit trail procedures.
 *
 * Procedures:
 *   ogaPermitAudit.getEventsByPermit       — event timeline for a specific permit
 *   ogaPermitAudit.getEventsByDeclaration  — all permit events for a declaration
 *   ogaPermitAudit.getRecentEvents         — admin: paginated recent events across all permits
 */

import { z } from "zod";
import { router, adminProcedure, protectedProcedure } from "../_core/trpc";
import { TRPCError } from "@trpc/server";

const AGENCIES = ["FDA", "EPA", "MOFEP", "CEPS", "NACOC", "GFZA", "GCAA", "NPA", "DVLA", "GSA"];
const EVENT_TYPES = ["REQUESTED", "SUBMITTED", "UNDER_REVIEW", "APPROVED", "REJECTED", "EXPIRED", "RENEWED", "REVOKED"];
const STATUS_PAIRS: Array<[string, string]> = [
  ["", "REQUESTED"],
  ["REQUESTED", "SUBMITTED"],
  ["SUBMITTED", "UNDER_REVIEW"],
  ["UNDER_REVIEW", "APPROVED"],
];

function mockPermitEvents(permitId: number) {
  return STATUS_PAIRS.map(([prev, next], i) => ({
    id: i + 1,
    permitId,
    declarationId: 1000 + permitId,
    agencyCode: AGENCIES[permitId % AGENCIES.length],
    eventType: EVENT_TYPES[i],
    previousStatus: prev || null,
    newStatus: next,
    actorId: i > 1 ? 200 + i : null,
    actorType: i > 1 ? "officer" : "system",
    remarks: i === 3 ? "All documents verified. Permit approved." : null,
    metadata: {},
    kafkaOffset: 1000 + i,
    kafkaPartition: 0,
    createdAt: new Date(Date.now() - (3 - i) * 3_600_000),
  }));
}

export const ogaPermitAuditRouter = router({
  /**
   * getEventsByPermit — chronological event timeline for a specific OGA permit.
   */
  getEventsByPermit: protectedProcedure
    .input(z.object({ permitId: z.number().int().positive() }))
    .query(async ({ input }) => {
      if (process.env.NODE_ENV !== "production") {
        return mockPermitEvents(input.permitId);
      }
      const { getOgaPermitEventsByPermit } = await import("../db");
      return getOgaPermitEventsByPermit(input.permitId);
    }),

  /**
   * getEventsByDeclaration — all OGA permit events linked to a declaration.
   */
  getEventsByDeclaration: protectedProcedure
    .input(z.object({ declarationId: z.number().int().positive() }))
    .query(async ({ input }) => {
      if (process.env.NODE_ENV !== "production") {
        // Return events for 3 mock permits
        return [1, 2, 3].flatMap((permitId) =>
          mockPermitEvents(permitId).map((e) => ({
            ...e,
            declarationId: input.declarationId,
            permitId,
          }))
        );
      }
      const { getOgaPermitEventsByDeclaration } = await import("../db");
      return getOgaPermitEventsByDeclaration(input.declarationId);
    }),

  /**
   * getRecentEvents — admin: paginated recent permit events across all agencies.
   */
  getRecentEvents: adminProcedure
    .input(
      z.object({
        limit: z.number().int().min(1).max(500).default(50),
        offset: z.number().int().min(0).default(0),
        agencyCode: z.string().optional(),
        eventType: z.enum([
          "REQUESTED", "SUBMITTED", "UNDER_REVIEW", "APPROVED",
          "REJECTED", "EXPIRED", "RENEWED", "REVOKED",
        ]).optional(),
      }).optional()
    )
    .query(async ({ input }) => {
      if (process.env.NODE_ENV !== "production") {
        const rows = Array.from({ length: 30 }, (_, i) => ({
          id: i + 1,
          permitId: 100 + i,
          declarationId: 1000 + i,
          agencyCode: AGENCIES[i % AGENCIES.length],
          eventType: EVENT_TYPES[i % EVENT_TYPES.length],
          previousStatus: i > 0 ? EVENT_TYPES[(i - 1) % EVENT_TYPES.length] : null,
          newStatus: EVENT_TYPES[i % EVENT_TYPES.length],
          actorId: i % 3 === 0 ? null : 200 + i,
          actorType: i % 3 === 0 ? "system" : "officer",
          remarks: i % 5 === 0 ? "Routine processing" : null,
          metadata: {},
          kafkaOffset: 5000 + i,
          kafkaPartition: i % 3,
          createdAt: new Date(Date.now() - i * 300_000),
        }));
        const filtered = rows.filter((r) => {
          if (input?.agencyCode && r.agencyCode !== input.agencyCode) return false;
          if (input?.eventType && r.eventType !== input.eventType) return false;
          return true;
        });
        return {
          events: filtered.slice(input?.offset ?? 0, (input?.offset ?? 0) + (input?.limit ?? 50)),
          total: filtered.length,
        };
      }
      const { getDb } = await import("../db");
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });
      const { ogaPermitEvents } = await import("../../drizzle/schema");
      const { desc, eq, and } = await import("drizzle-orm");
      const conditions: any[] = [];
      if (input?.agencyCode) conditions.push(eq(ogaPermitEvents.agencyCode, input.agencyCode));
      if (input?.eventType) conditions.push(eq(ogaPermitEvents.eventType, input.eventType));
      const events = await db
        .select()
        .from(ogaPermitEvents)
        .where(conditions.length > 0 ? and(...conditions) : undefined)
        .orderBy(desc(ogaPermitEvents.createdAt))
        .limit(input?.limit ?? 50)
        .offset(input?.offset ?? 0);
      return { events, total: events.length };
    }),

  /**
   * getAgencyStats — summary of permit event counts per agency.
   */
  getAgencyStats: adminProcedure.query(async (): Promise<Array<{
    agencyCode: string;
    total: number;
    approved: number;
    rejected: number;
    pending: number;
  }>> => {
    if (process.env.NODE_ENV !== "production") {
      return AGENCIES.slice(0, 6).map((agencyCode) => ({
        agencyCode,
        total: Math.floor(Math.random() * 100) + 20,
        approved: Math.floor(Math.random() * 60) + 10,
        rejected: Math.floor(Math.random() * 10) + 1,
        pending: Math.floor(Math.random() * 20) + 2,
      }));
    }
    const { getDb } = await import("../db");
    const db = await getDb();
    if (!db) return [];
    const { ogaPermitEvents } = await import("../../drizzle/schema");
    const { sql } = await import("drizzle-orm");
    const rows = await db.execute(
      sql`SELECT agency_code AS "agencyCode",
               COUNT(*) AS total,
               SUM(CASE WHEN new_status = 'APPROVED' THEN 1 ELSE 0 END) AS approved,
               SUM(CASE WHEN new_status = 'REJECTED' THEN 1 ELSE 0 END) AS rejected,
               SUM(CASE WHEN new_status IN ('REQUESTED','SUBMITTED','UNDER_REVIEW') THEN 1 ELSE 0 END) AS pending
          FROM oga_permit_events
          GROUP BY agency_code
          ORDER BY total DESC`
    );
    return ((rows as unknown) as any[]).map((r) => ({
      agencyCode: String(r.agencyCode),
      total: Number(r.total),
      approved: Number(r.approved),
      rejected: Number(r.rejected),
      pending: Number(r.pending),
    }));
  }),
});
