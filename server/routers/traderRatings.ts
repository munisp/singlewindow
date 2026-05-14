import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import { traderRatings, declarations } from "../../drizzle/schema";
import { eq, and, avg, count, sql, gte } from "drizzle-orm";
import { TRPCError } from "@trpc/server";

export const traderRatingsRouter = router({
  // Submit a satisfaction rating for a cleared declaration
  submit: protectedProcedure
    .input(z.object({
      declarationId: z.number().int().positive(),
      rating: z.number().int().min(1).max(5),
      comment: z.string().max(500).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      // Verify the declaration belongs to this trader and is cleared
      const [decl] = await db
        .select({ id: declarations.id, status: declarations.status, traderId: declarations.traderId })
        .from(declarations)
        .where(eq(declarations.id, input.declarationId));

      if (!decl) throw new TRPCError({ code: "NOT_FOUND", message: "Declaration not found" });
      if (decl.traderId !== ctx.user.id) throw new TRPCError({ code: "FORBIDDEN" });
      if (decl.status !== "cleared") throw new TRPCError({ code: "BAD_REQUEST", message: "Can only rate cleared declarations" });

      // Upsert — allow updating the rating
      await db
        .insert(traderRatings)
        .values({
          declarationId: input.declarationId,
          traderId: ctx.user.id,
          rating: input.rating,
          comment: input.comment ?? null,
        })
        .onConflictDoUpdate({
          target: [traderRatings.declarationId, traderRatings.traderId],
          set: {
            rating: input.rating,
            comment: input.comment ?? null,
          },
        });

      return { success: true };
    }),

  // Get the current user's rating for a declaration (if any)
  getMine: protectedProcedure
    .input(z.object({ declarationId: z.number().int().positive() }))
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      const [row] = await db
        .select()
        .from(traderRatings)
        .where(and(
          eq(traderRatings.declarationId, input.declarationId),
          eq(traderRatings.traderId, ctx.user.id),
        ));

      return row ?? null;
    }),

  // Admin: get aggregate satisfaction stats
  getStats: protectedProcedure
    .query(async ({ ctx }) => {
      if (ctx.user.role !== "admin" && ctx.user.role !== "finance") {
        throw new TRPCError({ code: "FORBIDDEN" });
      }
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      const [stats] = await db
        .select({
          avgRating: avg(traderRatings.rating),
          totalRatings: count(),
          fiveStars: sql<number>`COUNT(*) FILTER (WHERE rating = 5)`,
          fourStars: sql<number>`COUNT(*) FILTER (WHERE rating = 4)`,
          threeStars: sql<number>`COUNT(*) FILTER (WHERE rating = 3)`,
          twoStars: sql<number>`COUNT(*) FILTER (WHERE rating = 2)`,
          oneStar: sql<number>`COUNT(*) FILTER (WHERE rating = 1)`,
        })
        .from(traderRatings);

      return {
        avgRating: parseFloat(stats?.avgRating ?? "0"),
        totalRatings: Number(stats?.totalRatings ?? 0),
        distribution: {
          5: Number(stats?.fiveStars ?? 0),
          4: Number(stats?.fourStars ?? 0),
          3: Number(stats?.threeStars ?? 0),
          2: Number(stats?.twoStars ?? 0),
          1: Number(stats?.oneStar ?? 0),
        },
      };
    }),

  // Admin: get 30-day daily average rating trend for line chart
  getTrend: protectedProcedure
    .input(z.object({ days: z.number().int().min(7).max(90).default(30) }))
    .query(async ({ ctx, input }) => {
      if (ctx.user.role !== "admin" && ctx.user.role !== "finance") {
        throw new TRPCError({ code: "FORBIDDEN" });
      }
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      const since = new Date();
      since.setDate(since.getDate() - input.days);

      const rows = await db
        .select({
          day: sql<string>`DATE(created_at)`,
          avgRating: avg(traderRatings.rating),
          count: count(),
        })
        .from(traderRatings)
        .where(gte(traderRatings.createdAt, since))
        .groupBy(sql`DATE(created_at)`)
        .orderBy(sql`DATE(created_at)`);

      return rows.map((r) => ({
        day: r.day,
        avgRating: parseFloat(r.avgRating ?? "0"),
        count: Number(r.count),
      }));
    }),
});
