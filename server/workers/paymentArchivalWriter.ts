/**
 * paymentArchivalWriter.ts — Lakehouse archival writer for payment_archival_jobs
 *
 * Phase 22 follow-up to the payment-archival cron (server/_core/index.ts,
 * runPaymentArchivalCron). The cron only ENQUEUES honest status="pending" job
 * rows (storageUri NULL, bytesWritten 0) when PAYMENT_ARCHIVE_SINK_BUCKET is
 * configured. This worker fulfills those jobs for real:
 *
 *   1. Claim a pending job atomically:
 *        UPDATE payment_archival_jobs SET status='running'
 *        WHERE id=$1 AND status='pending' RETURNING *
 *      so a double-run / overlapping worker can never double-archive a job
 *      (the second claim updates 0 rows and skips).
 *   2. Read the committed payment_queue rows in the job's [periodStart,
 *      periodEnd) tier window (same predicate the cron counted with).
 *   3. Serialize to CSV and PUT it to the S3-compatible sink (RustFS) at
 *        s3://$PAYMENT_ARCHIVE_SINK_BUCKET/{tier}/{YYYY-MM-DD}/{jobId}.csv
 *   4. Mark the job completed with the REAL storageUri, the ACTUAL byte
 *      length of the uploaded payload, and the real row count — or failed
 *      with errorMessage. On any sink error the job is marked failed and NO
 *      storageUri is ever written. No fabricated URIs, ever.
 *
 * Format decision: CSV. package.json has no parquet writer dependency
 * (checked: no parquetjs/parquetjs-lite/duckdb/arrow); rather than silently
 * adding a new dependency this writer emits RFC-4180 CSV, which the lakehouse
 * rollup path can already ingest. The object key extension (.csv) reflects
 * the real format.
 *
 * Sink client: @aws-sdk/client-s3 — already a declared dependency
 * (package.json, used by the RustFS toolchain), pointed at the same RustFS
 * endpoint/credentials the document-vault rustfs-svc uses (RUSTFS_ENDPOINT /
 * RUSTFS_ACCESS_KEY / RUSTFS_SECRET_KEY, overridable via
 * PAYMENT_ARCHIVE_SINK_ENDPOINT / _ACCESS_KEY / _SECRET_KEY). The rustfs-svc
 * HTTP client (server/rustfsSvcClient.ts) is intentionally NOT used: it is
 * scoped to the document-vault bucket (RUSTFS_BUCKET) and force-prefixes keys
 * with a caller namespace, so it cannot write to the operator-configured
 * PAYMENT_ARCHIVE_SINK_BUCKET at the required key pattern.
 *
 * Lifecycle mirrors server/paymentWorker.ts: startPaymentArchivalWriter() is
 * a no-op (with a single log line) unless PAYMENT_ARCHIVE_SINK_BUCKET is set;
 * stopPaymentArchivalWriter() is wired into SIGTERM/SIGINT.
 */

import { eq, and, gte, lt, asc, sql } from "drizzle-orm";
import { paymentArchivalJobs, paymentQueue } from "../../drizzle/schema";
import { getDb } from "../db";

// ─── Config ──────────────────────────────────────────────────────────────────

const SINK_BUCKET = process.env.PAYMENT_ARCHIVE_SINK_BUCKET ?? "";
const WORKER_INTERVAL_MS = 15_000;  // poll every 15 s — jobs are daily, no hot loop needed
const WORKER_BATCH_SIZE = 5;        // jobs per cycle
const MAX_ROWS_PER_JOB = 500_000;   // safety bound on a single export payload

type Db = NonNullable<Awaited<ReturnType<typeof getDb>>>;

// ─── S3 sink (lazy — only constructed when the writer is enabled) ────────────

let _s3: import("@aws-sdk/client-s3").S3Client | null = null;

