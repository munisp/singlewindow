/**
 * Free Zone Operations tRPC Router
 * Proxies to the Go freezone-service (port 8098)
 */
import { z } from "zod";
import { protectedProcedure, adminProcedure, router } from "../_core/trpc";
import { TRPCError } from "@trpc/server";

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
});
