/**
 * AEO Renewals Router — manage AEO certificate renewal workflow
 */
import { z } from "zod";
import { router, protectedProcedure, adminProcedure } from "../_core/trpc";
import { getDb } from "../db";
import { aeoRenewals, aeoApplications } from "../../drizzle/schema";
import { eq, and, lte, desc } from "drizzle-orm";
import { createUserNotification } from "../db";

export const aeoRenewalsRouter = router({
  /** List renewals for the current trader */
  myRenewals: protectedProcedure.query(async ({ ctx }) => {
    const db = await getDb();
    if (!db) throw new Error("Database unavailable");
    return db.select().from(aeoRenewals)
      .where(eq(aeoRenewals.traderId, ctx.user.id))
      .orderBy(desc(aeoRenewals.createdAt));
  }),

  /** Admin: list all pending renewals */
  listPending: adminProcedure.query(async () => {
    const db = await getDb();
    if (!db) throw new Error("Database unavailable");
    return db.select().from(aeoRenewals)
      .where(eq(aeoRenewals.status, "pending"))
      .orderBy(aeoRenewals.renewalDueDate);
  }),

  /** Trader: submit renewal documents */
  submit: protectedProcedure
    .input(z.object({ aeoApplicationId: z.number().int(), renewalDueDate: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database unavailable");
      const [existing] = await db.select().from(aeoRenewals)
        .where(and(eq(aeoRenewals.aeoApplicationId, input.aeoApplicationId), eq(aeoRenewals.traderId, ctx.user.id)))
        .limit(1);
      if (existing) {
        await db.update(aeoRenewals)
          .set({ status: "docs_submitted", submittedAt: new Date(), updatedAt: new Date() })
          .where(eq(aeoRenewals.id, existing.id));
        return { id: existing.id };
      }
      const [created] = await db.insert(aeoRenewals)
        .values({
          aeoApplicationId: input.aeoApplicationId,
          traderId: ctx.user.id,
          status: "docs_submitted",
          submittedAt: new Date(),
          renewalDueDate: new Date(input.renewalDueDate),
        })
        .returning({ id: aeoRenewals.id });
      return { id: created.id };
    }),

  /** Admin: approve or reject a renewal */
  review: adminProcedure
    .input(z.object({
      renewalId: z.number().int(),
      decision: z.enum(["approved", "rejected"]),
      reviewNotes: z.string().max(1000).optional(),
      expiryDate: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database unavailable");
      const [renewal] = await db.select().from(aeoRenewals).where(eq(aeoRenewals.id, input.renewalId)).limit(1);
      if (!renewal) throw new Error("Renewal not found");
      await db.update(aeoRenewals)
        .set({
          status: input.decision,
          reviewedAt: new Date(),
          reviewedBy: ctx.user.id,
          reviewNotes: input.reviewNotes ?? null,
          expiryDate: input.expiryDate ? new Date(input.expiryDate) : null,
          updatedAt: new Date(),
        })
        .where(eq(aeoRenewals.id, input.renewalId));
      // Notify trader
      await createUserNotification({
        userId: renewal.traderId,
        type: "aeo_status_update",
        title: `AEO Renewal ${input.decision === "approved" ? "Approved" : "Rejected"}`,
        body: input.reviewNotes ?? `Your AEO renewal has been ${input.decision}.`,
      });
      return { success: true };
    }),

  /** List renewals due within N days (for heartbeat alert job) */
  listDueSoon: adminProcedure
    .input(z.object({ daysAhead: z.number().int().min(1).max(90).default(30) }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database unavailable");
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() + input.daysAhead);
      return db.select().from(aeoRenewals)
        .where(and(lte(aeoRenewals.renewalDueDate, cutoff), eq(aeoRenewals.status, "pending")));
    }),
});
