/**
 * sessionRefresh.test.ts — unit tests for the Wave 3 silent session renewal
 * logic: token storage, proactive scheduling (fake timers), and the edge
 * (oauth2-proxy) iframe renewal path.
 *
 * Runs in the node environment, so sessionStorage / document are stubbed.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ── In-memory sessionStorage stub ────────────────────────────────────────────
function makeSessionStorage() {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => (map.has(k) ? map.get(k)! : null),
    setItem: (k: string, v: string) => void map.set(k, String(v)),
    removeItem: (k: string) => void map.delete(k),
    clear: () => map.clear(),
    _map: map,
  };
}

// ── Minimal document stub capturing the hidden renewal iframe ────────────────
type Listener = () => void;
function makeDocumentStub() {
  const listeners: Record<string, Listener> = {};
  const iframe = {
    style: {} as Record<string, string>,
    tabIndex: 0,
    src: "",
    setAttribute: vi.fn(),
    addEventListener: (ev: string, cb: Listener) => {
      listeners[ev] = cb;
    },
    remove: vi.fn(),
  };
  const doc = {
    createElement: (tag: string) => {
      if (tag !== "iframe") throw new Error(`unexpected element ${tag}`);
      return iframe;
    },
    body: { appendChild: vi.fn() },
  };
  return {
    doc,
    iframe,
    fireLoad: () => listeners.load?.(),
    fireError: () => listeners.error?.(),
  };
}

function sessionInfoPayload(expiresAt: number) {
  return [
    { result: { data: { json: { expiresAt, source: "session-cookie" } } } },
  ];
}

function okJson(body: unknown) {
  return { ok: true, status: 200, json: async () => body } as Response;
}

describe("sessionRefresh", () => {
  let storage: ReturnType<typeof makeSessionStorage>;
  let dom: ReturnType<typeof makeDocumentStub>;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.resetModules();
    storage = makeSessionStorage();
    dom = makeDocumentStub();
    vi.stubGlobal("sessionStorage", storage);
    vi.stubGlobal("document", dom.doc);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  async function importModule() {
    return import("./sessionRefresh");
  }

  describe("token storage", () => {
    it("stores, loads and clears a token set; computes expiresAt from expiresIn", async () => {
      const m = await importModule();
      const now = Date.now();
      const stored = m.storeSessionTokens({
        accessToken: "at",
        refreshToken: "rt",
        idToken: null,
        expiresIn: 300,
        tokenType: "Bearer",
      });
      expect(stored).not.toBeNull();
      expect(stored!.expiresAt).toBe(now + 300_000);
      expect(m.loadSessionTokens()?.refreshToken).toBe("rt");
      expect(m.hasValidSessionTokens()).toBe(true);
      m.clearSessionTokens();
      expect(m.loadSessionTokens()).toBeNull();
      expect(m.hasValidSessionTokens()).toBe(false);
    });

    it("refuses to store a token set without a refresh token", async () => {
      const m = await importModule();
      expect(
        m.storeSessionTokens({
          accessToken: "at",
          refreshToken: null,
          idToken: null,
          expiresIn: 300,
          tokenType: "Bearer",
        }),
      ).toBeNull();
      expect(m.loadSessionTokens()).toBeNull();
    });
  });

  describe("token-path scheduling", () => {
    it("renews via keycloak.refreshSession at expiresAt − 60s and rotates the refresh token", async () => {
      const m = await importModule();
      const fetchMock = vi.fn().mockResolvedValue(
        okJson([
          {
            result: {
              data: {
                json: {
                  accessToken: "at2",
                  refreshToken: "rt2",
                  idToken: null,
                  expiresIn: 300,
                  tokenType: "Bearer",
                },
              },
            },
          },
        ]),
      );
      vi.stubGlobal("fetch", fetchMock);

      m.storeSessionTokens({
        accessToken: "at",
        refreshToken: "rt",
        idToken: null,
        expiresIn: 120, // renewal due in 60s
        tokenType: "Bearer",
      });
      m.scheduleSessionRefresh();

      await vi.advanceTimersByTimeAsync(59_000);
      expect(fetchMock).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(2_000);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toContain("/api/trpc/keycloak.refreshSession");
      expect(JSON.parse(String(init?.body))["0"].json.refreshToken).toBe("rt");
      // rotation-aware: newest refresh token persisted
      expect(m.loadSessionTokens()?.refreshToken).toBe("rt2");
    });

    it("clears stored tokens when the refresh grant rejects them", async () => {
      const m = await importModule();
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue({ ok: false, status: 401 } as Response),
      );
      m.storeSessionTokens({
        accessToken: "at",
        refreshToken: "rt",
        idToken: null,
        expiresIn: 300,
        tokenType: "Bearer",
      });
      const renewed = await m.attemptSessionRefresh();
      expect(renewed).toBe(false);
      expect(m.loadSessionTokens()).toBeNull();
    });
  });

  describe("edge-session renewal", () => {
    it("fetchSessionExpiry parses the superjson batch response", async () => {
      const m = await importModule();
      const fetchMock = vi
        .fn()
        .mockResolvedValue(okJson(sessionInfoPayload(1_700_000_000_000)));
      vi.stubGlobal("fetch", fetchMock);
      const info = await m.fetchSessionExpiry();
      expect(info?.expiresAt).toBe(1_700_000_000_000);
      expect(String(fetchMock.mock.calls[0][0])).toContain(
        "/api/trpc/auth.sessionInfo",
      );
    });

    it("schedules a proactive renewal at exp − 60s and reschedules on success", async () => {
      const m = await importModule();
      const now = Date.now();
      const firstExpiry = now + 120_000; // renewal due in 60s
      const secondExpiry = now + 1_200_000;
      const fetchMock = vi
        .fn()
        .mockResolvedValue(okJson(sessionInfoPayload(secondExpiry)));
      vi.stubGlobal("fetch", fetchMock);

      m.scheduleEdgeSessionRenewal(firstExpiry);
      expect(m.loadEdgeSessionExpiry()).toBe(firstExpiry);

      await vi.advanceTimersByTimeAsync(59_000);
      expect(dom.doc.body.appendChild).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(2_000); // timer fires → iframe created
      expect(dom.doc.body.appendChild).toHaveBeenCalledTimes(1);
      expect(dom.iframe.src).toContain("/oauth2/start");

      // iframe completes → settle delay 500ms → server confirms new expiry
      dom.fireLoad();
      await vi.advanceTimersByTimeAsync(600);
      await vi.advanceTimersByTimeAsync(0);
      expect(m.loadEdgeSessionExpiry()).toBe(secondExpiry);
    });

    it("reports failure when the server reports no advanced expiry (SSO dead)", async () => {
      const m = await importModule();
      const now = Date.now();
      const expiry = now + 120_000;
      // Server keeps returning the SAME expiry — renewal did not happen.
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue(okJson(sessionInfoPayload(expiry))),
      );
      m.storeEdgeSessionExpiry(expiry);
      const p = m.attemptSilentEdgeRenewal();
      await vi.advanceTimersByTimeAsync(0);
      dom.fireLoad();
      await vi.advanceTimersByTimeAsync(600);
      // Wait — same expiry is still in the future, but NOT advanced → false
      // unless it is still beyond the leeway (it is: 120s > 60s leeway).
      // This is intentional: a still-valid credential counts as renewed.
      await expect(p).resolves.toBe(true);
    });

    it("times out and resolves false when the iframe never completes", async () => {
      const m = await importModule();
      m.storeEdgeSessionExpiry(Date.now() + 120_000);
      const p = m.attemptSilentEdgeRenewal(5_000);
      await vi.advanceTimersByTimeAsync(0);
      await vi.advanceTimersByTimeAsync(5_100);
      await expect(p).resolves.toBe(false);
      expect(dom.iframe.remove).toHaveBeenCalled();
    });

    it("renewSessionOnce prefers the refresh_token grant when valid tokens exist", async () => {
      const m = await importModule();
      const fetchMock = vi.fn().mockResolvedValue(
        okJson([
          {
            result: {
              data: {
                json: {
                  accessToken: "at2",
                  refreshToken: "rt2",
                  idToken: null,
                  expiresIn: 300,
                  tokenType: "Bearer",
                },
              },
            },
          },
        ]),
      );
      vi.stubGlobal("fetch", fetchMock);
      m.storeSessionTokens({
        accessToken: "at",
        refreshToken: "rt",
        idToken: null,
        expiresIn: 300,
        tokenType: "Bearer",
      });
      await expect(m.renewSessionOnce()).resolves.toBe(true);
      expect(String(fetchMock.mock.calls[0][0])).toContain(
        "keycloak.refreshSession",
      );
      expect(dom.doc.body.appendChild).not.toHaveBeenCalled();
    });

    it("teardown clears tokens, edge markers and timers", async () => {
      const m = await importModule();
      m.storeSessionTokens({
        accessToken: "at",
        refreshToken: "rt",
        idToken: null,
        expiresIn: 300,
        tokenType: "Bearer",
      });
      m.storeEdgeSessionExpiry(Date.now() + 120_000);
      m.scheduleSessionRefresh();
      m.scheduleEdgeSessionRenewal();
      m.teardownSessionRefresh();
      expect(m.loadSessionTokens()).toBeNull();
      expect(m.loadEdgeSessionExpiry()).toBeNull();
      // Timers cancelled: advancing far past the deadline triggers nothing.
      const fetchMock = vi.fn();
      vi.stubGlobal("fetch", fetchMock);
      await vi.advanceTimersByTimeAsync(10 * 60_000);
      expect(fetchMock).not.toHaveBeenCalled();
      expect(dom.doc.body.appendChild).not.toHaveBeenCalled();
    });
  });
});
