/**
 * declarations.tenantScope.remediation.test.ts — Phase-11 remediation (MED)
 *
 * Officer declaration list (declarations.all) is tenant-scoped: an officer
 * only sees declarations filed by traders who share one of the officer's
 * tenants (tenant_users membership; a declaration's tenant is the filing
 * trader's tenant). Officers with no tenant membership fail closed (empty).
 *
 * The explicit platform-wide exception mirrors is_platform_admin() in
 * drizzle/migrations/0064_phase11_tenant_rls.sql: platform operators
 * ('admin'/'superadmin') and national customs command ('platform_admin'/
 * 'customs_commissioner') retain cross-tenant visibility; tenant-plane
 * officer roles (customs_officer, inspector, finance, oga_officer,
 * security) never do.
 */

import { describe, expect, it, vi, beforeEach } from "vitest";

// Stub the drizzle-orm query operators (imported dynamically by the router)
// so we can capture the exact conditions the tenant scoping adds.
const state = {
  officerTenants: [] as Array<{ tenantId: string }>,
  declRows: [] as Array<Record<string, unknown>>,
  inArrayCalls: [] as Array<{ column: unknown; values: unknown }>,
  declWhereCaptured: null as unknown,
  declQueryRan: false,
};

vi.mock("drizzle-orm", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  const tag = (op: string) => (...args: unknown[]) => ({ __op: op, args });
  return {
    ...actual,
    eq: tag("eq"),
    desc: tag("desc"),
    and: tag("and"),
    or: tag("or"),
    gte: tag("gte"),
    lte: tag("lte"),
    ilike: tag("ilike"),
    lt: tag("lt"),
    inArray: (column: unknown, values: unknown) => {
      state.inArrayCalls.push({ column, values });
      return { __op: "inArray", args: [column, values] };
    },
  };
});

function makeDb() {
  let fromTable: unknown = null;
  const tableName = () => String((fromTable as any)?.[Symbol.for("drizzle:Name")] ?? "");
  const chain: any = {
    select: () => chain,
    from: (t: unknown) => { fromTable = t; return chain; },
    leftJoin: () => chain,
    where: (cond: unknown) => {
      if (!tableName().includes("tenant_users")) {
        state.declWhereCaptured = cond;
        state.declQueryRan = true;
      }
      return chain;
    },
    orderBy: () => chain,
    limit: () => chain,
    offset: () => chain,
    then: (resolve: (v: unknown) => void) => {
      resolve(tableName().includes("tenant_users") ? state.officerTenants : state.declRows);
    },
  };
  return chain;
}

vi.mock("../db", () => ({
  getDb: vi.fn(async () => null),
  withRlsContext: vi.fn(async (_c: unknown, fn: (db: unknown) => unknown) => fn(makeDb())),
  logAuditEvent: vi.fn(async () => {}),
  createNotification: vi.fn(async () => {}),
  createUserNotification: vi.fn(async () => ({ id: 1 })),
}));
vi.mock("../_core/llm", () => ({ invokeLLM: vi.fn(async () => { throw new Error("offline"); }) }));
vi.mock("../_core/permify", () => ({ assertCan: vi.fn(async () => {}), setOwner: vi.fn(async () => {}) }));
vi.mock("../_core/polyglotClients", () => ({
  scoreDeclarationRisk: vi.fn(async () => { throw new Error("offline"); }),
  scoreDeclarationRiskComposite: vi.fn(async () => { throw new Error("offline"); }),
  configuredRiskScorers: vi.fn(() => ["python-ml"]),
  validateDeclarationWithEngine: vi.fn(async () => ({})),
  getCargoPosition: vi.fn(async () => ({})),
}));
vi.mock("../_core/kafka", () => ({ publishEvent: vi.fn(async () => {}), TOPICS: {} }));
vi.mock("../_core/wsServer", () => ({ broadcastNotification: vi.fn(), broadcastUnreadCount: vi.fn(), broadcastWorkloadUpdate: vi.fn() }));
vi.mock("../_core/opensearch", () => ({ indexDeclaration: vi.fn(async () => {}), searchDeclarations: vi.fn(async () => ({ hits: [] })) }));

