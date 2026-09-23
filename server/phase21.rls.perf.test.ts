/**
 * phase21.rls.perf.test.ts — Phase 21 (perf) RLS context establishment.
 *
 * withRlsContext (server/db.ts) previously ran four serialized
 * SELECT set_config(...) round-trips per request; it now issues ONE combined
 * set_config SELECT (transaction-scoped is_local=true ≡ SET LOCAL) between
 * BEGIN and COMMIT. These tests pin the round-trip count, the exact GUC
 * names the RLS policies read (SW-G3), the parameter order, and the
 * transaction lifecycle (COMMIT on success, ROLLBACK on error, client always
 * released).
 *
 * DATABASE_URL must be set before server/db.ts loads (getDb() resolves the
 * pool lazily at first use), and pg is mocked so no real socket is opened —
 * the module under test is therefore imported dynamically in beforeAll.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

process.env.DATABASE_URL = "postgres://phase21:phase21@localhost:5432/phase21_rls";

// ─── pg mock ─────────────────────────────────────────────────────────────────

const clientQuery = vi.fn(async () => ({ rows: [] }));
const clientRelease = vi.fn();
const poolConnect = vi.fn(async () => ({ query: clientQuery, release: clientRelease }));

vi.mock("pg", () => ({
  Pool: class {
    connect = poolConnect;
    query = clientQuery;
    end = vi.fn();
    on = vi.fn();
  },
}));

let withRlsContext: typeof import("./db").withRlsContext;

beforeAll(async () => {
  ({ withRlsContext } = await import("./db"));
});

beforeEach(() => {
  vi.clearAllMocks();
});

const USER = { id: 42, role: "customs_officer", tenantId: "tenant-7" };

describe("Phase 21 withRlsContext single-round-trip GUC setup", () => {
  it("issues exactly ONE set_config statement covering all four RLS GUCs", async () => {
    await withRlsContext(USER, async () => "ok");

    const setConfigCalls = clientQuery.mock.calls.filter(([sql]) =>
      String(sql).includes("set_config"),
    );
    expect(setConfigCalls).toHaveLength(1);
    const [sql] = setConfigCalls[0] as [string, unknown[]];
    expect(sql).toContain("app.current_user_id");
    expect(sql).toContain("app.current_role");
    expect(sql).toContain("app.current_trader_id");
    expect(sql).toContain("app.current_tenant_id");
    // Transaction-scoped (is_local = true ≡ SET LOCAL) for every GUC.
    expect((sql.match(/true\)/g) ?? []).length).toBe(4);
  });

  it("passes the GUC values as bound parameters in policy order (id, role, trader=id, tenant)", async () => {
    await withRlsContext(USER, async () => "ok");

    const [, params] = clientQuery.mock.calls.find(([sql]) =>
      String(sql).includes("set_config"),
    ) as [string, unknown[]];
    expect(params).toEqual(["42", "customs_officer", "42", "tenant-7"]);
  });

  it("defaults a missing tenantId to the empty string (tenant default-deny posture)", async () => {
    await withRlsContext({ id: 9, role: "user", tenantId: null }, async () => "ok");

    const [, params] = clientQuery.mock.calls.find(([sql]) =>
      String(sql).includes("set_config"),
    ) as [string, unknown[]];
    expect(params).toEqual(["9", "user", "9", ""]);
  });

  it("runs BEGIN → set_config → callback → COMMIT and returns the callback result", async () => {
    const order: string[] = [];
    clientQuery.mockImplementation(async (sql: unknown) => {
      const s = String(sql);
      order.push(s === "BEGIN" || s === "COMMIT" || s === "ROLLBACK" ? s : "SET_CONFIG");
      return { rows: [] };
    });

    let callbackRan = false;
    const result = await withRlsContext(USER, async () => {
      callbackRan = true;
      return 1234;
    });

    expect(result).toBe(1234);
    expect(callbackRan).toBe(true);
    expect(order).toEqual(["BEGIN", "SET_CONFIG", "COMMIT"]);
    expect(clientRelease).toHaveBeenCalledTimes(1);
  });

  it("success path issues exactly three statements (no per-GUC round-trips)", async () => {
    await withRlsContext(USER, async () => "ok");
    expect(clientQuery).toHaveBeenCalledTimes(3);
    expect(poolConnect).toHaveBeenCalledTimes(1);
    expect(clientRelease).toHaveBeenCalledTimes(1);
  });

  it("rolls back, releases the client, and rethrows when the callback fails", async () => {
    const failure = new Error("callback boom");
    await expect(
      withRlsContext(USER, async () => {
        throw failure;
      }),
    ).rejects.toBe(failure);

    const statements = clientQuery.mock.calls.map(([sql]) => String(sql));
    expect(statements[0]).toBe("BEGIN");
    expect(statements[statements.length - 1]).toBe("ROLLBACK");
    expect(statements).not.toContain("COMMIT");
    expect(clientRelease).toHaveBeenCalledTimes(1);
  });
});
