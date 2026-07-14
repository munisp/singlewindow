import { z } from "zod";
import { router, protectedProcedure, adminProcedure } from "../_core/trpc";
import { getDb } from "../db";
import { healthThresholds } from "../../drizzle/schema";
import { eq } from "drizzle-orm";

const DEFAULT_THRESHOLDS: Record<string, { degradedMs: number; unhealthyMs: number }> = {
  database:    { degradedMs: 300,  unhealthyMs: 1000 },
  redis:       { degradedMs: 50,   unhealthyMs: 200  },
  tigerbeetle: { degradedMs: 200,  unhealthyMs: 800  },
  temporal:    { degradedMs: 500,  unhealthyMs: 2000 },
  kafka:       { degradedMs: 300,  unhealthyMs: 1000 },
  asean_sw:    { degradedMs: 1000, unhealthyMs: 5000 },
  wco_cen:     { degradedMs: 1000, unhealthyMs: 5000 },
  permify:     { degradedMs: 200,  unhealthyMs: 800  },
};

export const healthThresholdsRouter = router({
  list: protectedProcedure.query(async () => {
    const db = await getDb();
    if (!db) throw new Error("Database unavailable");
    const rows = await db.select().from(healthThresholds);
    const rowMap = Object.fromEntries(rows.map(r => [r.componentName, r]));
    return Object.entries(DEFAULT_THRESHOLDS).map(([name, def]) => ({
      componentName: name,
      degradedMs:   rowMap[name]?.degradedMs   ?? def.degradedMs,
      unhealthyMs:  rowMap[name]?.unhealthyMs  ?? def.unhealthyMs,
      updatedBy:    rowMap[name]?.updatedBy    ?? null,
      updatedAt:    rowMap[name]?.updatedAt    ?? null,
      isDefault:    !rowMap[name],
    }));
  }),

  update: adminProcedure
    .input(z.object({
      componentName: z.string().min(1).max(128),
      degradedMs:    z.number().int().min(1).max(60_000),
      unhealthyMs:   z.number().int().min(1).max(120_000),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
    if (!db) throw new Error("Database unavailable");
      await db
        .insert(healthThresholds)
        .values({
          componentName: input.componentName,
          degradedMs:    input.degradedMs,
          unhealthyMs:   input.unhealthyMs,
          updatedBy:     ctx.user.openId,
          updatedAt:     new Date(),
        })
        .onConflictDoUpdate({
          target: healthThresholds.componentName,
          set: {
            degradedMs:  input.degradedMs,
            unhealthyMs: input.unhealthyMs,
            updatedBy:   ctx.user.openId,
            updatedAt:   new Date(),
          },
        });
      return { success: true, componentName: input.componentName };
    }),

  reset: adminProcedure
    .input(z.object({ componentName: z.string().min(1).max(128) }))
    .mutation(async ({ input }) => {
      const db = await getDb();
    if (!db) throw new Error("Database unavailable");
      await db.delete(healthThresholds).where(eq(healthThresholds.componentName, input.componentName));
      return { success: true, componentName: input.componentName };
    }),

  resetAll: adminProcedure.mutation(async () => {
    const db = await getDb();
    if (!db) throw new Error("Database unavailable");
    await db.delete(healthThresholds);
    return { success: true };
  }),
});
