/**
 * Bond Expiry Daily Digest — Heartbeat handler
 * Triggered daily at 07:00 UTC via project-level Heartbeat (§4a).
 * Scans bonded inventory and warehouse bonds expiring within 7 days,
 * then sends a structured owner notification digest.
 *
 * Endpoint: POST /api/scheduled/bond-expiry-digest
 */

import type { Request, Response } from "express";
import { getPool } from "../db";
import { notifyOwner } from "../_core/notification";

export async function bondExpiryDigestHandler(req: Request, res: Response) {
  try {
    const pool = getPool();
    if (!pool) {
      return res.status(500).json({ error: "Database unavailable" });
    }

    const now = new Date();
    const sevenDaysOut = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

    // Query expiring inventory items
    const { rows: inventoryRows } = await pool.query<{
      id: number;
      ucr: string;
      description: string;
      quantity: number;
      unit: string;
      expiry_date: string;
      warehouse_name: string;
      warehouse_location: string;
    }>(
      `SELECT
         bi.id, bi.ucr, bi.description, bi.quantity, bi.unit,
         bi.expiry_date,
         bw.name AS warehouse_name, bw.location AS warehouse_location
       FROM bonded_inventory bi
       JOIN bonded_warehouses bw ON bw.id = bi.warehouse_id
       WHERE bi.status = 'in_bond'
         AND bi.expiry_date IS NOT NULL
         AND bi.expiry_date <= $1
       ORDER BY bi.expiry_date ASC`,
      [sevenDaysOut]
    );

    // Query expiring warehouse bonds
    const { rows: warehouseRows } = await pool.query<{
      id: number;
      name: string;
      license_no: string;
      bond_expiry: string;
      bond_amount_usd: number;
    }>(
      `SELECT id, name, license_no, bond_expiry, bond_amount_usd
       FROM bonded_warehouses
       WHERE status = 'active'
         AND bond_expiry IS NOT NULL
         AND bond_expiry <= $1
       ORDER BY bond_expiry ASC`,
      [sevenDaysOut]
    );

    const totalFlagged = inventoryRows.length + warehouseRows.length;

    if (totalFlagged === 0) {
      return res.json({
        ok: true,
        scanned: { inventory: inventoryRows.length, warehouses: warehouseRows.length },
        flagged: 0,
        message: "No expiring bonds found — no digest sent",
      });
    }

    // Build HTML digest
    const formatDate = (d: string) => new Date(d).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
    const daysUntil = (d: string) => Math.ceil((new Date(d).getTime() - now.getTime()) / 86_400_000);

    const inventorySection = inventoryRows.length > 0
      ? `\n\n=== INVENTORY ITEMS EXPIRING WITHIN 7 DAYS (${inventoryRows.length}) ===\n` +
        inventoryRows.map(r => {
          const days = daysUntil(r.expiry_date);
          const flag = days <= 0 ? "⛔ EXPIRED" : days <= 3 ? "🔴 CRITICAL" : "🟡 WARNING";
          return `  ${flag} | UCR: ${r.ucr} | ${r.description} (${r.quantity} ${r.unit})\n` +
                 `         Warehouse: ${r.warehouse_name} (${r.warehouse_location})\n` +
                 `         Expiry: ${formatDate(r.expiry_date)} (${days <= 0 ? `${Math.abs(days)}d overdue` : `${days}d remaining`})`;
        }).join("\n\n")
      : "";

    const warehouseSection = warehouseRows.length > 0
      ? `\n\n=== WAREHOUSE BONDS EXPIRING WITHIN 7 DAYS (${warehouseRows.length}) ===\n` +
        warehouseRows.map(r => {
          const days = daysUntil(r.bond_expiry);
          const flag = days <= 0 ? "⛔ EXPIRED" : days <= 3 ? "🔴 CRITICAL" : "🟡 WARNING";
          return `  ${flag} | ${r.name} (Lic: ${r.license_no})\n` +
                 `         Bond Amount: USD ${Number(r.bond_amount_usd).toLocaleString()}\n` +
                 `         Expiry: ${formatDate(r.bond_expiry)} (${days <= 0 ? `${Math.abs(days)}d overdue` : `${days}d remaining`})`;
        }).join("\n\n")
      : "";

    const digestContent =
      `Daily Bond Expiry Digest — ${now.toLocaleDateString("en-GB", { weekday: "long", day: "2-digit", month: "long", year: "numeric" })}\n` +
      `Generated at: ${now.toISOString()}\n` +
      `Total items requiring attention: ${totalFlagged}` +
      inventorySection +
      warehouseSection +
      `\n\n---\nThis digest is sent daily at 07:00 UTC. Log in to the Bonded Warehouse Management module to take action.`;

    const notified = await notifyOwner({
      title: `⚠️ Bond Expiry Digest — ${totalFlagged} item(s) require attention`,
      content: digestContent,
    });

    return res.json({
      ok: true,
      scanned: { inventory: inventoryRows.length, warehouses: warehouseRows.length },
      flagged: totalFlagged,
      notified,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    const stack = err instanceof Error ? err.stack : undefined;
    return res.status(500).json({
      error: message,
      stack,
      context: { url: req.url, timestamp: new Date().toISOString() },
    });
  }
}
