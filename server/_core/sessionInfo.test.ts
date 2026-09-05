/**
 * sessionInfo.test.ts — resolveSessionExpiry extracts the credential expiry
 * from Bearer JWTs, the oauth2-proxy header, and the local session cookie.
 *
 * JWT_SECRET must be set before the module (and its env import) loads, so the
 * module under test is imported dynamically in beforeAll.
 */
import { SignJWT } from "jose";
import type { Request } from "express";
import { beforeAll, describe, expect, it, vi } from "vitest";

const TEST_SECRET = "wave3-session-info-test-secret";

let resolveSessionExpiry: typeof import("./sessionInfo").resolveSessionExpiry;

function fakeReq(headers: Record<string, string>): Request {
  return { headers } as unknown as Request;
}

/** Build an unsigned-integrity RS256-looking JWT payload blob (alg none is
 * fine here — resolveSessionExpiry only DECODES bearer/proxy tokens). */
function unsignedJwt(expSeconds: number): string {
  const b64 = (o: unknown) =>
    Buffer.from(JSON.stringify(o)).toString("base64url");
  return `${b64({ alg: "RS256", typ: "JWT" })}.${b64({ sub: "u1", exp: expSeconds })}.sig`;
}

async function signedSessionCookie(expSeconds: number): Promise<string> {
  return new SignJWT({ openId: "user-1", name: "User One" })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setExpirationTime(expSeconds)
    .sign(new TextEncoder().encode(TEST_SECRET));
}

beforeAll(async () => {
  process.env.JWT_SECRET = TEST_SECRET;
  ({ resolveSessionExpiry } = await import("./sessionInfo"));
});

describe("resolveSessionExpiry", () => {
  it("reads exp from an Authorization Bearer token", async () => {
    const exp = 1_900_000_000;
    const out = await resolveSessionExpiry(
      fakeReq({ authorization: `Bearer ${unsignedJwt(exp)}` }),
    );
    expect(out).toEqual({ expiresAt: exp * 1000, source: "keycloak-bearer" });
  });

  it("reads exp from X-Auth-Request-Access-Token (edge proxy)", async () => {
    const exp = 1_900_000_123;
    const out = await resolveSessionExpiry(
      fakeReq({ "x-auth-request-access-token": unsignedJwt(exp) }),
    );
    expect(out).toEqual({ expiresAt: exp * 1000, source: "edge-proxy" });
  });

  it("prefers the Bearer token over the proxy header", async () => {
    const bearerExp = 1_900_000_000;
    const proxyExp = 1_800_000_000;
    const out = await resolveSessionExpiry(
      fakeReq({
        authorization: `Bearer ${unsignedJwt(bearerExp)}`,
        "x-auth-request-access-token": unsignedJwt(proxyExp),
      }),
    );
    expect(out?.source).toBe("keycloak-bearer");
    expect(out?.expiresAt).toBe(bearerExp * 1000);
  });

  it("verifies and reads exp from the local session cookie", async () => {
    const exp = Math.floor(Date.now() / 1000) + 3600;
    const cookie = await signedSessionCookie(exp);
    const out = await resolveSessionExpiry(
      fakeReq({ cookie: `session=${cookie}` }),
    );
    expect(out).toEqual({ expiresAt: exp * 1000, source: "session-cookie" });
  });

  it("honours SESSION_COOKIE_NAME overrides", async () => {
    const prev = process.env.SESSION_COOKIE_NAME;
    process.env.SESSION_COOKIE_NAME = "custom_session";
    try {
      // Re-import with a fresh module registry so the module-level
      // cookie-name constant picks up the env override.
      vi.resetModules();
      const mod = await import("./sessionInfo");
      const exp = Math.floor(Date.now() / 1000) + 3600;
      const cookie = await signedSessionCookie(exp);
      const out = await mod.resolveSessionExpiry(
        fakeReq({ cookie: `custom_session=${cookie}` }),
      );
      expect(out?.source).toBe("session-cookie");
    } finally {
      if (prev === undefined) delete process.env.SESSION_COOKIE_NAME;
      else process.env.SESSION_COOKIE_NAME = prev;
    }
  });

  it("rejects a session cookie signed with the wrong secret (fail-closed)", async () => {
    const exp = Math.floor(Date.now() / 1000) + 3600;
    const evil = await new SignJWT({ openId: "u", name: "n" })
      .setProtectedHeader({ alg: "HS256" })
      .setExpirationTime(exp)
      .sign(new TextEncoder().encode("wrong-secret"));
    const out = await resolveSessionExpiry(fakeReq({ cookie: `session=${evil}` }));
    expect(out).toBeNull();
  });

  it("returns null for an expired session cookie", async () => {
    const exp = Math.floor(Date.now() / 1000) - 60;
    const cookie = await signedSessionCookie(exp);
    const out = await resolveSessionExpiry(fakeReq({ cookie: `session=${cookie}` }));
    expect(out).toBeNull();
  });

  it("returns null when no credential is present", async () => {
    expect(await resolveSessionExpiry(fakeReq({}))).toBeNull();
  });

  it("returns null for a malformed bearer token", async () => {
    expect(
      await resolveSessionExpiry(fakeReq({ authorization: "Bearer not-a-jwt" })),
    ).toBeNull();
  });
});
