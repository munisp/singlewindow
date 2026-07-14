import { z } from "zod";
import { router, protectedProcedure, adminProcedure } from "../_core/trpc";
import { getDb } from "../db";
import { declarationRiskHistory, declarations } from "../../drizzle/schema";
import { eq, desc } from "drizzle-orm";

export const declarationRiskHistoryRouter = router({
  getTimeline: protectedProcedure
    .input(z.object({ declarationId: z.number().int() }))
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database unavailable");
      // Verify access: trader can only see their own declarations
      const [decl] = await db.select({ traderId: declarations.traderId })
        .from(declarations).where(eq(declarations.id, input.declarationId)).limit(1);
      if (!decl) throw new Error("Declaration not found");
      const isAdmin = ["admin", "customs_officer", "finance"].includes(ctx.user.role);
      if (!isAdmin && decl.traderId !== ctx.user.id) throw new Error("Access denied");
      return db.select().from(declarationRiskHistory)
        .where(eq(declarationRiskHistory.declarationId, input.declarationId))
        .orderBy(desc(declarationRiskHistory.recordedAt));
    }),

  record: adminProcedure
    .input(z.object({
      declarationId: z.number().int(),
      riskScore: z.number().int().min(0).max(100),
      riskLane: z.string().optional(),
      triggeredBy: z.string().default("system"),
      factors: z.record(z.string(), z.unknown()).optional(),
    }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database unavailable");
      await db.insert(declarationRiskHistory).values({
        declarationId: input.declarationId,
        riskScore: input.riskScore,
        riskLane: input.riskLane ?? null,
        triggeredBy: input.triggeredBy,
        factors: input.factors ?? null,
        recordedAt: new Date(),
      });
      return { success: true };
    }),
});
