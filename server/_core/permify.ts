/**
 * permify.ts — Permify authorization client for TradeGateway NGSWTP
 *
 * Provides a thin wrapper around the Permify REST API for server-side
 * fine-grained authorization checks in tRPC procedures.
 *
 * Usage:
 *   import { can, assertCan } from "./_core/permify";
 *
 *   // In a tRPC procedure:
 *   await assertCan(ctx.user.id.toString(), "declaration", declarationId.toString(), "approve");
 */

import { TRPCError } from "@trpc/server";

const PERMIFY_HOST   = process.env.PERMIFY_HOST   || "http://localhost:3476";
const PERMIFY_TENANT = process.env.PERMIFY_TENANT  || "tradegateway";

// ── Types ─────────────────────────────────────────────────────────────────────

interface PermifyCheckRequest {
  metadata: { schema_version: string; depth: number };
  entity: { type: string; id: string };
  permission: string;
  subject: { type: string; id: string };
}

interface PermifyCheckResponse {
  can: "CHECK_RESULT_ALLOWED" | "CHECK_RESULT_DENIED" | string;
}

// ── Core check function ───────────────────────────────────────────────────────

/**
 * Checks whether a user has a specific permission on a resource.
 * Returns true if allowed, false if denied or if Permify is unavailable.
 * Falls back to false (deny) on network errors to maintain security.
 */
export async function can(
  userId: string,
  entityType: string,
  entityId: string,
  permission: string
): Promise<boolean> {
  const body: PermifyCheckRequest = {
    metadata: { schema_version: "", depth: 20 },
    entity:   { type: entityType, id: entityId },
    permission,
    subject:  { type: "user", id: userId },
  };

  // In demo mode (dev/test only — production boot-refuses DEMO_MODE via
  // server/_core/productionGates), bypass Permify and allow all checks.
  // Defence in depth: never allow the bypass when NODE_ENV=production, even if
  // the startup gate was somehow skipped.
  const isDemoMode =
    process.env.NODE_ENV !== "production" && process.env.DEMO_MODE === "true";
  if (isDemoMode) {
    return true;
  }

  try {
    const res = await fetch(
      `${PERMIFY_HOST}/v1/tenants/${PERMIFY_TENANT}/permissions/check`,
      {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify(body),
        signal:  AbortSignal.timeout(3000), // 3s timeout
      }
    );

    if (!res.ok) {
      console.warn(`[permify] Check failed (${res.status}): ${entityType}:${entityId}#${permission}`);
      // Deny on non-OK responses to maintain security (fail-closed)
      return false;
    }

    const data: PermifyCheckResponse = await res.json();
    return data.can === "CHECK_RESULT_ALLOWED";
  } catch (err) {
    // Permify unavailable — log and deny (fail-closed for security)
    console.warn(`[permify] Unavailable, denying ${entityType}:${entityId}#${permission} for user ${userId} (fail-closed):`, err);
    return false;
  }
}

/**
 * Asserts that a user has a permission, throwing a TRPC FORBIDDEN error if not.
 * Use this in protected tRPC procedures.
 */
export async function assertCan(
  userId: string,
  entityType: string,
  entityId: string,
  permission: string
): Promise<void> {
  const allowed = await can(userId, entityType, entityId, permission);
  if (!allowed) {
    throw new TRPCError({
      code:    "FORBIDDEN",
      message: `You do not have permission to ${permission} on ${entityType}:${entityId}`,
    });
  }
}

/**
 * Writes a relationship tuple to Permify.
 * Used when creating new resources (e.g., a new declaration assigns the trader as owner).
 */
export async function writeTuple(
  entityType: string,
  entityId: string,
  relation: string,
  subjectType: string,
  subjectId: string
): Promise<void> {
  const body = {
    metadata: { schema_version: "" },
    tuples: [
      {
        entity:   { type: entityType, id: entityId },
        relation,
        subject:  { type: subjectType, id: subjectId },
      },
    ],
  };

  try {
    const res = await fetch(
      `${PERMIFY_HOST}/v1/tenants/${PERMIFY_TENANT}/relationships/write`,
      {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify(body),
        signal:  AbortSignal.timeout(3000),
      }
    );

    if (!res.ok) {
      const text = await res.text();
      // SW-MP15: never swallow a failed grant — surface it so the calling
      // mutation fails honestly instead of leaving authz silently unwritten.
      throw new Error(`[permify] writeTuple failed (${res.status}): ${text}`);
    }
  } catch (err) {
    if (err instanceof Error && err.message.startsWith("[permify]")) throw err;
    throw new Error(`[permify] writeTuple unavailable: ${String(err)}`);
  }
}

/**
 * Deletes a relationship tuple from Permify.
 * Used when revoking access (e.g., suspending a trader profile).
 */
export async function deleteTuple(
  entityType: string,
  entityId: string,
  relation: string,
  subjectType: string,
  subjectId: string
): Promise<void> {
  const body = {
    tuples: [
      {
        entity:   { type: entityType, id: entityId },
        relation,
        subject:  { type: subjectType, id: subjectId },
      },
    ],
  };

  try {
    const res = await fetch(
      `${PERMIFY_HOST}/v1/tenants/${PERMIFY_TENANT}/relationships/delete`,
      {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify(body),
        signal:  AbortSignal.timeout(3000),
      }
    );

    if (!res.ok) {
      const text = await res.text();
      // SW-MP15: never swallow a failed revoke — surface it so the calling
      // mutation fails honestly instead of leaving access silently in place.
      throw new Error(`[permify] deleteTuple failed (${res.status}): ${text}`);
    }
  } catch (err) {
    if (err instanceof Error && err.message.startsWith("[permify]")) throw err;
    throw new Error(`[permify] deleteTuple unavailable: ${String(err)}`);
  }
}

/**
 * Convenience: writes the owner tuple when a new resource is created.
 * Call this after inserting a new declaration/permit/payment/etc.
 */
export async function setOwner(
  entityType: string,
  entityId: string | number,
  userId: string | number
): Promise<void> {
  await writeTuple(entityType, String(entityId), "owner", "user", String(userId));
}

/**
 * Convenience: assigns a reviewer/officer to a resource.
 */
export async function assignReviewer(
  entityType: string,
  entityId: string | number,
  relation: string,
  reviewerId: string | number
): Promise<void> {
  await writeTuple(entityType, String(entityId), relation, "user", String(reviewerId));
}

/**
 * writeRelationship — alias for writeTuple with named parameters.
 * Use this to seed Permify when creating users or assigning roles.
 */
export async function writeRelationship(
  entityType: string,
  entityId: string,
  relation: string,
  subjectType: string,
  subjectId: string
): Promise<void> {
  await writeTuple(entityType, entityId, relation, subjectType, subjectId);
}

