/**
 * keycloakRoleSync.ts — Keycloak realm_access.roles → user.role sync
 *
 * When a Keycloak-issued JWT is present in the request (Authorization: Bearer ...),
 * this helper decodes the token (without verification — APISIX already verified it
 * at the gateway layer), extracts the realm_access.roles claim, maps the first
 * matching TradeGateway role to the user.role column, and upserts the user record.
 *
 * Phase 20 (GAP 5) — fail-closed claim mapping:
 *   - Claim → role mapping is delegated to ./_core/roleClaimMap (single source
 *     of truth). Bare realm claims (e.g. a bare `admin` from ANY realm) no
 *     longer auto-map; they require an explicit ADMIN_ROLE_CLAIM_MAP allowlist
 *     entry. Unknown privileged claims leave the user at the lowest-privilege
 *     role AND record a PENDING role request (honest pending state) instead of
 *     silently granting access.
 *   - Every role write is audit-logged via db.logAuditEvent.
 *   - Suspended/offboarded users are never modified.
 *
 * This is intentionally non-blocking: if the token is absent, malformed, or the
 * DB is unavailable, the function returns silently without affecting the request.
 */

import type { Request } from "express";
import {
  collectClaimsFromPayload,
  mapKeycloakClaims,
  type TradeGatewayRole,
} from "./roleClaimMap";

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
 * Extracts the mapped TradeGateway role from a Keycloak JWT.
 * Returns the full mapping result (role, mapped flag, unmapped privileged claims).
 */
export function extractRoleMappingFromToken(token: string) {
  const payload = decodeJwtPayload(token);
  if (!payload) return null;
  const claims = collectClaimsFromPayload(
    payload as { realm_access?: { roles?: string[] }; resource_access?: Record<string, { roles?: string[] }> }
  );
  if (claims.length === 0) return null;
  return mapKeycloakClaims(claims);
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
    const mapping = extractRoleMappingFromToken(token);
    if (!mapping) return;

    const { getDb, logAuditEvent } = await import("../db");
    const db = await getDb();
    if (!db) return;

    const { users, roleRequests } = await import("../../drizzle/schema");
    const { and, eq } = await import("drizzle-orm");

    const [current] = await db
      .select({ role: users.role, status: users.status })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    if (!current) return;
    // Fail-closed: never mutate suspended/offboarded accounts via claim sync.
    if (current.status !== "active") return;

    const role: TradeGatewayRole = mapping.role;

    if (current.role !== role) {
      await db
        .update(users)
        .set({ role, updatedAt: new Date() })
        .where(eq(users.id, userId));

      // Audit trail for every claim-driven role write (GAP 5 / GAP 12).
      await logAuditEvent({
        entityType: "user",
        entityId: userId,
        action: "keycloak_role_sync",
        actorId: null,
        actorType: "keycloak_claim_sync",
        previousState: { role: current.role },
        newState: { role },
        metadata: { source: "realm_claims" },
      });
      console.log(`[KeycloakRoleSync] User ${userId} role synced '${current.role}' → '${role}' (audited)`);
    }

    // Honest pending state: privileged claims that were NOT granted become
    // pending maker-checker role requests instead of silent access.
    for (const claim of mapping.unmappedPrivilegedClaims) {
      const requestedRole = claimToPrivilegedRole(claim);
      if (!requestedRole) continue; // not a grantable privileged role — nothing to request
      try {
        const [existing] = await db
          .select({ id: roleRequests.id })
          .from(roleRequests)
          .where(and(eq(roleRequests.userId, userId), eq(roleRequests.status, "pending")))
          .limit(1);
        if (existing) continue;
        await db.insert(roleRequests).values({
          userId,
          requestedRole,
          reason: `Auto-created: unmapped privileged Keycloak claim '${claim}' requires admin approval (GAP 5 fail-closed mapping).`,
        });
      } catch (e) {
        console.warn("[KeycloakRoleSync] Failed to record pending role request:", e);
      }
    }
  } catch (err) {
    // Non-fatal — log and continue
    console.warn("[KeycloakRoleSync] Role sync failed (non-fatal):", err);
  }
}

/** Best-effort mapping of a privileged claim name to a grantable privileged role. */
function claimToPrivilegedRole(
  claim: string
): "admin" | "customs_officer" | "oga_officer" | "inspector" | "finance" | null {
  const stripped = claim.replace(/^tradegateway-/, "").replace(/-/g, "_");
  const privileged = ["admin", "customs_officer", "oga_officer", "inspector", "finance"] as const;
  return (privileged as readonly string[]).includes(stripped)
    ? (stripped as (typeof privileged)[number])
    : null;
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
