/**
 * Bonded Warehouse tRPC Router
 * Calls the Go warehouse-service for duty-suspension bond lifecycle,
 * inventory tracking, and goods release with duty payment trigger.
 */
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { protectedProcedure, router } from "../_core/trpc";

const WAREHOUSE_SVC = process.env.WAREHOUSE_SERVICE_URL ?? "http://localhost:8095";

async function warehouseFetch(path: string, opts?: RequestInit) {
  const res = await fetch(`${WAREHOUSE_SVC}${path}`, {
    ...opts,
    headers: { "Content-Type": "application/json", ...(opts?.headers ?? {}) },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: `warehouse-service error: ${body}` });
  }
  return res.json();
}

export const warehouseRouter = router({
  /** Get warehouse service health and aggregate stats */
  stats: protectedProcedure.query(async () => {
    try {
      return await warehouseFetch("/api/warehouse/stats");
    } catch {
      return {
        total_warehouses: 0,
        total_capacity_m3: 0,
        used_capacity_m3: 0,
        utilisation_pct: 0,
        active_bonds: 0,
        total_duty_suspended: 0,
        currency: "USD",
        _offline: true,
      };
    }
  }),

  /** Register a new bonded warehouse */
  register: protectedProcedure
    .input(z.object({
      name: z.string().min(3).max(120),
      portCode: z.string().min(2).max(10),
      address: z.string().max(300).optional(),
      maxCapacityM3: z.number().positive().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      return warehouseFetch("/api/warehouse/register", {
        method: "POST",
        body: JSON.stringify({
          operator_id: typeof ctx.user.id === 'number' ? ctx.user.id : parseInt(ctx.user.id as string),
          name: input.name,
          port_code: input.portCode,
          address: input.address ?? "",
          max_capacity_m3: input.maxCapacityM3 ?? 5000,
        }),
      });
    }),

  /** List all registered warehouses */
  list: protectedProcedure.query(async () => {
    try {
      return await warehouseFetch("/api/warehouse/list");
    } catch {
      return { warehouses: [], total: 0, _offline: true };
    }
  }),

  /** Deposit goods into bonded warehouse (creates duty-suspension bond) */
  deposit: protectedProcedure
    .input(z.object({
      warehouseId: z.string().uuid(),
      ucr: z.string().min(3).max(50),
      declarationId: z.number().int().positive(),
      hsCode: z.string().max(20).optional(),
      description: z.string().max(500).optional(),
      quantityKg: z.number().nonnegative().optional(),
      volumeM3: z.number().nonnegative().optional(),
      declaredValue: z.number().nonnegative(),
      dutyRate: z.number().min(0).max(1),
      bondValue: z.number().nonnegative(),
    }))
    .mutation(async ({ ctx, input }) => {
      return warehouseFetch("/api/warehouse/deposit", {
        method: "POST",
        body: JSON.stringify({
          warehouse_id: input.warehouseId,
          ucr: input.ucr,
          declaration_id: input.declarationId,
          trader_id: typeof ctx.user.id === 'number' ? ctx.user.id : parseInt(ctx.user.id as string),
          hs_code: input.hsCode ?? "",
          description: input.description ?? "",
          quantity_kg: input.quantityKg ?? 0,
          volume_m3: input.volumeM3 ?? 0,
          declared_value: input.declaredValue,
          duty_rate: input.dutyRate,
          bond_value: input.bondValue,
        }),
      });
    }),

  /** List inventory items, optionally filtered by warehouse */
  listInventory: protectedProcedure
    .input(z.object({ warehouseId: z.string().uuid().optional() }).optional())
    .query(async ({ input }) => {
      const qs = input?.warehouseId ? `?warehouse_id=${input.warehouseId}` : "";
      try {
        return await warehouseFetch(`/api/warehouse/inventory${qs}`);
      } catch {
        return { inventory: [], total: 0, _offline: true };
      }
    }),

  /** Release goods from bonded warehouse (triggers duty payment settlement) */
  release: protectedProcedure
    .input(z.object({
      inventoryId: z.string().uuid(),
      bondId: z.string().uuid(),
      dutyPaid: z.number().nonnegative(),
      paymentRef: z.string().min(3).max(80),
      destinationType: z.enum(["domestic", "re_export", "destruction"]),
    }))
    .mutation(async ({ input }) => {
      return warehouseFetch("/api/warehouse/release", {
        method: "POST",
        body: JSON.stringify({
          inventory_id: input.inventoryId,
          bond_id: input.bondId,
          duty_paid: input.dutyPaid,
          payment_ref: input.paymentRef,
          destination_type: input.destinationType,
        }),
      });
    }),
});
