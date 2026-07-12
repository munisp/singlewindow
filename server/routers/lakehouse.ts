/**
 * Lakehouse Jobs tRPC Router — Sprint v81
 * Admin procedures for Delta Lake batch job monitoring and manual triggering.
 */
import { z } from "zod";
import { router, protectedProcedure, adminProcedure } from "../_core/trpc";
import { TRPCError } from "@trpc/server";

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

function makeDevJob(i: number) {
  const status = STATUSES[i % STATUSES.length];
  const jobType = JOB_TYPES[i % JOB_TYPES.length];
  const targetTable = TARGET_TABLES[i % TARGET_TABLES.length];
  const started = new Date(Date.now() - (i + 1) * 7_200_000);
  const finished = status !== "running" && status !== "pending"
    ? new Date(started.getTime() + Math.random() * 3_600_000)
    : null;
  return {
    id: i + 1,
    jobId: `lh-job-${(1000 + i).toString(16).padStart(6, "0")}`,
    jobType,
    targetTable,
    status,
    rowsProcessed: status === "completed" ? Math.floor(Math.random() * 500_000) + 10_000 : null,
    bytesWritten: status === "completed" ? Math.floor(Math.random() * 1_073_741_824) + 1_048_576 : null,
    errorMessage: status === "failed" ? "Spark executor OOM — increase driver memory" : null,
    sparkJobId: status !== "pending" ? `spark-app-${(2000 + i).toString(16)}` : null,
    scheduledAt: new Date(started.getTime() - 300_000),
    startedAt: status !== "pending" ? started : null,
    finishedAt: finished,
    durationMs: finished ? Math.round(finished.getTime() - started.getTime()) : null,
    createdAt: started,
    triggeredBy: i % 4 === 0 ? "cron" : "manual",
  };
}

export const lakehouseRouter = router({
  /**
   * getLakehouseJobs — paginated list of Delta Lake batch jobs.
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
      if (process.env.NODE_ENV !== "production") {
        const rows = Array.from({ length: 50 }, (_, i) => makeDevJob(i));
        const filtered = rows.filter((r) => {
          if (input?.status && r.status !== input.status) return false;
          if (input?.jobType && r.jobType !== input.jobType) return false;
          if (input?.targetTable && r.targetTable !== input.targetTable) return false;
          return true;
        });
        return {
          jobs: filtered.slice(input?.offset ?? 0, (input?.offset ?? 0) + (input?.limit ?? 50)),
          total: filtered.length,
        };
      }
      const { getLakehouseJobs } = await import("../db");
      const jobs = await getLakehouseJobs({
        limit: input?.limit,
        offset: input?.offset,
        status: input?.status,
        jobType: input?.jobType,
        targetTable: input?.targetTable,
      });
      return { jobs, total: jobs.length };
    }),

  /**
   * getLakehouseJobById — fetch a single job by its DB id.
   */
  getLakehouseJobById: adminProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .query(async ({ input }) => {
      if (process.env.NODE_ENV !== "production") {
        return makeDevJob(input.id - 1);
      }
      const { getLakehouseJobById } = await import("../db");
      const job = await getLakehouseJobById(input.id);
      if (!job) throw new TRPCError({ code: "NOT_FOUND", message: `Lakehouse job ${input.id} not found` });
      return job;
    }),

  /**
   * getLakehouseStats — summary counts by status.
   */
  getLakehouseStats: adminProcedure
    .query(async () => {
      if (process.env.NODE_ENV !== "production") {
        return { pending: 2, running: 1, completed: 38, failed: 3, cancelled: 1 };
      }
      const { getLakehouseJobStats } = await import("../db");
      const stats = await getLakehouseJobStats();
      return stats ?? { pending: 0, running: 0, completed: 0, failed: 0, cancelled: 0 };
    }),

  /**
   * triggerLakehouseJob — manually trigger a new Delta Lake batch job.
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
      if (process.env.NODE_ENV !== "production") {
        return {
          success: true,
          jobId,
          message: `Triggered ${input.jobType} on ${input.targetTable} (dev stub)`,
        };
      }
      const { upsertLakehouseJob } = await import("../db");
      await upsertLakehouseJob({
        jobId,
        jobType: input.jobType,
        targetTable: input.targetTable,
        status: "pending",
        triggeredBy: "manual",
        createdAt: new Date(),
      });
      return {
        success: true,
        jobId,
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
   * v93: Get a single lakehouse job by ID (for detail drawer).
   */
  getJobById: protectedProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .query(async ({ input }) => {
      const { getDb } = await import("../db");
      const db = await getDb();
      if (!db) return null;
      const { lakehouseJobs } = await import("../../drizzle/schema");
      const { eq } = await import("drizzle-orm");
      const [row] = await db.select().from(lakehouseJobs).where(eq(lakehouseJobs.id, input.id)).limit(1);
      return row ?? null;
    }),

  /**
   * v93: Re-trigger a failed or completed lakehouse job (creates a new pending copy).
   */
  retriggerJob: protectedProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      const isAdmin = ["admin", "customs_officer"].includes(ctx.user.role);
      if (!isAdmin) throw new TRPCError({ code: "FORBIDDEN" });
      const { getDb } = await import("../db");
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      const { lakehouseJobs } = await import("../../drizzle/schema");
      const { eq } = await import("drizzle-orm");
      const [original] = await db.select().from(lakehouseJobs).where(eq(lakehouseJobs.id, input.id)).limit(1);
      if (!original) throw new TRPCError({ code: "NOT_FOUND" });
      const [newJob] = await db.insert(lakehouseJobs).values({
        jobId: `${original.jobId}-retry-${Date.now()}`,
        jobType: original.jobType,
        targetTable: original.targetTable,
        status: "pending",
        metadata: { ...((original.metadata as any) ?? {}), retriggeredFrom: original.id },
        triggeredBy: String(ctx.user.id),
      }).returning();
      return newJob;
    }),
});
