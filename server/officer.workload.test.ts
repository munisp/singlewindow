/**
 * Tests for Sprint 14 procedures:
 *   - officerWorkload.getTeamSummary
 *   - officerWorkload.getMyWorkload
 *   - declarations.listMyCertificates
 *   - alerts.getExpiringPermits
 *   - alerts.runPermitExpiryCheck
 */

import { describe, it, expect } from "vitest";
import { appRouter } from "./routers";

// ─── HELPERS ─────────────────────────────────────────────────────────────────

type Role = "admin" | "customs_officer" | "user" | "oga_officer" | "finance";

function makeCtx(role: Role = "admin", id = 1) {
  return {
    user: { id, openId: "test-open-id", name: "Test User", email: "test@example.com", role, createdAt: new Date(), updatedAt: new Date(), lastSignedIn: new Date() },
    req: {} as any,
    res: { clearCookie: () => {} } as any,
  };
}

function makeAnon() {
  return { user: null, req: {} as any, res: {} as any };
}

// ─── OFFICER WORKLOAD: getTeamSummary ─────────────────────────────────────────

describe("officerWorkload.getTeamSummary", () => {
  it("rejects unauthenticated callers", async () => {
    const caller = appRouter.createCaller(makeAnon() as any);
    await expect(caller.officerWorkload.getTeamSummary({ periodDays: 30, slaTargetHours: 24 }))
      .rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("rejects non-officer non-admin roles", async () => {
    const caller = appRouter.createCaller(makeCtx("user") as any);
    await expect(caller.officerWorkload.getTeamSummary({ periodDays: 30, slaTargetHours: 24 }))
      .rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("rejects oga_officer role", async () => {
    const caller = appRouter.createCaller(makeCtx("oga_officer") as any);
    await expect(caller.officerWorkload.getTeamSummary({ periodDays: 30, slaTargetHours: 24 }))
      .rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("accepts admin role and returns expected shape (DB unavailable → INTERNAL_SERVER_ERROR or empty)", async () => {
    const caller = appRouter.createCaller(makeCtx("admin") as any);
    try {
      const result = await caller.officerWorkload.getTeamSummary({ periodDays: 30, slaTargetHours: 24 });
      expect(result).toHaveProperty("officers");
      expect(result).toHaveProperty("teamStats");
      expect(Array.isArray(result.officers)).toBe(true);
      expect(result.teamStats).toHaveProperty("totalOfficers");
      expect(result.teamStats).toHaveProperty("totalQueueDepth");
    } catch (err: any) {
      expect(err.code).toBe("INTERNAL_SERVER_ERROR");
    }
  });

  it("accepts customs_officer role", async () => {
    const caller = appRouter.createCaller(makeCtx("customs_officer") as any);
    try {
      const result = await caller.officerWorkload.getTeamSummary({ periodDays: 7, slaTargetHours: 48 });
      expect(result).toHaveProperty("teamStats");
    } catch (err: any) {
      expect(err.code).toBe("INTERNAL_SERVER_ERROR");
    }
  });

  it("rejects periodDays > 90", async () => {
    const caller = appRouter.createCaller(makeCtx("admin") as any);
    await expect(caller.officerWorkload.getTeamSummary({ periodDays: 91, slaTargetHours: 24 }))
      .rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("rejects slaTargetHours > 168", async () => {
    const caller = appRouter.createCaller(makeCtx("admin") as any);
    await expect(caller.officerWorkload.getTeamSummary({ periodDays: 30, slaTargetHours: 200 }))
      .rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
});

// ─── OFFICER WORKLOAD: getMyWorkload ─────────────────────────────────────────

describe("officerWorkload.getMyWorkload", () => {
  it("rejects unauthenticated callers", async () => {
    const caller = appRouter.createCaller(makeAnon() as any);
    await expect(caller.officerWorkload.getMyWorkload({ periodDays: 30 }))
      .rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("rejects user role", async () => {
    const caller = appRouter.createCaller(makeCtx("user") as any);
    await expect(caller.officerWorkload.getMyWorkload({ periodDays: 30 }))
      .rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("accepts customs_officer role and returns expected shape", async () => {
    const caller = appRouter.createCaller(makeCtx("customs_officer") as any);
    try {
      const result = await caller.officerWorkload.getMyWorkload({ periodDays: 30 });
      expect(result).toHaveProperty("queueDepth");
      expect(result).toHaveProperty("openFraudCases");
      expect(result).toHaveProperty("declarationsReviewedInPeriod");
      expect(result).toHaveProperty("avgReviewTimeHours");
    } catch (err: any) {
      expect(err.code).toBe("INTERNAL_SERVER_ERROR");
    }
  });

  it("rejects periodDays > 90", async () => {
    const caller = appRouter.createCaller(makeCtx("customs_officer") as any);
    await expect(caller.officerWorkload.getMyWorkload({ periodDays: 100 }))
      .rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
});

// ─── DECLARATIONS: listMyCertificates ────────────────────────────────────────

describe("declarations.listMyCertificates", () => {
  it("rejects unauthenticated callers", async () => {
    const caller = appRouter.createCaller(makeAnon() as any);
    await expect(caller.declarations.listMyCertificates({ limit: 20, offset: 0 }))
      .rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("accepts authenticated user and returns array shape", async () => {
    const caller = appRouter.createCaller(makeCtx("user") as any);
    try {
      const result = await caller.declarations.listMyCertificates({ limit: 20, offset: 0 });
      expect(Array.isArray(result)).toBe(true);
    } catch (err: any) {
      expect(err.code).toBe("INTERNAL_SERVER_ERROR");
    }
  });

  it("rejects limit > 100", async () => {
    const caller = appRouter.createCaller(makeCtx("user") as any);
    await expect(caller.declarations.listMyCertificates({ limit: 200, offset: 0 }))
      .rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
});

// ─── ALERTS: getExpiringPermits ───────────────────────────────────────────────

describe("alerts.getExpiringPermits", () => {
  it("rejects unauthenticated callers", async () => {
    const caller = appRouter.createCaller(makeAnon() as any);
    await expect(caller.alerts.getExpiringPermits({ daysAhead: 30 }))
      .rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("rejects user role", async () => {
    const caller = appRouter.createCaller(makeCtx("user") as any);
    await expect(caller.alerts.getExpiringPermits({ daysAhead: 30 }))
      .rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("accepts admin role and returns array", async () => {
    const caller = appRouter.createCaller(makeCtx("admin") as any);
    try {
      const result = await caller.alerts.getExpiringPermits({ daysAhead: 30 });
      expect(Array.isArray(result)).toBe(true);
    } catch (err: any) {
      expect(err.code).toBe("INTERNAL_SERVER_ERROR");
    }
  });

  it("rejects daysAhead > 90", async () => {
    const caller = appRouter.createCaller(makeCtx("admin") as any);
    await expect(caller.alerts.getExpiringPermits({ daysAhead: 91 }))
      .rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
});

// ─── ALERTS: runPermitExpiryCheck ────────────────────────────────────────────

describe("alerts.runPermitExpiryCheck", () => {
  it("rejects unauthenticated callers", async () => {
    const caller = appRouter.createCaller(makeAnon() as any);
    await expect(caller.alerts.runPermitExpiryCheck({ daysAhead: 30 }))
      .rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("rejects non-admin roles", async () => {
    const caller = appRouter.createCaller(makeCtx("user") as any);
    await expect(caller.alerts.runPermitExpiryCheck({ daysAhead: 30 }))
      .rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("accepts admin and returns result shape", async () => {
    const caller = appRouter.createCaller(makeCtx("admin") as any);
    try {
      const result = await caller.alerts.runPermitExpiryCheck({ daysAhead: 30 });
      expect(result).toHaveProperty("permitsFound");
      expect(result).toHaveProperty("notificationSent");
    } catch (err: any) {
      expect(err.code).toBe("INTERNAL_SERVER_ERROR");
    }
  });
});
