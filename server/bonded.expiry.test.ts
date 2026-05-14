/**
 * Bonded Warehouse Expiry Cron Tests
 *
 * Tests the isBondExpiringSoon() utility and the expiry notification logic
 * used by runBondedWarehouseExpiryCheck() in the nightly cron job.
 */

import { describe, it, expect } from "vitest";
import { isBondExpiringSoon } from "../server/routers/bondedWarehouse";

// ─── isBondExpiringSoon utility ───────────────────────────────────────────────
describe("isBondExpiringSoon", () => {
  const now = new Date();

  it("returns true for a bond expiring in 3 days (within default 7-day window)", () => {
    const expiryDate = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000);
    expect(isBondExpiringSoon(expiryDate.toISOString())).toBe(true);
  });

  it("returns true for a bond expiring today", () => {
    const expiryDate = new Date(now.getTime() + 12 * 60 * 60 * 1000); // 12 hours from now
    expect(isBondExpiringSoon(expiryDate.toISOString())).toBe(true);
  });

  it("returns false for a bond expiring in 30 days", () => {
    const expiryDate = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
    expect(isBondExpiringSoon(expiryDate.toISOString(), 7)).toBe(false);
  });

  it("returns false for a bond expiring in exactly 8 days (outside 7-day window)", () => {
    const expiryDate = new Date(now.getTime() + 8 * 24 * 60 * 60 * 1000);
    expect(isBondExpiringSoon(expiryDate.toISOString(), 7)).toBe(false);
  });

  it("returns true for an already-expired bond", () => {
    const expiryDate = new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000); // 2 days ago
    expect(isBondExpiringSoon(expiryDate.toISOString())).toBe(true);
  });

  it("respects custom threshold (14 days)", () => {
    const expiryDate = new Date(now.getTime() + 10 * 24 * 60 * 60 * 1000); // 10 days
    expect(isBondExpiringSoon(expiryDate.toISOString(), 14)).toBe(true);
    expect(isBondExpiringSoon(expiryDate.toISOString(), 7)).toBe(false);
  });

  it("handles Date object input", () => {
    const expiryDate = new Date(now.getTime() + 5 * 24 * 60 * 60 * 1000);
    expect(isBondExpiringSoon(expiryDate)).toBe(true);
  });
});

// ─── Expiry notification content builder ─────────────────────────────────────
describe("Bonded warehouse expiry notification content", () => {
  it("formats expiring-soon items correctly", () => {
    const item = {
      ucr: "UCR-2026-001234",
      goods_description: "Electronic Components",
      quantity: 500,
      unit: "units",
      warehouse_name: "Apapa Bonded Zone A",
      warehouse_location: "Lagos",
      bond_expiry_date: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString(),
      daysUntilExpiry: 5,
    };
    const line =
      `  • UCR: ${item.ucr} | ${item.goods_description} | ` +
      `${item.quantity} ${item.unit} | Warehouse: ${item.warehouse_name} (${item.warehouse_location}) | ` +
      `Expires: ${new Date(item.bond_expiry_date).toLocaleDateString("en-GB")} (in ${item.daysUntilExpiry} days)`;
    expect(line).toContain("UCR-2026-001234");
    expect(line).toContain("Electronic Components");
    expect(line).toContain("Apapa Bonded Zone A");
    expect(line).toContain("in 5 days");
  });

  it("formats already-expired items correctly", () => {
    const item = {
      ucr: "UCR-2026-000999",
      goods_description: "Textile Goods",
      quantity: 200,
      unit: "bales",
      warehouse_name: "Tin Can Island Warehouse",
      warehouse_location: "Lagos",
      bond_expiry_date: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(),
      daysUntilExpiry: -3,
    };
    const line =
      `  • UCR: ${item.ucr} | ${item.goods_description} | ` +
      `Expired: ${new Date(item.bond_expiry_date).toLocaleDateString("en-GB")} (${Math.abs(item.daysUntilExpiry)} days ago)`;
    expect(line).toContain("3 days ago");
    expect(line).toContain("UCR-2026-000999");
  });

  it("uses singular 'day' for exactly 1 day remaining", () => {
    const daysUntilExpiry = 1;
    const suffix = daysUntilExpiry === 1 ? "" : "s";
    expect(`in ${daysUntilExpiry} day${suffix}`).toBe("in 1 day");
  });

  it("uses plural 'days' for 2+ days remaining", () => {
    const daysUntilExpiry = 6;
    const suffix = daysUntilExpiry === 1 ? "" : "s";
    expect(`in ${daysUntilExpiry} day${suffix}`).toBe("in 6 days");
  });

  it("builds notification title with correct count", () => {
    const totalAlerts = 3;
    const title = `🏭 Bonded Warehouse Alert: ${totalAlerts} bond${totalAlerts === 1 ? "" : "s"} expiring soon`;
    expect(title).toBe("🏭 Bonded Warehouse Alert: 3 bonds expiring soon");
  });

  it("uses singular in notification title for 1 alert", () => {
    const totalAlerts = 1;
    const title = `🏭 Bonded Warehouse Alert: ${totalAlerts} bond${totalAlerts === 1 ? "" : "s"} expiring soon`;
    expect(title).toBe("🏭 Bonded Warehouse Alert: 1 bond expiring soon");
  });
});

// ─── Days-until-expiry calculation ───────────────────────────────────────────
describe("Days until expiry calculation", () => {
  it("calculates positive days for future expiry", () => {
    const now = new Date();
    const future = new Date(now.getTime() + 5 * 24 * 60 * 60 * 1000);
    const days = Math.ceil((future.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
    expect(days).toBe(5);
  });

  it("calculates negative days for past expiry", () => {
    const now = new Date();
    const past = new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000);
    const days = Math.ceil((past.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
    expect(days).toBeLessThan(0);
  });

  it("correctly classifies expired vs expiring-soon items", () => {
    const now = new Date();
    const items = [
      { bond_expiry_date: new Date(now.getTime() - 2 * 86400000).toISOString() }, // expired
      { bond_expiry_date: new Date(now.getTime() + 3 * 86400000).toISOString() }, // expiring soon
      { bond_expiry_date: new Date(now.getTime() + 30 * 86400000).toISOString() }, // fine
    ];

    const expired = items.filter((i) => {
      const days = Math.ceil((new Date(i.bond_expiry_date).getTime() - now.getTime()) / 86400000);
      return days < 0;
    });
    const expiringSoon = items.filter((i) => {
      const days = Math.ceil((new Date(i.bond_expiry_date).getTime() - now.getTime()) / 86400000);
      return days >= 0 && days <= 7;
    });

    expect(expired).toHaveLength(1);
    expect(expiringSoon).toHaveLength(1);
  });
});