async function getSink(): Promise<import("@aws-sdk/client-s3").S3Client> {
  if (_s3) return _s3;
  const { S3Client } = await import("@aws-sdk/client-s3");
  const endpoint =
    process.env.PAYMENT_ARCHIVE_SINK_ENDPOINT ??
    process.env.RUSTFS_ENDPOINT ??
    "http://localhost:9000";
  const accessKeyId =
    process.env.PAYMENT_ARCHIVE_SINK_ACCESS_KEY ??
    process.env.RUSTFS_ACCESS_KEY ??
    "";
  const secretAccessKey =
    process.env.PAYMENT_ARCHIVE_SINK_SECRET_KEY ??
    process.env.RUSTFS_SECRET_KEY ??
    "";
  if (!accessKeyId || !secretAccessKey) {
    // Fail closed: without sink credentials every job would fail anyway —
    // surface one clear error instead of N opaque per-job failures.
    throw new Error(
      "Sink credentials missing: set PAYMENT_ARCHIVE_SINK_ACCESS_KEY/_SECRET_KEY " +
      "(or RUSTFS_ACCESS_KEY/RUSTFS_SECRET_KEY) alongside PAYMENT_ARCHIVE_SINK_BUCKET",
    );
  }
  _s3 = new S3Client({
    endpoint,
    region: process.env.PAYMENT_ARCHIVE_SINK_REGION ?? process.env.RUSTFS_REGION ?? "us-east-1",
    credentials: { accessKeyId, secretAccessKey },
    forcePathStyle: true, // RustFS / MinIO-style path addressing
  });
  return _s3;
}

// ─── CSV serialization (RFC-4180) ────────────────────────────────────────────

function csvCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  const s = value instanceof Date ? value.toISOString() : String(value);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

const CSV_HEADER =
  "id,transfer_id,debit_account_id,credit_account_id,amount_minor_units," +
  "currency,ledger,attempt_count,committed_at,created_at\n";

function toCsv(rows: Array<typeof paymentQueue.$inferSelect>): string {
  const lines = rows.map((r) =>
    [
      r.id,
      r.transferId,
      r.debitAccountId,
      r.creditAccountId,
      r.amountMinorUnits.toString(), // bigint → exact string, never a float
      r.currency,
      r.ledger,
      r.attemptCount,
      r.committedAt,
      r.createdAt,
    ]
      .map(csvCell)
      .join(","),
  );
  return CSV_HEADER + lines.join("\n") + (lines.length ? "\n" : "");
}

// ─── Single job execution ────────────────────────────────────────────────────

async function executeJob(db: Db, job: typeof paymentArchivalJobs.$inferSelect): Promise<void> {
  // 1. Read the committed transfers in the job's tier window — the exact
  //    predicate runPaymentArchivalCron used to count them.
  const rows = await db
    .select()
    .from(paymentQueue)
    .where(
      and(
        eq(paymentQueue.status, "committed"),
        gte(paymentQueue.createdAt, job.periodStart),
        lt(paymentQueue.createdAt, job.periodEnd),
      ),
    )
    .orderBy(asc(paymentQueue.createdAt), asc(paymentQueue.id))
    .limit(MAX_ROWS_PER_JOB);

  const csv = toCsv(rows);
  const payload = Buffer.from(csv, "utf8");
  const bytesWritten = BigInt(payload.byteLength);

  // 2. PUT to the sink. Key pattern: {tier}/{YYYY-MM-DD}/{jobId}.csv
  const day = new Date().toISOString().slice(0, 10);
  const key = `${job.tier}/${day}/${job.jobId}.csv`;
  const sink = await getSink();
  const { PutObjectCommand } = await import("@aws-sdk/client-s3");
  await sink.send(
    new PutObjectCommand({
      Bucket: SINK_BUCKET,
      Key: key,
      Body: payload,
      ContentType: "text/csv",
    }),
  );

  // 3. Only after the object verifiably exists: mark completed with real values.
  const storageUri = `s3://${SINK_BUCKET}/${key}`;
  await db
    .update(paymentArchivalJobs)
    .set({
      status: "completed",
      storageUri,
      bytesWritten,
      transfersArchived: rows.length,
      completedAt: new Date(),
      errorMessage: null,
    })
    .where(eq(paymentArchivalJobs.id, job.id));

  console.log(
    `[PaymentArchival] ✓ ${job.jobId} (${job.tier}) archived ${rows.length} transfers, ` +
    `${bytesWritten} bytes → ${storageUri}`,
  );
}

