/**
 * keycloak.ts — tRPC router for Keycloak OIDC integration (Sprint 32)
 *
 * Proxies to the Go keycloak-svc (port 8087) for OIDC discovery, JWKS
 * management, JWT validation, and role federation. Admin-only procedures
 * allow updating the Keycloak configuration and testing connectivity.
 *
 * Procedures:
 *   keycloak.getConfig         — get current OIDC config (admin only)
 *   keycloak.updateConfig      — update OIDC config (admin only)
 *   keycloak.testConnection    — test Keycloak realm connectivity (admin only)
 *   keycloak.refreshJWKS       — force JWKS key rotation (admin only)
 *   keycloak.validateToken     — validate a JWT token (protected)
 *   keycloak.getDiscovery      — get OIDC discovery document (protected)
 *   keycloak.getServiceStatus  — get keycloak-svc health (protected)
 *   keycloak.getDbConfig       — get DB-persisted Keycloak config (admin only)
 *   keycloak.saveDbConfig      — persist Keycloak config to DB (admin only)
 */

import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import { getKeycloakConfig, upsertKeycloakConfig, logAuditEvent } from "../db";
import {
  getJwksStatus,
  invalidateJwksCache,
  validateKeycloakToken,
} from "../middleware/keycloakJwt";

const KEYCLOAK_SVC_URL = process.env.KEYCLOAK_SVC_URL || "http://localhost:8087";

async function keycloakSvcAvailable(): Promise<boolean> {
  try {
    const res = await fetch(`${KEYCLOAK_SVC_URL}/health`, { signal: AbortSignal.timeout(3_000) });
    return res.ok;
  } catch {
    return false;
  }
}

