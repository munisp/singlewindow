/**
 * renewingFetch.test.ts — the tRPC link fetch wrapper retries a 401 exactly
 * once after a successful silent renewal, and never loops.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./sessionRefresh", () => ({
  renewSessionOnce: vi.fn(),
}));

import { renewSessionOnce } from "./sessionRefresh";
import { createRenewingFetch } from "./renewingFetch";

const renewMock = vi.mocked(renewSessionOnce);

function res(status: number) {
  return { status } as Response;
}

describe("createRenewingFetch", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("passes non-401 responses straight through without renewing", async () => {
    const base = vi.fn().mockResolvedValue(res(200));
    const f = createRenewingFetch(base);
    const out = await f("/api/trpc/auth.me", { method: "POST" });
    expect(out.status).toBe(200);
    expect(base).toHaveBeenCalledTimes(1);
    expect(renewMock).not.toHaveBeenCalled();
  });

  it("on 401: renews silently and retries the original request once", async () => {
    const base = vi
      .fn()
      .mockResolvedValueOnce(res(401))
      .mockResolvedValueOnce(res(200));
    renewMock.mockResolvedValue(true);
    const f = createRenewingFetch(base);
    const init = { method: "POST", body: '{"0":{"json":null}}' };
    const out = await f("/api/trpc/auth.me?batch=1", init);
    expect(renewMock).toHaveBeenCalledTimes(1);
    expect(base).toHaveBeenCalledTimes(2);
    // Same input + same init replayed
    expect(base.mock.calls[1]).toEqual(["/api/trpc/auth.me?batch=1", init]);
    expect(out.status).toBe(200);
  });

  it("returns the original 401 when renewal fails (no retry)", async () => {
    const base = vi.fn().mockResolvedValue(res(401));
    renewMock.mockResolvedValue(false);
    const f = createRenewingFetch(base);
    const out = await f("/api/trpc/auth.me?batch=1", {});
    expect(out.status).toBe(401);
    expect(base).toHaveBeenCalledTimes(1);
  });

  it("returns the retried 401 untouched when the session is truly dead", async () => {
    const base = vi.fn().mockResolvedValue(res(401));
    renewMock.mockResolvedValue(true);
    const f = createRenewingFetch(base);
    const out = await f("/api/trpc/auth.me?batch=1", {});
    expect(out.status).toBe(401);
    expect(base).toHaveBeenCalledTimes(2); // exactly one retry, no loop
  });

  it("never triggers renewal for the renewal endpoints themselves", async () => {
    const base = vi.fn().mockResolvedValue(res(401));
    const f = createRenewingFetch(base);
    await f("/api/trpc/keycloak.refreshSession?batch=1", {});
    await f("/api/trpc/auth.sessionInfo?batch=1", {});
    expect(renewMock).not.toHaveBeenCalled();
    expect(base).toHaveBeenCalledTimes(2);
  });

  it("treats a throwing renewal attempt as failure", async () => {
    const base = vi.fn().mockResolvedValue(res(401));
    renewMock.mockRejectedValue(new Error("boom"));
    const f = createRenewingFetch(base);
    const out = await f("/api/trpc/auth.me?batch=1", {});
    expect(out.status).toBe(401);
    expect(base).toHaveBeenCalledTimes(1);
  });
});
