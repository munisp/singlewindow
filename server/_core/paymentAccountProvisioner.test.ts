/**
 * P0-4 remediation tests — paymentAccountProvisioner.
 * The TigerBeetle bridge provisioning is now REAL (HTTP /api/ledger/accounts)
 * and FAIL-CLOSED: provisioning failure aborts the payment setup.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── DB mock ─────────────────────────────────────────────────────────────────
const selectResult: Array<{ accountId: string }[]> = [[]];
const insertCalls: unknown[] = [];

vi.mock("../db", () => ({
  getDb: vi.fn(async () => ({
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => selectResult[0],
        }),
      }),
    }),
    insert: () => ({
      values: (v: unknown) => {
        insertCalls.push(v);
        return { onConflictDoNothing: async () => undefined };
      },
    }),
  })),
}));

import { provisionTraderAccount } from "./paymentAccountProvisioner";

describe("P0-4 — TigerBeetle account provisioning (fail-closed)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    selectResult[0] = [];
    insertCalls.length = 0;
  });

  it("provisions via the bridge and records the DB mirror on success", async () => {
    const fetchMock = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await provisionTraderAccount(42, "USD");

    expect(result).toEqual({ accountId: "trader-42", isNew: true, ledger: 1 });
    // Bridge was called with the /api/ledger/accounts dialect
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("/api/ledger/accounts");
    expect(init.method).toBe("POST");
    const body = JSON.parse(String(init.body));
    expect(body.id).toBe("trader-42");
    expect(body.accountType).toBe("TRADER_LIABILITY");
    // DB mirror row written after successful provisioning
    expect(insertCalls.length).toBe(1);
  });

  it("ABORTS payment setup when the bridge is unreachable (no DB row written)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("ECONNREFUSED"); }));

    await expect(provisionTraderAccount(43, "USD")).rejects.toThrow(/NOT provisioned|aborted/i);
    expect(insertCalls.length).toBe(0);
  });

  it("ABORTS payment setup when the bridge rejects the account", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("boom", { status: 500 })));

    await expect(provisionTraderAccount(44, "USD")).rejects.toThrow(/HTTP 500|aborted/i);
    expect(insertCalls.length).toBe(0);
  });

  it("returns existing account without re-provisioning", async () => {
    selectResult[0] = [{ accountId: "trader-45" }];
    const fetchMock = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await provisionTraderAccount(45, "USD");
    expect(result.isNew).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(insertCalls.length).toBe(0);
  });
});
