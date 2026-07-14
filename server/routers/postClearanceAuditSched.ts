import { z } from "zod";
import { router, protectedProcedure, adminProcedure } from "../_core/trpc";
import { getDb } from "../db";
import { postClearanceAuditSchedule } from "../../drizzle/schema";
import { eq, and, desc } from "drizzle-orm";
import { createUserNotification } from "../db";

export const postClearanceAuditSchedRouter = router({
  list: adminProcedure.query(async () => {
    const db = await getDb();
    if (!db) throw new Error("Database unavailable");
    return db.select().from(postClearanceAuditSchedule)
      .orderBy(desc(postClearanceAuditSchedule.scheduledDate)).limit(100);
  }),

  myAudits: protectedProcedure.query(async ({ ctx }) => {
    const db = await getDb();
    if (!db) throw new Error("Database unavailable");
    return db.select().from(postClearanceAuditSchedule)
      .where(eq(postClearanceAuditSchedule.traderId, ctx.user.id))
      .orderBy(desc(postClearanceAuditSchedule.scheduledDate));
  }),

  schedule: adminProcedure
    .input(z.object({
      declarationId: z.number().int(),
      traderId: z.number().int(),
      auditType: z.enum(["random", "risk_based", "targeted"]).default("random"),
      scheduledDate: z.string(),
      assignedOfficer: z.number().int().optional(),
      riskScore: z.number().int().min(0).max(100).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database unavailable");
      const [created] = await db.insert(postClearanceAuditSchedule).values({
        declarationId: input.declarationId,
        traderId: input.traderId,
        scheduledBy: ctx.user.openId,
        auditType: input.auditType,
        status: "scheduled",
        scheduledDate: new Date(input.scheduledDate),
        assignedOfficer: input.assignedOfficer ?? null,
        riskScore: input.riskScore ?? null,
      }).returning({ id: postClearanceAuditSchedule.id });
      await createUserNotification({
        userId: input.traderId,
        type: "general",
        title: "Post-Clearance Audit Scheduled",
        body: `A ${input.auditType} post-clearance audit has been scheduled for declaration #${input.declarationId} on ${new Date(input.scheduledDate).toLocaleDateString()}.`,
      });
      return { id: created.id };
    }),

  updateStatus: adminProcedure
    .input(z.object({
      id: z.number().int(),
      status: z.enum(["in_progress", "completed", "cancelled"]),
      findings: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database unavailable");
      await db.update(postClearanceAuditSchedule)
        .set({
          status: input.status,
          findings: input.findings ?? null,
          completedAt: input.status === "completed" ? new Date() : null,
          updatedAt: new Date(),
        })
        .where(eq(postClearanceAuditSchedule.id, input.id));
      return { success: true };
    }),
});