// ─── Worker cycle ────────────────────────────────────────────────────────────

export async function runPaymentArchivalWriterCycle(): Promise<number> {
  if (!SINK_BUCKET) return 0;
  const db = await getDb();
  if (!db) {
    console.warn("[PaymentArchival] DB unavailable — skipping writer cycle");
    return 0;
  }

  // Candidate pending jobs, oldest first.
  const pending = await db
    .select({ id: paymentArchivalJobs.id })
    .from(paymentArchivalJobs)
    .where(eq(paymentArchivalJobs.status, "pending"))
    .orderBy(asc(paymentArchivalJobs.createdAt))
    .limit(WORKER_BATCH_SIZE);

  let processed = 0;
  for (const { id } of pending) {
    // Idempotent claim: UPDATE … WHERE status='pending' RETURNING. A
    // concurrent worker/double-run that already claimed the row updates 0
    // rows and is skipped — the job is archived exactly once.
    const claimed = await db
      .update(paymentArchivalJobs)
      .set({ status: "running" })
      .where(and(eq(paymentArchivalJobs.id, id), eq(paymentArchivalJobs.status, "pending")))
      .returning();
    const job = claimed[0];
    if (!job) continue;

    try {
      await executeJob(db, job);
      processed++;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[PaymentArchival] ✗ ${job.jobId} failed:`, err);
      // Honest failure: status failed + errorMessage, storageUri stays NULL.
      await db
        .update(paymentArchivalJobs)
        .set({ status: "failed", errorMessage: message.slice(0, 2000), completedAt: new Date() })
        .where(eq(paymentArchivalJobs.id, job.id))
        .catch((e) => console.error(`[PaymentArchival] failed to record failure for ${job.jobId}:`, e));
    }
  }
  return processed;
}

// ─── Lifecycle (mirrors server/paymentWorker.ts) ─────────────────────────────

let workerTimer: ReturnType<typeof setInterval> | null = null;
let _startedAt: Date | null = null;
let _lastCycleAt: Date | null = null;
let _jobsCompletedTotal = 0;

export function getPaymentArchivalWriterStatus() {
  return {
    enabled: Boolean(SINK_BUCKET),
    running: workerTimer !== null,
    sinkBucket: SINK_BUCKET || null,
    startedAt: _startedAt,
    lastCycleAt: _lastCycleAt,
    jobsCompletedTotal: _jobsCompletedTotal,
  };
}

export function startPaymentArchivalWriter(): void {
  if (!SINK_BUCKET) {
    // Logged once at startup: pending jobs are never enqueued without the
    // bucket (cron is fail-closed), so a silent writer would be fine — but an
    // explicit line makes the disabled state auditable.
    console.log("[PaymentArchival] writer disabled — PAYMENT_ARCHIVE_SINK_BUCKET not set");
    return;
  }
  if (workerTimer) return; // already running
  _startedAt = new Date();
  console.log(
    `[PaymentArchival] lakehouse writer started (bucket: ${SINK_BUCKET}, interval: ${WORKER_INTERVAL_MS}ms)`,
  );
  const tick = () =>
    runPaymentArchivalWriterCycle()
      .then((n) => {
        _lastCycleAt = new Date();
        _jobsCompletedTotal += n ?? 0;
      })
      .catch((err) => console.error("[PaymentArchival] writer cycle error:", err));
  tick();
  workerTimer = setInterval(tick, WORKER_INTERVAL_MS);
}

export function stopPaymentArchivalWriter(): void {
  if (workerTimer) {
    clearInterval(workerTimer);
    workerTimer = null;
    console.log("[PaymentArchival] lakehouse writer stopped");
  }
}

// Re-export for tests / scheduled handlers that want a direct invocation.
export { sql as _sql };