import { declarationsRouter } from "./declarations";
import { declarations as declTable, tenantUsers } from "../../drizzle/schema";
import type { TrpcContext } from "../_core/context";

function makeCtx(role: string, userId = 7): TrpcContext {
  return {
    user: {
      id: userId, openId: `t-${role}`, email: `${role}@e.com`, name: role,
      loginMethod: "manus", role, createdAt: new Date(), updatedAt: new Date(), lastSignedIn: new Date(),
    } as TrpcContext["user"],
    req: { protocol: "https", headers: {} } as unknown as TrpcContext["req"],
    res: { clearCookie: () => {} } as unknown as TrpcContext["res"],
  };
}

beforeEach(() => {
  state.officerTenants = [];
  state.declRows = [];
  state.inArrayCalls = [];
  state.declWhereCaptured = null;
  state.declQueryRan = false;
});

describe("declarations.all tenant scoping", () => {
  it("tenant-plane officer: list is restricted to the officer's own tenant(s)", async () => {
    state.officerTenants = [{ tenantId: "tenant-a" }];
    state.declRows = [{ id: 1, declarationNumber: "TG-1" }];
    const caller = declarationsRouter.createCaller(makeCtx("customs_officer"));
    const result = await caller.all({ limit: 50 });
    expect(result.items).toHaveLength(1);

    // traderId must be restricted via a tenant_users subquery…
    const traderScope = state.inArrayCalls.find((c) => c.column === (declTable as any).traderId);
    expect(traderScope).toBeTruthy();
    // …and that subquery filters tenant_users.tenantId to exactly the
    // officer's tenants (tenant A only — tenant B declarations excluded).
    const tenantFilter = state.inArrayCalls.find((c) => c.column === (tenantUsers as any).tenantId);
    expect(tenantFilter?.values).toEqual(["tenant-a"]);
    // The filter landed in the main declaration query WHERE clause.
    expect(state.declWhereCaptured).toMatchObject({ __op: "and" });
    expect((state.declWhereCaptured as any).args).toContainEqual(
      expect.objectContaining({ __op: "inArray" })
    );
  });

  it("officer from tenant A cannot list tenant B declarations (membership drives the filter)", async () => {
    state.officerTenants = [{ tenantId: "tenant-a" }];
    const caller = declarationsRouter.createCaller(makeCtx("inspector", 8));
    await caller.all({ limit: 50 });
    const tenantFilter = state.inArrayCalls.find((c) => c.column === (tenantUsers as any).tenantId);
    expect(tenantFilter?.values).toEqual(["tenant-a"]);
    expect(tenantFilter?.values).not.toContain("tenant-b");
  });

  it("officer with no tenant membership fails closed (empty list, query short-circuits)", async () => {
    state.officerTenants = [];
    const caller = declarationsRouter.createCaller(makeCtx("finance", 9));
    const result = await caller.all({ limit: 50 });
    expect(result).toEqual({ items: [], hasMore: false, nextCursor: undefined });
    expect(state.declQueryRan).toBe(false);
  });

  it("platform role (admin) bypasses tenant scoping", async () => {
    state.declRows = [{ id: 1 }, { id: 2 }];
    const caller = declarationsRouter.createCaller(makeCtx("admin", 1));
    const result = await caller.all({ limit: 50 });
    expect(result.items).toHaveLength(2);
    expect(state.inArrayCalls).toHaveLength(0); // no tenant filter at all
  });

  it("national customs command role (customs_commissioner) bypasses tenant scoping", async () => {
    state.declRows = [{ id: 1 }];
    const caller = declarationsRouter.createCaller(makeCtx("customs_commissioner", 2));
    const result = await caller.all({ limit: 50 });
    expect(result.items).toHaveLength(1);
    expect(state.inArrayCalls).toHaveLength(0);
  });

  it("plain traders remain forbidden", async () => {
    const caller = declarationsRouter.createCaller(makeCtx("user", 42));
    await expect(caller.all({ limit: 50 })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
