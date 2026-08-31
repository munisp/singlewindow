/**
 * fourEyes.ts — Postgres-backed dual-control (4-eyes) approvals (SW-G4)
 *
 * Replaces the in-memory fourEyesStore Map: approvals now survive restarts and
 * are enforced by privileged mutations. Semantics:
 *   1. A requester creates a request for (action, entityType, entityId).
 *   2. A DIFFERENT admin approves or denies it.
 *   3. A privileged mutation MUST consume a valid approved request —
 *      consume-on-use: an approval authorises exactly one execution.
 *   4. Fail closed: if the store is unavailable, consumption fails and the
 *      privileged action does NOT proceed.
 */
import { TRPCError } from "@trpc/server";
import { and, desc, eq, isNull, or, gt } from "drizzle-orm";
import { getDb } from "../db";
import { fourEyesRequests, type FourEyesRequest } from "../../drizzle/schema";

const DEFAULT_EXPIRY_HOURS = 24;

export async function createFourEyesRequest(params: {
  action: string;
  entityType: string;
  entityId: string;
  requestedBy: number;
  expiresInHours?: number;
}): Promise<FourEyesRequest> {
  const db = await getDb();
  if (!db) throw new TRPCError({ code: "SERVICE_UNAVAILABLE", message: "FOUR_EYES_STORE_UNAVAILABLE" });
  const expiresAt = new Date(Date.now() + (params.expiresInHours ?? DEFAULT_EXPIRY_HOURS) * 3_600_000);
  const [row] = await db.insert(fourEyesRequests).values({
    action: params.action,
    entityType: params.entityType,
    entityId: params.entityId,
    requestedBy: params.requestedBy,
    status: "pending",
    expiresAt,
  }).returning();
  return row;
}

export async function decideFourEyesRequest(params: {
  id: number;
  approverId: number;
  decision: "approved" | "denied";
}): Promise<FourEyesRequest> {
  const db = await getDb();
  if (!db) throw new TRPCError({ code: "SERVICE_UNAVAILABLE", message: "FOUR_EYES_STORE_UNAVAILABLE" });
  const [record] = await db.select().from(fourEyesRequests).where(eq(fourEyesRequests.id, params.id)).limit(1);
  if (!record) throw new TRPCError({ code: "NOT_FOUND", message: "Approval request not found" });
  if (record.status !== "pending") {
    throw new TRPCError({ code: "BAD_REQUEST", message: `Request already ${record.status}` });
  }
  if (record.requestedBy === params.approverId) {
    throw new TRPCError({ code: "FORBIDDEN", message: "Cannot approve your own 4-eyes request" });
  }
  const [updated] = await db.update(fourEyesRequests)
    .set({ status: params.decision, approvedBy: params.approverId, approvedAt: new Date() })
    .where(and(eq(fourEyesRequests.id, params.id), eq(fourEyesRequests.status, "pending")))
    .returning();
  if (!updated) throw new TRPCError({ code: "CONFLICT", message: "Request was decided concurrently" });
  return updated;
}

export async function listPendingFourEyes(): Promise<FourEyesRequest[]> {
  const db = await getDb();
  if (!db) throw new TRPCError({ code: "SERVICE_UNAVAILABLE", message: "FOUR_EYES_STORE_UNAVAILABLE" });
  return db.select().from(fourEyesRequests)
    .where(eq(fourEyesRequests.status, "pending"))
    .orderBy(desc(fourEyesRequests.createdAt))
    .limit(200);
}

/**
 * Consume a valid approval for a privileged action. Atomically marks the
 * approval consumed (consume-on-use). Returns the consumed approval.
 * Throws PRECONDITION_FAILED when no valid approval exists — the caller MUST
 * NOT proceed with the privileged action.
 */
export async function consumeFourEyesApproval(params: {
  action: string;
  entityType: string;
  entityId: string;
  approvalId?: number;
}): Promise<FourEyesRequest> {
  const db = await getDb();
  if (!db) {
    // Fail closed: no store → no privileged action.
    throw new TRPCError({ code: "SERVICE_UNAVAILABLE", message: "FOUR_EYES_STORE_UNAVAILABLE: dual-control state cannot be verified" });
  }
  const conditions = [
    eq(fourEyesRequests.action, params.action),
    eq(fourEyesRequests.entityType, params.entityType),
    eq(fourEyesRequests.entityId, params.entityId),
    eq(fourEyesRequests.status, "approved"),
    isNull(fourEyesRequests.consumedAt),
    or(isNull(fourEyesRequests.expiresAt), gt(fourEyesRequests.expiresAt, new Date())),
  ];
  if (params.approvalId != null) conditions.push(eq(fourEyesRequests.id, params.approvalId));

  // Atomic consume-on-use: only one concurrent execution can win the UPDATE.
  const [consumed] = await db.update(fourEyesRequests)
    .set({ consumedAt: new Date() })
    .where(and(...conditions))
    .returning();

  if (!consumed) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message:
        `FOUR_EYES_APPROVAL_REQUIRED: '${params.action}' on ${params.entityType}/${params.entityId} ` +
        "requires an approved dual-control request. Create one via insiderThreat.requestFourEyesApproval " +
        "and have a second admin approve it.",
    });
  }
  return consumed;
}
