import { z } from "zod";
import { router, protectedProcedure, adminProcedure } from "../_core/trpc";
import { getDb } from "../db";
import { sanctionsBatchJobs, sanctionsBatchConflicts, sanctionsChecks } from "../../drizzle/schema";
import { eq, desc, and, isNull, inArray } from "drizzle-orm";
import { storagePut } from "../storage";

export const sanctionsBatchRouter = router({
  list: adminProcedure.query(async () => {
    const db = await getDb();
    if (!db) throw new Error("Database unavailable");
    return db.select().from(sanctionsBatchJobs).orderBy(desc(sanctionsBatchJobs.createdAt)).limit(50);
  }),

  create: adminProcedure
    .input(z.object({ fileName: z.string(), fileBase64: z.string(), totalRows: z.number().int().optional() }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database unavailable");
      const buf = Buffer.from(input.fileBase64, "base64");
      const key = `sanctions-batch/${ctx.user.id}-${Date.now()}-${input.fileName}`;
      const { url } = await storagePut(key, buf, "text/csv");
      const [created] = await db.insert(sanctionsBatchJobs).values({
        submittedBy: ctx.user.id,
        fileName: input.fileName,
        fileUrl: url,
        fileKey: key,
        totalRows: input.totalRows ?? 0,
        status: "pending",
      }).returning({ id: sanctionsBatchJobs.id });
      return { id: created.id, fileUrl: url };
    }),

  getStatus: adminProcedure
    .input(z.object({ id: z.number().int() }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database unavailable");
      const [job] = await db.select().from(sanctionsBatchJobs).where(eq(sanctionsBatchJobs.id, input.id)).limit(1);
      return job ?? null;
    }),

  /** Detect conflicts between incoming batch rows and existing sanctions entries */
  detectConflicts: adminProcedure
    .input(z.object({
      batchId: z.number().int(),
      rows: z.array(z.object({
        rowIndex: z.number().int(),
        entityName: z.string(),
        entityType: z.string().optional(),
        data: z.record(z.string(), z.unknown()),
      })),
    }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database unavailable");
      const conflicts: Array<typeof sanctionsBatchConflicts.$inferInsert> = [];
      // Batch the existence lookups (was one query per row — N+1). When
      // multiple checks share a name, the first match wins, mirroring the
      // previous LIMIT 1 semantics (no ordering was specified).
      const names = [...new Set(input.rows.map((r) => r.entityName))];
      const existingRows = names.length > 0
        ? await db.select().from(sanctionsChecks).where(inArray(sanctionsChecks.entityName, names))
        : [];
      const existingByName = new Map<string, (typeof existingRows)[number]>();
      for (const e of existingRows) {
        if (!existingByName.has(e.entityName)) existingByName.set(e.entityName, e);
      }
      for (const row of input.rows) {
        const existing = existingByName.get(row.entityName);
        if (existing) {
          conflicts.push({
            batchId: input.batchId,
            rowIndex: row.rowIndex,
            entityName: row.entityName,
            entityType: row.entityType ?? null,
            existingId: existing.id,
            incomingData: row.data,
            existingData: {
              id: existing.id,
              entityName: existing.entityName,
              entityType: existing.entityType,
              checkResult: existing.checkResult,
              createdAt: existing.createdAt,
            },
          });
        }
      }
      if (conflicts.length > 0) {
        await db.insert(sanctionsBatchConflicts).values(conflicts);
      }
      return { conflictCount: conflicts.length };
    }),

  /** List unresolved conflicts for a batch */
  listConflicts: adminProcedure
    .input(z.object({ batchId: z.number().int() }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database unavailable");
      return db.select().from(sanctionsBatchConflicts)
        .where(and(eq(sanctionsBatchConflicts.batchId, input.batchId), isNull(sanctionsBatchConflicts.resolution)))
        .orderBy(sanctionsBatchConflicts.rowIndex);
    }),

  /** Resolve a single conflict (overwrite, skip, or merge) */
  resolveConflict: adminProcedure
    .input(z.object({
      conflictId: z.number().int(),
      resolution: z.enum(["overwrite", "skip", "merge"]),
      mergedData: z.record(z.string(), z.unknown()).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database unavailable");
      const [conflict] = await db.select().from(sanctionsBatchConflicts)
        .where(eq(sanctionsBatchConflicts.id, input.conflictId))
        .limit(1);
      if (!conflict) throw new Error("Conflict not found");
      await db.update(sanctionsBatchConflicts)
        .set({
          resolution: input.resolution,
          resolvedBy: ctx.user.id,
          resolvedAt: new Date(),
          ...(input.mergedData ? { incomingData: input.mergedData } : {}),
        })
        .where(eq(sanctionsBatchConflicts.id, input.conflictId));
      return { success: true, resolution: input.resolution };
    }),

  /** Bulk resolve all unresolved conflicts for a batch */
  bulkResolveConflicts: adminProcedure
    .input(z.object({
      batchId: z.number().int(),
      resolution: z.enum(["overwrite", "skip"]),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database unavailable");
      await db.update(sanctionsBatchConflicts)
        .set({ resolution: input.resolution, resolvedBy: ctx.user.id, resolvedAt: new Date() })
        .where(and(eq(sanctionsBatchConflicts.batchId, input.batchId), isNull(sanctionsBatchConflicts.resolution)));
      return { success: true };
    }),

  /** Get conflict resolution summary for a batch */
  conflictSummary: adminProcedure
    .input(z.object({ batchId: z.number().int() }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database unavailable");
      const all = await db.select().from(sanctionsBatchConflicts)
        .where(eq(sanctionsBatchConflicts.batchId, input.batchId));
      return {
        total: all.length,
        unresolved: all.filter(c => !c.resolution).length,
        overwritten: all.filter(c => c.resolution === "overwrite").length,
        skipped: all.filter(c => c.resolution === "skip").length,
        merged: all.filter(c => c.resolution === "merge").length,
        allResolved: all.length === 0 || all.every(c => !!c.resolution),
      };
    }),
});
