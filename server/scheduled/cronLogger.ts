/**
 * cronLogger — shared utility for recording cron job execution to cron_run_logs.
 * All four scheduled handlers import this to write run history.
 */
import { getDb } from "../db";
import { cronRunLogs } from "../../drizzle/schema";

export interface CronLogEntry {
  jobName: string;
  taskUid?: string;
  triggeredBy?: "scheduler" | "manual";
  status: "success" | "error";
  durationMs?: number;
  resultSummary?: string;
  errorMessage?: string;
}

/**
 * Write a cron run log entry. Silently swallows errors so a logging failure
 * never causes the handler itself to fail.
 */
export async function logCronRun(entry: CronLogEntry): Promise<void> {
  try {
    const db = await getDb();
    if (!db) return;
    await db.insert(cronRunLogs).values({
      jobName: entry.jobName,
      taskUid: entry.taskUid ?? null,
      triggeredBy: entry.triggeredBy ?? "scheduler",
      status: entry.status,
      durationMs: entry.durationMs ?? null,
      resultSummary: entry.resultSummary ?? null,
      errorMessage: entry.errorMessage ?? null,
      triggeredAt: new Date(),
    });
  } catch {
    // Intentionally silent — logging must never break the handler
  }
}
