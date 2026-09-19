/**
 * Phase 20 — Stakeholder Onboarding Governance test suite (W1)
 *
 * Covers:
 *   GAP 1 — onboarding.selectRole self-assignment lockdown + maker-checker role requests
 *   GAP 4 — devPortal elevated-scope (admin:all) self-issuance removal
 *   GAP 5 — fail-closed Keycloak claim→role mapping (ADMIN_ROLE_CLAIM_MAP allowlist)
 *   GAP 6 — nigeriaId unsigned dev decode gating
 *   GAP 9 — users.status lifecycle column + enforcement helpers
 */
import { afterEach, describe, expect, it } from "vitest";

const ENV_KEYS = ["ADMIN_ROLE_CLAIM_MAP", "NIGERIA_ID_ALLOW_UNSIGNED_DEV_TOKENS"] as const;
const savedEnv: Record<string, string | undefined> = {};
for (const k of ENV_KEYS) savedEnv[k] = process.env[k];

import type { TrpcContext } from "./_core/context";

function makeCallerCtx(role: string): TrpcContext {
  return {
    user: {
      id: 999999, openId: `t-${role}`, email: `${role}@e.com`, name: role,
      loginMethod: "test", role, status: "active",
      createdAt: new Date(), updatedAt: new Date(), lastSignedIn: new Date(),
    } as TrpcContext["user"],
    req: { protocol: "https", method: "POST", headers: {} } as unknown as TrpcContext["req"],
    res: { clearCookie: () => {} } as unknown as TrpcContext["res"],
  };
}

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
});

// ─── GAP 5: fail-closed claim mapping ────────────────────────────────────────
describe("roleClaimMap (GAP 5)", () => {
  it("bare 'admin' claim does NOT map without an allowlist entry", async () => {
    delete process.env.ADMIN_ROLE_CLAIM_MAP;
    const { mapKeycloakClaims, resetAdminRoleClaimAllowlistCache } = await import("./_core/roleClaimMap");
    resetAdminRoleClaimAllowlistCache();
    const result = mapKeycloakClaims(["admin"]);
    expect(result.role).toBe("user");
    expect(result.mapped).toBe(false);
    expect(result.unmappedPrivilegedClaims).toContain("admin");
  });

  it("bare officer claims do NOT map without an allowlist entry", async () => {
    delete process.env.ADMIN_ROLE_CLAIM_MAP;
    const { mapKeycloakClaims, resetAdminRoleClaimAllowlistCache } = await import("./_core/roleClaimMap");
    resetAdminRoleClaimAllowlistCache();
    for (const claim of ["customs_officer", "oga_officer", "inspector", "finance"]) {
      const result = mapKeycloakClaims([claim]);
      expect(result.role).toBe("user");
      expect(result.unmappedPrivilegedClaims).toContain(claim);
    }
  });

  it("catalogue-prefixed claims still map without an allowlist", async () => {
    delete process.env.ADMIN_ROLE_CLAIM_MAP;
    const { mapKeycloakClaims, resetAdminRoleClaimAllowlistCache } = await import("./_core/roleClaimMap");
    resetAdminRoleClaimAllowlistCache();
    expect(mapKeycloakClaims(["tradegateway-admin"]).role).toBe("admin");
    expect(mapKeycloakClaims(["tradegateway-customs-officer"]).role).toBe("customs_officer");
    expect(mapKeycloakClaims(["tradegateway-trader"]).role).toBe("user");
  });

  it("ADMIN_ROLE_CLAIM_MAP allowlist enables bare-claim mapping", async () => {
    process.env.ADMIN_ROLE_CLAIM_MAP = "admin=admin,customs_officer=customs_officer";
    const { mapKeycloakClaims, resetAdminRoleClaimAllowlistCache } = await import("./_core/roleClaimMap");
    resetAdminRoleClaimAllowlistCache();
    expect(mapKeycloakClaims(["admin"]).role).toBe("admin");
    expect(mapKeycloakClaims(["customs_officer"]).role).toBe("customs_officer");
    // Claims not in the allowlist still do not map
    const unmapped = mapKeycloakClaims(["inspector"]);
    expect(unmapped.role).toBe("user");
    expect(unmapped.unmappedPrivilegedClaims).toContain("inspector");
  });

  it("parseAdminRoleClaimMap ignores malformed entries and catalogue overrides", async () => {
    const { parseAdminRoleClaimMap } = await import("./_core/roleClaimMap");
    const parsed = parseAdminRoleClaimMap("admin=admin,bogus,=user,tradegateway-admin=user,x=notarole, finance=finance");
    expect(parsed.admin).toBe("admin");
    expect(parsed.finance).toBe("finance");
    expect(parsed["tradegateway-admin"]).toBeUndefined(); // catalogue cannot be overridden
    expect(Object.keys(parsed)).not.toContain("");
    expect(Object.keys(parsed)).not.toContain("x");
  });

  it("unknown claims default to lowest-privilege 'user' with honest unmapped reporting", async () => {
    delete process.env.ADMIN_ROLE_CLAIM_MAP;
    const { mapKeycloakClaims, resetAdminRoleClaimAllowlistCache } = await import("./_core/roleClaimMap");
    resetAdminRoleClaimAllowlistCache();
    const result = mapKeycloakClaims(["offline_access", "uma_authorization"]);
    expect(result.role).toBe("user");
    expect(result.mapped).toBe(false);
    expect(result.unmappedPrivilegedClaims).toEqual([]);
  });

  it("highest-priority mapping wins across claims", async () => {
    delete process.env.ADMIN_ROLE_CLAIM_MAP;
    const { mapKeycloakClaims, resetAdminRoleClaimAllowlistCache } = await import("./_core/roleClaimMap");
    resetAdminRoleClaimAllowlistCache();
    expect(mapKeycloakClaims(["tradegateway-trader", "tradegateway-finance"]).role).toBe("finance");
  });

  it("extractRoleMappingFromToken maps claims from an unsigned JWT payload", async () => {
    delete process.env.ADMIN_ROLE_CLAIM_MAP;
    const { extractRoleMappingFromToken } = await import("./_core/keycloakRoleSync");
    const { resetAdminRoleClaimAllowlistCache } = await import("./_core/roleClaimMap");
    resetAdminRoleClaimAllowlistCache();
    const payload = Buffer.from(JSON.stringify({ realm_access: { roles: ["admin"] } })).toString("base64url");
    const token = `x.${payload}.y`;
    const mapping = extractRoleMappingFromToken(token);
    expect(mapping).not.toBeNull();
    expect(mapping!.role).toBe("user"); // bare admin rejected
    expect(mapping!.unmappedPrivilegedClaims).toContain("admin");
  });
});

