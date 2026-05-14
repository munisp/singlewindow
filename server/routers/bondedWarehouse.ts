/**
 * Bonded Warehouse Router — DB-backed implementation (v37)
 * Manages warehouse registration, goods-in-bond inventory, bond guarantees,
 * ex-bond permit issuance, and expiry alerts.
 * Tables: bonded_warehouses, bonded_inventory, ex_bond_permits
 */
import { z } from "zod";
import { protectedProcedure, adminProcedure, router } from "../_core/trpc";
import { TRPCError } from "@trpc/server";
import { getDb, getPool } from "../db";

/** Bond must cover 110% of total goods value (WCO standard). */
export function calculateBondRequirement(totalInventoryValueUsd: number): number {
  return Math.ceil(totalInventoryValueUsd * 1.1);
}

/**
 * isBondExpiringSoon — returns true if the bond expires within `withinDays` days.
 * @param bondExpiryDate ISO date string or Date object
 * @param withinDays threshold in days (default 30)
 */
export function isBondExpiringSoon(bondExpiryDate: string | Date, withinDays = 30): boolean {
  const expiry = new Date(bondExpiryDate);
  const now = new Date();
  const diffMs = expiry.getTime() - now.getTime();
  const diffDays = diffMs / (1000 * 60 * 60 * 24);
  return diffDays <= withinDays;
}

export function generatePermitNo(): string {
  const year = new Date().getFullYear();
  // 6 uppercase hex characters for uniqueness
  const hex = Math.floor(Math.random() * 0xFFFFFF).toString(16).padStart(6, "0").toUpperCase();
  return `BW-${year}-${hex}`;
}

function generateLicenseNo(): string {
  const year = new Date().getFullYear();
  const rnd = Math.floor(Math.random() * 90000) + 10000;
  return `BWL-${year}-${rnd}`;
}

async function pgQuery<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> {
  await getDb(); // ensure pool is initialised
  const pool = getPool();
  if (!pool) throw new Error("Database pool not available");
  const { rows } = await pool.query(sql, params);
  return rows as T[];
}

