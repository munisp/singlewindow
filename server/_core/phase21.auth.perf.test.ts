/**
 * phase21.auth.perf.test.ts — Phase 21 (perf) request-auth hot path.
 *
 * Covers the round-trip eliminations in server/_core/sdk.ts and the
 * revocation verdict cache in server/_core/redisRateLimiter.ts:
 *   - Bearer path: single SELECT fast path; the UPSERT write only happens
 *     when something changed (new user / mapped role change / profile drift)
 *     or the last_signed_in throttle interval elapsed.
 *   - Exactly one RS256 verification per request: the verified payload is
 *     handed to createContext via getVerifiedBearerPayload (WeakMap keyed on
 *     the request object).
 *   - Cookie path: throttled last_signed_in write (≤1 write/user/interval).
 *   - Session revocation: 10 s in-process verdict cache; same-instance
 *     revocation is immediate; Redis errors are never cached.
 *
 * JWT_SECRET must be set before the module (and its env import) loads, so the
 * modules under test are imported dynamically in beforeAll.
 */
import type { Request } from "express";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { COOKIE_NAME } from "../../shared/const";

const TEST_SECRET = "phase21-auth-perf-test-secret";
process.env.JWT_SECRET = TEST_SECRET;

// ─── Module mocks ────────────────────────────────────────────────────────────

const getUserByOpenId = vi.fn();
const upsertUserReturning = vi.fn();
const upsertUser = vi.fn();
const logAuditEvent = vi.fn(async () => {});

vi.mock("../db", () => ({
  getUserByOpenId: (...args: unknown[]) => getUserByOpenId(...args),
  upsertUserReturning: (...args: unknown[]) => upsertUserReturning(...args),
  upsertUser: (...args: unknown[]) => upsertUser(...args),
  logAuditEvent: (...args: unknown[]) => logAuditEvent(...args),
  getPool: () => null,
}));

const verifyKeycloakToken = vi.fn();
const extractRoleMappingFromPayload = vi.fn();

vi.mock("./keycloakVerifier", () => ({
  verifyKeycloakToken: (...args: unknown[]) => verifyKeycloakToken(...args),
  extractRoleMappingFromPayload: (...args: unknown[]) => extractRoleMappingFromPayload(...args),
}));

const redisGet = vi.fn();
const redisSet = vi.fn(async () => "OK");

vi.mock("ioredis", () => ({
  default: class {
    get = redisGet;
    set = redisSet;
    on = vi.fn();
  },
}));

// ─── Dynamically imported modules under test ────────────────────────────────

let sdk: typeof import("./sdk").sdk;
let __resetLastSignedInThrottle: typeof import("./sdk").__resetLastSignedInThrottle;
let isSessionRevoked: typeof import("./redisRateLimiter").isSessionRevoked;
let revokeSession: typeof import("./redisRateLimiter").revokeSession;
let __clearRevocationVerdictCache: typeof import("./redisRateLimiter").__clearRevocationVerdictCache;

beforeAll(async () => {
  const sdkModule = await import("./sdk");
  sdk = sdkModule.sdk;
  __resetLastSignedInThrottle = sdkModule.__resetLastSignedInThrottle;
  const rl = await import("./redisRateLimiter");
  isSessionRevoked = rl.isSessionRevoked;
  revokeSession = rl.revokeSession;
  __clearRevocationVerdictCache = rl.__clearRevocationVerdictCache;
});

// ─── Fixtures ────────────────────────────────────────────────────────────────

function bearerReq(token = "kc-token"): Request {
  return { headers: { authorization: `Bearer ${token}` } } as unknown as Request;
}

function cookieReq(token: string): Request {
  return { headers: { cookie: `${COOKIE_NAME}=${token}` } } as unknown as Request;
}

function keycloakPayload(overrides: Record<string, unknown> = {}) {
  return { sub: "kc-1", preferred_username: "kc-1", email: null, ...overrides };
}

