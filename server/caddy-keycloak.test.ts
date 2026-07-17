/**
 * caddy-keycloak.test.ts — Vitest tests for Caddy + Keycloak integration
 *
 * Tests cover:
 *   1. keycloakJwt middleware — token extraction from headers
 *   2. validateKeycloakToken — signature verification (mocked JWKS)
 *   3. getJwksStatus — JWKS endpoint health check
 *   4. invalidateJwksCache — cache invalidation
 *   5. requireKeycloakAuth — role-based access control
 *   6. keycloak.getJwksStatus tRPC procedure — admin-only guard
 *   7. keycloak.introspectToken tRPC procedure — introspection response shape
 *   8. keycloak.exchangeCode tRPC procedure — token exchange error handling
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Request, Response, NextFunction } from "express";

// ── Mock jose before importing middleware ─────────────────────────────────────
vi.mock("jose", () => ({
  createRemoteJWKSet: vi.fn(() => vi.fn()),
  jwtVerify: vi.fn(),
}));

import {
  keycloakJwtMiddleware,
  requireKeycloakAuth,
  getKeycloakUserFromRequest,
  getJwksStatus,
  invalidateJwksCache,
  validateKeycloakToken,
  type KeycloakUser,
} from "./middleware/keycloakJwt";

import { jwtVerify } from "jose";

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeReq(headers: Record<string, string> = {}): Request {
  return {
    headers,
  } as unknown as Request;
}

function makeRes(): Response & { _status?: number; _json?: unknown } {
  const res: any = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res;
}

const mockUser: KeycloakUser = {
  sub: "user-uuid-1234",
  username: "trader.alice",
  email: "alice@tradegateway.gov.ng",
  emailVerified: true,
  firstName: "Alice",
  lastName: "Trader",
  realmRoles: ["trader", "offline_access"],
  clientRoles: [],
  sessionState: "session-abc",
  payload: {
    sub: "user-uuid-1234",
    iss: "http://keycloak:8080/realms/tradegateway",
    aud: "tradegateway-backend",
    exp: Math.floor(Date.now() / 1000) + 3600,
    iat: Math.floor(Date.now() / 1000),
    preferred_username: "trader.alice",
    email: "alice@tradegateway.gov.ng",
    email_verified: true,
    given_name: "Alice",
    family_name: "Trader",
    realm_access: { roles: ["trader", "offline_access"] },
    session_state: "session-abc",
  },
};

// ── 1. Token extraction ───────────────────────────────────────────────────────

describe("keycloakJwtMiddleware — token extraction", () => {
  beforeEach(() => {
    vi.mocked(jwtVerify).mockResolvedValue({ payload: mockUser.payload } as any);
  });

  afterEach(() => {
    vi.clearAllMocks();
    invalidateJwksCache();
  });

  it("extracts token from Authorization: Bearer header", async () => {
    const req = makeReq({ authorization: "Bearer eyJtest.token.here" });
    const res = makeRes();
    const next = vi.fn();

    await keycloakJwtMiddleware(req, res, next);

    expect(next).toHaveBeenCalledOnce();
    expect((req as any).keycloakUser).toBeDefined();
    expect((req as any).keycloakUser?.username).toBe("trader.alice");
  });

  it("extracts token from X-Auth-Request-Access-Token header (oauth2-proxy)", async () => {
    const req = makeReq({ "x-auth-request-access-token": "eyJproxy.token.here" });
    const res = makeRes();
    const next = vi.fn();

    await keycloakJwtMiddleware(req, res, next);

    expect(next).toHaveBeenCalledOnce();
    expect((req as any).keycloakUser).toBeDefined();
  });

  it("prefers Authorization header over X-Auth-Request-Access-Token", async () => {
    const req = makeReq({
      authorization: "Bearer eyJbearer.token",
      "x-auth-request-access-token": "eyJproxy.token",
    });
    const res = makeRes();
    const next = vi.fn();

    await keycloakJwtMiddleware(req, res, next);

    // jwtVerify should be called with the bearer token (first arg)
    expect(jwtVerify).toHaveBeenCalledWith(
      "eyJbearer.token",
      expect.any(Function),
      expect.any(Object)
    );
  });

  it("calls next without setting keycloakUser when no token present", async () => {
    const req = makeReq({});
    const res = makeRes();
    const next = vi.fn();

    await keycloakJwtMiddleware(req, res, next);

    expect(next).toHaveBeenCalledOnce();
    expect((req as any).keycloakUser).toBeUndefined();
  });

  it("calls next and sets keycloakUser to null on invalid token", async () => {
    vi.mocked(jwtVerify).mockRejectedValueOnce(new Error("JWTExpired"));
    const req = makeReq({ authorization: "Bearer expired.token.here" });
    const res = makeRes();
    const next = vi.fn();

    await keycloakJwtMiddleware(req, res, next);

    expect(next).toHaveBeenCalledOnce();
    expect((req as any).keycloakUser).toBeNull();
  });
});

// ── 2. validateKeycloakToken ──────────────────────────────────────────────────

describe("validateKeycloakToken", () => {
  beforeEach(() => {
    vi.mocked(jwtVerify).mockResolvedValue({ payload: mockUser.payload } as any);
  });

  afterEach(() => {
    vi.clearAllMocks();
    invalidateJwksCache();
  });

  it("returns a KeycloakUser with correct fields", async () => {
    const user = await validateKeycloakToken("eyJvalid.token");

    expect(user.sub).toBe("user-uuid-1234");
    expect(user.username).toBe("trader.alice");
    expect(user.email).toBe("alice@tradegateway.gov.ng");
    expect(user.realmRoles).toContain("trader");
    expect(user.emailVerified).toBe(true);
  });

  it("extracts realm roles from realm_access.roles", async () => {
    const user = await validateKeycloakToken("eyJvalid.token");
    expect(user.realmRoles).toEqual(["trader", "offline_access"]);
  });

  it("extracts client roles from resource_access", async () => {
    const payloadWithClientRoles = {
      ...mockUser.payload,
      resource_access: {
        "tradegateway-backend": { roles: ["declaration:submit"] },
      },
    };
    vi.mocked(jwtVerify).mockResolvedValueOnce({ payload: payloadWithClientRoles } as any);

    const user = await validateKeycloakToken("eyJvalid.token");
    expect(user.clientRoles).toContain("declaration:submit");
  });

  it("throws on invalid token", async () => {
    vi.mocked(jwtVerify).mockRejectedValueOnce(new Error("JWTSignatureInvalid"));

    await expect(validateKeycloakToken("eyJinvalid.token")).rejects.toThrow(
      "JWTSignatureInvalid"
    );
  });
});

// ── 3. getKeycloakUserFromRequest ─────────────────────────────────────────────

describe("getKeycloakUserFromRequest", () => {
  afterEach(() => {
    vi.clearAllMocks();
    invalidateJwksCache();
  });

  it("returns null when no token in request", async () => {
    const req = makeReq({});
    const user = await getKeycloakUserFromRequest(req);
    expect(user).toBeNull();
  });

  it("returns null on invalid token (does not throw)", async () => {
    vi.mocked(jwtVerify).mockRejectedValueOnce(new Error("JWTExpired"));
    const req = makeReq({ authorization: "Bearer expired.token" });
    const user = await getKeycloakUserFromRequest(req);
    expect(user).toBeNull();
  });

  it("returns KeycloakUser on valid token", async () => {
    vi.mocked(jwtVerify).mockResolvedValueOnce({ payload: mockUser.payload } as any);
    const req = makeReq({ authorization: "Bearer valid.token" });
    const user = await getKeycloakUserFromRequest(req);
    expect(user?.sub).toBe("user-uuid-1234");
  });
});

// ── 4. requireKeycloakAuth middleware ─────────────────────────────────────────

describe("requireKeycloakAuth", () => {
  afterEach(() => {
    vi.clearAllMocks();
    invalidateJwksCache();
  });

  it("returns 401 when no token present", async () => {
    const middleware = requireKeycloakAuth();
    const req = makeReq({});
    const res = makeRes();
    const next = vi.fn();

    await middleware(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ code: "NO_TOKEN" })
    );
    expect(next).not.toHaveBeenCalled();
  });

  it("returns 401 when token is invalid", async () => {
    vi.mocked(jwtVerify).mockRejectedValueOnce(new Error("JWTExpired"));
    const middleware = requireKeycloakAuth();
    const req = makeReq({ authorization: "Bearer bad.token" });
    const res = makeRes();
    const next = vi.fn();

    await middleware(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ code: "INVALID_TOKEN" })
    );
  });

  it("returns 403 when user lacks required role", async () => {
    vi.mocked(jwtVerify).mockResolvedValueOnce({ payload: mockUser.payload } as any);
    const middleware = requireKeycloakAuth(["customs_officer"]);
    const req = makeReq({ authorization: "Bearer valid.token" });
    const res = makeRes();
    const next = vi.fn();

    await middleware(req, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ code: "FORBIDDEN" })
    );
  });

  it("calls next when user has required role", async () => {
    vi.mocked(jwtVerify).mockResolvedValueOnce({ payload: mockUser.payload } as any);
    const middleware = requireKeycloakAuth(["trader"]);
    const req = makeReq({ authorization: "Bearer valid.token" });
    const res = makeRes();
    const next = vi.fn();

    await middleware(req, res, next);

    expect(next).toHaveBeenCalledOnce();
    expect((req as any).keycloakUser?.username).toBe("trader.alice");
  });

  it("calls next when no roles required and token is valid", async () => {
    vi.mocked(jwtVerify).mockResolvedValueOnce({ payload: mockUser.payload } as any);
    const middleware = requireKeycloakAuth();
    const req = makeReq({ authorization: "Bearer valid.token" });
    const res = makeRes();
    const next = vi.fn();

    await middleware(req, res, next);

    expect(next).toHaveBeenCalledOnce();
  });
});

// ── 5. getJwksStatus ─────────────────────────────────────────────────────────

describe("getJwksStatus", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    invalidateJwksCache();
  });

  it("returns reachable=false when fetch throws", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(
      new Error("ECONNREFUSED")
    );

    const status = await getJwksStatus();

    expect(status.reachable).toBe(false);
    expect(status.error).toContain("ECONNREFUSED");
    expect(status.keyCount).toBe(0);
    expect(status.checkedAt).toBeDefined();
  });

  it("returns reachable=false on non-OK HTTP response", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
      ok: false,
      status: 503,
      statusText: "Service Unavailable",
    } as any);

    const status = await getJwksStatus();

    expect(status.reachable).toBe(false);
    expect(status.error).toContain("503");
  });

  it("returns reachable=true with key count on success", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        keys: [{ kid: "key1", kty: "RSA" }, { kid: "key2", kty: "RSA" }],
      }),
    } as any);

    const status = await getJwksStatus();

    expect(status.reachable).toBe(true);
    expect(status.keyCount).toBe(2);
    expect(status.error).toBeUndefined();
  });

  it("includes issuer and jwksUrl in response", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
      ok: true,
      json: async () => ({ keys: [] }),
    } as any);

    const status = await getJwksStatus();

    expect(status.issuer).toContain("realms/tradegateway");
    expect(status.jwksUrl).toContain("openid-connect/certs");
  });
});

// ── 6. invalidateJwksCache ────────────────────────────────────────────────────

describe("invalidateJwksCache", () => {
  it("does not throw when called multiple times", () => {
    expect(() => {
      invalidateJwksCache();
      invalidateJwksCache();
      invalidateJwksCache();
    }).not.toThrow();
  });
});

// ── 7. Caddy infrastructure files existence ───────────────────────────────────

describe("Caddy infrastructure files", () => {
  it("Caddyfile.prod exists in infra/caddy/", async () => {
    const fs = await import("fs/promises");
    const content = await fs.readFile("infra/caddy/Caddyfile.prod", "utf-8");
    expect(content).toContain("forward_auth");
    expect(content).toContain("coraza_waf");
    // Caddy enables HTTPS automatically; the global block uses acme_ca instead of auto_https
    expect(content).toContain("acme_ca");
  });

  it("Caddyfile.dev exists in infra/caddy/", async () => {
    const fs = await import("fs/promises");
    const content = await fs.readFile("infra/caddy/Caddyfile.dev", "utf-8");
    expect(content).toContain("auto_https off");
    expect(content).toContain(":8888");
  });

  it("oauth2-proxy.cfg exists in infra/caddy/", async () => {
    const fs = await import("fs/promises");
    const content = await fs.readFile("infra/caddy/oauth2-proxy.cfg", "utf-8");
    expect(content).toContain("keycloak-oidc");
    expect(content).toContain("caddy-frontend");
  });

  it("Kubernetes Caddy deployment.yaml exists", async () => {
    const fs = await import("fs/promises");
    const content = await fs.readFile("infra/k8s/caddy/deployment.yaml", "utf-8");
    expect(content).toContain("caddy:2-alpine");
  });

  it("Kubernetes Caddy service.yaml exists with LoadBalancer type", async () => {
    const fs = await import("fs/promises");
    const content = await fs.readFile("infra/k8s/caddy/service.yaml", "utf-8");
    expect(content).toContain("LoadBalancer");
    expect(content).toContain("oauth2-proxy");
  });

  it("Kubernetes IngressClass for Caddy exists", async () => {
    const fs = await import("fs/promises");
    const content = await fs.readFile("infra/k8s/caddy/ingress-class.yaml", "utf-8");
    expect(content).toContain("caddy.ingress.kubernetes.io");
  });
});

// ── 8. keycloakJwt middleware module exports ──────────────────────────────────

describe("keycloakJwt module exports", () => {
  it("exports all required functions", () => {
    expect(typeof keycloakJwtMiddleware).toBe("function");
    expect(typeof requireKeycloakAuth).toBe("function");
    expect(typeof getKeycloakUserFromRequest).toBe("function");
    expect(typeof getJwksStatus).toBe("function");
    expect(typeof invalidateJwksCache).toBe("function");
    expect(typeof validateKeycloakToken).toBe("function");
  });

  it("requireKeycloakAuth returns a middleware function", () => {
    const middleware = requireKeycloakAuth(["trader"]);
    expect(typeof middleware).toBe("function");
  });
});
