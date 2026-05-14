import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { protectedProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import { kpiTargets } from "../../drizzle/schema";
import { eq } from "drizzle-orm";

const DEFAULT_KPI_TARGETS = [
  { metricKey: "clearance_time_hours", label: "Target Clearance Time", targetValue: "4", unit: "hours" },
  { metricKey: "daily_revenue_ngn", label: "Daily Revenue Target", targetValue: "500000000", unit: "NGN" },
  { metricKey: "green_lane_pct", label: "Green Lane %", targetValue: "70", unit: "%" },
  { metricKey: "sla_compliance_pct", label: "SLA Compliance", targetValue: "95", unit: "%" },
  { metricKey: "trader_satisfaction", label: "Trader Satisfaction Score", targetValue: "4.5", unit: "/5" },
  { metricKey: "aeo_operator_count", label: "AEO Operators Target", targetValue: "50", unit: "operators" },
];

/**
 * Seed default KPI targets on startup — idempotent, skips existing rows.
 * Called from server/_core/index.ts during startup.
 */
export async function seedDefaultKpiTargets() {
  try {
    const db = await getDb();
    if (!db) return;
    for (const kpi of DEFAULT_KPI_TARGETS) {
      const [existing] = await db
        .select({ id: kpiTargets.id })
        .from(kpiTargets)
        .where(eq(kpiTargets.metricKey, kpi.metricKey))
        .limit(1);
      if (!existing) {
        await db.insert(kpiTargets).values({ ...kpi, updatedBy: null });
      }
    }
  } catch {
    /* non-fatal — DB may not be ready yet */
  }
}

export const kpiTargetsRouter = router({
  // List all KPI targets (admin, customs_officer, finance roles)
  list: protectedProcedure.query(async ({ ctx }) => {
    const allowedRoles = ["admin", "customs_officer", "finance"];
    if (!allowedRoles.includes(ctx.user.role)) throw new TRPCError({ code: "FORBIDDEN" });
    const db = await getDb();
    if (!db) return [];
    return db.select().from(kpiTargets).orderBy(kpiTargets.metricKey);
  }),

  // Set (upsert) a KPI target — admin only
  setTarget: protectedProcedure
    .input(z.object({
      metricKey: z.string().min(1).max(128),
      label: z.string().min(1).max(255),
      targetValue: z.number().positive(),
      unit: z.string().max(32).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      if (ctx.user.role !== "admin") throw new TRPCError({ code: "FORBIDDEN" });
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      const [existing] = await db
        .select({ id: kpiTargets.id })
        .from(kpiTargets)
        .where(eq(kpiTargets.metricKey, input.metricKey))
        .limit(1);

      if (existing) {
        const [updated] = await db
          .update(kpiTargets)
          .set({
            label: input.label,
            targetValue: input.targetValue.toString(),
            unit: input.unit ?? null,
            updatedBy: ctx.user.id,
            updatedAt: new Date(),
          })
          .where(eq(kpiTargets.metricKey, input.metricKey))
          .returning();
        return updated;
      } else {
        const [created] = await db
          .insert(kpiTargets)
          .values({
            metricKey: input.metricKey,
            label: input.label,
            targetValue: input.targetValue.toString(),
            unit: input.unit ?? null,
            updatedBy: ctx.user.id,
          })
          .returning();
        return created;
      }
    }),
});