function existingUser(overrides: Record<string, unknown> = {}) {
  const now = new Date();
  return {
    id: 7,
    openId: "kc-1",
    name: "kc-1",
    email: null,
    loginMethod: "keycloak",
    role: "user",
    status: "active",
    createdAt: now,
    updatedAt: now,
    lastSignedIn: now,
    ...overrides,
  };
}

const NO_MAPPING = { mapped: false, role: "user" as const, unmappedPrivilegedClaims: [] as string[] };

beforeEach(() => {
  vi.clearAllMocks();
  __resetLastSignedInThrottle();
  __clearRevocationVerdictCache();
  extractRoleMappingFromPayload.mockReturnValue(NO_MAPPING);
  redisGet.mockResolvedValue(null);
});

// ─── Bearer path: round-trip reduction + write gating ───────────────────────

describe("Phase 21 Bearer auth hot path", () => {
  it("writes at most once per throttle interval across repeat requests (single-read fast path afterwards)", async () => {
    verifyKeycloakToken.mockResolvedValue(keycloakPayload());
    getUserByOpenId.mockResolvedValue(existingUser());
    upsertUserReturning.mockResolvedValue(existingUser());

    await sdk.authenticateRequest(bearerReq());
    await sdk.authenticateRequest(bearerReq());
    await sdk.authenticateRequest(bearerReq());

    // Every request re-reads the user (1 SELECT each) ...
    expect(getUserByOpenId).toHaveBeenCalledTimes(3);
    // ... but the UPSERT ... RETURNING write ran only on the first request.
    expect(upsertUserReturning).toHaveBeenCalledTimes(1);
  });

  it("auto-provisions a new user with ONE UPSERT ... RETURNING and an audit event", async () => {
    verifyKeycloakToken.mockResolvedValue(keycloakPayload({ sub: "kc-new" }));
    getUserByOpenId.mockResolvedValue(null);
    upsertUserReturning.mockResolvedValue(existingUser({ id: 99, openId: "kc-new" }));

    const user = await sdk.authenticateRequest(bearerReq());

    expect(user.openId).toBe("kc-new");
    expect(upsertUserReturning).toHaveBeenCalledTimes(1);
    expect(
      logAuditEvent.mock.calls.some(([e]) => e?.action === "keycloak_auto_provision"),
    ).toBe(true);
  });

  it("does NOT delay fail-closed role sync behind the last_signed_in throttle", async () => {
    verifyKeycloakToken.mockResolvedValue(keycloakPayload());
    getUserByOpenId.mockResolvedValue(existingUser());
    upsertUserReturning.mockResolvedValue(existingUser());

    // First request marks the throttle (write happens).
    await sdk.authenticateRequest(bearerReq());
    expect(upsertUserReturning).toHaveBeenCalledTimes(1);

    // Second request inside the throttle window, but a mapped role claim now
    // differs from the stored role — the write MUST still happen.
    extractRoleMappingFromPayload.mockReturnValue({
      mapped: true,
      role: "admin" as const,
      unmappedPrivilegedClaims: [] as string[],
    });
    upsertUserReturning.mockResolvedValue(existingUser({ role: "admin" }));

    const user = await sdk.authenticateRequest(bearerReq());
    expect(upsertUserReturning).toHaveBeenCalledTimes(2);
    expect(user.role).toBe("admin");
  });

  it("writes when the profile claims drift (name change) even inside the throttle window", async () => {
    verifyKeycloakToken.mockResolvedValue(keycloakPayload());
    getUserByOpenId.mockResolvedValue(existingUser());
    upsertUserReturning.mockResolvedValue(existingUser());

    await sdk.authenticateRequest(bearerReq());
    expect(upsertUserReturning).toHaveBeenCalledTimes(1);

    verifyKeycloakToken.mockResolvedValue(keycloakPayload({ preferred_username: "renamed-user" }));
    upsertUserReturning.mockResolvedValue(existingUser({ name: "renamed-user" }));

    await sdk.authenticateRequest(bearerReq());
    expect(upsertUserReturning).toHaveBeenCalledTimes(2);
  });

  it("fails closed for suspended accounts", async () => {
    verifyKeycloakToken.mockResolvedValue(keycloakPayload());
    getUserByOpenId.mockResolvedValue(existingUser({ status: "suspended" }));
    upsertUserReturning.mockResolvedValue(existingUser({ status: "suspended" }));

    await expect(sdk.authenticateRequest(bearerReq())).rejects.toThrow(
      /Invalid Keycloak bearer token/,
    );
  });

  it("verifies the RS256 token exactly once per request and reuses the payload via getVerifiedBearerPayload", async () => {
    const payload = keycloakPayload();
    verifyKeycloakToken.mockResolvedValue(payload);
    getUserByOpenId.mockResolvedValue(existingUser());
    upsertUserReturning.mockResolvedValue(existingUser());

    const req = bearerReq();
    await sdk.authenticateRequest(req);

    expect(verifyKeycloakToken).toHaveBeenCalledTimes(1);
    // The SAME request object retrieves the already-verified payload (so
    // createContext role enrichment does not re-verify); a different request
    // object sees nothing.
    expect(sdk.getVerifiedBearerPayload(req)).toBe(payload);
    expect(sdk.getVerifiedBearerPayload(bearerReq("other"))).toBeUndefined();
  });
});

