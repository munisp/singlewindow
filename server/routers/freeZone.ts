/**
 * Free Zone Operations tRPC Router
 * Proxies to the Go freezone-service (port 8098)
 */
import { z } from "zod";
import { protectedProcedure, adminProcedure, router } from "../_core/trpc";
import { TRPCError } from "@trpc/server";
import { getDb } from "../db";
import { declarations, freezoneReconciliationRuns } from "../../drizzle/schema";
import { eq, inArray, desc } from "drizzle-orm";

const FZ_SERVICE_URL = process.env.FREEZONE_SERVICE_URL || "http://localhost:8098";

async function fzFetch(path: string, options?: RequestInit) {
  try {
    const res = await fetch(`${FZ_SERVICE_URL}${path}`, {
      ...options,
      headers: { "Content-Type": "application/json", ...(options?.headers ?? {}) },
    });
    const text = await res.text();
    if (!res.ok) {
      let msg = text;
      try { msg = JSON.parse(text).error ?? text; } catch {}
      throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: msg });
    }
    return JSON.parse(text);
  } catch (err) {
    if (err instanceof TRPCError) throw err;
    return null;
  }
}

const ZoneTypeEnum = z.enum(["EXPORT_PROCESSING", "LOGISTICS", "TECHNOLOGY", "GENERAL"]);
const ExitDestEnum = z.enum(["DOMESTIC", "RE_EXPORT", "DESTRUCTION"]);

