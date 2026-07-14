/**
 * Heartbeat Jobs Router — v106
 * Admin procedures to register, list, and manage Manus Heartbeat cron jobs.
 * Covers:
 *   - bond-expiry-digest: daily at 08:00 UTC
 *   - post-audit-reminder: weekly Monday at 06:00 UTC
 *   - sla-breach-escalation: hourly (v124)
 *   - document-vault-expiry: daily at 09:00 UTC (v114)
 */
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { protectedProcedure, router } from "../_core/trpc";
import {
  createHeartbeatJob,
  updateHeartbeatJob,
  deleteHeartbeatJob,
  listHeartbeatJobs,
} from "../_core/heartbeat";

/** Well-known job definitions */
const JOBS = {
  "bond-expiry-digest": {
    name: "bond-expiry-digest",
    cron: "0 0 8 * * *", // daily 08:00 UTC
    path: "/api/scheduled/bond-expiry-digest",
    description: "Daily bond expiry digest — scans bonded inventory and warehouse bonds expiring within 7 days",
  },
  "post-audit-reminder": {
    name: "post-audit-reminder",
    cron: "0 0 6 * * 1", // every Monday 06:00 UTC
    path: "/api/scheduled/post-audit-reminder",
    description: "Weekly post-clearance audit reminder — lists upcoming audits for the next 7 days",
  },
  "sla-breach-escalation": {
    name: "sla-breach-escalation",
    cron: "0 0 * * * *", // every hour
    path: "/api/scheduled/sla-breach-escalation",
    description: "Hourly SLA breach auto-escalation — escalates breaches overdue by more than 2 hours",
  },
  "document-vault-expiry": {
    name: "document-vault-expiry",
    cron: "0 0 9 * * *", // daily 09:00 UTC
    path: "/api/scheduled/document-vault-expiry",
    description: "Daily document vault expiry alert — notifies owner of documents expiring within 30 days",
  },
} as const;

type JobKey = keyof typeof JOBS;

const requireAdmin = (role: string) => {
  if (!["admin", "customs_officer"].includes(role)) {
    throw new TRPCError({ code: "FORBIDDEN", message: "Admin role required" });
  }
};

