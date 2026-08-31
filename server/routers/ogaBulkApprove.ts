import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, adminProcedure } from "../_core/trpc";
import { getDb } from "../db";
import { ogaPermits, ogaBulkActions, declarations } from "../../drizzle/schema";
import { inArray, desc, eq } from "drizzle-orm";
import { createUserNotification } from "../db";
import { consumeFourEyesApproval } from "../_core/fourEyes";

// SW-28: batches above this size require an approved dual-control request.
const FOUR_EYES_THRESHOLD = 10;
// Only permits in these states may be approved (per-permit validation).
const APPROVABLE_STATUSES = ["pending", "under_review", "docs_required"];

export const ogaBulkApproveRouter = router({
  bulkApprove: adminProcedure
    .input(z.object({
      permitIds: z.array(z.number().int()).min(1).max(100),
      notes: z.string().max(500).optional(),
    }))
    .input(z.object({
      // SW-28: required when the batch exceeds FOUR_EYES_THRESHOLD.
      approvalId: z.number().int().positive().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database unavailable");

      // SW-28: four-eyes for large batches (100 permits/click was unaudited).
      if (input.permitIds.length > FOUR_EYES_THRESHOLD) {
        await consumeFourEyesApproval({
          action: "oga_bulk_approve",
          entityType: "oga_permit_batch",
          entityId: [...input.permitIds].sort((a, b) => a - b).join(","),
          approvalId: input.approvalId,
        });
      }

      const permits = await db.select().from(ogaPermits).where(inArray(ogaPermits.id, input.permitIds));

      // SW-28: per-permit validation — unknown ids fail the request; permits not
      // in an approvable state are skipped and reported, never silently approved.
      const foundIds = new Set(permits.map((p) => p.id));
      const unknownIds = input.permitIds.filter((id) => !foundIds.has(id));
      if (unknownIds.length > 0) {
        throw new TRPCError({ code: "NOT_FOUND", message: `Unknown permit ids: ${unknownIds.join(", ")}` });
      }
      const eligible = permits.filter((p) => APPROVABLE_STATUSES.includes(p.status));
      const skipped = permits
        .filter((p) => !APPROVABLE_STATUSES.includes(p.status))
        .map((p) => ({ permitId: p.id, status: p.status }));
      if (eligible.length === 0) {
        return { success: false, updated: 0, skipped, message: "No permits in an approvable state" };
      }

      await db.update(ogaPermits)
        .set({ status: "approved", respondedAt: new Date(), reviewNotes: input.notes ?? null, updatedAt: new Date() })
        .where(inArray(ogaPermits.id, eligible.map((p) => p.id)));

      // Log bulk action (real eligible set, not the requested count)
      await db.insert(ogaBulkActions).values({
        performedBy: ctx.user.id,
        action: "bulk_approve",
        permitIds: eligible.map((p) => p.id),
        notes: input.notes ?? null,
      });

      // SW-28: notify the TRADERS (looked up from their declarations), not the
      // approver; and sync declaration status when all permits are approved.
      const declarationIds = [...new Set(eligible.map((p) => p.declarationId))];
      // Batch the per-declaration lookups (was 2 queries per declaration — N+1):
      // one fetch for the declarations, one for all their permits.
      const declRows = declarationIds.length > 0
        ? await db.select().from(declarations).where(inArray(declarations.id, declarationIds))
        : [];
      const declById = new Map(declRows.map((d) => [d.id, d]));
      const permitRows = declarationIds.length > 0
        ? await db.select().from(ogaPermits).where(inArray(ogaPermits.declarationId, declarationIds))
        : [];
      const permitsByDeclId = new Map<number, typeof permitRows>();
      for (const p of permitRows) {
        const arr = permitsByDeclId.get(p.declarationId) ?? [];
        arr.push(p);
        permitsByDeclId.set(p.declarationId, arr);
      }
      for (const declId of declarationIds) {
        const decl = declById.get(declId);
        if (!decl) continue;
        const approvedCount = eligible.filter((p) => p.declarationId === declId).length;
        await createUserNotification({
          userId: decl.traderId,
          type: "permit_approved",
          title: "OGA Permit Approved",
          body: `${approvedCount} permit(s) approved for declaration #${declId}.`,
        });

        // Declaration status sync: mirrors the OGA webhook contract — when ALL
        // permits for the declaration are approved, the declaration clears.
        const allPermits = permitsByDeclId.get(declId) ?? [];
        const allApproved = allPermits.length > 0 && allPermits.every((p) => p.status === "approved");
        if (allApproved && decl.status !== "cleared") {
          await db.update(declarations)
            .set({ status: "cleared", updatedAt: new Date() })
            .where(eq(declarations.id, declId));
        }
      }
      return { success: true, updated: eligible.length, skipped };
    }),

  bulkReject: adminProcedure
    .input(z.object({
      permitIds: z.array(z.number().int()).min(1).max(100),
      notes: z.string().max(500),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database unavailable");
      await db.update(ogaPermits)
        .set({ status: "rejected", respondedAt: new Date(), reviewNotes: input.notes, updatedAt: new Date() })
        .where(inArray(ogaPermits.id, input.permitIds));
      await db.insert(ogaBulkActions).values({
        performedBy: ctx.user.id,
        action: "bulk_reject",
        permitIds: input.permitIds,
        notes: input.notes,
      });
      return { success: true, updated: input.permitIds.length };
    }),

  listBulkActions: adminProcedure.query(async () => {
    const db = await getDb();
    if (!db) throw new Error("Database unavailable");
    return db.select().from(ogaBulkActions).orderBy(desc(ogaBulkActions.createdAt)).limit(50);
  }),
});
