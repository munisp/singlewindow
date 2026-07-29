/**
 * Lakehouse Jobs tRPC Router — Sprint v81
 * Admin procedures for Delta Lake batch job monitoring and manual triggering.
 *
 * All procedures read from and write to the lakehouseJobs table in PostgreSQL.
 * Jobs are created by the scheduled lakehouseRollup handler and the deltalake-svc.
 * No mock data — returns empty results when no jobs exist.
 */
import { z } from "zod";
import { router, protectedProcedure, adminProcedure } from "../_core/trpc";
import { TRPCError } from "@trpc/server";
import { getDb, getLakehouseJobs, getLakehouseJobById, getLakehouseJobStats, upsertLakehouseJob } from "../db";
import { lakehouseJobs } from "../../drizzle/schema";
import { eq, sql } from "drizzle-orm";

const JOB_TYPES = [
  "DELTA_COMPACTION",
  "PARQUET_EXPORT",
  "SPARK_AGGREGATION",
  "FLINK_STREAM_SNAPSHOT",
  "ML_FEATURE_PIPELINE",
  "GEOSPATIAL_INDEX",
  "AUDIT_ARCHIVE",
  "TRADE_STATS_ROLLUP",
] as const;

const TARGET_TABLES = [
  "trade_stats_mirror",
  "declaration_events_mirror",
  "payment_ledger_mirror",
  "risk_scores_mirror",
  "oga_permit_mirror",
  "kyc_events_mirror",
  "cargo_tracking_mirror",
] as const;

const STATUSES = ["pending", "running", "completed", "failed", "cancelled"] as const;

export const lakehouseRouter = router({
  /**
   * getLakehouseJobs — paginated list of Delta Lake batch jobs from the database.
   */
  getLakehouseJobs: adminProcedure
    .input(
      z.object({
        limit: z.number().int().min(1).max(500).default(50),
        offset: z.number().int().min(0).default(0),
        status: z.enum(STATUSES).optional(),
        jobType: z.string().optional(),
        targetTable: z.string().optional(),
      }).optional()
    )
    .query(async ({ input }) => {
      const jobs = await getLakehouseJobs({
        limit: input?.limit,
        offset: input?.offset,
        status: input?.status,
        jobType: input?.jobType,
        targetTable: input?.targetTable,
      });

      // Get total count for pagination
      const db = await getDb();
      let total = jobs.length;
      if (db) {
        try {
          const [countRow] = await db
            .select({ count: sql<number>`count(*)::int` })
            .from(lakehouseJobs);
          total = countRow?.count ?? jobs.length;
        } catch {
          // Non-fatal
        }
      }

      return { jobs, total };
    }),

  /**
   * getLakehouseJobById — fetch a single job by its DB id.
   */
  getLakehouseJobById: adminProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .query(async ({ input }) => {
      const job = await getLakehouseJobById(input.id);
      if (!job) throw new TRPCError({ code: "NOT_FOUND", message: `Lakehouse job ${input.id} not found` });
      return job;
    }),

  /**
   * getLakehouseStats — summary counts by status.
   */
  getLakehouseStats: adminProcedure
    .query(async () => {
      const stats = await getLakehouseJobStats();
      return stats ?? { pending: 0, running: 0, completed: 0, failed: 0, cancelled: 0 };
    }),

  /**
   * triggerLakehouseJob — manually trigger a new Delta Lake batch job.
   * Creates a pending job record and notifies the deltalake-svc via HTTP.
   */
  triggerLakehouseJob: adminProcedure
    .input(
      z.object({
        jobType: z.enum(JOB_TYPES),
        targetTable: z.enum(TARGET_TABLES),
        params: z.record(z.string(), z.unknown()).optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const jobId = `lh-manual-${Date.now().toString(16)}-${Math.random().toString(16).slice(2, 6)}`;
      const job = await upsertLakehouseJob({
        jobId,
        jobType: input.jobType,
        targetTable: input.targetTable,
        status: "pending",
        triggeredBy: "manual",
        createdAt: new Date(),
        metadata: { triggeredByUserId: ctx.user.id, params: input.params ?? {} },
      });

      // Notify deltalake-svc to pick up the job
      const DELTALAKE_SVC = process.env.DELTALAKE_SVC_URL ?? "http://deltalake-svc:8000";
      try {
        await fetch(`${DELTALAKE_SVC}/jobs/trigger`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            jobId,
            jobType: input.jobType,
            targetTable: input.targetTable,
            params: input.params ?? {},
          }),
          signal: AbortSignal.timeout(10_000),
        });
      } catch (e) {
        console.warn(`[lakehouse] Failed to notify deltalake-svc for job ${jobId}: ${e}`);
        // Job is still persisted in DB — deltalake-svc will pick it up on next poll
      }

      return {
        success: true,
        jobId,
        jobDbId: job?.id,
        message: `Triggered ${input.jobType} on ${input.targetTable}`,
      };
    }),

  /**
   * getJobTypes — list of distinct job types for filter dropdowns.
   */
  getJobTypes: adminProcedure
    .query(async () => {
      return [...JOB_TYPES];
    }),

  /**
   * getTargetTables — list of distinct target tables for filter dropdowns.
   */
  getTargetTables: adminProcedure
    .query(async () => {
      return [...TARGET_TABLES];
    }),

  /**
   * getJobById — get a single lakehouse job by ID (for detail drawer).
   */
  getJobById: protectedProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return null;
      const [row] = await db.select().from(lakehouseJobs).where(eq(lakehouseJobs.id, input.id)).limit(1);
      return row ?? null;
    }),

  /**
   * retriggerJob — re-trigger a failed or completed lakehouse job (creates a new pending copy).
   */
  retriggerJob: protectedProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      const isAdmin = ["admin", "customs_officer"].includes(ctx.user.role);
      if (!isAdmin) throw new TRPCError({ code: "FORBIDDEN" });

      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      const [original] = await db.select().from(lakehouseJobs).where(eq(lakehouseJobs.id, input.id)).limit(1);
      if (!original) throw new TRPCError({ code: "NOT_FOUND" });

      const newJobId = `${original.jobId}-retry-${Date.now()}`;
      const [newJob] = await db.insert(lakehouseJobs).values({
        jobId: newJobId,
        jobType: original.jobType,
        targetTable: original.targetTable,
        status: "pending",
        metadata: { ...((original.metadata as Record<string, unknown>) ?? {}), retriggeredFrom: original.id },
        triggeredBy: String(ctx.user.id),
      }).returning();

      // Notify deltalake-svc
      const DELTALAKE_SVC = process.env.DELTALAKE_SVC_URL ?? "http://deltalake-svc:8000";
      try {
        await fetch(`${DELTALAKE_SVC}/jobs/trigger`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            jobId: newJobId,
            jobType: original.jobType,
            targetTable: original.targetTable,
          }),
          signal: AbortSignal.timeout(10_000),
        });
      } catch (e) {
        console.warn(`[lakehouse] Failed to notify deltalake-svc for retrigger ${newJobId}: ${e}`);
      }

      return newJob;
    }),
});
