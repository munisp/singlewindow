/**
 * Permify tRPC Router — Sprint v79
 * Exposes Permify policy management and permission-check procedures.
 * All write operations are admin-only; reads are protected (any logged-in user).
 */
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { router, protectedProcedure, keycloakAdminProcedure } from "../_core/trpc";
import {
  can,
  writeTuple,
  deleteTuple,
  setOwner,
  assignReviewer,
} from "../_core/permify";
import { ENV } from "../_core/env";

// ── helpers ──────────────────────────────────────────────────────────────────

async function permifyHealth(): Promise<{ ok: boolean; latencyMs: number; version: string }> {
  const start = Date.now();
  try {
    const base = ENV.permifyUrl ?? "http://permify.tradegateway.svc.cluster.local:3476";
    const res = await fetch(`${base}/healthz`, { signal: AbortSignal.timeout(3000) });
    return { ok: res.ok, latencyMs: Date.now() - start, version: res.headers.get("x-permify-version") ?? "unknown" };
  } catch {
    return { ok: false, latencyMs: Date.now() - start, version: "unreachable" };
  }
}

async function listSchemas(): Promise<{ schemas: string[]; count: number }> {
  try {
    const base = ENV.permifyUrl ?? "http://permify.tradegateway.svc.cluster.local:3476";
    const res = await fetch(`${base}/v1/tenants/t1/schemas/list`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ page_size: 100 }),
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return { schemas: [], count: 0 };
    const data = await res.json() as { head_snapshots?: Array<{ schema_version: string }> };
    const schemas = (data.head_snapshots ?? []).map((s) => s.schema_version);
    return { schemas, count: schemas.length };
  } catch {
    return { schemas: ["offline-stub-v1"], count: 1 };
  }
}

// ── router ────────────────────────────────────────────────────────────────────

export const permifyRouter = router({
  /**
   * GET /permify.getServiceStatus
   * Returns Permify health, latency, and schema count.
   */
  getServiceStatus: protectedProcedure.query(async () => {
    const [health, schemas] = await Promise.all([permifyHealth(), listSchemas()]);
    return {
      healthy: health.ok,
      latencyMs: health.latencyMs,
      version: health.version,
      schemaCount: schemas.count,
      schemas: schemas.schemas,
    };
  }),

  /**
   * POST /permify.checkPermission
   * Checks whether a subject can perform an action on an entity.
   */
  checkPermission: protectedProcedure
    .input(
      z.object({
        subjectType: z.string().min(1),
        subjectId: z.string().min(1),
        permission: z.string().min(1),
        entityType: z.string().min(1),
        entityId: z.string().min(1),
      })
    )
    .mutation(async ({ input }) => {
      // can(userId, entityType, entityId, permission)
      const allowed = await can(
        input.subjectId,
        input.entityType,
        input.entityId,
        input.permission
      );
      return { allowed, checkedAt: new Date().toISOString() };
    }),

  /**
   * POST /permify.writeTuple (admin-only)
   * Creates a new relationship tuple in Permify.
   */
  writeTuple: keycloakAdminProcedure
    .input(
      z.object({
        entityType: z.string().min(1),
        entityId: z.string().min(1),
        relation: z.string().min(1),
        subjectType: z.string().min(1),
        subjectId: z.string().min(1),
        subjectRelation: z.string().optional(),
      })
    )
    .mutation(async ({ input }) => {
      await writeTuple(
        input.entityType,
        input.entityId,
        input.relation,
        input.subjectType,
        input.subjectId
      );
      return { success: true, tuple: input };
    }),

  /**
   * POST /permify.deleteTuple (admin-only)
   * Removes a relationship tuple from Permify.
   */
  deleteTuple: keycloakAdminProcedure
    .input(
      z.object({
        entityType: z.string().min(1),
        entityId: z.string().min(1),
        relation: z.string().min(1),
        subjectType: z.string().min(1),
        subjectId: z.string().min(1),
        subjectRelation: z.string().optional(),
      })
    )
    .mutation(async ({ input }) => {
      await deleteTuple(
        input.entityType,
        input.entityId,
        input.relation,
        input.subjectType,
        input.subjectId
      );
      return { success: true, deleted: input };
    }),

  /**
   * POST /permify.setOwner (admin-only)
   * Sets the owner of a resource entity.
   */
  setOwner: keycloakAdminProcedure
    .input(
      z.object({
        entityType: z.string().min(1),
        entityId: z.string().min(1),
        ownerId: z.string().min(1),
      })
    )
    .mutation(async ({ input }) => {
      await setOwner(input.entityType, input.entityId, input.ownerId);
      return { success: true, owner: input.ownerId, entity: `${input.entityType}:${input.entityId}` };
    }),

  /**
   * POST /permify.assignReviewer (admin-only)
   * Assigns a reviewer to a resource entity.
   */
  assignReviewer: keycloakAdminProcedure
    .input(
      z.object({
        entityType: z.string().min(1),
        entityId: z.string().min(1),
        reviewerId: z.string().min(1),
      })
    )
    .mutation(async ({ input }) => {
      await assignReviewer(input.entityType, input.entityId, "reviewer", input.reviewerId);
      return { success: true, reviewer: input.reviewerId, entity: `${input.entityType}:${input.entityId}` };
    }),

  /**
   * POST /permify.writeRelationship (admin-only)
   * Low-level write of a full relationship object.
   */
  writeRelationship: keycloakAdminProcedure
    .input(
      z.object({
        entityType: z.string().min(1),
        entityId: z.string().min(1),
        relation: z.string().min(1),
        subjectType: z.string().min(1),
        subjectId: z.string().min(1),
      })
    )
    .mutation(async ({ input }) => {
      await writeTuple(input.entityType, input.entityId, input.relation, input.subjectType, input.subjectId);
      return { success: true };
    }),

  /**
   * GET /permify.listPolicies (admin-only)
   * Returns the current schema versions available in Permify.
   */
  listPolicies: keycloakAdminProcedure.query(async () => {
    return listSchemas();
  }),

  /**
   * v91: Get Permify authorization audit log entries.
   */
  getAuditLog: keycloakAdminProcedure
    .input(z.object({
      operation: z.string().optional(),
      entity: z.string().optional(),
      limit: z.number().int().min(1).max(500).default(100),
    }))
    .query(async ({ input }) => {
      const { getPermifyAuditLog } = await import("../db");
      return getPermifyAuditLog({ operation: input.operation, entity: input.entity, limit: input.limit });
    }),

  /**
   * v91: Get Permify audit log stats (operation breakdown).
   */
  getAuditStats: keycloakAdminProcedure.query(async () => {
    const { getPermifyAuditLog } = await import("../db");
    const rows = await getPermifyAuditLog({ limit: 1000 });
    const byOp: Record<string, { total: number; allowed: number; denied: number }> = {};
    for (const r of rows) {
      if (!byOp[r.operation]) byOp[r.operation] = { total: 0, allowed: 0, denied: 0 };
      byOp[r.operation].total++;
      if (r.allowed === true) byOp[r.operation].allowed++;
      if (r.allowed === false) byOp[r.operation].denied++;
    }
    return Object.entries(byOp).map(([operation, stats]) => ({ operation, ...stats }));
  }),
});