// ─── Cookie path: throttled last_signed_in ──────────────────────────────────

describe("Phase 21 cookie auth throttle", () => {
  it("throttles last_signed_in writes to one per interval; reset hook re-arms", async () => {
    const token = await sdk.createSessionToken("user-1", { name: "User One" });
    getUserByOpenId.mockResolvedValue(existingUser({ openId: "user-1", loginMethod: "manus" }));
    upsertUser.mockResolvedValue(undefined);

    await sdk.authenticateRequest(cookieReq(token));
    await sdk.authenticateRequest(cookieReq(token));
    expect(upsertUser).toHaveBeenCalledTimes(1);

    __resetLastSignedInThrottle();
    await sdk.authenticateRequest(cookieReq(token));
    expect(upsertUser).toHaveBeenCalledTimes(2);
  });
});

// ─── Revocation verdict cache ───────────────────────────────────────────────

describe("Phase 21 revocation verdict cache", () => {
  it("memoises negative verdicts: repeated checks cost at most one Redis round-trip per TTL", async () => {
    redisGet.mockResolvedValue(null);

    expect(await isSessionRevoked("sess-a")).toBe(false);
    expect(await isSessionRevoked("sess-a")).toBe(false);
    expect(await isSessionRevoked("sess-a")).toBe(false);
    expect(redisGet).toHaveBeenCalledTimes(1);
  });

  it("same-instance revocation is immediate (revokeSession primes the local cache)", async () => {
    await revokeSession("sess-b");
    expect(redisSet).toHaveBeenCalledWith(
      "revoked:sess-b",
      "1",
      "EX",
      expect.any(Number),
    );
    // Deny is served from the local cache — no Redis read on the hot path.
    expect(await isSessionRevoked("sess-b")).toBe(true);
    expect(redisGet).not.toHaveBeenCalled();
  });

  it("never caches Redis errors: the next check retries Redis (dev fail-open, no sticky verdict)", async () => {
    redisGet.mockRejectedValueOnce(new Error("redis down")).mockResolvedValue("1");

    // Error path: not cached (dev/test => allow, matching the existing posture).
    expect(await isSessionRevoked("sess-c")).toBe(false);
    // Retry hits Redis again and now observes the revocation.
    expect(await isSessionRevoked("sess-c")).toBe(true);
    expect(redisGet).toHaveBeenCalledTimes(2);
    // ... and the positive verdict is then served from cache.
    expect(await isSessionRevoked("sess-c")).toBe(true);
    expect(redisGet).toHaveBeenCalledTimes(2);
  });
});
