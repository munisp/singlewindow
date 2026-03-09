/**
 * keycloakRoleSync.ts — Keycloak realm_access.roles → user.role sync
 *
 * When a Keycloak-issued JWT is present in the request (Authorization: Bearer ...),
 * this helper decodes the token (without verification — APISIX already verified it
 * at the gateway layer), extracts the realm_access.roles claim, maps the first
 * matching TradeGateway role to the user.role column, and upserts the user record.
 *
 * Role priority (highest wins):
 *   admin > customs_officer > oga_officer > inspector > finance > user
 *
 * This is intentionally non-blocking: if the token is absent, malformed, or the
 * DB is unavailable, the function returns silently without affecting the request.
 */

import type { Request } from "express";

// TradeGateway role enum values (must match drizzle/schema.ts userRoleEnum)
type TradeGatewayRole = "admin" | "customs_officer" | "oga_officer" | "inspector" | "finance" | "user";

// Keycloak realm role → TradeGateway role mapping
const KEYCLOAK_ROLE_MAP: Record<string, TradeGatewayRole> = {
  "tradegateway-admin":           "admin",
  "tradegateway-customs-officer": "customs_officer",
  "tradegateway-oga-officer":     "oga_officer",
  "tradegateway-inspector":       "inspector",
  "tradegateway-finance":         "finance",
  "tradegateway-trader":          "user",
  // Also accept bare role names (for Keycloak realms that don't prefix)
  "admin":           "admin",
  "customs_officer": "customs_officer",
  "oga_officer":     "oga_officer",
  "inspector":       "inspector",
  "finance":         "finance",
  "trader":          "user",
};

// Role priority for conflict resolution
const ROLE_PRIORITY: Record<TradeGatewayRole, number> = {
  admin:           100,
  customs_officer: 80,
  oga_officer:     70,
  inspector:       60,
  finance:         50,
  user:            10,
};

/**
 * Decodes a JWT payload without verifying the signature.
 * APISIX already verified the token at the gateway; this is for claim extraction only.
 */
function decodeJwtPayload(token: string): Record<string, unknown> | null {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    const payload = Buffer.from(parts[1], "base64url").toString("utf8");
    return JSON.parse(payload);
  } catch {
    return null;
  }
}

/**
 * Extracts the highest-priority TradeGateway role from a Keycloak JWT.
 * Returns null if no matching role is found.
 */
function extractRoleFromToken(token: string): TradeGatewayRole | null {
  const payload = decodeJwtPayload(token);
  if (!payload) return null;

  // Keycloak stores realm roles in payload.realm_access.roles
  const realmRoles: string[] = [];
  const realmAccess = payload.realm_access as { roles?: string[] } | undefined;
  if (realmAccess?.roles && Array.isArray(realmAccess.roles)) {
    realmRoles.push(...realmAccess.roles);
  }

  // Also check resource_access for client-specific roles
  const resourceAccess = payload.resource_access as Record<string, { roles?: string[] }> | undefined;
  if (resourceAccess) {
    for (const client of Object.values(resourceAccess)) {
      if (client?.roles && Array.isArray(client.roles)) {
        realmRoles.push(...client.roles);
      }
    }
  }

  if (realmRoles.length === 0) return null;

  // Map and find highest-priority role
  let bestRole: TradeGatewayRole | null = null;
  let bestPriority = -1;

  for (const keycloakRole of realmRoles) {
    const mapped = KEYCLOAK_ROLE_MAP[keycloakRole];
    if (mapped && ROLE_PRIORITY[mapped] > bestPriority) {
      bestRole = mapped;
      bestPriority = ROLE_PRIORITY[mapped];
    }
  }

  return bestRole;
}

/**
 * Syncs the Keycloak role claim to the user.role column in the database.
 * Call this after upsertUser in the OAuth callback, or in the auth.me procedure.
 *
 * @param req  - Express request (to extract Authorization header)
 * @param userId - The platform user ID to update
 */
export async function syncKeycloakRole(req: Request, userId: number): Promise<void> {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith("Bearer ")) return;

    const token = authHeader.slice(7);
    const role = extractRoleFromToken(token);
    if (!role) return;

    // Only update if the role differs from the current value (avoid unnecessary writes)
    const { getDb } = await import("../db");
    const db = await getDb();
    if (!db) return;

    const { users } = await import("../../drizzle/schema");
    const { eq } = await import("drizzle-orm");

    const [current] = await db
      .select({ role: users.role })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    if (current?.role === role) return; // Already in sync

    await db
      .update(users)
      .set({ role, updatedAt: new Date() })
      .where(eq(users.id, userId));

    console.log(`[KeycloakRoleSync] User ${userId} role synced to '${role}' from Keycloak token`);
  } catch (err) {
    // Non-fatal — log and continue
    console.warn("[KeycloakRoleSync] Role sync failed (non-fatal):", err);
  }
}

/**
 * Extracts the Keycloak subject (sub claim) from a Bearer token.
 * Returns null if not present or token is invalid.
 */
export function extractKeycloakSub(req: Request): string | null {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith("Bearer ")) return null;
    const payload = decodeJwtPayload(authHeader.slice(7));
    return typeof payload?.sub === "string" ? payload.sub : null;
  } catch {
    return null;
  }
}
