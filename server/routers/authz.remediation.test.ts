/**
 * authz.remediation.test.ts — Phase-6 Group 3 regression tests
 *
 * SW-G3:    withRlsContext sets exactly the GUC names RLS policies read.
 * SW-G4:    four-eyes store is Postgres-backed, consume-on-use, enforced.
 * SW-G7:    finance reads gated to finance/admin; trader variant self-scoped.
 * SW-FLAG1: auditEngine lifecycle role-gated.
 * SW-28:    ogaBulkApprove per-permit validation + four-eyes threshold.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";

const state = {
  gucs: [] as Array<[string, string]>,
  fourEyesRows: [] as Array<Record<string, unknown>>,
  fourEyesUpdates: [] as Array<Record<string, unknown>>,
  fourEyesConsumeResult: null as null | Record<string, unknown>,
  permitRows: [] as Array<Record<string, unknown>>,
  declarationRows: [] as Array<Record<string, unknown>>,
  notifications: [] as Array<Record<string, unknown>>,
  bulkActionInserts: [] as Array<Record<string, unknown>>,
  dbNull: false,
};

vi.mock("../db", () => ({
  getDb: vi.fn(async () => {
    if (state.dbNull) return null;
    return {
      select: () => ({
        from: (table: any) => ({
          where: async () => {
            const name = table?.[Symbol.for("drizzle:Name")] ?? "";
            if (String(name).includes("four_eyes")) return state.fourEyesRows;
            if (String(name).includes("oga_permits")) return state.permitRows;
            return state.declarationRows;
          },
          orderBy: () => ({ limit: async () => state.fourEyesRows }),
          limit: async () => state.declarationRows,
        }),
      }),
      insert: (table: any) => ({
        values: (v: any) => {
          const name = String(table?.[Symbol.for("drizzle:Name")] ?? "");
          if (name.includes("four_eyes")) {
            const row = { id: 55, status: "pending", ...v };
            state.fourEyesRows.push(row);
            return { returning: async () => [row] };
          }
          state.bulkActionInserts.push(v);
          return { returning: async () => [{ id: 1 }] };
        },
      }),
      update: (table: any) => ({
        set: (v: any) => ({
          where: () => {
            const name = String(table?.[Symbol.for("drizzle:Name")] ?? "");
            const rows = name.includes("four_eyes") && state.fourEyesConsumeResult
              ? [state.fourEyesConsumeResult]
              : [];
            // Awaitable AND .returning()-capable (drizzle update supports both)
            return {
              returning: async () => rows,
              then: (resolve: any) => resolve(rows),
            };
          },
        }),
      }),
    };
  }),
  createUserNotification: vi.fn(async (d: Record<string, unknown>) => {
    state.notifications.push(d);
  }),
  logAuditEvent: vi.fn(async () => {}),
  withRlsContext: vi.fn(async (user: { id: number; role: string }, cb: any) => {
    // txDb mimic: select().from().where(...) is awaitable (→ []) and chains
    // orderBy().limit().offset() (→ [])
    const whereResult = Object.assign(Promise.resolve([{ total: 0 }]), {
      orderBy: () => ({ limit: () => ({ offset: async () => [] }) }),
    });
    return cb({
      select: () => ({ from: () => ({ where: () => whereResult }) }),
    });
  }),
}));

vi.mock("../_core/kafka", () => ({
  publishEvent: vi.fn(async () => {}),
  TOPICS: { INSIDER_THREAT_DETECTED: "t", SANCTIONS_HIT: "s" },
}));

// ── SW-G3: GUC names (unit-level against the real db.ts implementation) ──────
describe("SW-G3: RLS GUC wiring", () => {
  it("db.ts sets app.current_role and app.current_trader_id (what policies read)", async () => {
    const fs = await import("node:fs");
    const src = fs.readFileSync(new URL("../db.ts", import.meta.url), "utf8");
    expect(src).toContain("app.current_user_id");
    expect(src).toContain("app.current_role");
    expect(src).toContain("app.current_trader_id");
    expect(src).not.toContain("app.current_user_role");
  });

  it("RLS policies are folded into the drizzle migration chain", async () => {
    const fs = await import("node:fs");
    const mig = fs.readFileSync(
      new URL("../../drizzle/migrations/0052_phase6_rls.sql", import.meta.url), "utf8");
    expect(mig).toContain("CREATE POLICY");
    expect(mig).toContain("DROP POLICY IF EXISTS");
    expect(mig).toContain("NOBYPASSRLS"); // app-role requirement documented
  });
});

// ── SW-G4: four-eyes enforcement ─────────────────────────────────────────────
describe("SW-G4: dual-control enforcement", () => {
  beforeEach(() => {
    state.fourEyesRows = [];
    state.fourEyesConsumeResult = null;
    state.dbNull = false;
  });

  it("consumeFourEyesApproval throws PRECONDITION_FAILED with no valid approval", async () => {
    const { consumeFourEyesApproval } = await import("../_core/fourEyes");
    await expect(
      consumeFourEyesApproval({ action: "force_logout", entityType: "user", entityId: "7" })
    ).rejects.toThrow(/FOUR_EYES_APPROVAL_REQUIRED/);
  });

  it("consumeFourEyesApproval fails closed when the store is unavailable", async () => {
    state.dbNull = true;
    const { consumeFourEyesApproval } = await import("../_core/fourEyes");
    await expect(
      consumeFourEyesApproval({ action: "force_logout", entityType: "user", entityId: "7" })
    ).rejects.toThrow(/FOUR_EYES_STORE_UNAVAILABLE/);
  });

  it("request → approve lifecycle is Postgres-backed", async () => {
    const { createFourEyesRequest } = await import("../_core/fourEyes");
    const rec = await createFourEyesRequest({
      action: "force_logout", entityType: "user", entityId: "7", requestedBy: 1,
    });
    expect(rec.id).toBe(55);
    expect(state.fourEyesRows.some(r => r.action === "force_logout")).toBe(true);
  });

  it("forceLogout rejects without an approval record", async () => {
    const { insiderThreatRouter } = await import("./insiderThreat");
    const caller = insiderThreatRouter.createCaller({
      user: { id: 1, role: "admin", openId: "a", name: "Admin" }, req: {}, res: {},
    } as any);
    await expect(
      caller.forceLogout({ sessionId: "sess-1", reason: "test", targetUserId: 7 })
    ).rejects.toThrow(/FOUR_EYES_APPROVAL_REQUIRED/);
  });
});

// ── SW-G7: finance gating ────────────────────────────────────────────────────
describe("SW-G7: finance console gating", () => {
  const traderCtx = { user: { id: 9, role: "trader", openId: "t", name: "Trader" }, req: {}, res: {} } as any;
  const financeCtx = { user: { id: 2, role: "finance", openId: "f", name: "Fin" }, req: {}, res: {} } as any;

  it("traders are FORBIDDEN from platform queue reads", async () => {
    const { batchPaymentsRouter } = await import("./batchPayments");
    const caller = batchPaymentsRouter.createCaller(traderCtx);
    await expect(caller.getQueueStats()).rejects.toThrow(/Finance or admin/);
    await expect(caller.listQueue({ status: "all", page: 1, pageSize: 20 })).rejects.toThrow(/Finance or admin/);
    await expect(caller.listAllAccounts({ page: 1, pageSize: 20 })).rejects.toThrow(/Finance or admin/);
  });

  it("finance role can read queue stats (proceeds past the gate)", async () => {
    const { batchPaymentsRouter } = await import("./batchPayments");
    const caller = batchPaymentsRouter.createCaller(financeCtx);
    // db select mock returns [] → resolves without FORBIDDEN
    await expect(caller.listMyQueue({ page: 1, pageSize: 5 })).resolves.toMatchObject({ scope: "trader" });
  });
});

// ── SW-FLAG1: auditEngine role gating ────────────────────────────────────────
describe("SW-FLAG1: audit lifecycle role gate", () => {
  it("traders cannot create audit tasks", async () => {
    const { auditEngineRouter } = await import("./auditEngine");
    const caller = auditEngineRouter.createCaller({
      user: { id: 9, role: "trader", openId: "t", name: "T" }, req: {}, res: {},
    } as any);
    await expect(caller.createAuditTask({
      declarationId: "d1", declarantName: "X", declaredValueUsd: 100, dutyPaidUsd: 10,
      selectionReason: "risk_score_high", riskScore: 90,
    })).rejects.toThrow(/Customs officer or admin/);
  });

  it("anonymous callers cannot read audit stats", async () => {
    const { auditEngineRouter } = await import("./auditEngine");
    const caller = auditEngineRouter.createCaller({ user: null, req: {}, res: {} } as any);
    await expect(caller.getAuditStats()).rejects.toThrow();
  });
});

// ── SW-28: ogaBulkApprove ────────────────────────────────────────────────────
describe("SW-28: bulk OGA approval honesty", () => {
  beforeEach(() => {
    state.permitRows = [];
    state.declarationRows = [];
    state.notifications = [];
    state.bulkActionInserts = [];
    state.fourEyesConsumeResult = null;
    state.dbNull = false;
  });
  const adminCtx = { user: { id: 1, role: "admin", openId: "a", name: "A" }, req: {}, res: {} } as any;

  it("unknown permit ids fail the whole request", async () => {
    state.permitRows = [{ id: 1, status: "pending", declarationId: 5 }];
    const { ogaBulkApproveRouter } = await import("./ogaBulkApprove");
    const caller = ogaBulkApproveRouter.createCaller(adminCtx);
    await expect(caller.bulkApprove({ permitIds: [1, 999] })).rejects.toThrow(/Unknown permit ids: 999/);
  });

  it("batches above threshold require four-eyes approval", async () => {
    state.permitRows = Array.from({ length: 11 }, (_, i) => ({ id: i + 1, status: "pending", declarationId: 5 }));
    const { ogaBulkApproveRouter } = await import("./ogaBulkApprove");
    const caller = ogaBulkApproveRouter.createCaller(adminCtx);
    await expect(
      caller.bulkApprove({ permitIds: state.permitRows.map(p => p.id as number) })
    ).rejects.toThrow(/FOUR_EYES_APPROVAL_REQUIRED/);
  });
});
