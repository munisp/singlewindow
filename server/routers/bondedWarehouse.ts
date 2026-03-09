/**
 * Bonded Warehouse Router — Sprint 56: Bonded Warehouse & Free Zone Management
 * Manages warehouse registration, goods-in-bond inventory, bond guarantees,
 * ex-bond permit issuance, and expiry alerts.
 */

import { z } from "zod";
import { publicProcedure, router } from "../_core/trpc";
import crypto from "crypto";

// ─── Types ───────────────────────────────────────────────────────────────────

export type WarehouseStatus = "active" | "suspended" | "revoked" | "pending_renewal";
export type InventoryStatus = "in_bond" | "ex_bonded" | "re_exported" | "destroyed" | "seized";
export type PermitStatus = "active" | "used" | "expired" | "cancelled";

interface BondedWarehouse {
  id: string;
  name: string;
  licenseNo: string;
  operatorId: string;
  operatorName: string;
  country: string;
  address: string;
  capacityCbm: number;
  usedCbm: number;
  bondAmountUsd: number;
  bondExpiry: string;
  status: WarehouseStatus;
  createdAt: string;
}

interface BondedInventoryItem {
  id: string;
  warehouseId: string;
  warehouseName: string;
  declarationId: string;
  hsCode: string;
  description: string;
  quantity: number;
  unit: string;
  weightKg: number;
  volumeCbm: number;
  valueUsd: number;
  entryDate: string;
  expectedExitDate: string;
  status: InventoryStatus;
  exBondPermitId: string | null;
}

interface ExBondPermit {
  id: string;
  permitNo: string;
  inventoryId: string;
  warehouseId: string;
  destination: string;
  quantity: number;
  issuedAt: string;
  expiresAt: string;
  status: PermitStatus;
  issuedBy: string;
}

// ─── In-memory stores ────────────────────────────────────────────────────────

const _warehouses: BondedWarehouse[] = [];
const _inventory: BondedInventoryItem[] = [];
const _permits: ExBondPermit[] = [];
let _seeded = false;

// ─── Bond guarantee logic ────────────────────────────────────────────────────

/**
 * Calculates the required bond guarantee amount based on inventory value
 * and warehouse tier. Bond must cover 110% of total goods value.
 */
export function calculateBondRequirement(totalInventoryValueUsd: number): number {
  return Math.ceil(totalInventoryValueUsd * 1.1);
}

/**
 * Checks if a bond is expiring within the given number of days.
 */
export function isBondExpiringSoon(bondExpiry: string, withinDays = 30): boolean {
  const expiry = new Date(bondExpiry).getTime();
  const threshold = Date.now() + withinDays * 86400_000;
  return expiry <= threshold;
}

/**
 * Generates a permit number in the format BW-YYYY-XXXXXX.
 */
export function generatePermitNo(): string {
  const year = new Date().getFullYear();
  const suffix = crypto.randomBytes(3).toString("hex").toUpperCase();
  return `BW-${year}-${suffix}`;
}

// ─── Seed demo data ──────────────────────────────────────────────────────────

