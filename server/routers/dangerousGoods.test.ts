/**
 * dangerousGoods.test.ts — Phase 19 (F5a / A5-B9) IMDG DG declaration router.
 *
 * Covers: structural fail-closed validation at the API edge, ownership and
 * status gates, the derived DG flag lifecycle, the officer board, and the
 * honest IMDG_CODE_LOOKUP_NOT_CONFIGURED state.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { createMockDrizzleDb, type MockStore } from "../testutils/mockDrizzleDb";

const store: MockStore = {};
const auditEvents: Array<Record<string, unknown>> = [];

vi.mock("../db", () => ({
  getDb: vi.fn(async () => createMockDrizzleDb(store)),
  logAuditEvent: vi.fn(async (e: Record<string, unknown>) => {
    auditEvents.push(e);
  }),
}));

import { appRouter } from "../routers";
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

const VALID_ITEM = {
  unNumber: "1203",
  imoClass: "3",
  packingGroup: "II",
  properShippingName: "GASOLINE",
  flashpointCelsius: -43,
  emsCodes: ["F-E", "S-E"],
  marinePollutant: false,
};

function seedDeclaration(overrides: Record<string, unknown> = {}) {
  store.declarations = [
    {
      id: 5, declarationNumber: "TG-2026-DG", traderId: 42, status: "submitted",
      ...overrides,
    },
  ];
}

beforeEach(() => {
  for (const k of Object.keys(store)) delete store[k];
  auditEvents.length = 0;
  seedDeclaration();
});

describe("dangerousGoods.addItem", () => {
  it("attaches a structurally valid DG item, flags the declaration and audits", async () => {
    const caller = appRouter.createCaller(makeCtx("user", 42));
    const res = await caller.dangerousGoods.addItem({ declarationId: 5, item: VALID_ITEM });
    expect(res.hasDangerousGoods).toBe(true);
    expect(res.item).toMatchObject({ unNumber: "1203", imoClass: "3", packingGroup: "II" });
    expect(store.declaration_dg_items).toHaveLength(1);
    expect(auditEvents.some((e) => e.action === "dg_item.added")).toBe(true);
  });

  it("fails closed on structurally invalid IMDG data (class 3 without flashpoint)", async () => {
    const caller = appRouter.createCaller(makeCtx("user", 42));
    await expect(
      caller.dangerousGoods.addItem({ declarationId: 5, item: { ...VALID_ITEM, flashpointCelsius: null } })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(store.declaration_dg_items ?? []).toHaveLength(0);
  });

  it("rejects packing-group misuse (class 7 with PG)", async () => {
    const caller = appRouter.createCaller(makeCtx("user", 42));
    await expect(
      caller.dangerousGoods.addItem({
        declarationId: 5,
        item: { ...VALID_ITEM, imoClass: "7", packingGroup: "III", flashpointCelsius: null },
      })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("forbids non-owners (even officers) from writing DG items", async () => {
    const caller = appRouter.createCaller(makeCtx("customs_officer", 7));
    await expect(
      caller.dangerousGoods.addItem({ declarationId: 5, item: VALID_ITEM })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("freezes DG items once the declaration is cleared", async () => {
    seedDeclaration({ status: "cleared" });
    const caller = appRouter.createCaller(makeCtx("user", 42));
    await expect(
      caller.dangerousGoods.addItem({ declarationId: 5, item: VALID_ITEM })
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });
});

describe("dangerousGoods.removeItem", () => {
  it("removes the item and clears the flag when the last DG item goes", async () => {
    const caller = appRouter.createCaller(makeCtx("user", 42));
    const { item } = await caller.dangerousGoods.addItem({ declarationId: 5, item: VALID_ITEM });
    const res = await caller.dangerousGoods.removeItem({ declarationId: 5, itemId: item.id });
    expect(res).toEqual({ removed: true, hasDangerousGoods: false });
    expect(store.declaration_dg_items).toHaveLength(0);
    expect(auditEvents.some((e) => e.action === "dg_item.removed")).toBe(true);
  });
});

describe("dangerousGoods.listForDeclaration / officerBoard", () => {
  it("lets the owner and officers read, but not unrelated traders", async () => {
    const owner = appRouter.createCaller(makeCtx("user", 42));
    await owner.dangerousGoods.addItem({ declarationId: 5, item: VALID_ITEM });
    const listed = await owner.dangerousGoods.listForDeclaration({ declarationId: 5 });
    expect(listed.hasDangerousGoods).toBe(true);
    expect(listed.items).toHaveLength(1);

    const officer = appRouter.createCaller(makeCtx("customs_officer", 7));
    const officerListed = await officer.dangerousGoods.listForDeclaration({ declarationId: 5 });
    expect(officerListed.items).toHaveLength(1);

    const stranger = appRouter.createCaller(makeCtx("user", 99));
    await expect(stranger.dangerousGoods.listForDeclaration({ declarationId: 5 })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });

  it("officer board surfaces DG-flagged declarations with their items", async () => {
    const owner = appRouter.createCaller(makeCtx("user", 42));
    await owner.dangerousGoods.addItem({ declarationId: 5, item: VALID_ITEM });
    const officer = appRouter.createCaller(makeCtx("customs_officer", 7));
    const board = await officer.dangerousGoods.officerBoard({});
    expect(board.count).toBe(1);
    expect(board.board[0].declaration).toMatchObject({ id: 5 });
    expect(board.board[0].items).toHaveLength(1);
  });

  it("officer board refuses non-officers", async () => {
    const trader = appRouter.createCaller(makeCtx("user", 42));
    await expect(trader.dangerousGoods.officerBoard({})).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("dangerousGoods.lookup — honest unavailable state", () => {
  it("always fails closed with IMDG_CODE_LOOKUP_NOT_CONFIGURED (no fabricated substance DB)", async () => {
    const caller = appRouter.createCaller(makeCtx("customs_officer", 7));
    await expect(caller.dangerousGoods.lookup({ unNumber: "1203" })).rejects.toMatchObject({
      code: "PRECONDITION_FAILED",
      message: expect.stringContaining("IMDG_CODE_LOOKUP_NOT_CONFIGURED"),
    });
  });
});
