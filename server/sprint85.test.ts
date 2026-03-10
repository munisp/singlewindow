/**
 * Sprint 85 — Test Suite
 * Covers:
 *  1. AEO renewal procedures (renewCertificate, getExpiringCertificates)
 *  2. Pilot Dashboard getReportDetail procedure
 *  3. Certificate CSV export procedures (exportRevokedCsv, exportTopScannedCsv)
 */
import { describe, expect, it } from "vitest";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";

type AuthenticatedUser = NonNullable<TrpcContext["user"]>;

function makeCtx(overrides: Partial<AuthenticatedUser> = {}): TrpcContext {
  const user: AuthenticatedUser = {
    id: 1,
    openId: "test-user",
    email: "test@example.com",
    name: "Test User",
    loginMethod: "manus",
    role: "admin",
    createdAt: new Date(),
    updatedAt: new Date(),
    lastSignedIn: new Date(),
    ...overrides,
  };
  return {
    user,
    req: {} as TrpcContext["req"],
    res: {} as TrpcContext["res"],
  };
}

// ─── AEO Renewal ─────────────────────────────────────────────────────────────

describe("aeo.getExpiringCertificates", () => {
  it("returns an array for admin users", async () => {
    const caller = appRouter.createCaller(makeCtx({ role: "admin" }));
    const result = await caller.aeo.getExpiringCertificates({ withinDays: 60 });
    expect(Array.isArray(result)).toBe(true);
  });

  it("throws FORBIDDEN for non-admin users", async () => {
    const caller = appRouter.createCaller(makeCtx({ role: "user" }));
    await expect(
      caller.aeo.getExpiringCertificates({ withinDays: 60 })
    ).rejects.toThrow();
  });

  it("accepts withinDays between 1 and 365", async () => {
    const caller = appRouter.createCaller(makeCtx({ role: "admin" }));
    const result7 = await caller.aeo.getExpiringCertificates({ withinDays: 7 });
    const result365 = await caller.aeo.getExpiringCertificates({ withinDays: 365 });
    expect(Array.isArray(result7)).toBe(true);
    expect(Array.isArray(result365)).toBe(true);
  });
});

describe("aeo.renewCertificate", () => {
  it("throws NOT_FOUND for non-existent application", async () => {
    const caller = appRouter.createCaller(makeCtx({ role: "admin" }));
    await expect(
      caller.aeo.renewCertificate({ applicationId: 999999999 })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("throws FORBIDDEN for non-admin users", async () => {
    const caller = appRouter.createCaller(makeCtx({ role: "user" }));
    await expect(
      caller.aeo.renewCertificate({ applicationId: 1 })
    ).rejects.toThrow();
  });
});

// ─── Pilot Dashboard Drill-Down ───────────────────────────────────────────────

describe("pilot.getReportDetail", () => {
  it("throws NOT_FOUND for non-existent report", async () => {
    const caller = appRouter.createCaller(makeCtx({ role: "admin" }));
    await expect(
      caller.pilot.getReportDetail({ reportId: 999999999 })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("throws FORBIDDEN for trader role", async () => {
    const caller = appRouter.createCaller(makeCtx({ role: "user" }));
    await expect(
      caller.pilot.getReportDetail({ reportId: 1 })
    ).rejects.toThrow();
  });
});

// ─── Certificate CSV Exports ──────────────────────────────────────────────────

describe("rulesOfOrigin.exportRevokedCsv", () => {
  it("returns csv string, rowCount, and filename for admin", async () => {
    const caller = appRouter.createCaller(makeCtx({ role: "admin" }));
    const result = await caller.rulesOfOrigin.exportRevokedCsv({});
    expect(typeof result.csv).toBe("string");
    expect(typeof result.rowCount).toBe("number");
    expect(result.filename).toMatch(/^revocation-log-\d{4}-\d{2}-\d{2}\.csv$/);
  });

  it("CSV header row is present", async () => {
    const caller = appRouter.createCaller(makeCtx({ role: "admin" }));
    const result = await caller.rulesOfOrigin.exportRevokedCsv({});
    const firstLine = result.csv.split("\n")[0];
    expect(firstLine).toContain("Cert Number");
    expect(firstLine).toContain("Exporter");
    expect(firstLine).toContain("Reason");
  });

  it("throws FORBIDDEN for non-admin", async () => {
    const caller = appRouter.createCaller(makeCtx({ role: "customs_officer" }));
    await expect(
      caller.rulesOfOrigin.exportRevokedCsv({})
    ).rejects.toThrow();
  });

  it("accepts optional search and date filters", async () => {
    const caller = appRouter.createCaller(makeCtx({ role: "admin" }));
    const result = await caller.rulesOfOrigin.exportRevokedCsv({
      search: "CO-",
      revokedFrom: new Date("2024-01-01"),
      revokedTo: new Date("2025-12-31"),
    });
    expect(typeof result.csv).toBe("string");
    expect(result.rowCount).toBeGreaterThanOrEqual(0);
  });
});

describe("rulesOfOrigin.exportTopScannedCsv", () => {
  it("returns csv string, rowCount, and filename for admin", async () => {
    const caller = appRouter.createCaller(makeCtx({ role: "admin" }));
    const result = await caller.rulesOfOrigin.exportTopScannedCsv({});
    expect(typeof result.csv).toBe("string");
    expect(typeof result.rowCount).toBe("number");
    expect(result.filename).toMatch(/^top-scanned-certs-/);
  });

  it("CSV header row contains Rank and Scan Count", async () => {
    const caller = appRouter.createCaller(makeCtx({ role: "admin" }));
    const result = await caller.rulesOfOrigin.exportTopScannedCsv({});
    const firstLine = result.csv.split("\n")[0];
    expect(firstLine).toContain("Rank");
    expect(firstLine).toContain("Scan Count");
    expect(firstLine).toContain("Exporter");
  });

  it("throws FORBIDDEN for trader role", async () => {
    const caller = appRouter.createCaller(makeCtx({ role: "user" }));
    await expect(
      caller.rulesOfOrigin.exportTopScannedCsv({})
    ).rejects.toThrow();
  });

  it("accepts days filter and reflects it in filename", async () => {
    const caller = appRouter.createCaller(makeCtx({ role: "admin" }));
    const result = await caller.rulesOfOrigin.exportTopScannedCsv({ days: 30, limit: 50 });
    expect(result.filename).toContain("last-30d");
  });

  it("all-time filename when no days filter", async () => {
    const caller = appRouter.createCaller(makeCtx({ role: "admin" }));
    const result = await caller.rulesOfOrigin.exportTopScannedCsv({ limit: 10 });
    expect(result.filename).toContain("all-time");
  });

  it("customs_officer and oga_officer can export", async () => {
    for (const role of ["customs_officer", "oga_officer", "finance"] as const) {
      const caller = appRouter.createCaller(makeCtx({ role }));
      const result = await caller.rulesOfOrigin.exportTopScannedCsv({});
      expect(typeof result.csv).toBe("string");
    }
  });
});