// ─── GAP 1: selectRole lockdown ──────────────────────────────────────────────
describe("onboarding role governance (GAP 1)", () => {
  it("privileged roles are not self-assignable", async () => {
    const { isSelfAssignableRole, SELF_ASSIGNABLE_ROLES, PRIVILEGED_ROLES } = await import("./routers/onboarding");
    expect([...SELF_ASSIGNABLE_ROLES]).toEqual(["user"]);
    for (const role of ["customs_officer", "oga_officer", "inspector", "finance", "admin"]) {
      expect(isSelfAssignableRole(role)).toBe(false);
      expect(PRIVILEGED_ROLES).toContain(role);
    }
    expect(isSelfAssignableRole("user")).toBe(true);
  });

  it("selectRole rejects privileged roles via the caller (input schema still parses, guard throws)", async () => {
    const { onboardingRouter } = await import("./routers/onboarding");
    const caller = onboardingRouter.createCaller(makeCallerCtx("user"));
    await expect(caller.selectRole({ role: "customs_officer" })).rejects.toThrow(/privileged/i);
    await expect(caller.selectRole({ role: "finance" })).rejects.toThrow(/privileged/i);
    await expect(caller.selectRole({ role: "inspector" })).rejects.toThrow(/privileged/i);
    await expect(caller.selectRole({ role: "oga_officer" })).rejects.toThrow(/privileged/i);
  });

  it("selectRole still accepts the trader-level role", async () => {
    const { onboardingRouter } = await import("./routers/onboarding");
    const caller = onboardingRouter.createCaller(makeCallerCtx("user"));
    // DB is unavailable in the test env → sandbox success path for "user".
    const result = await caller.selectRole({ role: "user" });
    expect(result.role).toBe("user");
  });
});