export const freeZoneRouter = router({
  // Register a new free zone
  registerZone: adminProcedure
    .input(z.object({
      name: z.string().min(3).max(200),
      code: z.string().min(2).max(10),
      location: z.string().min(3).max(200),
      operatorName: z.string().min(3).max(200),
      zoneType: ZoneTypeEnum,
      capacityM3: z.number().positive(),
    }))
    .mutation(async ({ input }) => {
      const data = await fzFetch("/zones", {
        method: "POST",
        body: JSON.stringify(input),
      });
      if (!data) throw new TRPCError({ code: "SERVICE_UNAVAILABLE", message: "Free zone service unavailable" });
      return data;
    }),

  // List all free zones
  listZones: protectedProcedure
    .query(async () => {
      const data = await fzFetch("/zones");
      return data ?? { zones: [], total: 0 };
    }),

  // Admit goods into a free zone
  admitGoods: protectedProcedure
    .input(z.object({
      zoneId: z.string(),
      ucr: z.string().min(3).max(50),
      traderRef: z.string().min(3).max(100),
      hsCode: z.string().min(4).max(10),
      description: z.string().min(3).max(500),
      originCountry: z.string().length(2),
      grossWeightKg: z.number().positive(),
      volumeM3: z.number().positive(),
      invoiceValue: z.number().positive(),
      currency: z.string().length(3),
      dutyRate: z.number().min(0).max(1).optional().default(0),
    }))
    .mutation(async ({ input }) => {
      const { zoneId, ...body } = input;
      const data = await fzFetch(`/zones/${zoneId}/admit`, {
        method: "POST",
        body: JSON.stringify(body),
      });
      if (!data) throw new TRPCError({ code: "SERVICE_UNAVAILABLE", message: "Free zone service unavailable" });
      return data;
    }),

  // Transfer goods between free zones
  transferGoods: protectedProcedure
    .input(z.object({
      goodsId: z.string(),
      toZoneId: z.string(),
      reason: z.string().min(5).max(500),
      officerRef: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      const { goodsId, ...body } = input;
      const data = await fzFetch(`/goods/${goodsId}/transfer`, {
        method: "POST",
        body: JSON.stringify(body),
      });
      if (!data) throw new TRPCError({ code: "SERVICE_UNAVAILABLE", message: "Free zone service unavailable" });
      return data;
    }),

  // Exit goods from the free zone
  exitGoods: protectedProcedure
    .input(z.object({
      goodsId: z.string(),
      destination: ExitDestEnum,
      dutyPaid: z.number().min(0).optional().default(0),
    }))
    .mutation(async ({ input }) => {
      const { goodsId, ...body } = input;
      const data = await fzFetch(`/goods/${goodsId}/exit`, {
        method: "POST",
        body: JSON.stringify(body),
      });
      if (!data) throw new TRPCError({ code: "SERVICE_UNAVAILABLE", message: "Free zone service unavailable" });
      return data;
    }),

  // List inventory across all zones or a specific zone
  listInventory: protectedProcedure
    .input(z.object({
      zoneId: z.string().optional(),
      status: z.enum(["ADMITTED", "TRANSFERRED", "EXITED", "DESTROYED"]).optional(),
    }))
    .query(async ({ input }) => {
      const params = new URLSearchParams();
      if (input.zoneId) params.set("zoneId", input.zoneId);
      if (input.status) params.set("status", input.status);
      const data = await fzFetch(`/inventory?${params}`);
      return data ?? { inventory: [], total: 0 };
    }),

  // Get free zone statistics
  getStats: protectedProcedure
    .query(async () => {
      const data = await fzFetch("/stats");
      return data ?? {
        totalZones: 0, activeZones: 0,
        totalCapacityM3: 0, usedCapacityM3: 0,
        utilisationPct: 0, goodsInZone: 0,
        goodsExited: 0, totalValueUSD: 0,
      };
    }),

  /**
   * v118: reconcileInventory — compare the free zone microservice inventory ledger
   * against the customs declarations database to identify discrepancies.
   * Returns a reconciliation report with matched, unmatched, and surplus items.
   */
  reconcileInventory: protectedProcedure
    .input(z.object({
      zoneId: z.string().min(1).optional(),
      tolerancePct: z.number().min(0).max(10).default(2),
    }))
    .query(async ({ ctx, input }) => {
      const isPrivileged = ["admin", "customs_officer", "finance"].includes(ctx.user.role);
      if (!isPrivileged) throw new TRPCError({ code: "FORBIDDEN", message: "Privileged access required" });

      // Fetch inventory from free zone microservice
      const params = new URLSearchParams();
      if (input.zoneId) params.set("zoneId", input.zoneId);
      params.set("limit", "500");
      const fzInventory: Array<{ itemId: string; hsCode: string; quantity: number; valueUSD: number; declarationRef?: string }> =
        await fzFetch(`/inventory?${params}`) ?? { inventory: [] };

      const items = Array.isArray(fzInventory) ? fzInventory : (fzInventory as any).inventory ?? [];

      // Group by declaration reference
      const fzByDecl: Record<string, typeof items> = {};
      for (const item of items) {
        const ref = item.declarationRef ?? "UNLINKED";
        if (!fzByDecl[ref]) fzByDecl[ref] = [];
        fzByDecl[ref].push(item);
      }

      const matched: Array<{ declarationRef: string; fzValue: number; declaredValue: number; variance: number; status: string }> = [];
      const unmatched: Array<{ declarationRef: string; fzValue: number; reason: string }> = [];
      const surplus: Array<{ itemId: string; hsCode: string; quantity: number; valueUSD: number }> = [];

      // SW-21: resolve real declared values from the declarations table.
      const linkedRefs = Object.keys(fzByDecl).filter((r) => r !== "UNLINKED");
      const declaredByRef = new Map<string, number>();
      if (linkedRefs.length > 0) {
        const db = await getDb();
        if (!db) throw new TRPCError({ code: "SERVICE_UNAVAILABLE", message: "DECLARATION_STORE_UNAVAILABLE: cannot reconcile without real declaration values" });
        const rows = await db
          .select({ declarationNumber: declarations.declarationNumber, invoiceValue: declarations.invoiceValue })
          .from(declarations)
          .where(inArray(declarations.declarationNumber, linkedRefs));
        for (const row of rows) {
          if (row.declarationNumber && row.invoiceValue != null) {
            declaredByRef.set(row.declarationNumber, Number(row.invoiceValue));
          }
        }
      }

      for (const [ref, refItems] of Object.entries(fzByDecl)) {
        if (ref === "UNLINKED") {
          surplus.push(...refItems.map((i: { itemId: number; hsCode?: string | null; quantity?: number | null; valueUSD?: number | null }) => ({ itemId: i.itemId, hsCode: i.hsCode, quantity: i.quantity, valueUSD: i.valueUSD })));
          continue;
        }
        const fzValue = refItems.reduce((s: number, i: { valueUSD?: number | null }) => s + (i.valueUSD ?? 0), 0);
        // SW-21: declared value comes from the REAL declarations record — never simulated.
        const declaredValue = declaredByRef.get(ref);
        if (declaredValue == null) {
          unmatched.push({ declarationRef: ref, fzValue: Math.round(fzValue * 100) / 100, reason: "No matching customs declaration found for this reference" });
          continue;
        }
        const variance = Math.abs(fzValue - declaredValue) / Math.max(declaredValue, 1) * 100;
        const status = variance <= input.tolerancePct ? "matched" : "discrepancy";
        if (status === "matched") {
          matched.push({ declarationRef: ref, fzValue: Math.round(fzValue * 100) / 100, declaredValue: Math.round(declaredValue * 100) / 100, variance: Math.round(variance * 100) / 100, status });
        } else {
          unmatched.push({ declarationRef: ref, fzValue: Math.round(fzValue * 100) / 100, reason: `Value variance ${Math.round(variance * 100) / 100}% exceeds tolerance ${input.tolerancePct}%` });
        }
      }

      const rate = items.length > 0 ? Math.round((matched.length / Math.max(matched.length + unmatched.length + surplus.length, 1)) * 10000) / 100 : 100;
      const report = {
        zoneId: input.zoneId ?? "all",
        tolerancePct: input.tolerancePct,
        reconciledAt: new Date().toISOString(),
        summary: {
          totalItems: items.length,
          matched: matched.length,
          unmatched: unmatched.length,
          surplus: surplus.length,
          reconciliationRate: rate,
        },
        matched,
        unmatched,
        surplus,
      };

      // SW-21: persist the real run so history is factual, not fabricated.
      let runId: number | null = null;
      try {
        const db = await getDb();
        if (db) {
          const [run] = await db.insert(freezoneReconciliationRuns).values({
            zoneId: input.zoneId ?? "all",
            tolerancePct: input.tolerancePct,
            totalItems: items.length,
            matched: matched.length,
            unmatched: unmatched.length,
            surplus: surplus.length,
            reconciliationRate: rate,
            report,
            triggeredBy: ctx.user.id,
          }).returning({ id: freezoneReconciliationRuns.id });
          runId = run?.id ?? null;
        }
      } catch (persistErr) {
        // Persistence failure must not fabricate history — report it honestly.
        console.error("[FreeZone] Failed to persist reconciliation run:", persistErr);
      }

      return { runId, runPersisted: runId != null, ...report };
    }),

  /**
   * v118: getInventoryAuditTrail — return a chronological log of all goods
   * admitted, transferred, and exited from a free zone for audit purposes.
   */
  getInventoryAuditTrail: protectedProcedure
    .input(z.object({
      zoneId: z.string().min(1).optional(),
      limit: z.number().int().min(1).max(200).default(50),
      offset: z.number().int().min(0).default(0),
    }))
    .query(async ({ ctx, input }) => {
      const isPrivileged = ["admin", "customs_officer", "finance"].includes(ctx.user.role);
      if (!isPrivileged) throw new TRPCError({ code: "FORBIDDEN", message: "Privileged access required" });

      const params = new URLSearchParams();
      if (input.zoneId) params.set("zoneId", input.zoneId);
      params.set("limit", String(input.limit));
      params.set("offset", String(input.offset));
      const data = await fzFetch(`/audit-trail?${params}`);
      return data ?? { events: [], total: 0 };
    }),

  /**
   * v118: getReconciliationHistory — list past inventory reconciliation runs for a free zone.
   */
  getReconciliationHistory: protectedProcedure
    .input(z.object({
      freeZoneId: z.number().int().positive(),
      limit: z.number().int().min(1).max(100).default(20),
      offset: z.number().int().min(0).default(0),
    }))
    .query(async ({ input }) => {
      // SW-21: serve ONLY real persisted reconciliation runs. Empty = no runs yet.
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "SERVICE_UNAVAILABLE", message: "Database unavailable" });
      const runs = await db
        .select()
        .from(freezoneReconciliationRuns)
        .where(eq(freezoneReconciliationRuns.zoneId, String(input.freeZoneId)))
        .orderBy(desc(freezoneReconciliationRuns.createdAt))
        .limit(input.limit)
        .offset(input.offset);
      return {
        runs,
        total: runs.length,
        limit: input.limit,
        offset: input.offset,
        noData: runs.length === 0,
        message: runs.length === 0 ? "NO_RECONCILIATION_RUNS: no persisted reconciliation runs for this zone." : undefined,
      };
    }),
});