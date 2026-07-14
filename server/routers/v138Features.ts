/**
 * v138 Features Router — covers items 1–30
 * Merged into a single router file to keep routers.ts tidy.
 * Sub-namespaces: aeoComments, docVersions, checklistTemplates,
 *   scheduleStats, scheduleDeps, sanctionsEntities, watchlistAlerts, batchErrors
 */
import { z } from "zod";
import { eq, and, desc, isNull, sql, like, or, inArray } from "drizzle-orm";
import { adminProcedure, protectedProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import {
  aeoRenewalComments,
  aeoDocumentVersions,
  checklistTemplates,
  scheduleDeliveryStats,
  scheduleDependencies,
  sanctionsEntities,
  sanctionsWatchlistAlerts,
  batchValidationErrors,
  aeoRenewalDocuments,
  exportSchedules,
  exportScheduleDeliveries,
  sanctionsBatchConflicts,
} from "../../drizzle/schema";
import { createUserNotification } from "../db";

// ─── AEO Renewal Comments (Item 21) ──────────────────────────────────────────
export const aeoCommentsRouter = router({
  list: protectedProcedure
    .input(z.object({ renewalId: z.number().int() }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return [];
      return db.select().from(aeoRenewalComments)
        .where(eq(aeoRenewalComments.renewalId, input.renewalId))
        .orderBy(aeoRenewalComments.createdAt);
    }),

  post: protectedProcedure
    .input(z.object({
      renewalId: z.number().int(),
      message: z.string().min(1).max(2000),
      mentionedUserIds: z.array(z.number().int()).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database unavailable");
      await db.insert(aeoRenewalComments).values({
        renewalId: input.renewalId,
        authorId: ctx.user.id,
        authorRole: ctx.user.role ?? "user",
        message: input.message,
      });
      // @mention detection: parse @admin / @trader tokens from message
      const mentionTokens = input.message.match(/@(admin|trader|\w+)/gi) ?? [];
      const explicitMentions = input.mentionedUserIds ?? [];
      // Notify explicitly mentioned users
      for (const userId of explicitMentions) {
        if (userId === ctx.user.id) continue;
        try {
          await createUserNotification({
            userId,
            type: "aeo_comment_mention",
            title: "You were mentioned in an AEO renewal comment",
            body: `${ctx.user.name ?? "Someone"} mentioned you on renewal #${input.renewalId}: "${input.message.slice(0, 100)}${input.message.length > 100 ? '...' : ''}"`,
          });
        } catch (_) { /* notification failure is non-fatal */ }
      }
      return { success: true, mentionTokens };
    }),

  delete: protectedProcedure
    .input(z.object({ commentId: z.number().int() }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database unavailable");
      const [comment] = await db.select().from(aeoRenewalComments)
        .where(eq(aeoRenewalComments.id, input.commentId)).limit(1);
      if (!comment) throw new Error("Comment not found");
      if (comment.authorId !== ctx.user.id && ctx.user.role !== "admin") {
        throw new Error("Not authorised to delete this comment");
      }
      await db.delete(aeoRenewalComments).where(eq(aeoRenewalComments.id, input.commentId));
      return { success: true };
    }),
});

// ─── Document Version History (Item 14) ──────────────────────────────────────
export const docVersionsRouter = router({
  list: protectedProcedure
    .input(z.object({ renewalDocId: z.number().int() }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return [];
      return db.select().from(aeoDocumentVersions)
        .where(eq(aeoDocumentVersions.renewalDocId, input.renewalDocId))
        .orderBy(desc(aeoDocumentVersions.uploadedAt));
    }),

  add: protectedProcedure
    .input(z.object({
      renewalDocId: z.number().int(),
      fileUrl: z.string().url(),
      fileKey: z.string().optional(),
      notes: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database unavailable");
      await db.insert(aeoDocumentVersions).values({
        renewalDocId: input.renewalDocId,
        fileUrl: input.fileUrl,
        fileKey: input.fileKey ?? null,
        uploadedBy: ctx.user.id,
        notes: input.notes ?? null,
      });
      return { success: true };
    }),
});

// ─── Checklist Template Editor (Item 27) ─────────────────────────────────────
export const checklistTemplatesRouter = router({
  list: protectedProcedure.query(async () => {
    const db = await getDb();
    if (!db) return [];
    return db.select().from(checklistTemplates).orderBy(checklistTemplates.sortOrder);
  }),

  upsert: adminProcedure
    .input(z.object({
      docType: z.string().min(1).max(100),
      label: z.string().min(1).max(255),
      required: z.boolean(),
      sortOrder: z.number().int().default(0),
      expiryDays: z.number().int().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database unavailable");
      const existing = await db.select().from(checklistTemplates)
        .where(eq(checklistTemplates.docType, input.docType)).limit(1);
      if (existing.length > 0) {
        await db.update(checklistTemplates)
          .set({ label: input.label, required: input.required, sortOrder: input.sortOrder, expiryDays: input.expiryDays ?? null, updatedAt: new Date() })
          .where(eq(checklistTemplates.docType, input.docType));
      } else {
        await db.insert(checklistTemplates).values({ ...input, createdBy: ctx.user.id, expiryDays: input.expiryDays ?? null });
      }
      return { success: true };
    }),

  delete: adminProcedure
    .input(z.object({ docType: z.string() }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database unavailable");
      await db.delete(checklistTemplates).where(eq(checklistTemplates.docType, input.docType));
      return { success: true };
    }),

  reorder: adminProcedure
    .input(z.object({ order: z.array(z.object({ docType: z.string(), sortOrder: z.number().int() })) }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database unavailable");
      for (const item of input.order) {
        await db.update(checklistTemplates)
          .set({ sortOrder: item.sortOrder, updatedAt: new Date() })
          .where(eq(checklistTemplates.docType, item.docType));
      }
      return { success: true };
    }),
});

// ─── Schedule Delivery Stats + Analytics (Items 5, 8, 22, 25, 28) ────────────
export const scheduleStatsRouter = router({
  getStats: protectedProcedure
    .input(z.object({ scheduleId: z.number().int() }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return null;
      const [stats] = await db.select().from(scheduleDeliveryStats)
        .where(eq(scheduleDeliveryStats.scheduleId, input.scheduleId)).limit(1);
      return stats ?? null;
    }),

  getAllStats: protectedProcedure.query(async () => {
    const db = await getDb();
    if (!db) return [];
    return db.select().from(scheduleDeliveryStats);
  }),

  getLast30Deliveries: protectedProcedure
    .input(z.object({ scheduleId: z.number().int() }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return [];
      return db.select().from(exportScheduleDeliveries)
        .where(eq(exportScheduleDeliveries.scheduleId, input.scheduleId))
        .orderBy(desc(exportScheduleDeliveries.deliveredAt))
        .limit(30);
    }),

  retryDelivery: protectedProcedure
    .input(z.object({ scheduleId: z.number().int() }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database unavailable");
      // Reset consecutive failures so schedule can run again
      await db.update(scheduleDeliveryStats)
        .set({ consecutiveFailures: 0, lastUpdated: new Date() })
        .where(eq(scheduleDeliveryStats.scheduleId, input.scheduleId));
      // Re-activate the schedule
      await db.update(exportSchedules)
        .set({ isActive: true })
        .where(eq(exportSchedules.id, input.scheduleId));
      // Log a retry attempt
      await db.insert(exportScheduleDeliveries).values({
        scheduleId: input.scheduleId,
        deliveredAt: new Date(),
        rowCount: 0,
        fileSizeBytes: 0,
        status: "pending",
        errorMessage: null,
      });
      return { success: true };
    }),

  dryRun: protectedProcedure
    .input(z.object({ scheduleId: z.number().int() }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return { estimatedRows: 0, dateRange: null };
      const [schedule] = await db.select().from(exportSchedules)
        .where(eq(exportSchedules.id, input.scheduleId)).limit(1);
      if (!schedule) throw new Error("Schedule not found");
      // Estimate based on last delivery
      const [lastDelivery] = await db.select().from(exportScheduleDeliveries)
        .where(and(eq(exportScheduleDeliveries.scheduleId, input.scheduleId), eq(exportScheduleDeliveries.status, "success")))
        .orderBy(desc(exportScheduleDeliveries.deliveredAt)).limit(1);
      const cadenceDays = schedule.cadence === "daily" ? 1 : schedule.cadence === "weekly" ? 7 : 30;
      const from = new Date(Date.now() - cadenceDays * 86400000);
      return {
        estimatedRows: lastDelivery?.rowCount ?? 0,
        dateRange: { from: from.toISOString(), to: new Date().toISOString() },
        cadence: schedule.cadence,
        filterPreset: schedule.filterPreset,
      };
    }),
});

// ─── Schedule Dependencies (Item 28) ─────────────────────────────────────────
export const scheduleDepsRouter = router({
  list: protectedProcedure
    .input(z.object({ scheduleId: z.number().int() }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return [];
      return db.select().from(scheduleDependencies)
        .where(eq(scheduleDependencies.scheduleId, input.scheduleId));
    }),

  add: adminProcedure
    .input(z.object({
      scheduleId: z.number().int(),
      dependsOnScheduleId: z.number().int(),
    }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database unavailable");
      if (input.scheduleId === input.dependsOnScheduleId) {
        throw new Error("A schedule cannot depend on itself");
      }
      await db.insert(scheduleDependencies).values(input);
      return { success: true };
    }),

  remove: adminProcedure
    .input(z.object({ id: z.number().int() }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database unavailable");
      await db.delete(scheduleDependencies).where(eq(scheduleDependencies.id, input.id));
      return { success: true };
    }),

  getDagGraph: protectedProcedure
    .input(z.object({ scheduleId: z.number().int().optional() }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return { nodes: [], edges: [] };
      const allSchedules = await db.select().from(exportSchedules);
      const allDeps = await db.select().from(scheduleDependencies);
      const nodes = allSchedules.map(s => ({
        id: s.id,
        label: `${s.exportType} (${s.cadence})`,
        cadence: s.cadence,
        isActive: s.isActive,
        lastRunAt: s.lastRunAt,
        highlighted: input.scheduleId ? s.id === input.scheduleId : false,
      }));
      const edges = allDeps.map(d => ({
        id: d.id,
        source: d.dependsOnScheduleId,
        target: d.scheduleId,
      }));
      return { nodes, edges };
    }),
});

// ─── Sanctions Entities (Items 10, 13, 20, 30) ───────────────────────────────
export const sanctionsEntitiesRouter = router({
  list: protectedProcedure
    .input(z.object({
      search: z.string().optional(),
      entityType: z.string().optional(),
      page: z.number().int().default(1),
      pageSize: z.number().int().default(25),
    }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return { items: [], total: 0 };
      const conditions = [eq(sanctionsEntities.isActive, true)];
      if (input.search) {
        conditions.push(like(sanctionsEntities.entityName, `%${input.search}%`));
      }
      if (input.entityType) {
        conditions.push(eq(sanctionsEntities.entityType, input.entityType));
      }
      const offset = (input.page - 1) * input.pageSize;
      const items = await db.select().from(sanctionsEntities)
        .where(and(...conditions))
        .orderBy(desc(sanctionsEntities.riskScore))
        .limit(input.pageSize).offset(offset);
      const [{ count }] = await db.select({ count: sql<number>`count(*)` })
        .from(sanctionsEntities).where(and(...conditions));
      return { items, total: Number(count) };
    }),

  updateRiskScore: adminProcedure
    .input(z.object({ id: z.number().int(), riskScore: z.number().int().min(1).max(10) }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database unavailable");
      await db.update(sanctionsEntities)
        .set({ riskScore: input.riskScore, updatedAt: new Date() })
        .where(eq(sanctionsEntities.id, input.id));
      return { success: true };
    }),

  bulkDelete: adminProcedure
    .input(z.object({ ids: z.array(z.number().int()).min(1) }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database unavailable");
      await db.update(sanctionsEntities)
        .set({ isActive: false, updatedAt: new Date() })
        .where(inArray(sanctionsEntities.id, input.ids));
      return { success: true, deleted: input.ids.length };
    }),

  getEntityTypes: protectedProcedure.query(async () => {
    const db = await getDb();
    if (!db) return [];
    const rows = await db.selectDistinct({ entityType: sanctionsEntities.entityType })
      .from(sanctionsEntities).where(eq(sanctionsEntities.isActive, true));
    return rows.map(r => r.entityType).filter(Boolean) as string[];
  }),

  mergeEntities: adminProcedure
    .input(z.object({
      primaryId: z.number().int(),
      duplicateId: z.number().int(),
      mergedFields: z.record(z.string(), z.unknown()),
    }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new Error('Database unavailable');
      if (input.primaryId === input.duplicateId) throw new Error('Cannot merge an entity with itself');
      const [primary] = await db.select().from(sanctionsEntities).where(eq(sanctionsEntities.id, input.primaryId)).limit(1);
      const [duplicate] = await db.select().from(sanctionsEntities).where(eq(sanctionsEntities.id, input.duplicateId)).limit(1);
      if (!primary || !duplicate) throw new Error('One or both entities not found');
      const allowedFields = ['entityName', 'country', 'entityType', 'riskScore', 'metadata'];
      const updateData: Record<string, unknown> = { updatedAt: new Date() };
      for (const field of allowedFields) {
        if (field in input.mergedFields) updateData[field] = input.mergedFields[field];
      }
      await db.update(sanctionsEntities).set(updateData as any).where(eq(sanctionsEntities.id, input.primaryId));
      await db.update(sanctionsEntities).set({ isActive: false, updatedAt: new Date() }).where(eq(sanctionsEntities.id, input.duplicateId));
      return { success: true, primaryId: input.primaryId, archivedId: input.duplicateId };
    }),
});

// ─── Sanctions Watchlist Alerts (Item 23) ────────────────────────────────────
export const watchlistAlertsRouter = router({
  list: adminProcedure
    .input(z.object({
      status: z.enum(["open", "reviewed", "dismissed", "all"]).default("open"),
      page: z.number().int().default(1),
      pageSize: z.number().int().default(20),
    }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return { items: [], total: 0 };
      const conditions = input.status !== "all"
        ? [eq(sanctionsWatchlistAlerts.status, input.status)]
        : [];
      const offset = (input.page - 1) * input.pageSize;
      const items = await db.select().from(sanctionsWatchlistAlerts)
        .where(conditions.length > 0 ? and(...conditions) : undefined)
        .orderBy(desc(sanctionsWatchlistAlerts.riskScore), desc(sanctionsWatchlistAlerts.createdAt))
        .limit(input.pageSize).offset(offset);
      const [{ count }] = await db.select({ count: sql<number>`count(*)` })
        .from(sanctionsWatchlistAlerts)
        .where(conditions.length > 0 ? and(...conditions) : undefined);
      return { items, total: Number(count) };
    }),

  review: adminProcedure
    .input(z.object({
      alertId: z.number().int(),
      status: z.enum(["reviewed", "dismissed"]),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database unavailable");
      await db.update(sanctionsWatchlistAlerts)
        .set({ status: input.status, reviewedBy: ctx.user.id, reviewedAt: new Date() })
        .where(eq(sanctionsWatchlistAlerts.id, input.alertId));
      return { success: true };
    }),

  getSummary: adminProcedure.query(async () => {
    const db = await getDb();
    if (!db) return { open: 0, reviewed: 0, dismissed: 0, total: 0 };
    const all = await db.select({ status: sanctionsWatchlistAlerts.status }).from(sanctionsWatchlistAlerts);
    return {
      open: all.filter(a => a.status === "open").length,
      reviewed: all.filter(a => a.status === "reviewed").length,
      dismissed: all.filter(a => a.status === "dismissed").length,
      total: all.length,
    };
  }),
});

// ─── Batch Validation Errors (Item 29) ───────────────────────────────────────
export const batchErrorsRouter = router({
  list: adminProcedure
    .input(z.object({ batchId: z.number().int() }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return [];
      return db.select().from(batchValidationErrors)
        .where(eq(batchValidationErrors.batchId, input.batchId))
        .orderBy(batchValidationErrors.rowIndex);
    }),

  exportCSV: adminProcedure
    .input(z.object({ batchId: z.number().int() }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database unavailable");
      const errors = await db.select().from(batchValidationErrors)
        .where(eq(batchValidationErrors.batchId, input.batchId))
        .orderBy(batchValidationErrors.rowIndex);
      const header = "Row,Field,Error Code,Error Message,Raw Value";
      const rows = errors.map(e =>
        `${e.rowIndex},${e.field ?? ""},${e.errorCode},"${(e.errorMessage ?? "").replace(/"/g, '""')}","${(e.rawValue ?? "").replace(/"/g, '""')}"`
      );
      return { csv: [header, ...rows].join("\n"), count: errors.length };
    }),

  getSummary: adminProcedure
    .input(z.object({ batchId: z.number().int() }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return { total: 0, byField: {} };
      const errors = await db.select().from(batchValidationErrors)
        .where(eq(batchValidationErrors.batchId, input.batchId));
      const byField: Record<string, number> = {};
      for (const e of errors) {
        const key = e.field ?? "unknown";
        byField[key] = (byField[key] ?? 0) + 1;
      }
      return { total: errors.length, byField };
    }),
});

// ─── Conflict Resolution Stats Dashboard (Item 26) ───────────────────────────
export const conflictStatsRouter = router({
  globalSummary: adminProcedure.query(async () => {
    const db = await getDb();
    if (!db) return { total: 0, resolved: 0, pending: 0, overwritten: 0, skipped: 0, merged: 0 };
    const all = await db.select({
      resolution: sanctionsBatchConflicts.resolution,
    }).from(sanctionsBatchConflicts);
    return {
      total: all.length,
      resolved: all.filter(c => !!c.resolution).length,
      pending: all.filter(c => !c.resolution).length,
      overwritten: all.filter(c => c.resolution === "overwrite").length,
      skipped: all.filter(c => c.resolution === "skip").length,
      merged: all.filter(c => c.resolution === "merge").length,
    };
  }),

  undoResolution: adminProcedure
    .input(z.object({ conflictId: z.number().int() }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database unavailable");
      const [conflict] = await db.select().from(sanctionsBatchConflicts)
        .where(eq(sanctionsBatchConflicts.id, input.conflictId)).limit(1);
      if (!conflict) throw new Error("Conflict not found");
      if (!conflict.resolvedAt) throw new Error("Conflict is not resolved");
      // Only allow undo within 24 hours
      const hoursSinceResolution = (Date.now() - new Date(conflict.resolvedAt).getTime()) / 3600000;
      if (hoursSinceResolution > 24) throw new Error("Undo window (24 hours) has expired");
      await db.update(sanctionsBatchConflicts)
        .set({ resolution: null, resolvedBy: null, resolvedAt: null })
        .where(eq(sanctionsBatchConflicts.id, input.conflictId));
      return { success: true };
    }),
});