function seedDemoData() {
  if (_seeded) return;
  _seeded = true;

  const now = Date.now();

  // Warehouses
  const warehouseData = [
    { name: "Tema Port Bonded Zone A", country: "GH", operator: "Ghana Ports Authority", capacity: 5000, bond: 2_000_000 },
    { name: "Kigali Logistics Hub", country: "RW", operator: "Rwanda Trade Logistics Ltd", capacity: 2500, bond: 800_000 },
    { name: "Mombasa Free Trade Zone", country: "KE", operator: "Kenya Ports Authority", capacity: 8000, bond: 3_500_000 },
    { name: "Lagos Apapa Bonded Warehouse", country: "NG", operator: "NPA Bonded Services", capacity: 6000, bond: 2_500_000 },
  ];

  for (let i = 0; i < warehouseData.length; i++) {
    const w = warehouseData[i];
    const wh: BondedWarehouse = {
      id: `wh-${String(i + 1).padStart(3, "0")}`,
      name: w.name,
      licenseNo: `BWL-${2024 + i}-${String(i + 1).padStart(4, "0")}`,
      operatorId: `op-${String(i + 1).padStart(3, "0")}`,
      operatorName: w.operator,
      country: w.country,
      address: `${w.country} Industrial Zone, Unit ${i + 1}`,
      capacityCbm: w.capacity,
      usedCbm: Math.floor(w.capacity * (0.3 + i * 0.1)),
      bondAmountUsd: w.bond,
      bondExpiry: new Date(now + (90 + i * 30) * 86400_000).toISOString(),
      status: i === 2 ? "pending_renewal" : "active",
      createdAt: new Date(now - (365 + i * 30) * 86400_000).toISOString(),
    };
    _warehouses.push(wh);
  }

  // Inventory
  const hsCodes = ["6204", "8471", "2710", "7108", "3004", "8703"];
  const descriptions = ["Textile goods", "Computers", "Petroleum products", "Gold bullion", "Pharmaceuticals", "Motor vehicles"];

  for (let i = 0; i < 20; i++) {
    const wh = _warehouses[i % _warehouses.length];
    const hsIdx = i % hsCodes.length;
    const statuses: InventoryStatus[] = ["in_bond", "in_bond", "in_bond", "ex_bonded", "re_exported"];
    const status = statuses[i % statuses.length];
    const item: BondedInventoryItem = {
      id: `inv-${String(i + 1).padStart(4, "0")}`,
      warehouseId: wh.id,
      warehouseName: wh.name,
      declarationId: `DECL-${20000 + i}`,
      hsCode: hsCodes[hsIdx],
      description: descriptions[hsIdx],
      quantity: 10 + i * 5,
      unit: "units",
      weightKg: 100 + i * 50,
      volumeCbm: 1 + i * 0.5,
      valueUsd: 5000 + i * 2500,
      entryDate: new Date(now - (30 + i * 5) * 86400_000).toISOString(),
      expectedExitDate: new Date(now + (60 - i * 3) * 86400_000).toISOString(),
      status,
      exBondPermitId: status === "ex_bonded" ? `permit-${String(i + 1).padStart(3, "0")}` : null,
    };
    _inventory.push(item);
  }

  // Permits
  for (let i = 0; i < 8; i++) {
    const inv = _inventory.filter((it) => it.status === "ex_bonded")[i % 4];
    if (!inv) continue;
    const permitStatuses: PermitStatus[] = ["active", "used", "expired"];
    _permits.push({
      id: `permit-${String(i + 1).padStart(3, "0")}`,
      permitNo: `BW-${2025 + Math.floor(i / 4)}-${String(i + 1).padStart(6, "0")}`,
      inventoryId: inv.id,
      warehouseId: inv.warehouseId,
      destination: ["Accra Central Market", "Kigali Industrial Park", "Nairobi CBD", "Lagos Free Zone"][i % 4],
      quantity: inv.quantity,
      issuedAt: new Date(now - (10 + i * 3) * 86400_000).toISOString(),
      expiresAt: new Date(now + (20 - i * 2) * 86400_000).toISOString(),
      status: permitStatuses[i % permitStatuses.length],
      issuedBy: `officer-${String((i % 3) + 1).padStart(3, "0")}`,
    });
  }
}

// ─── Router ──────────────────────────────────────────────────────────────────

