/**
 * heartbeatAdmin.ts
 * Admin tRPC procedures to create, pause, resume, and delete
 * the project-level "tenant-domain-poller" Heartbeat job.
 *
 * Uses keycloakAdminProcedure so only Keycloak realm-admin users
 * can manage the cron — no DB role lookup required.
 *
 * The platform-issued taskUid is persisted in system_heartbeat_jobs
 * so the job can be managed across sessions without re-running the CLI.
 */

import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { eq } from "drizzle-orm";
import { parse as parseCookie } from "cookie";
import { router, keycloakAdminProcedure } from "../_core/trpc";
import { getDb } from "../db";

async function requireDb() {
  const d = await getDb();
  if (!d) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
  return d;
}
import { systemHeartbeatJobs } from "../../drizzle/schema";
import {
  createHeartbeatJob,
  updateHeartbeatJob,
  deleteHeartbeatJob,
  listHeartbeatJobs,
} from "../_core/heartbeat";
import { COOKIE_NAME } from "../../shared/const";

const POLLER_NAME = "tenant-domain-poller";
const POLLER_PATH = "/api/scheduled/tenant-domain-poll";
const POLLER_CRON = "0 0 */15 * * *"; // every 15 minutes

function getSessionToken(ctx: { req: { headers: { cookie?: string } } }): string {
  return parseCookie(ctx.req.headers.cookie ?? "")[COOKIE_NAME] ?? "";
}

async function getPollerRecord() {
  const d = await getDb();
  if (!d) return null;
  return (
    (await d
      .select()
      .from(systemHeartbeatJobs)
      .where(eq(systemHeartbeatJobs.name, POLLER_NAME))
      .limit(1))[0] ?? null
  );
}

export const heartbeatAdminRouter = router({
  /**
   * Get the current state of the DNS poller Heartbeat job.
   * Returns null if the job has never been created.
   */
  getPollerStatus: keycloakAdminProcedure.query(async () => {
    return getPollerRecord();
  }),

  /**
   * Create (or re-register) the DNS poller Heartbeat job.
   * Idempotent: if a record already exists with a taskUid, returns it.
   */
  createPoller: keycloakAdminProcedure
    .input(
      z.object({
        cronExpression: z
          .string()
          .optional()
          .default(POLLER_CRON)
          .describe("6-field cron expression (sec min hour dom mon dow)"),
        description: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const existing = await getPollerRecord();
      if (existing?.taskUid) {
        throw new TRPCError({
          code: "CONFLICT",
          message: `Poller already registered with taskUid ${existing.taskUid}. Use updatePoller or deletePoller first.`,
        });
      }

      const sessionToken = getSessionToken(ctx);
      const job = await createHeartbeatJob(
        {
          name: POLLER_NAME,
          cron: input.cronExpression,
          path: POLLER_PATH,
          description:
            input.description ??
            "Auto-verify pending tenant custom domains via DNS TXT lookup",
        },
        sessionToken
      );

      const now = new Date();
      const record = {
        name: POLLER_NAME,
        taskUid: job.taskUid,
        cronExpression: input.cronExpression,
        callbackPath: POLLER_PATH,
        description:
          input.description ??
          "Auto-verify pending tenant custom domains via DNS TXT lookup",
        isEnabled: true,
        nextExecutionAt: job.nextExecutionAt ? new Date(job.nextExecutionAt) : null,
        updatedAt: now,
      };

      const dbSave = await requireDb();
      if (existing) {
        await dbSave
          .update(systemHeartbeatJobs)
          .set(record)
          .where(eq(systemHeartbeatJobs.name, POLLER_NAME));
      } else {
        await dbSave.insert(systemHeartbeatJobs).values(record);
      }

      return { taskUid: job.taskUid, nextExecutionAt: job.nextExecutionAt };
    }),

  /**
   * Pause the DNS poller Heartbeat job.
   */
  pausePoller: keycloakAdminProcedure.mutation(async ({ ctx }) => {
    const existing = await getPollerRecord();
    if (!existing?.taskUid) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Poller job not found. Create it first." });
    }

    const sessionToken = getSessionToken(ctx);
    await updateHeartbeatJob(existing.taskUid, { enable: false }, sessionToken);

    const dbPause = await requireDb();
    await dbPause
      .update(systemHeartbeatJobs)
      .set({ isEnabled: false, updatedAt: new Date() })
      .where(eq(systemHeartbeatJobs.name, POLLER_NAME));

    return { paused: true };
  }),

  /**
   * Resume the DNS poller Heartbeat job.
   */
  resumePoller: keycloakAdminProcedure.mutation(async ({ ctx }) => {
    const existing = await getPollerRecord();
    if (!existing?.taskUid) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Poller job not found. Create it first." });
    }

    const sessionToken = getSessionToken(ctx);
    const result = await updateHeartbeatJob(
      existing.taskUid,
      { enable: true },
      sessionToken
    );

    const dbResume = await requireDb();
    await dbResume
      .update(systemHeartbeatJobs)
      .set({
        isEnabled: true,
        nextExecutionAt: result.nextExecutionAt ? new Date(result.nextExecutionAt) : null,
        updatedAt: new Date(),
      })
      .where(eq(systemHeartbeatJobs.name, POLLER_NAME));

    return { resumed: true, nextExecutionAt: result.nextExecutionAt };
  }),

  /**
   * Update the cron expression of the DNS poller Heartbeat job.
   */
  updatePollerCron: keycloakAdminProcedure
    .input(
      z.object({
        cronExpression: z.string().min(11).describe("6-field cron expression"),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const existing = await getPollerRecord();
      if (!existing?.taskUid) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Poller job not found. Create it first." });
      }

      const sessionToken = getSessionToken(ctx);
      const result = await updateHeartbeatJob(
        existing.taskUid,
        { cron: input.cronExpression },
        sessionToken
      );

    const dbUpdate = await requireDb();
    await dbUpdate
      .update(systemHeartbeatJobs)
      .set({
        cronExpression: input.cronExpression,
        nextExecutionAt: result.nextExecutionAt ? new Date(result.nextExecutionAt) : null,
        updatedAt: new Date(),
      })
      .where(eq(systemHeartbeatJobs.name, POLLER_NAME));

    return { updated: true, nextExecutionAt: result.nextExecutionAt };
    }),

  /**
   * Delete the DNS poller Heartbeat job from the platform and local DB.
   */
  deletePoller: keycloakAdminProcedure.mutation(async ({ ctx }) => {
    const existing = await getPollerRecord();
    if (!existing?.taskUid) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Poller job not found." });
    }

    const sessionToken = getSessionToken(ctx);
    await deleteHeartbeatJob(existing.taskUid, sessionToken);

    const dbDel = await requireDb();
    await dbDel
      .delete(systemHeartbeatJobs)
      .where(eq(systemHeartbeatJobs.name, POLLER_NAME));

    return { deleted: true };
  }),

  /**
   * List all project-level Heartbeat jobs (platform view).
   * Useful for debugging — shows all jobs, not just the DNS poller.
   */
  listAllJobs: keycloakAdminProcedure.query(async ({ ctx }) => {
    const sessionToken = getSessionToken(ctx);
    return listHeartbeatJobs(sessionToken);
  }),
});