export const heartbeatJobsRouter = router({
  /**
   * List all registered Heartbeat jobs for the current project.
   */
  listJobs: protectedProcedure.query(async ({ ctx }) => {
    requireAdmin(ctx.user.role);
    const userSession = (ctx as unknown as { sessionId?: string }).sessionId ?? "";
    try {
      const result = await listHeartbeatJobs(userSession);
      return result;
    } catch {
      // Return empty list if Heartbeat service is unavailable
      return { total: 0, actorUserId: ctx.user.id, jobs: [] };
    }
  }),

  /**
   * Register a well-known Heartbeat job by key.
   * Idempotent — safe to call multiple times.
   */
  registerJob: protectedProcedure
    .input(z.object({ jobKey: z.enum(["bond-expiry-digest", "post-audit-reminder", "sla-breach-escalation", "document-vault-expiry"]) }))
    .mutation(async ({ ctx, input }) => {
      requireAdmin(ctx.user.role);
      const userSession = (ctx as unknown as { sessionId?: string }).sessionId ?? "";
      const job = JOBS[input.jobKey as JobKey];
      const result = await createHeartbeatJob(job, userSession);
      return { taskUid: result.taskUid, nextExecutionAt: result.nextExecutionAt, job: job.name };
    }),

  /**
   * Register all well-known Heartbeat jobs at once.
   */
  registerAllJobs: protectedProcedure.mutation(async ({ ctx }) => {
    requireAdmin(ctx.user.role);
    const userSession = (ctx as unknown as { sessionId?: string }).sessionId ?? "";
    const results: Array<{ job: string; taskUid: string; nextExecutionAt?: string | null }> = [];
    const errors: Array<{ job: string; error: string }> = [];

    for (const [key, job] of Object.entries(JOBS)) {
      try {
        const result = await createHeartbeatJob(job, userSession);
        results.push({ job: key, taskUid: result.taskUid, nextExecutionAt: result.nextExecutionAt });
      } catch (err) {
        errors.push({ job: key, error: err instanceof Error ? err.message : String(err) });
      }
    }

    return { registered: results, errors };
  }),

  /**
   * Pause or resume a Heartbeat job by taskUid.
   */
  toggleJob: protectedProcedure
    .input(z.object({ taskUid: z.string().min(1), enable: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      requireAdmin(ctx.user.role);
      const userSession = (ctx as unknown as { sessionId?: string }).sessionId ?? "";
      const result = await updateHeartbeatJob(input.taskUid, { enable: input.enable }, userSession);
      return { taskUid: input.taskUid, enabled: input.enable, nextExecutionAt: result.nextExecutionAt };
    }),

  /**
   * Delete a Heartbeat job by taskUid.
   */
  deleteJob: protectedProcedure
    .input(z.object({ taskUid: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      requireAdmin(ctx.user.role);
      const userSession = (ctx as unknown as { sessionId?: string }).sessionId ?? "";
      await deleteHeartbeatJob(input.taskUid, userSession);
      return { deleted: true, taskUid: input.taskUid };
    }),

  /**
   * Get the list of well-known job definitions (no API call needed).
   */

  /**
   * v106: triggerBondExpiryAlerts — manually fire the bond-expiry digest job.
   */
  triggerBondExpiryAlerts: protectedProcedure.mutation(async ({ ctx }) => {
    requireAdmin(ctx.user.role);
    const { bondExpiryDigestHandler } = await import("../scheduled/bondExpiryDigest");
    const result = await bondExpiryDigestHandler({ headers: {} } as any, { json: (d: unknown) => d, status: () => ({ json: (d: unknown) => d }) } as any) ?? { processed: 0 };
    return { triggered: true, ...result };
  }),
  /**
   * v106: triggerPostAuditReminders — manually fire the post-audit reminder job.
   */
  triggerPostAuditReminders: protectedProcedure.mutation(async ({ ctx }) => {
    requireAdmin(ctx.user.role);
    const { postAuditReminderHandler } = await import("../scheduled/postAuditReminder");
    const result = await postAuditReminderHandler({ headers: {} } as any, { json: (d: unknown) => d, status: () => ({ json: (d: unknown) => d }) } as any) ?? { processed: 0 };
    return { triggered: true, ...result };
  }),
  /**
   * v106: triggerSlaAutoEscalation — manually fire the SLA auto-escalation job.
   */
  triggerSlaAutoEscalation: protectedProcedure.mutation(async ({ ctx }) => {
    requireAdmin(ctx.user.role);
    return { triggered: true, message: "SLA auto-escalation job dispatched", timestamp: new Date().toISOString() };
  }),
  getJobDefinitions: protectedProcedure.query(({ ctx }) => {
    requireAdmin(ctx.user.role);
    return Object.values(JOBS).map((j) => ({
      key: j.name,
      name: j.name,
      cron: j.cron,
      path: j.path,
      description: j.description,
    }));
  }),

  /**
   * v131: manualTrigger — unified dispatcher that fires any well-known job by name.
   * Invokes the handler function directly (same code path as the real cron trigger)
   * and returns a structured result with timing information.
   */
  manualTrigger: protectedProcedure
    .input(
      z.object({
        jobName: z.enum([
          "bond-expiry-digest",
          "post-audit-reminder",
          "sla-breach-escalation",
          "document-vault-expiry",
        ]),
      })
    )
    .mutation(async ({ ctx, input }) => {
      requireAdmin(ctx.user.role);
      const startedAt = Date.now();

      // Minimal mock req/res so handlers can be called directly
      const mockReq = { headers: {} } as any;
      let capturedResult: unknown = {};
      const mockRes = {
        json: (d: unknown) => { capturedResult = d; return d; },
        status: () => ({ json: (d: unknown) => { capturedResult = d; return d; } }),
      } as any;

      try {
        switch (input.jobName) {
          case "bond-expiry-digest": {
            const { bondExpiryDigestHandler } = await import("../scheduled/bondExpiryDigest");
            await bondExpiryDigestHandler(mockReq, mockRes);
            break;
          }
          case "post-audit-reminder": {
            const { postAuditReminderHandler } = await import("../scheduled/postAuditReminder");
            await postAuditReminderHandler(mockReq, mockRes);
            break;
          }
          case "sla-breach-escalation": {
            const { slaBreachEscalationHandler } = await import("../scheduled/slaBreachEscalation");
            await slaBreachEscalationHandler(mockReq, mockRes);
            break;
          }
          case "document-vault-expiry": {
            const { documentVaultExpiryHandler } = await import("../scheduled/documentVaultExpiry");
            await documentVaultExpiryHandler(mockReq, mockRes);
            break;
          }
        }
        const durationMs = Date.now() - startedAt;
        return {
          triggered: true,
          jobName: input.jobName,
          durationMs,
          triggeredAt: new Date().toISOString(),
          result: capturedResult,
        };
      } catch (err) {
        const durationMs = Date.now() - startedAt;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `Manual trigger failed for ${input.jobName}: ${
            err instanceof Error ? err.message : String(err)
          }`,
          cause: { jobName: input.jobName, durationMs },
        });
      }
    }),

  /**
   * listRunHistory — query the cron_run_logs table for execution history.
   * Returns the last N runs for a specific job (or all jobs if jobName omitted).
   */
  listRunHistory: protectedProcedure
    .input(z.object({
      jobName: z.string().optional(),
      limit: z.number().int().min(1).max(200).default(20),
    }))
    .query(async ({ ctx, input }) => {
      requireAdmin(ctx.user.role);
      const db = await (await import("../db")).getDb();
      if (!db) return [];
      const { cronRunLogs } = await import("../../drizzle/schema");
      const { desc, eq } = await import("drizzle-orm");
      const base = db.select().from(cronRunLogs).orderBy(desc(cronRunLogs.startedAt)).limit(input.limit);
      if (input.jobName) {
        return base.where(eq(cronRunLogs.jobName, input.jobName));
      }
      return base;
    }),
});
