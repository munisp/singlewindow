/**
 * healthThresholds Router — v132
 * Admin procedures to list, update, and reset per-component latency alert thresholds.
 * Thresholds are stored in the health_thresholds table and consumed by the
 * SystemStatus dashboard to colour-code component cards.
 */
import { z } from "zod";
import { router, protectedProcedure } from "../_core/trpc";
import { TRPCError } from "@trpc/server";
import { getDb } from "../db";
import { healthThresholds } from "../../drizzle/schema";
import { eq } from "drizzle-orm";

// Default thresholds per component (used when no DB row exists yet)
const DEFAULT_THRESHOLDS: Record<string, { degradedMs: number; unhealthyMs: number }> = {
  "API Gateway":           { degradedMs: 100,  unhealthyMs: 500  },
  "Declaration Engine":    { degradedMs: 200,  unhealthyMs: 1000 },
  "Risk AI Engine":        { degradedMs: 300,  unhealthyMs: 2000 },
  "Payment Gateway":       { degradedMs: 200,  unhealthyMs: 1000 },
  "Document Vault":        { degradedMs: 150,  unhealthyMs: 750  },
  "Cargo Tracking":        { degradedMs: 150,  unhealthyMs: 750  },
  "OGA Integration Hub":   { degradedMs: 500,  unhealthyMs: 3000 },
  "ASEAN Single Window":   { degradedMs: 500,  unhealthyMs: 3000 },
  "Ledger Service":        { degradedMs: 100,  unhealthyMs: 500  },
  "Notification Service":  { degradedMs: 50,   unhealthyMs: 250  },
};

export const healthThresholdsRouter = router({
  /**
   * List all component thresholds, merging DB rows with defaults for any
   * component that has not yet been customised.
   */
  list: protectedProcedure.query(async ({ ctx }) => {
    if (!["admin", "customs_officer"].includes(ctx.user.role)) {
      throw new TRPCError({ code: "FORBIDDEN" });
    }
    const db = await getDb();
    const rows = db ? await db.select().from(healthThresholds) : [];
    const dbMap = new Map(rows.map((r) => [r.componentName, r]));

    return Object.entries(DEFAULT_THRESHOLDS).map(([name, defaults]) => {
      const row = dbMap.get(name);
      return {
        componentName: name,
        degradedMs: row?.degradedMs ?? defaults.degradedMs,
        unhealthyMs: row?.unhealthyMs ?? defaults.unhealthyMs,
        enabled: row?.enabled ?? true,
        isCustomised: !!row,
        updatedBy: row?.updatedBy ?? null,
        updatedAt: row?.updatedAt?.toISOString() ?? null,
      };
    });
  }),

  /**
   * Upsert a single component's threshold values.
   */
  update: protectedProcedure
    .input(
      z.object({
        componentName: z.string().min(1).max(64),
        degradedMs: z.number().int().min(1).max(60_000),
        unhealthyMs: z.number().int().min(1).max(60_000),
        enabled: z.boolean().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      if (!["admin"].includes(ctx.user.role)) {
        throw new TRPCError({ code: "FORBIDDEN" });
      }
      if (input.degradedMs >= input.unhealthyMs) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "degradedMs must be less than unhealthyMs",
        });
      }
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

      const existing = await db
        .select()
        .from(healthThresholds)
        .where(eq(healthThresholds.componentName, input.componentName))
        .limit(1);

      if (existing.length > 0) {
        await db
          .update(healthThresholds)
          .set({
            degradedMs: input.degradedMs,
            unhealthyMs: input.unhealthyMs,
            enabled: input.enabled ?? existing[0].enabled,
            updatedBy: ctx.user.name ?? ctx.user.openId,
            updatedAt: new Date(),
          })
          .where(eq(healthThresholds.componentName, input.componentName));
      } else {
        await db.insert(healthThresholds).values({
          componentName: input.componentName,
          degradedMs: input.degradedMs,
          unhealthyMs: input.unhealthyMs,
          enabled: input.enabled ?? true,
          updatedBy: ctx.user.name ?? ctx.user.openId,
          updatedAt: new Date(),
        });
      }

      return { success: true, componentName: input.componentName };
    }),

  /**
   * Reset a single component's thresholds back to the built-in defaults.
   */
  reset: protectedProcedure
    .input(z.object({ componentName: z.string().min(1).max(64) }))
    .mutation(async ({ ctx, input }) => {
      if (!["admin"].includes(ctx.user.role)) {
        throw new TRPCError({ code: "FORBIDDEN" });
      }
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

      await db
        .delete(healthThresholds)
        .where(eq(healthThresholds.componentName, input.componentName));

      return {
        success: true,
        componentName: input.componentName,
        defaults: DEFAULT_THRESHOLDS[input.componentName] ?? null,
      };
    }),

  /**
   * Reset ALL components to built-in defaults.
   */
  resetAll: protectedProcedure.mutation(async ({ ctx }) => {
    if (!["admin"].includes(ctx.user.role)) {
      throw new TRPCError({ code: "FORBIDDEN" });
    }
    const db = await getDb();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

    const { rowCount } = await db.delete(healthThresholds) as unknown as { rowCount: number };
    return { success: true, deletedCount: rowCount ?? 0 };
  }),
});
