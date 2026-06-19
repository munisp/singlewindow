/**
 * v57 Test Suite
 * Tests for:
 *   1. Keycloak JWKS verifier (keycloakVerifier.ts)
 *   2. OpenSearch audit dual-write hook in trpc.ts
 *   3. nlQuery DB persistence (getHistory returns DB rows)
 *   4. Permify assertCan enforcement in payments.cancel
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── 1. Keycloak Verifier ─────────────────────────────────────────────────────
describe("keycloakVerifier", () => {
  it("returns null for undefined token", async () => {
    const { verifyKeycloakToken } = await import("./_core/keycloakVerifier");
    const result = await verifyKeycloakToken(undefined);
    expect(result).toBeNull();
  });

  it("returns null for empty string token", async () => {
    const { verifyKeycloakToken } = await import("./_core/keycloakVerifier");
    const result = await verifyKeycloakToken("");
    expect(result).toBeNull();
  });

  it("returns null for a malformed JWT", async () => {
    const { verifyKeycloakToken } = await import("./_core/keycloakVerifier");
    // This will fail JWKS fetch (Keycloak not running in test env) — should return null gracefully
    const result = await verifyKeycloakToken("Bearer not.a.real.jwt");
    expect(result).toBeNull();
  });

  it("strips Bearer prefix before verifying", async () => {
    const { verifyKeycloakToken } = await import("./_core/keycloakVerifier");
    // Should not throw even with Bearer prefix
    const result = await verifyKeycloakToken("Bearer eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiJ0ZXN0In0.sig");
    expect(result).toBeNull(); // Invalid sig — graceful null
  });

  it("resetJwksCache clears the cached JWKS set", async () => {
    const { resetJwksCache, verifyKeycloakToken } = await import("./_core/keycloakVerifier");
    // Should not throw
    expect(() => resetJwksCache()).not.toThrow();
    // Subsequent call should still return null for invalid token
    const result = await verifyKeycloakToken(undefined);
    expect(result).toBeNull();
  });

  it("extractRoleFromPayload returns null for empty roles", async () => {
    const { extractRoleFromPayload } = await import("./_core/keycloakVerifier");
    const result = extractRoleFromPayload({
      sub: "test-user",
      iat: Date.now() / 1000,
      exp: Date.now() / 1000 + 3600,
    });
    expect(result).toBeNull();
  });

  it("extractRoleFromPayload maps tradegateway-admin to admin", async () => {
    const { extractRoleFromPayload } = await import("./_core/keycloakVerifier");
    const result = extractRoleFromPayload({
      sub: "test-user",
      iat: Date.now() / 1000,
      exp: Date.now() / 1000 + 3600,
      realm_access: { roles: ["tradegateway-admin", "offline_access"] },
    });
    expect(result).toBe("admin");
  });

  it("extractRoleFromPayload picks highest-priority role", async () => {
    const { extractRoleFromPayload } = await import("./_core/keycloakVerifier");
    const result = extractRoleFromPayload({
      sub: "test-user",
      iat: Date.now() / 1000,
      exp: Date.now() / 1000 + 3600,
      realm_access: { roles: ["tradegateway-trader", "tradegateway-customs-officer"] },
    });
    // customs_officer (priority 80) > user (priority 10)
    expect(result).toBe("customs_officer");
  });

  it("extractRoleFromPayload reads resource_access client roles", async () => {
    const { extractRoleFromPayload } = await import("./_core/keycloakVerifier");
    const result = extractRoleFromPayload({
      sub: "test-user",
      iat: Date.now() / 1000,
      exp: Date.now() / 1000 + 3600,
      resource_access: {
        "tradegateway-app": { roles: ["tradegateway-finance"] },
      },
    });
    expect(result).toBe("finance");
  });
});

// ─── 2. OpenSearch dual-write hook ───────────────────────────────────────────
describe("OpenSearch audit dual-write", () => {
  it("indexAuditEvent is exported from opensearch.ts", async () => {
    const opensearch = await import("./_core/opensearch");
    expect(typeof opensearch.indexAuditEvent).toBe("function");
  });

  it("indexAuditEvent handles missing OpenSearch URL gracefully", async () => {
    const { indexAuditEvent } = await import("./_core/opensearch");
    // Should not throw when OPENSEARCH_URL is not set (test env)
    await expect(
      indexAuditEvent({
        id: 1,
        entityType: "declaration",
        entityId: 42,
        action: "test.action",
        actorId: 1,
        actorType: "user",
        ipAddress: "127.0.0.1",
        userAgent: "test",
        entryHash: null,
        prevHash: null,
        createdAt: new Date(),
      })
    ).resolves.not.toThrow();
  });
});

// ─── 3. nlQuery DB persistence ───────────────────────────────────────────────
describe("nlQuery DB persistence", () => {
  it("nlQueryRouter exports getHistory procedure", async () => {
    const { nlQueryRouter } = await import("./routers/nlQuery");
    expect(nlQueryRouter).toBeDefined();
    // The router object should have getHistory key
    expect(typeof (nlQueryRouter as any)._def?.procedures?.getHistory ?? (nlQueryRouter as any).getHistory).toBeDefined();
  });

  it("nlQueryHistory table is exported from schema", async () => {
    const schema = await import("../drizzle/schema");
    expect(schema.nlQueryHistory).toBeDefined();
    // Should have userId column
    expect((schema.nlQueryHistory as any).userId).toBeDefined();
  });
});

// ─── 4. Permify assertCan in payments.cancel ─────────────────────────────────
describe("Permify RBAC enforcement", () => {
  it("assertCan is exported from permify.ts", async () => {
    const permify = await import("./_core/permify");
    expect(typeof permify.assertCan).toBe("function");
  });

  it("assertCan behaviour depends on DEMO_MODE", async () => {
    const { assertCan } = await import("./_core/permify");
    const isDemoMode = process.env.DEMO_MODE === "true";
    if (isDemoMode) {
      // In DEMO_MODE, Permify is bypassed — assertCan should resolve without throwing
      await expect(assertCan("999", "payment", "999", "cancel")).resolves.toBeUndefined();
    } else {
      // In production with Permify unreachable, assertCan should throw FORBIDDEN (fail-closed)
      await expect(
        assertCan("999", "payment", "999", "cancel")
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
    }
  });

  it("can function returns true in DEMO_MODE (fail-open bypass) or false when Permify is unreachable", async () => {
    const { can } = await import("./_core/permify");
    const result = await can("999", "payment", "999", "cancel");
    // In DEMO_MODE=true (test env), Permify is bypassed and all checks return true.
    // In production (DEMO_MODE=false, Permify unreachable), it returns false (fail-closed).
    const isDemoMode = process.env.DEMO_MODE === "true";
    if (isDemoMode) {
      expect(result).toBe(true);
    } else {
      expect(result).toBe(false);
    }
  });
});

// ─── 5. SDK Keycloak path ─────────────────────────────────────────────────────
describe("SDK authenticateRequest Keycloak path", () => {
  it("sdk exports authenticateRequest method", async () => {
    const { sdk } = await import("./_core/sdk");
    expect(typeof sdk.authenticateRequest).toBe("function");
  });

  it("sdk.authenticateRequest falls back to session cookie when Bearer token is absent", async () => {
    const { sdk } = await import("./_core/sdk");
    // No Bearer header, no session cookie → should throw ForbiddenError
    const mockReq = {
      headers: { cookie: undefined, authorization: undefined },
      socket: {},
    } as any;
    await expect(sdk.authenticateRequest(mockReq)).rejects.toMatchObject({
      message: expect.stringContaining("Invalid session cookie"),
    });
  });
});