export const bondedWarehouseRouter = router({
  // ─── Warehouses ────────────────────────────────────────────────────────────

  listWarehouses: publicProcedure
    .input(
      z.object({
        country: z.string().optional(),
        status: z.enum(["active", "suspended", "revoked", "pending_renewal"]).optional(),
      })
    )
    .query(({ input }) => {
      seedDemoData();
      let results = [..._warehouses];
      if (input.country) results = results.filter((w) => w.country === input.country);
      if (input.status) results = results.filter((w) => w.status === input.status);
      return { total: results.length, warehouses: results };
    }),

  registerWarehouse: publicProcedure
    .input(
      z.object({
        name: z.string().min(3),
        operatorId: z.string(),
        operatorName: z.string(),
        country: z.string().length(2),
        address: z.string(),
        capacityCbm: z.number().positive(),
        bondAmountUsd: z.number().positive(),
        bondExpiry: z.string(),
      })
    )
    .mutation(({ input }) => {
      seedDemoData();
      const now = new Date().toISOString();
      const wh: BondedWarehouse = {
        id: `wh-${crypto.randomBytes(4).toString("hex")}`,
        name: input.name,
        licenseNo: `BWL-${new Date().getFullYear()}-${crypto.randomBytes(2).toString("hex").toUpperCase()}`,
        operatorId: input.operatorId,
        operatorName: input.operatorName,
        country: input.country,
        address: input.address,
        capacityCbm: input.capacityCbm,
        usedCbm: 0,
        bondAmountUsd: input.bondAmountUsd,
        bondExpiry: input.bondExpiry,
        status: "active",
        createdAt: now,
      };
      _warehouses.push(wh);
      return wh;
    }),

  // ─── Inventory ─────────────────────────────────────────────────────────────

  getInventory: publicProcedure
    .input(
      z.object({
        warehouseId: z.string().optional(),
        status: z.enum(["in_bond", "ex_bonded", "re_exported", "destroyed", "seized"]).optional(),
        limit: z.number().int().min(1).max(100).default(50),
        offset: z.number().int().min(0).default(0),
      })
    )
    .query(({ input }) => {
      seedDemoData();
      let results = [..._inventory];
      if (input.warehouseId) results = results.filter((i) => i.warehouseId === input.warehouseId);
      if (input.status) results = results.filter((i) => i.status === input.status);
      results.sort((a, b) => b.entryDate.localeCompare(a.entryDate));
      return { total: results.length, items: results.slice(input.offset, input.offset + input.limit) };
    }),

  recordEntry: publicProcedure
    .input(
      z.object({
        warehouseId: z.string(),
        declarationId: z.string(),
        hsCode: z.string(),
        description: z.string(),
        quantity: z.number().positive(),
        unit: z.string().default("units"),
        weightKg: z.number().positive(),
        volumeCbm: z.number().positive(),
        valueUsd: z.number().positive(),
        expectedExitDate: z.string(),
      })
    )
    .mutation(({ input }) => {
      seedDemoData();
      const wh = _warehouses.find((w) => w.id === input.warehouseId);
      if (!wh) throw new Error(`Warehouse ${input.warehouseId} not found`);
      if (wh.usedCbm + input.volumeCbm > wh.capacityCbm) {
        throw new Error("Insufficient warehouse capacity");
      }
      const item: BondedInventoryItem = {
        id: `inv-${crypto.randomBytes(4).toString("hex")}`,
        warehouseId: input.warehouseId,
        warehouseName: wh.name,
        declarationId: input.declarationId,
        hsCode: input.hsCode,
        description: input.description,
        quantity: input.quantity,
        unit: input.unit,
        weightKg: input.weightKg,
        volumeCbm: input.volumeCbm,
        valueUsd: input.valueUsd,
        entryDate: new Date().toISOString(),
        expectedExitDate: input.expectedExitDate,
        status: "in_bond",
        exBondPermitId: null,
      };
      wh.usedCbm += input.volumeCbm;
      _inventory.push(item);
      return item;
    }),

  recordExit: publicProcedure
    .input(
      z.object({
        inventoryId: z.string(),
        exitType: z.enum(["ex_bonded", "re_exported", "destroyed"]),
        permitId: z.string().optional(),
      })
    )
    .mutation(({ input }) => {
      seedDemoData();
      const item = _inventory.find((i) => i.id === input.inventoryId);
      if (!item) throw new Error(`Inventory item ${input.inventoryId} not found`);
      if (item.status !== "in_bond") throw new Error("Item is not in bond status");
      item.status = input.exitType;
      if (input.permitId) item.exBondPermitId = input.permitId;
      // Free up warehouse capacity
      const wh = _warehouses.find((w) => w.id === item.warehouseId);
      if (wh) wh.usedCbm = Math.max(0, wh.usedCbm - item.volumeCbm);
      return item;
    }),

  // ─── Ex-Bond Permits ───────────────────────────────────────────────────────

  issueExBondPermit: publicProcedure
    .input(
      z.object({
        inventoryId: z.string(),
        destination: z.string(),
        quantity: z.number().positive(),
        issuedBy: z.string(),
        validDays: z.number().int().min(1).max(90).default(30),
      })
    )
    .mutation(({ input }) => {
      seedDemoData();
      const item = _inventory.find((i) => i.id === input.inventoryId);
      if (!item) throw new Error(`Inventory item ${input.inventoryId} not found`);
      const now = new Date();
      const permit: ExBondPermit = {
        id: `permit-${crypto.randomBytes(4).toString("hex")}`,
        permitNo: generatePermitNo(),
        inventoryId: input.inventoryId,
        warehouseId: item.warehouseId,
        destination: input.destination,
        quantity: input.quantity,
        issuedAt: now.toISOString(),
        expiresAt: new Date(now.getTime() + input.validDays * 86400_000).toISOString(),
        status: "active",
        issuedBy: input.issuedBy,
      };
      _permits.push(permit);
      return permit;
    }),

  listPermits: publicProcedure
    .input(
      z.object({
        warehouseId: z.string().optional(),
        status: z.enum(["active", "used", "expired", "cancelled"]).optional(),
      })
    )
    .query(({ input }) => {
      seedDemoData();
      let results = [..._permits];
      if (input.warehouseId) results = results.filter((p) => p.warehouseId === input.warehouseId);
      if (input.status) results = results.filter((p) => p.status === input.status);
      results.sort((a, b) => b.issuedAt.localeCompare(a.issuedAt));
      return { total: results.length, permits: results };
    }),

  // ─── Bond Guarantees & Expiry Alerts ──────────────────────────────────────

  getBondGuarantees: publicProcedure.query(() => {
    seedDemoData();
    return _warehouses.map((wh) => {
      const whInventory = _inventory.filter((i) => i.warehouseId === wh.id && i.status === "in_bond");
      const totalValue = whInventory.reduce((s, i) => s + i.valueUsd, 0);
      const required = calculateBondRequirement(totalValue);
      return {
        warehouseId: wh.id,
        warehouseName: wh.name,
        bondAmountUsd: wh.bondAmountUsd,
        requiredBondUsd: required,
        inventoryValueUsd: totalValue,
        isSufficient: wh.bondAmountUsd >= required,
        bondExpiry: wh.bondExpiry,
        isExpiringSoon: isBondExpiringSoon(wh.bondExpiry, 30),
      };
    });
  }),

  getExpiryAlerts: publicProcedure.query(() => {
    seedDemoData();
    const now = Date.now();
    const alerts: Array<{
      type: "bond_expiry" | "inventory_overdue" | "permit_expiry";
      id: string;
      name: string;
      daysUntilExpiry: number;
      severity: "warning" | "critical";
    }> = [];

    // Bond expiry alerts
    for (const wh of _warehouses) {
      const daysLeft = Math.floor((new Date(wh.bondExpiry).getTime() - now) / 86400_000);
      if (daysLeft <= 60) {
        alerts.push({
          type: "bond_expiry",
          id: wh.id,
          name: wh.name,
          daysUntilExpiry: daysLeft,
          severity: daysLeft <= 14 ? "critical" : "warning",
        });
      }
    }

    // Overdue inventory
    for (const item of _inventory.filter((i) => i.status === "in_bond")) {
      const daysOverdue = Math.floor((now - new Date(item.expectedExitDate).getTime()) / 86400_000);
      if (daysOverdue > 0) {
        alerts.push({
          type: "inventory_overdue",
          id: item.id,
          name: `${item.description} (${item.declarationId})`,
          daysUntilExpiry: -daysOverdue,
          severity: daysOverdue > 30 ? "critical" : "warning",
        });
      }
    }

    // Permit expiry
    for (const permit of _permits.filter((p) => p.status === "active")) {
      const daysLeft = Math.floor((new Date(permit.expiresAt).getTime() - now) / 86400_000);
      if (daysLeft <= 7) {
        alerts.push({
          type: "permit_expiry",
          id: permit.id,
          name: permit.permitNo,
          daysUntilExpiry: daysLeft,
          severity: daysLeft <= 2 ? "critical" : "warning",
        });
      }
    }

    return { total: alerts.length, alerts: alerts.sort((a, b) => a.daysUntilExpiry - b.daysUntilExpiry) };
  }),
});
