import { z } from "zod";
import { router, protectedProcedure, adminProcedure } from "../_core/trpc";
import { getDb } from "../db";
import { healthThresholds, thresholdAuditLog } from "../../drizzle/schema";
import { eq, desc } from "drizzle-orm";

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
      changeReason:  z.string().max(512).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database unavailable");

      const [current] = await db.select().from(healthThresholds)
        .where(eq(healthThresholds.componentName, input.componentName)).limit(1);

      const fromDegradedMs  = current?.degradedMs  ?? (DEFAULT_THRESHOLDS[input.componentName]?.degradedMs  ?? 500);
      const fromUnhealthyMs = current?.unhealthyMs ?? (DEFAULT_THRESHOLDS[input.componentName]?.unhealthyMs ?? 2000);

      await db.insert(healthThresholds).values({
        componentName: input.componentName,
        degradedMs:    input.degradedMs,
        unhealthyMs:   input.unhealthyMs,
        updatedBy:     ctx.user.openId,
        updatedAt:     new Date(),
      }).onConflictDoUpdate({
        target: healthThresholds.componentName,
        set: { degradedMs: input.degradedMs, unhealthyMs: input.unhealthyMs, updatedBy: ctx.user.openId, updatedAt: new Date() },
      });

      await db.insert(thresholdAuditLog).values({
        componentName:   input.componentName,
        changedBy:       ctx.user.openId,
        changedByUserId: ctx.user.id,
        fromDegradedMs,
        toDegradedMs:    input.degradedMs,
        fromUnhealthyMs,
        toUnhealthyMs:   input.unhealthyMs,
        changeReason:    input.changeReason ?? null,
        changedAt:       new Date(),
      });

      return { success: true, componentName: input.componentName };
    }),

  reset: adminProcedure
    .input(z.object({
      componentName: z.string().min(1).max(128),
      changeReason:  z.string().max(512).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database unavailable");
      const [current] = await db.select().from(healthThresholds)
        .where(eq(healthThresholds.componentName, input.componentName)).limit(1);
      if (current) {
        const def = DEFAULT_THRESHOLDS[input.componentName];
        await db.insert(thresholdAuditLog).values({
          componentName:   input.componentName,
          changedBy:       ctx.user.openId,
          changedByUserId: ctx.user.id,
          fromDegradedMs:  current.degradedMs,
          toDegradedMs:    def?.degradedMs ?? 500,
          fromUnhealthyMs: current.unhealthyMs,
          toUnhealthyMs:   def?.unhealthyMs ?? 2000,
          changeReason:    input.changeReason ?? "Reset to default",
          changedAt:       new Date(),
        });
        await db.delete(healthThresholds).where(eq(healthThresholds.componentName, input.componentName));
      }
      return { success: true, componentName: input.componentName };
    }),

  resetAll: adminProcedure.mutation(async ({ ctx }) => {
    const db = await getDb();
    if (!db) throw new Error("Database unavailable");
    const rows = await db.select().from(healthThresholds);
    if (rows.length > 0) {
      await db.insert(thresholdAuditLog).values(
        rows.map(r => {
          const def = DEFAULT_THRESHOLDS[r.componentName];
          return {
            componentName:   r.componentName,
            changedBy:       ctx.user.openId,
            changedByUserId: ctx.user.id,
            fromDegradedMs:  r.degradedMs,
            toDegradedMs:    def?.degradedMs ?? 500,
            fromUnhealthyMs: r.unhealthyMs,
            toUnhealthyMs:   def?.unhealthyMs ?? 2000,
            changeReason:    "Reset all to defaults",
            changedAt:       new Date(),
          };
        })
      );
      await db.delete(healthThresholds);
    }
    return { success: true };
  }),

  listAuditLog: adminProcedure
    .input(z.object({
      componentName: z.string().optional(),
      limit:         z.number().int().min(1).max(200).default(50),
      offset:        z.number().int().min(0).default(0),
    }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database unavailable");
      const where = input.componentName
        ? eq(thresholdAuditLog.componentName, input.componentName)
        : undefined;
      return db.select().from(thresholdAuditLog)
        .where(where)
        .orderBy(desc(thresholdAuditLog.changedAt))
        .limit(input.limit)
        .offset(input.offset);
    }),
});