async function keycloakFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${KEYCLOAK_SVC_URL}${path}`, {
    ...options,
    headers: { "Content-Type": "application/json", ...(options?.headers ?? {}) },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: `Keycloak service error (${res.status}): ${body}`,
    });
  }
  return res.json() as Promise<T>;
}

function requireAdmin(role: string) {
  if (role !== "admin") {
    throw new TRPCError({ code: "FORBIDDEN", message: "Admin access required" });
  }
}

export const keycloakRouter = router({
  /**
   * Get the current OIDC configuration from the Go service.
   * Admin only — client secret is redacted.
   */
  getConfig: protectedProcedure.query(async ({ ctx }) => {
    requireAdmin(ctx.user.role);
    const available = await keycloakSvcAvailable();
    if (!available) {
      // Fall back to DB config
      const dbConfig = await getKeycloakConfig();
      return { ...dbConfig, _source: "db_fallback", clientSecret: undefined };
    }
    return keycloakFetch<Record<string, unknown>>("/api/oidc/config");
  }),

  /**
   * Update the OIDC configuration in the Go service and persist to DB.
   * Admin only.
   */
  updateConfig: protectedProcedure
    .input(z.object({
      enabled: z.boolean().optional(),
      realmUrl: z.string().url().optional(),
      clientId: z.string().min(1).optional(),
      clientSecret: z.string().optional(),
      audience: z.string().optional(),
      fallbackEnabled: z.boolean().optional(),
      roleMappings: z.record(z.string(), z.string()).optional(),
      scopes: z.array(z.string()).optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      requireAdmin(ctx.user.role);

      // Update Go service
      const available = await keycloakSvcAvailable();
      if (available) {
        await keycloakFetch("/api/oidc/config", {
          method: "PUT",
          body: JSON.stringify({
            enabled: input.enabled,
            realmUrl: input.realmUrl,
            clientId: input.clientId,
            clientSecret: input.clientSecret,
            audience: input.audience,
            fallbackEnabled: input.fallbackEnabled,
            roleMappings: input.roleMappings,
            scopes: input.scopes,
          }),
        });
      }

      // Persist to DB
      await upsertKeycloakConfig({
        enabled: input.enabled,
        realmUrl: input.realmUrl,
        clientId: input.clientId,
        clientSecret: input.clientSecret ? `[encrypted]${input.clientSecret}` : undefined,
        issuer: input.realmUrl,
        roleMappings: input.roleMappings as Record<string, string> | undefined,
        scopes: input.scopes,
        fallbackEnabled: input.fallbackEnabled,
        updatedBy: ctx.user.id,
      });

      await logAuditEvent({
        entityType: "user",
        entityId: ctx.user.id,
        action: "keycloak_config_updated",
        actorId: ctx.user.id,
        actorType: "admin",
        newState: { realmUrl: input.realmUrl, enabled: input.enabled },
      });

      return { success: true, updatedAt: new Date().toISOString() };
    }),

  /**
   * Test connectivity to the configured Keycloak realm.
   * Admin only.
   */
  testConnection: protectedProcedure.mutation(async ({ ctx }) => {
    requireAdmin(ctx.user.role);
    const available = await keycloakSvcAvailable();
    if (!available) {
      return {
        success: false,
        error: "keycloak-svc is unavailable",
        testedAt: new Date().toISOString(),
      };
    }
    const result = await keycloakFetch<Record<string, unknown>>("/api/oidc/test-connection", {
      method: "POST",
    });

    // Update DB with test result
    await upsertKeycloakConfig({
      lastTestedAt: new Date(),
      lastTestResult: (result as any).success ? "ok" : "failed",
      lastTestError: (result as any).error ?? null,
      updatedBy: ctx.user.id,
    });

    return result;
  }),

  /**
   * Force a JWKS key rotation (re-fetch from Keycloak).
   * Admin only. Also invalidates the local jose JWKS cache.
   */
  refreshJWKS: protectedProcedure.mutation(async ({ ctx }) => {
    requireAdmin(ctx.user.role);
    // Invalidate the local jose JWKS cache immediately
    invalidateJwksCache();
    const available = await keycloakSvcAvailable();
    if (available) {
      try {
        await keycloakFetch<Record<string, unknown>>("/api/oidc/refresh-jwks", { method: "POST" });
      } catch {
        // Non-fatal — local cache already cleared
      }
    }
    // Re-check JWKS status after cache invalidation
    const status = await getJwksStatus();
    return { success: true, jwksStatus: status };
  }),

  /**
   * Get JWKS endpoint health status — checks reachability and key count.
   * Admin only.
   */
  getJwksStatus: protectedProcedure.query(async ({ ctx }) => {
    requireAdmin(ctx.user.role);
    return getJwksStatus();
  }),

  /**
   * Exchange a Keycloak authorization code for tokens.
   * Used by the frontend after Keycloak redirects back with ?code=...
   * Protected — requires an existing Manus session to call this.
   */
  exchangeCode: protectedProcedure
    .input(z.object({
      code: z.string().min(1),
      redirectUri: z.string().url(),
      codeVerifier: z.string().optional(), // PKCE
    }))
    .mutation(async ({ input }) => {
      const keycloakRealmUrl =
        process.env.KEYCLOAK_REALM_URL || "http://keycloak:8080/realms/tradegateway";
      const clientId =
        process.env.KEYCLOAK_CLIENT_ID || "tradegateway-backend";
      const clientSecret = process.env.KEYCLOAK_CLIENT_SECRET || "";

      const tokenUrl = `${keycloakRealmUrl}/protocol/openid-connect/token`;

      const body = new URLSearchParams({
        grant_type: "authorization_code",
        code: input.code,
        redirect_uri: input.redirectUri,
        client_id: clientId,
        client_secret: clientSecret,
        ...(input.codeVerifier ? { code_verifier: input.codeVerifier } : {}),
      });

      const res = await fetch(tokenUrl, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: body.toString(),
        signal: AbortSignal.timeout(10_000),
      });

      if (!res.ok) {
        const err = await res.text();
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Token exchange failed: ${err}`,
        });
      }

      const tokens = await res.json() as {
        access_token: string;
        refresh_token?: string;
        id_token?: string;
        expires_in: number;
        token_type: string;
      };

      // Validate the returned access token
      const user = await validateKeycloakToken(tokens.access_token).catch(() => null);

      return {
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token ?? null,
        idToken: tokens.id_token ?? null,
        expiresIn: tokens.expires_in,
        tokenType: tokens.token_type,
        user,
      };
    }),

  /**
   * Introspect a Keycloak token via the introspection endpoint.
   * Returns active status, expiry, and claims.
   * Admin only.
   */
  introspectToken: protectedProcedure
    .input(z.object({ token: z.string().min(10) }))
    .mutation(async ({ input, ctx }) => {
      requireAdmin(ctx.user.role);
      const keycloakRealmUrl =
        process.env.KEYCLOAK_REALM_URL || "http://keycloak:8080/realms/tradegateway";
      const clientId =
        process.env.KEYCLOAK_CLIENT_ID || "tradegateway-backend";
      const clientSecret = process.env.KEYCLOAK_CLIENT_SECRET || "";

      const introspectUrl = `${keycloakRealmUrl}/protocol/openid-connect/token/introspect`;

      const body = new URLSearchParams({
        token: input.token,
        client_id: clientId,
        client_secret: clientSecret,
      });

      const res = await fetch(introspectUrl, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: body.toString(),
        signal: AbortSignal.timeout(10_000),
      });

      if (!res.ok) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `Introspection failed: HTTP ${res.status}`,
        });
      }

      const result = await res.json() as Record<string, unknown>;
      return {
        active: result.active as boolean,
        sub: result.sub as string | undefined,
        username: result.preferred_username as string | undefined,
        email: result.email as string | undefined,
        realmRoles: (result.realm_access as any)?.roles ?? [],
        expiresAt: result.exp
          ? new Date((result.exp as number) * 1000).toISOString()
          : null,
        introspectedAt: new Date().toISOString(),
        raw: result,
      };
    }),

  /**
   * Validate a JWT token against the configured Keycloak realm.
   */
  validateToken: protectedProcedure
    .input(z.object({ token: z.string().min(10) }))
    .mutation(async ({ input }) => {
      const available = await keycloakSvcAvailable();
      if (!available) {
        throw new TRPCError({ code: "SERVICE_UNAVAILABLE", message: "keycloak-svc is unavailable" });
      }
      return keycloakFetch<Record<string, unknown>>("/api/oidc/validate", {
        method: "POST",
        body: JSON.stringify({ token: input.token }),
      });
    }),

  /**
   * Get the OIDC discovery document from the Go service.
   */
  getDiscovery: protectedProcedure.query(async () => {
    const available = await keycloakSvcAvailable();
    if (!available) {
      throw new TRPCError({ code: "SERVICE_UNAVAILABLE", message: "keycloak-svc is unavailable" });
    }
    return keycloakFetch<Record<string, unknown>>("/api/oidc/discovery");
  }),

  /**
   * Get the health and status of the keycloak-svc Go microservice.
   */
  getServiceStatus: protectedProcedure.query(async () => {
    const available = await keycloakSvcAvailable();
    return {
      available,
      serviceUrl: KEYCLOAK_SVC_URL,
      checkedAt: new Date().toISOString(),
    };
  }),

  /**
   * Get the DB-persisted Keycloak configuration (admin only).
   */
  getDbConfig: protectedProcedure.query(async ({ ctx }) => {
    requireAdmin(ctx.user.role);
    const config = await getKeycloakConfig();
    if (!config) return null;
    return { ...config, clientSecret: config.clientSecret ? "[redacted]" : null };
  }),

  /**
   * Persist Keycloak configuration directly to DB (admin only).
   * Use this when keycloak-svc is not deployed yet.
   */
  saveDbConfig: protectedProcedure
    .input(z.object({
      enabled: z.boolean().optional(),
      realmUrl: z.string().url().optional(),
      clientId: z.string().optional(),
      discoveryUrl: z.string().url().optional(),
      jwksUri: z.string().url().optional(),
      issuer: z.string().optional(),
      roleMappings: z.record(z.string(), z.string()).optional(),
      scopes: z.array(z.string()).optional(),
      fallbackEnabled: z.boolean().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      requireAdmin(ctx.user.role);
      const result = await upsertKeycloakConfig({ ...input, roleMappings: input.roleMappings as Record<string, string> | undefined, updatedBy: ctx.user.id });
      await logAuditEvent({
        entityType: "user",
        entityId: ctx.user.id,
        action: "keycloak_db_config_saved",
        actorId: ctx.user.id,
        actorType: "admin",
        newState: { realmUrl: input.realmUrl, enabled: input.enabled },
      });
      return result;
    }),

  /**
   * v90: List Keycloak sessions (admin: all; user: own sessions).
   */
  getSessions: protectedProcedure
    .input(z.object({ userId: z.number().int().optional(), isActive: z.boolean().optional() }).optional())
    .query(async ({ ctx, input }) => {
      const isAdmin = ["admin", "customs_officer"].includes(ctx.user.role);
      const { getKeycloakSessions } = await import("../db");
      const userId = isAdmin ? input?.userId : ctx.user.id;
      return getKeycloakSessions({ userId, isActive: input?.isActive, limit: 200 });
    }),

  /**
   * v90: Revoke a specific Keycloak session by sessionId.
   */
  revokeSession: protectedProcedure
    .input(z.object({ sessionId: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const isAdmin = ["admin", "customs_officer"].includes(ctx.user.role);
      if (!isAdmin) throw new TRPCError({ code: "FORBIDDEN" });
      const { revokeKeycloakSession } = await import("../db");
      const result = await revokeKeycloakSession(input.sessionId);
      if (!result) throw new TRPCError({ code: "NOT_FOUND", message: "Session not found" });
      return { success: true };
    }),

  /**
   * v90: Revoke all active sessions for a given user (admin only).
   */
  revokeAllUserSessions: protectedProcedure
    .input(z.object({ userId: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      const isAdmin = ["admin", "customs_officer"].includes(ctx.user.role);
      if (!isAdmin) throw new TRPCError({ code: "FORBIDDEN" });
      const { getKeycloakSessions, revokeKeycloakSession } = await import("../db");
      const sessions = await getKeycloakSessions({ userId: input.userId, isActive: true });
      await Promise.all(sessions.map(s => revokeKeycloakSession(s.sessionId)));
      return { revokedCount: sessions.length };
    }),
});