export const bondedWarehouseRouter = router({

  listWarehouses: protectedProcedure
    .input(z.object({
      status: z.enum(["active", "suspended", "revoked", "pending_renewal"]).optional(),
      portCode: z.string().optional(),
      limit: z.number().min(1).max(200).default(50),
      offset: z.number().min(0).default(0),
    }))
    .query(async ({ input }) => {
      const conditions: string[] = ["1=1"];
      const params: unknown[] = [];
      let i = 1;
      if (input.status) { conditions.push(`bw.status = $${i++}`); params.push(input.status); }
      if (input.portCode) { conditions.push(`bw.port_code = $${i++}`); params.push(input.portCode); }
      params.push(input.limit, input.offset);
      const rows = await pgQuery(
        `SELECT bw.*,
          (SELECT COUNT(*) FROM bonded_inventory bi WHERE bi.warehouse_id = bw.id AND bi.status = 'in_bond') AS items_in_bond,
          (SELECT COALESCE(SUM(bi.invoice_value_usd),0) FROM bonded_inventory bi WHERE bi.warehouse_id = bw.id AND bi.status = 'in_bond') AS total_value_usd
         FROM bonded_warehouses bw WHERE ${conditions.join(" AND ")}
         ORDER BY bw.created_at DESC LIMIT $${i++} OFFSET $${i++}`,
        params
      );
      const [{ total }] = await pgQuery<{ total: string }>(
        `SELECT COUNT(*) as total FROM bonded_warehouses WHERE 1=1${input.status ? " AND status=$1" : ""}`,
        input.status ? [input.status] : []
      );
      return { warehouses: rows, total: parseInt(total, 10) };
    }),

  registerWarehouse: protectedProcedure
    .input(z.object({
      name: z.string().min(3).max(200),
      operatorName: z.string().min(2).max(200),
      country: z.string().length(3).default("NGA"),
      address: z.string().min(10),
      portCode: z.string().max(10).optional(),
      capacityCbm: z.number().min(1),
      bondAmountUsd: z.number().min(0),
      bondExpiryDays: z.number().min(30).default(365),
    }))
    .mutation(async ({ input, ctx }) => {
      const licenseNo = generateLicenseNo();
      const bondExpiry = new Date(Date.now() + input.bondExpiryDays * 86400_000);
      const rows = await pgQuery(
        `INSERT INTO bonded_warehouses
          (license_no, name, operator_id, operator_name, country, address, port_code,
           capacity_cbm, bond_amount_usd, bond_expiry, status, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,NOW(),NOW())
         RETURNING *`,
        [licenseNo, input.name, ctx.user.id, input.operatorName, input.country,
         input.address, input.portCode ?? null, input.capacityCbm,
         input.bondAmountUsd, bondExpiry, "active"]
      );
      return { success: true, warehouse: rows[0], licenseNo };
    }),

  getInventory: protectedProcedure
    .input(z.object({
      warehouseId: z.number().optional(),
      status: z.enum(["in_bond", "ex_bonded", "re_exported", "destroyed", "seized"]).optional(),
      limit: z.number().min(1).max(200).default(50),
      offset: z.number().min(0).default(0),
    }))
    .query(async ({ input }) => {
      const conditions: string[] = ["1=1"];
      const params: unknown[] = [];
      let i = 1;
      if (input.warehouseId) { conditions.push(`bi.warehouse_id = $${i++}`); params.push(input.warehouseId); }
      if (input.status) { conditions.push(`bi.status = $${i++}`); params.push(input.status); }
      params.push(input.limit, input.offset);
      return pgQuery(
        `SELECT bi.*, bw.name as warehouse_name, bw.license_no
         FROM bonded_inventory bi
         JOIN bonded_warehouses bw ON bi.warehouse_id = bw.id
         WHERE ${conditions.join(" AND ")}
         ORDER BY bi.deposited_at DESC LIMIT $${i++} OFFSET $${i++}`,
        params
      );
    }),

  recordEntry: protectedProcedure
    .input(z.object({
      warehouseId: z.number(),
      declarationId: z.number().optional(),
      ucr: z.string().min(5).max(50),
      hsCode: z.string().min(4).max(20),
      description: z.string().min(5),
      quantityKg: z.number().min(0),
      volumeCbm: z.number().min(0),
      invoiceValueUsd: z.number().min(0),
      originCountry: z.string().length(3).optional(),
      expiryDays: z.number().min(1).default(180),
    }))
    .mutation(async ({ input }) => {
      const [w] = await pgQuery<{ capacity_cbm: number; used_cbm: number }>(
        "SELECT * FROM bonded_warehouses WHERE id = $1 AND status = 'active'", [input.warehouseId]
      );
      if (!w) throw new TRPCError({ code: "NOT_FOUND", message: "Warehouse not found or inactive" });
      if (w.used_cbm + input.volumeCbm > w.capacity_cbm) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Insufficient warehouse capacity" });
      }
      const dutyLiabilityUsd = Math.round(input.invoiceValueUsd * 0.15);
      const expiryDate = new Date(Date.now() + input.expiryDays * 86400_000);
      await pgQuery(
        `INSERT INTO bonded_inventory
          (warehouse_id, declaration_id, ucr, hs_code, description, quantity_kg, volume_cbm,
           invoice_value_usd, duty_liability_usd, origin_country, deposited_at, expiry_date, status, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,NOW(),$11,$12,NOW())`,
        [input.warehouseId, input.declarationId ?? null, input.ucr, input.hsCode,
         input.description, input.quantityKg, input.volumeCbm, input.invoiceValueUsd,
         dutyLiabilityUsd, input.originCountry ?? null, expiryDate, "in_bond"]
      );
      await pgQuery(
        "UPDATE bonded_warehouses SET used_cbm = used_cbm + $1, updated_at = NOW() WHERE id = $2",
        [input.volumeCbm, input.warehouseId]
      );
      return { success: true, dutyLiabilityUsd, expiryDate };
    }),

  recordExit: protectedProcedure
    .input(z.object({
      inventoryId: z.number(),
      exitReason: z.enum(["ex_bonded", "re_exported", "destroyed", "seized"]).default("ex_bonded"),
    }))
    .mutation(async ({ input }) => {
      const [item] = await pgQuery<{ warehouse_id: number; volume_cbm: number }>(
        "SELECT * FROM bonded_inventory WHERE id = $1 AND status = 'in_bond'", [input.inventoryId]
      );
      if (!item) throw new TRPCError({ code: "NOT_FOUND", message: "Inventory item not found or already released" });
      await pgQuery(
        "UPDATE bonded_inventory SET status = $1, released_at = NOW() WHERE id = $2",
        [input.exitReason, input.inventoryId]
      );
      await pgQuery(
        "UPDATE bonded_warehouses SET used_cbm = GREATEST(0, used_cbm - $1), updated_at = NOW() WHERE id = $2",
        [item.volume_cbm, item.warehouse_id]
      );
      return { success: true, status: input.exitReason };
    }),

  issueExBondPermit: protectedProcedure
    .input(z.object({
      inventoryId: z.number(),
      quantityKg: z.number().min(1),
      dutyPaidUsd: z.number().min(0),
      paymentRef: z.string().optional(),
      validDays: z.number().min(1).default(30),
    }))
    .mutation(async ({ input, ctx }) => {
      const [inv] = await pgQuery<{ warehouse_id: number; duty_liability_usd: number }>(
        "SELECT * FROM bonded_inventory WHERE id = $1 AND status = 'in_bond'", [input.inventoryId]
      );
      if (!inv) throw new TRPCError({ code: "NOT_FOUND", message: "Inventory item not found" });
      if (input.dutyPaidUsd < Number(inv.duty_liability_usd)) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Duty payment USD ${input.dutyPaidUsd} is less than liability USD ${inv.duty_liability_usd}`
        });
      }
      const permitNo = generatePermitNo();
      const expiresAt = new Date(Date.now() + input.validDays * 86400_000);
      await pgQuery(
        `INSERT INTO ex_bond_permits
          (permit_no, inventory_id, warehouse_id, requested_by_id, quantity_kg,
           duty_paid_usd, payment_ref, status, issued_at, expires_at, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW(),$9,NOW())`,
        [permitNo, input.inventoryId, inv.warehouse_id, ctx.user.id,
         input.quantityKg, input.dutyPaidUsd, input.paymentRef ?? null, "active", expiresAt]
      );
      return { success: true, permitNo, expiresAt };
    }),

  listPermits: protectedProcedure
    .input(z.object({
      warehouseId: z.number().optional(),
      status: z.enum(["active", "used", "expired", "cancelled"]).optional(),
      limit: z.number().min(1).max(100).default(50),
      offset: z.number().min(0).default(0),
    }))
    .query(async ({ input }) => {
      const conditions: string[] = ["1=1"];
      const params: unknown[] = [];
      let i = 1;
      if (input.warehouseId) { conditions.push(`ep.warehouse_id = $${i++}`); params.push(input.warehouseId); }
      if (input.status) { conditions.push(`ep.status = $${i++}`); params.push(input.status); }
      params.push(input.limit, input.offset);
      return pgQuery(
        `SELECT ep.*, bw.name as warehouse_name, bi.hs_code, bi.description
         FROM ex_bond_permits ep
         JOIN bonded_warehouses bw ON ep.warehouse_id = bw.id
         JOIN bonded_inventory bi ON ep.inventory_id = bi.id
         WHERE ${conditions.join(" AND ")}
         ORDER BY ep.issued_at DESC LIMIT $${i++} OFFSET $${i++}`,
        params
      );
    }),

  getBondGuarantees: protectedProcedure.query(async () => {
    const rows = await pgQuery<{
      bond_amount_usd: number;
      total_inventory_value_usd: number;
    }>(
      `SELECT bw.id, bw.name, bw.license_no, bw.bond_amount_usd, bw.bond_expiry, bw.status,
        COALESCE(SUM(bi.invoice_value_usd),0) AS total_inventory_value_usd,
        COALESCE(SUM(bi.duty_liability_usd),0) AS total_duty_liability_usd,
        COUNT(bi.id) AS items_count
       FROM bonded_warehouses bw
       LEFT JOIN bonded_inventory bi ON bi.warehouse_id = bw.id AND bi.status = 'in_bond'
       GROUP BY bw.id
       ORDER BY bw.name`
    );
    return rows.map((r) => ({
      ...r,
      bondRequirement: calculateBondRequirement(Number(r.total_inventory_value_usd)),
      bondAdequate: Number(r.bond_amount_usd) >= calculateBondRequirement(Number(r.total_inventory_value_usd)),
    }));
  }),

  getExpiryAlerts: protectedProcedure.query(async () => {
    const thirtyDays = new Date(Date.now() + 30 * 86400_000);
    const [invExpiry, bondExpiry, permitExpiry] = await Promise.all([
      pgQuery(
        `SELECT bi.id, bi.ucr, bi.hs_code, bi.description, bi.expiry_date, bi.status,
                bw.name as warehouse_name, bw.license_no
         FROM bonded_inventory bi
         JOIN bonded_warehouses bw ON bi.warehouse_id = bw.id
         WHERE bi.status = 'in_bond' AND bi.expiry_date IS NOT NULL AND bi.expiry_date <= $1
         ORDER BY bi.expiry_date ASC`,
        [thirtyDays]
      ),
      pgQuery(
        `SELECT id, name, license_no, bond_expiry, status
         FROM bonded_warehouses
         WHERE status = 'active' AND bond_expiry IS NOT NULL AND bond_expiry <= $1
         ORDER BY bond_expiry ASC`,
        [thirtyDays]
      ),
      pgQuery(
        `SELECT ep.id, ep.permit_no, ep.expires_at, bw.name as warehouse_name
         FROM ex_bond_permits ep
         JOIN bonded_warehouses bw ON ep.warehouse_id = bw.id
         WHERE ep.status = 'active' AND ep.expires_at <= $1
         ORDER BY ep.expires_at ASC`,
        [thirtyDays]
      ),
    ]);
    return {
      inventoryExpiring: invExpiry,
      bondsExpiring: bondExpiry,
      permitsExpiring: permitExpiry,
      totalAlerts: invExpiry.length + bondExpiry.length + permitExpiry.length,
    };
  }),

  updateWarehouseStatus: adminProcedure
    .input(z.object({
      warehouseId: z.number(),
      status: z.enum(["active", "suspended", "revoked", "pending_renewal"]),
    }))
    .mutation(async ({ input, ctx }) => {
      await pgQuery(
        "UPDATE bonded_warehouses SET status = $1, approved_by = $2, approved_at = NOW(), updated_at = NOW() WHERE id = $3",
        [input.status, ctx.user.id, input.warehouseId]
      );
      return { success: true };
    }),

  getDashboardStats: protectedProcedure.query(async () => {
    const [stats] = await pgQuery(
      `SELECT
        COUNT(DISTINCT bw.id) AS total_warehouses,
        SUM(CASE WHEN bw.status = 'active' THEN 1 ELSE 0 END) AS active_warehouses,
        COUNT(bi.id) AS total_inventory_items,
        SUM(CASE WHEN bi.status = 'in_bond' THEN 1 ELSE 0 END) AS items_in_bond,
        COALESCE(SUM(CASE WHEN bi.status = 'in_bond' THEN bi.invoice_value_usd ELSE 0 END),0) AS total_value_in_bond_usd,
        COALESCE(SUM(CASE WHEN bi.status = 'in_bond' THEN bi.duty_liability_usd ELSE 0 END),0) AS total_duty_liability_usd
       FROM bonded_warehouses bw
       LEFT JOIN bonded_inventory bi ON bi.warehouse_id = bw.id`
    );
    return stats ?? {};
  }),

  /**
   * runExpiryCheck — admin-only on-demand trigger for the bonded warehouse
   * expiry notification job. Returns a summary of expiring/expired items
   * and sends an owner notification if any are found.
   */
  runExpiryCheck: adminProcedure.mutation(async () => {
    const pool = getPool();
    if (!pool) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

    const { rows } = await pool.query(`
      SELECT
        bi.id, bi.ucr, bi.goods_description, bi.quantity, bi.unit,
        bi.bond_expiry_date,
        bw.name AS warehouse_name, bw.location AS warehouse_location, bw.license_number
      FROM bonded_inventory bi
      JOIN bonded_warehouses bw ON bw.id = bi.warehouse_id
      WHERE bi.status = 'active' AND bi.bond_expiry_date IS NOT NULL
      ORDER BY bi.bond_expiry_date ASC
    `);

    const now = new Date();
    const expiringSoon: Array<Record<string, unknown> & { daysUntilExpiry: number }> = [];
    const alreadyExpired: Array<Record<string, unknown> & { daysUntilExpiry: number }> = [];

    for (const row of rows) {
      const expiryDate = new Date(row.bond_expiry_date as string);
      const daysUntilExpiry = Math.ceil(
        (expiryDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)
      );
      if (daysUntilExpiry < 0) {
        alreadyExpired.push({ ...row, daysUntilExpiry });
      } else if (isBondExpiringSoon(row.bond_expiry_date as string, 7)) {
        expiringSoon.push({ ...row, daysUntilExpiry });
      }
    }

    const totalFlagged = expiringSoon.length + alreadyExpired.length;

    if (totalFlagged > 0) {
      const { notifyOwner } = await import("../_core/notification");
      const lines: string[] = [];
      if (alreadyExpired.length > 0) {
        lines.push(`EXPIRED (${alreadyExpired.length} items):`);
        for (const item of alreadyExpired) {
          lines.push(`  • UCR ${item.ucr} — ${item.goods_description} @ ${item.warehouse_name} (${Math.abs(item.daysUntilExpiry)}d overdue)`);
        }
      }
      if (expiringSoon.length > 0) {
        lines.push(`EXPIRING WITHIN 7 DAYS (${expiringSoon.length} items):`);
        for (const item of expiringSoon) {
          lines.push(`  • UCR ${item.ucr} — ${item.goods_description} @ ${item.warehouse_name} (${item.daysUntilExpiry}d remaining)`);
        }
      }
      await notifyOwner({
        title: `Bonded Warehouse Expiry Check — ${totalFlagged} item(s) require attention`,
        content: lines.join("\n"),
      });
    }

    return {
      scanned: rows.length,
      expiringSoon: expiringSoon.length,
      alreadyExpired: alreadyExpired.length,
      totalFlagged,
      items: [
        ...alreadyExpired.map((i) => ({ ...i, flag: "expired" as const })),
        ...expiringSoon.map((i) => ({ ...i, flag: "expiring_soon" as const })),
      ],
    };
  }),
});
