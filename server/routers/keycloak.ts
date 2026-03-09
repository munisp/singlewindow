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
   * Admin only.
   */
  refreshJWKS: protectedProcedure.mutation(async ({ ctx }) => {
    requireAdmin(ctx.user.role);
    const available = await keycloakSvcAvailable();
    if (!available) {
      throw new TRPCError({ code: "SERVICE_UNAVAILABLE", message: "keycloak-svc is unavailable" });
    }
    return keycloakFetch<Record<string, unknown>>("/api/oidc/refresh-jwks", { method: "POST" });
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
});
