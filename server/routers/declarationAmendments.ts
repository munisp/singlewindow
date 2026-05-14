import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { protectedProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import { declarationAmendments, declarations } from "../../drizzle/schema";
import { eq, desc, and } from "drizzle-orm";
import { logAuditEvent } from "../db";
import { createNotification } from "../db";

export const declarationAmendmentsRouter = router({
  // Trader: request an amendment on a cleared declaration
  requestAmendment: protectedProcedure
    .input(z.object({
      declarationId: z.number().int().positive(),
      fieldName: z.string().min(1).max(128),
      newValue: z.string().min(1),
      reason: z.string().min(10),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      // Verify declaration exists and belongs to trader (or admin)
      const [decl] = await db
        .select({ id: declarations.id, status: declarations.status, traderId: declarations.traderId, declarationNumber: declarations.declarationNumber })
        .from(declarations)
        .where(eq(declarations.id, input.declarationId))
        .limit(1);

      if (!decl) throw new TRPCError({ code: "NOT_FOUND", message: "Declaration not found" });

      const isAdmin = ctx.user.role === "admin" || ctx.user.role === "customs_officer";
      if (!isAdmin && decl.traderId !== ctx.user.id) {
        throw new TRPCError({ code: "FORBIDDEN", message: "You can only amend your own declarations" });
      }

      // Only cleared declarations can be amended
      if (!isAdmin && decl.status !== "cleared") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Only cleared declarations can be amended" });
      }

      // Get current field value for audit trail
      const oldValue = (decl as Record<string, unknown>)[input.fieldName] as string | undefined;

      const [amendment] = await db.insert(declarationAmendments).values({
        declarationId: input.declarationId,
        requestedBy: ctx.user.id,
        status: "pending",
        fieldName: input.fieldName,
        oldValue: oldValue?.toString() ?? null,
        newValue: input.newValue,
        reason: input.reason,
      }).returning();

      await logAuditEvent({
        entityType: "declaration",
        entityId: input.declarationId,
        action: "amendment_requested",
        actorId: ctx.user.id,
        actorType: "trader",
        newState: { fieldName: input.fieldName, newValue: input.newValue, reason: input.reason },
      });

      return amendment;
    }),

  // List amendments for a declaration
  listByDeclaration: protectedProcedure
    .input(z.object({ declarationId: z.number().int().positive() }))
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) return [];

      const [decl] = await db
        .select({ traderId: declarations.traderId })
        .from(declarations)
        .where(eq(declarations.id, input.declarationId))
        .limit(1);

      if (!decl) throw new TRPCError({ code: "NOT_FOUND" });

      const isAdmin = ["admin", "customs_officer", "inspector"].includes(ctx.user.role);
      if (!isAdmin && decl.traderId !== ctx.user.id) {
        throw new TRPCError({ code: "FORBIDDEN" });
      }

      return db
        .select()
        .from(declarationAmendments)
        .where(eq(declarationAmendments.declarationId, input.declarationId))
        .orderBy(desc(declarationAmendments.requestedAt));
    }),

  // List pending amendments (admin/officer)
  listPending: protectedProcedure
    .query(async ({ ctx }) => {
      const allowedRoles = ["admin", "customs_officer", "inspector"];
      if (!allowedRoles.includes(ctx.user.role)) throw new TRPCError({ code: "FORBIDDEN" });

      const db = await getDb();
      if (!db) return [];

      return db
        .select()
        .from(declarationAmendments)
        .where(eq(declarationAmendments.status, "pending"))
        .orderBy(desc(declarationAmendments.requestedAt))
        .limit(100);
    }),

  // Trader: list their own amendment requests
  listMine: protectedProcedure
    .query(async ({ ctx }) => {
      const db = await getDb();
      if (!db) return [];
      return db
        .select()
        .from(declarationAmendments)
        .where(eq(declarationAmendments.requestedBy, ctx.user.id))
        .orderBy(desc(declarationAmendments.requestedAt))
        .limit(50);
    }),

  // Admin/officer: review (approve or reject) an amendment
  reviewAmendment: protectedProcedure
    .input(z.object({
      amendmentId: z.number().int().positive(),
      decision: z.enum(["approved", "rejected"]),
      reviewNotes: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const allowedRoles = ["admin", "customs_officer"];
      if (!allowedRoles.includes(ctx.user.role)) throw new TRPCError({ code: "FORBIDDEN" });

      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      const [amendment] = await db
        .select()
        .from(declarationAmendments)
        .where(and(
          eq(declarationAmendments.id, input.amendmentId),
          eq(declarationAmendments.status, "pending"),
        ))
        .limit(1);

      if (!amendment) throw new TRPCError({ code: "NOT_FOUND", message: "Pending amendment not found" });

      const [updated] = await db
        .update(declarationAmendments)
        .set({
          status: input.decision,
          reviewedBy: ctx.user.id,
          reviewNotes: input.reviewNotes ?? null,
          reviewedAt: new Date(),
        })
        .where(eq(declarationAmendments.id, input.amendmentId))
        .returning();

      // If approved, apply the change to the declaration
      if (input.decision === "approved") {
        await db
          .update(declarations)
          .set({ [amendment.fieldName]: amendment.newValue, updatedAt: new Date() } as any)
          .where(eq(declarations.id, amendment.declarationId));
      }

      await logAuditEvent({
        entityType: "declaration",
        entityId: amendment.declarationId,
        action: `amendment_${input.decision}`,
        actorId: ctx.user.id,
        actorType: "admin",
        newState: { amendmentId: input.amendmentId, decision: input.decision, reviewNotes: input.reviewNotes },
      });

      // Notify the trader
      await createNotification({
        userId: amendment.requestedBy,
        type: "declaration_status_change",
        title: `Amendment ${input.decision === "approved" ? "Approved" : "Rejected"}`,
        message: `Your amendment request for field "${amendment.fieldName}" has been ${input.decision}.${input.reviewNotes ? ` Note: ${input.reviewNotes}` : ""}`,
        entityType: "declaration",
        entityId: amendment.declarationId,
      });

      return updated;
    }),
});