// ─── GAP 4: devPortal elevated scopes ────────────────────────────────────────
describe("devPortal elevated scopes (GAP 4)", () => {
  it("admin:all is excluded from self-issuable scopes", async () => {
    const { SELF_ISSUABLE_SCOPES, ELEVATED_SCOPES } = await import("./routers/devPortal");
    expect(SELF_ISSUABLE_SCOPES).not.toContain("admin:all");
    expect(ELEVATED_SCOPES).toContain("admin:all");
  });

  it("containsElevatedScope detects elevated scopes in comma lists", async () => {
    const { containsElevatedScope } = await import("./routers/devPortal");
    expect(containsElevatedScope("declarations:read,admin:all")).toBe(true);
    expect(containsElevatedScope("declarations:read,payments:read")).toBe(false);
    expect(containsElevatedScope(" admin:all ")).toBe(true);
  });

  it("createApiKey input schema rejects admin:all", async () => {
    const { devPortalRouter } = await import("./routers/devPortal");
    const caller = devPortalRouter.createCaller(makeCallerCtx("user"));
    await expect(
      caller.createApiKey({ name: "evil-key", scopes: ["admin:all"] as never, rateLimit: 100, sandboxMode: true })
    ).rejects.toThrow();
  });

  it("reviewScopeElevation requires admin (non-admin rejected)", async () => {
    const { devPortalRouter } = await import("./routers/devPortal");
    const caller = devPortalRouter.createCaller(makeCallerCtx("user"));
    await expect(
      caller.reviewScopeElevation({ scopeRequestId: 1, decision: "approved" })
    ).rejects.toThrow();
  });
});

// ─── GAP 6: nigeriaId unsigned decode gating ─────────────────────────────────
describe("nigeriaId dev-decode gating (GAP 6)", () => {
  it("unsigned dev decode is refused unless explicitly enabled outside production", async () => {
    const { isUnsignedDevDecodeAllowed } = await import("./routers/nigeriaId");
    delete process.env.NIGERIA_ID_ALLOW_UNSIGNED_DEV_TOKENS;
    expect(isUnsignedDevDecodeAllowed()).toBe(false);
    process.env.NIGERIA_ID_ALLOW_UNSIGNED_DEV_TOKENS = "true";
    // Test env NODE_ENV is not production → allowed
    expect(isUnsignedDevDecodeAllowed()).toBe(true);
  });

  it("unsigned dev decode is ALWAYS refused when NODE_ENV=production", async () => {
    const { isUnsignedDevDecodeAllowed } = await import("./routers/nigeriaId");
    const savedNodeEnv = process.env.NODE_ENV;
    try {
      process.env.NIGERIA_ID_ALLOW_UNSIGNED_DEV_TOKENS = "true";
      process.env.NODE_ENV = "production";
      expect(isUnsignedDevDecodeAllowed()).toBe(false);
    } finally {
      process.env.NODE_ENV = savedNodeEnv;
    }
  });
});

// ─── GAP 9: users.status lifecycle ───────────────────────────────────────────
describe("users.status lifecycle (GAP 9)", () => {
  it("users table exposes a status column defaulting to active", async () => {
    const { users } = await import("../drizzle/schema");
    expect(users.status).toBeDefined();
    expect(users.status.default).toBe("active");
  });

  it("roleRequests and apiScopeRequests tables exist with pending default", async () => {
    const { roleRequests, apiScopeRequests } = await import("../drizzle/schema");
    expect(roleRequests.status.default).toBe("pending");
    expect(apiScopeRequests.status.default).toBe("pending");
  });

  it("suspend/reactivate/offboard procedures require admin (non-admin rejected)", async () => {
    const { onboardingRouter } = await import("./routers/onboarding");
    const caller = onboardingRouter.createCaller(makeCallerCtx("user"));
    await expect(caller.suspendUser({ userId: 1, reason: "test suspension" })).rejects.toThrow();
    await expect(caller.reactivateUser({ userId: 1 })).rejects.toThrow();
    await expect(caller.offboardUser({ userId: 1, reason: "test offboard" })).rejects.toThrow();
    await expect(caller.reviewRoleRequest({ roleRequestId: 1, decision: "approved" })).rejects.toThrow();
    await expect(caller.listPendingRoleRequests()).rejects.toThrow();
  });
});
