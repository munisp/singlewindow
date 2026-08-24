/**
 * Lakehouse Trade-Stats Nightly Rollup — Sprint v82
 * Heartbeat handler: POST /api/scheduled/lakehouse-rollup
 *
 * Triggered nightly at 02:00 UTC by a project-level Heartbeat cron.
 * Inserts a new lakehouseJobs row with status=running, calls the
 * deltalake-svc write-postgres endpoint, then marks the row completed/failed.
 */
import type { Request, Response } from "express";
import { sdk } from "../_core/sdk";
import { ENV } from "../_core/env";
import { randomUUID } from "crypto";

const DELTALAKE_SVC = ENV.deltaLakeSvcUrl;
const JOB_TYPE = "TRADE_STATS_ROLLUP";
const TARGET_TABLE = "trade_stats_mirror";

export async function lakehouseRollupHandler(req: Request, res: Response) {
  try {
    // Authenticate — must be a cron caller
    const user = await sdk.authenticateRequest(req);
    if (!("isCron" in user) || user.isCron !== true) {
      return res.status(403).json({ error: "cron-only endpoint" });
    }

    const { upsertLakehouseJob } = await import("../db");

    const jobId = `heartbeat-rollup-${Date.now()}-${randomUUID().slice(0, 8)}`;
    const startedAt = new Date();

    // Create a running job row
    const job = await upsertLakehouseJob({
      jobId,
      jobType: JOB_TYPE,
      targetTable: TARGET_TABLE,
      status: "running",
      triggeredBy: "heartbeat",
      startedAt,
    });

    const dbId = job?.id;

    try {
      // Call deltalake-svc write-back endpoint
      const response = await fetch(`${DELTALAKE_SVC}/write-postgres`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          table: TARGET_TABLE,
        }),
        signal: AbortSignal.timeout(90_000),
      });

      if (!response.ok) {
        const text = await response.text().catch(() => "");
        throw new Error(`deltalake-svc responded ${response.status}: ${text}`);
      }

      const result = await response.json().catch(() => ({}));
      const completedAt = new Date();
      const durationMs = completedAt.getTime() - startedAt.getTime();

      // Mark completed
      await upsertLakehouseJob({
        jobId,
        jobType: JOB_TYPE,
        targetTable: TARGET_TABLE,
        status: "completed",
        completedAt,
        durationMs,
        rowsWritten: result.rows_affected ?? 0,
        rowsProcessed: result.rows_affected ?? 0,
      });

      console.log(`[LakehouseRollup] Completed job ${dbId ?? jobId} — rows: ${result.rows_affected ?? "?"} in ${durationMs}ms`);
      return res.json({ ok: true, jobId, dbId, rowsWritten: result.rows_affected ?? null, durationMs });
    } catch (innerErr: unknown) {
      const msg = innerErr instanceof Error ? innerErr.message : String(innerErr);
      console.error("[LakehouseRollup] Job failed:", msg);

      await upsertLakehouseJob({
        jobId,
        jobType: JOB_TYPE,
        targetTable: TARGET_TABLE,
        status: "failed",
        completedAt: new Date(),
        errorMessage: msg,
      }).catch(() => {});

      return res.status(500).json({
        error: msg,
        context: { jobType: JOB_TYPE, targetTable: TARGET_TABLE, jobId, dbId },
        timestamp: new Date().toISOString(),
      });
    }
  } catch (authErr: unknown) {
    const msg = authErr instanceof Error ? authErr.message : String(authErr);
    return res.status(403).json({ error: msg });
  }
}
