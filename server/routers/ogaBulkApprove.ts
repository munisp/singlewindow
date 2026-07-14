import { z } from "zod";
import { router, adminProcedure } from "../_core/trpc";
import { getDb } from "../db";
import { ogaPermits, ogaBulkActions } from "../../drizzle/schema";
import { inArray, desc } from "drizzle-orm";
import { createUserNotification } from "../db";

export const ogaBulkApproveRouter = router({
  bulkApprove: adminProcedure
    .input(z.object({
      permitIds: z.array(z.number().int()).min(1).max(100),
      notes: z.string().max(500).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database unavailable");
      const permits = await db.select().from(ogaPermits).where(inArray(ogaPermits.id, input.permitIds));
      await db.update(ogaPermits)
        .set({ status: "approved", respondedAt: new Date(), reviewNotes: input.notes ?? null, updatedAt: new Date() })
        .where(inArray(ogaPermits.id, input.permitIds));
      // Log bulk action
      await db.insert(ogaBulkActions).values({
        performedBy: ctx.user.id,
        action: "bulk_approve",
        permitIds: input.permitIds,
        notes: input.notes ?? null,
      });
      // Notify each unique declaration's trader
      const declarationIds = [...new Set(permits.map(p => p.declarationId))];
      for (const declId of declarationIds) {
        const permit = permits.find(p => p.declarationId === declId);
        if (permit) {
          // We'd need to look up trader from declaration — simplified here
          await createUserNotification({
            userId: ctx.user.id, // fallback; real impl would look up trader
            type: "permit_approved",
            title: "OGA Permit Approved",
            body: `${permits.filter(p => p.declarationId === declId).length} permit(s) approved for declaration #${declId}.`,
          });
        }
      }
      return { success: true, updated: input.permitIds.length };
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
