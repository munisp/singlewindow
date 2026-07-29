/**
 * ogaPermitAudit.ts — tRPC router for OGA Permit Audit Trail
 * Sprint v79 — OGA Permit audit trail procedures.
 *
 * All procedures read directly from the database (ogaPermitEvents table).
 * No mock data — returns empty arrays when no events exist.
 *
 * Procedures:
 *   ogaPermitAudit.getEventsByPermit       — event timeline for a specific permit
 *   ogaPermitAudit.getEventsByDeclaration  — all permit events for a declaration
 *   ogaPermitAudit.getRecentEvents         — admin: paginated recent events across all permits
 *   ogaPermitAudit.getAgencyStats          — summary counts per agency
 *   ogaPermitAudit.bulkApprovePermits      — admin: bulk approve multiple permits
 */

import { z } from "zod";
import { router, adminProcedure, protectedProcedure } from "../_core/trpc";
import { TRPCError } from "@trpc/server";
import { getDb, getOgaPermitEventsByPermit, getOgaPermitEventsByDeclaration } from "../db";
import { ogaPermitEvents, ogaPermits } from "../../drizzle/schema";
import { desc, eq, and, inArray, sql } from "drizzle-orm";

export const ogaPermitAuditRouter = router({
  /**
   * getEventsByPermit — chronological event timeline for a specific OGA permit.
   * Returns events from the ogaPermitEvents table ordered by creation time.
   */
  getEventsByPermit: protectedProcedure
    .input(z.object({ permitId: z.number().int().positive() }))
    .query(async ({ input }) => {
      return getOgaPermitEventsByPermit(input.permitId);
    }),

  /**
   * getEventsByDeclaration — all OGA permit events linked to a declaration.
   * Joins through ogaPermits to find all events for permits on this declaration.
   */
  getEventsByDeclaration: protectedProcedure
    .input(z.object({ declarationId: z.number().int().positive() }))
    .query(async ({ input }) => {
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
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

      const conditions: ReturnType<typeof eq>[] = [];
      if (input?.agencyCode) conditions.push(eq(ogaPermitEvents.agencyCode, input.agencyCode));
      if (input?.eventType) conditions.push(eq(ogaPermitEvents.eventType, input.eventType));

      const events = await db
        .select()
        .from(ogaPermitEvents)
        .where(conditions.length > 0 ? and(...conditions) : undefined)
        .orderBy(desc(ogaPermitEvents.createdAt))
        .limit(input?.limit ?? 50)
        .offset(input?.offset ?? 0);

      // Get total count for pagination
      const [countRow] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(ogaPermitEvents)
        .where(conditions.length > 0 ? and(...conditions) : undefined);

      return {
        events,
        total: countRow?.count ?? events.length,
      };
    }),

  /**
   * getAgencyStats — summary of permit event counts per agency.
   * Aggregates approved, rejected, and pending counts from the ogaPermitEvents table.
   */
  getAgencyStats: adminProcedure.query(async (): Promise<Array<{
    agencyCode: string;
    total: number;
    approved: number;
    rejected: number;
    pending: number;
  }>> => {
    const db = await getDb();
    if (!db) return [];

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

    return ((rows as unknown) as Array<Record<string, unknown>>).map((r) => ({
      agencyCode: String(r.agencyCode ?? r.agency_code ?? ""),
      total: Number(r.total),
      approved: Number(r.approved),
      rejected: Number(r.rejected),
      pending: Number(r.pending),
    }));
  }),

  /**
   * bulkApprovePermits — admin: approve multiple OGA permits in one operation.
   * Requires admin, customs_officer, or oga_officer role.
   */
  bulkApprovePermits: protectedProcedure
    .input(z.object({
      permitIds: z.array(z.number().int().positive()).min(1).max(100),
      reviewNotes: z.string().max(500).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const isAdmin = ["admin", "customs_officer", "oga_officer"].includes(ctx.user.role);
      if (!isAdmin) throw new TRPCError({ code: "FORBIDDEN" });

      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      const updated = await db.update(ogaPermits)
        .set({
          status: "approved",
          reviewNotes: input.reviewNotes ?? null,
          respondedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(inArray(ogaPermits.id, input.permitIds))
        .returning({ id: ogaPermits.id });

      return { approvedCount: updated.length, ids: updated.map(r => r.id) };
    }),
});
