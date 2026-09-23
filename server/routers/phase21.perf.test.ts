/**
 * phase21.perf.test.ts — Phase 21 (perf) router hot-path round-trip
 * eliminations and result-set bounding.
 *
 * Covers:
 *   - shorePass: batched expiry sweep (ONE set-based UPDATE + ONE batched
 *     audit-event insert) replacing serialized per-row lazy expiry in the
 *     list endpoints; mandatory-bounded list reads (listMine ≤200,
 *     listForOfficer default 100 / max 500 with limit+offset).
 *   - slaEscalation.autoEscalate: in-memory breach evaluation, ONE batched
 *     existence check (IN (...)), bulk inserts; dry-run writes nothing.
 *   - portCongestion: 60 s in-process port-profiles cache in front of the
 *     trailing-7-day aggregate.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createMockDrizzleDb, type MockStore } from "../testutils/mockDrizzleDb";

const store: MockStore = {};
const poolQuery = vi.fn();

vi.mock("../db", () => ({
  getDb: vi.fn(async () => createMockDrizzleDb(store)),
  getPool: vi.fn(() => ({ query: poolQuery })),
  logAuditEvent: vi.fn(async () => {}),
}));

import { appRouter } from "../routers";
import {
  PORT_PROFILES_CACHE_TTL_MS,
  __clearPortProfilesCache,
} from "./portCongestion";
import type { TrpcContext } from "../_core/context";

function makeCtx(role = "user", userId = 42): TrpcContext {
  return {
    user: {
      id: userId, openId: `t-${role}-${userId}`, email: `${role}@e.com`, name: role,
      loginMethod: "manus", role, createdAt: new Date(), updatedAt: new Date(), lastSignedIn: new Date(),
    } as TrpcContext["user"],
    req: { protocol: "https", headers: {} } as unknown as TrpcContext["req"],
    res: { clearCookie: () => {} } as unknown as TrpcContext["res"],
  };
}

const HOUR_MS = 60 * 60 * 1000;

function shorePassRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    requestedBy: 42,
    decidedBy: 7,
    vesselImoNumber: "9074729",
    status: "APPROVED",
    validUntil: new Date(Date.now() - HOUR_MS), // lapsed
    createdAt: new Date(),
    ...overrides,
  };
}

beforeEach(() => {
  for (const k of Object.keys(store)) delete store[k];
  vi.clearAllMocks();
  __clearPortProfilesCache();
  poolQuery.mockResolvedValue({
    rows: [
      {
        port_code: "NGLOS",
        port_name: "Lagos",
        country: "NG",
        avg_wait: 5,
        avg_vessels: 10,
        avg_backlog: 50,
      },
    ],
  });
});

// ─── shorePass: batched expiry sweep ────────────────────────────────────────

describe("Phase 21 shorePass batched expiry sweep", () => {
  it("expireSweep transitions every lapsed APPROVED pass with a batched audit insert", async () => {
    store.shore_pass_applications = [
      shorePassRow({ id: 1 }),
      shorePassRow({ id: 2 }),
      shorePassRow({ id: 3, validUntil: new Date(Date.now() + HOUR_MS) }), // still valid
      shorePassRow({ id: 4, status: "SUBMITTED" }), // not yet decided
    ];
    const caller = appRouter.createCaller(makeCtx("customs_officer", 7));

    const res = await caller.shorePass.expireSweep();

    expect(res).toEqual({ scanned: 3, expired: 2 });
    const byId = new Map(store.shore_pass_applications.map((r) => [r.id, r]));
    expect(byId.get(1)?.status).toBe("EXPIRED");
    expect(byId.get(2)?.status).toBe("EXPIRED");
    expect(byId.get(3)?.status).toBe("APPROVED");
    expect(byId.get(4)?.status).toBe("SUBMITTED");
    // ONE batched audit insert: two events, sweep-labelled.
    expect(store.shore_pass_events).toHaveLength(2);
    for (const e of store.shore_pass_events) {
      expect(e.action).toBe("expired");
      expect(e.fromStatus).toBe("APPROVED");
      expect(e.toStatus).toBe("EXPIRED");
      expect(String(e.detail)).toContain("batched expiry sweep");
    }
  });

  it("listMine runs the batched sweep before reading (no serialized per-row lazy expiry)", async () => {
    store.shore_pass_applications = [shorePassRow({ id: 11 })];
    const caller = appRouter.createCaller(makeCtx("user", 42));

    const res = await caller.shorePass.listMine();

    expect(res.applications).toHaveLength(1);
    expect(res.applications[0].status).toBe("EXPIRED");
    expect(store.shore_pass_events).toHaveLength(1);
    expect(String(store.shore_pass_events[0].detail)).toContain("batched expiry sweep");
  });
});

// ─── shorePass: bounded list endpoints ──────────────────────────────────────

describe("Phase 21 shorePass bounded lists", () => {
  it("listMine is bounded at 200 rows", async () => {
    store.shore_pass_applications = Array.from({ length: 250 }, (_, i) =>
      shorePassRow({
        id: i + 1,
        status: "SUBMITTED",
        validUntil: null,
        createdAt: new Date(Date.now() + i * 1000),
      }),
    );
    const caller = appRouter.createCaller(makeCtx("user", 42));

    const res = await caller.shorePass.listMine();

    expect(res.applications).toHaveLength(200);
  });

  it("listForOfficer applies mandatory limit/offset (default 100, caller-bounded)", async () => {
    store.shore_pass_applications = Array.from({ length: 5 }, (_, i) =>
      shorePassRow({
        id: i + 1,
        status: "SUBMITTED",
        validUntil: null,
        createdAt: new Date(Date.now() + i * 1000),
      }),
    );
    const caller = appRouter.createCaller(makeCtx("customs_officer", 7));

    const page = await caller.shorePass.listForOfficer({ limit: 2, offset: 1 });
    expect(page.limit).toBe(2);
    expect(page.offset).toBe(1);
    expect(page.applications).toHaveLength(2);
    // desc(createdAt) ordering: newest first, so offset 1 skips id 5.
    expect(page.applications.map((a: { id: number }) => a.id)).toEqual([4, 3]);

    const unbounded = await caller.shorePass.listForOfficer();
    expect(unbounded.limit).toBe(100);
    expect(unbounded.applications).toHaveLength(5);

    await expect(
      caller.shorePass.listForOfficer({ limit: 501 }),
    ).rejects.toThrow(); // max 500 enforced at the input schema
  });
});

// ─── slaEscalation.autoEscalate: batched existence check + bulk inserts ─────

describe("Phase 21 slaEscalation.autoEscalate batching", () => {
  function seedPending() {
    store.declarations = [
      {
        // Breaches GREEN 4h SLA, but already has an unresolved escalation.
        id: 1, declarationNumber: "TG-1", riskLane: "GREEN",
        status: "submitted", submittedAt: new Date(Date.now() - 5 * HOUR_MS),
        assignedOfficerId: 7,
      },
      {
        // Breaches GREEN 4h SLA — the only declaration that should escalate.
        id: 2, declarationNumber: "TG-2", riskLane: "GREEN",
        status: "submitted", submittedAt: new Date(Date.now() - 5 * HOUR_MS),
        assignedOfficerId: 7,
      },
      {
        // Within its 24h YELLOW SLA — skipped.
        id: 3, declarationNumber: "TG-3", riskLane: "YELLOW",
        status: "submitted", submittedAt: new Date(Date.now() - 1 * HOUR_MS),
        assignedOfficerId: 7,
      },
      {
        // Already cleared — not part of the pending scan at all.
        id: 4, declarationNumber: "TG-4", riskLane: "GREEN",
        status: "cleared", submittedAt: new Date(Date.now() - 9 * HOUR_MS),
        assignedOfficerId: 7,
      },
    ];
    store.sla_escalations = [
      { id: 1, declarationId: 1, resolved: false, breachType: "GREEN_sla_breach" },
    ];
  }

  it("escalates only un-escalated breaches via one batched existence check and bulk inserts", async () => {
    seedPending();
    const caller = appRouter.createCaller(makeCtx("admin", 1));

    const res = await caller.slaEscalation.autoEscalate({ dryRun: false, notifySupervisor: true });

    expect(res.escalatedCount).toBe(1);
    expect(res.escalated[0]).toMatchObject({ declarationId: 2, lane: "GREEN" });
    expect(res.skippedCount).toBe(2); // already-escalated #1 + within-SLA #3
    // ONE bulk escalation insert (one new row appended beside the existing).
    expect(store.sla_escalations).toHaveLength(2);
    const inserted = store.sla_escalations.find((r) => r.declarationId === 2);
    expect(inserted).toMatchObject({ breachType: "GREEN_sla_breach", resolved: false, escalatedBy: 1 });
    // ONE bulk notification insert.
    expect(store.user_notifications).toHaveLength(1);
    expect(store.user_notifications[0]).toMatchObject({
      userId: 7,
      type: "sla_breach",
      isRead: false,
    });
  });

  it("dryRun reports breaches without writing anything", async () => {
    seedPending();
    const caller = appRouter.createCaller(makeCtx("admin", 1));

    const res = await caller.slaEscalation.autoEscalate({ dryRun: true, notifySupervisor: true });

    expect(res.dryRun).toBe(true);
    expect(res.escalatedCount).toBe(1);
    expect(store.sla_escalations).toHaveLength(1); // unchanged
    expect(store.user_notifications ?? []).toHaveLength(0);
  });
});

// ─── portCongestion: 60 s port-profiles cache ───────────────────────────────

describe("Phase 21 portCongestion port-profiles cache", () => {
  it("serves repeat profile reads from the 60 s in-process cache (one aggregate round-trip)", async () => {
    expect(PORT_PROFILES_CACHE_TTL_MS).toBe(60_000);
    const caller = appRouter.createCaller(makeCtx("user", 42));

    const first = await caller.portCongestion.listPorts();
    const second = await caller.portCongestion.listPorts();

    expect(first).toEqual([
      { portCode: "NGLOS", portName: "Lagos", country: "NGA", slaThreshold: 70 },
    ]);
    expect(second).toEqual(first);
    // The trailing-7-day aggregate ran exactly once across both calls.
    expect(poolQuery).toHaveBeenCalledTimes(1);

    // Test hook clears the cache — the next read recomputes.
    __clearPortProfilesCache();
    await caller.portCongestion.listPorts();
    expect(poolQuery).toHaveBeenCalledTimes(2);
  });
});
