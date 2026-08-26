import pg from "pg";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("DATABASE_URL is required for PostgreSQL integration fixtures.");
}

const pool = new pg.Pool({
  connectionString: databaseUrl,
  max: 1,
});

const now = new Date();
const minutesAgo = (minutes) => new Date(now.getTime() - minutes * 60_000).toISOString();

async function seed() {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(`
      TRUNCATE TABLE
        kafka_event_log,
        temporal_workflow_runs,
        open_appsec_events,
        lakehouse_jobs,
        geoip_seed_jobs,
        workflow_input_schemas
      RESTART IDENTITY
    `);

    await client.query(
      `INSERT INTO kafka_event_log
        (topic, event_type, aggregate_id, payload, status, attempts, created_at)
       VALUES
        ('declarations.events', 'DECLARATION_SUBMITTED', 'decl-fixture-001', $1::jsonb, 'published', 1, $2),
        ('payments.events', 'PAYMENT_RETRY_REQUIRED', 'payment-fixture-002', $3::jsonb, 'failed', 2, $4),
        ('declarations.events', 'DECLARATION_RISK_SCORED', 'decl-fixture-003', $5::jsonb, 'pending', 0, $6)`,
      [
        JSON.stringify({ declarationId: 1, fixture: true }), minutesAgo(30),
        JSON.stringify({ paymentId: "payment-fixture-002", fixture: true }), minutesAgo(20),
        JSON.stringify({ declarationId: 2, fixture: true }), minutesAgo(10),
      ],
    );

    const temporalRows = [
      ["workflow-fixture-001", "run-fixture-001", "DeclarationClearance", "declaration-processing", "completed", minutesAgo(60), minutesAgo(55), 300_000],
      ["workflow-fixture-002", "run-fixture-002", "KYCVerification", "kyc-processing", "failed", minutesAgo(50), minutesAgo(45), 300_000],
      ["workflow-fixture-003", "run-fixture-003", "PaymentReconciliation", "payment-processing", "running", minutesAgo(40), null, null],
      ["workflow-fixture-004", "run-fixture-004", "DeclarationClearance", "declaration-processing", "completed", minutesAgo(30), minutesAgo(25), 300_000],
      ["workflow-fixture-005", "run-fixture-005", "SanctionsScreening", "risk-processing", "timed_out", minutesAgo(20), minutesAgo(15), 300_000],
      ["workflow-fixture-006", "run-fixture-006", "CargoTrackingSync", "cargo-processing", "pending", minutesAgo(10), null, null],
    ];
    for (const row of temporalRows) {
      await client.query(
        `INSERT INTO temporal_workflow_runs
          (workflow_id, run_id, workflow_type, task_queue, status, input, started_at, closed_at, duration_ms, created_at)
         VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9, $7)`,
        [...row.slice(0, 5), JSON.stringify({ fixture: true }), ...row.slice(5)],
      );
    }

    const wafRows = [
      ["waf-fixture-001", "critical", "SQL_INJECTION", "203.0.113.10", "/api/declarations", "POST", "block", false],
      ["waf-fixture-002", "high", "XSS", "203.0.113.11", "/api/payments", "POST", "block", false],
      ["waf-fixture-003", "medium", "COMMAND_INJECTION", "203.0.113.12", "/api/documents", "GET", "detect", false],
      ["waf-fixture-004", "low", "PATH_TRAVERSAL", "203.0.113.13", "/api/health", "GET", "detect", true],
      ["waf-fixture-005", "high", "XSS", "203.0.113.14", "/api/traders", "POST", "block", false],
      ["waf-fixture-006", "critical", "SQL_INJECTION", "203.0.113.15", "/api/admin", "POST", "block", false],
    ];
    for (const [eventId, severity, attackType, sourceIp, targetPath, httpMethod, action, isAcknowledged] of wafRows) {
      await client.query(
        `INSERT INTO open_appsec_events
          (event_id, severity, attack_type, source_ip, target_path, http_method, action, is_acknowledged, request_headers, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10)`,
        [eventId, severity, attackType, sourceIp, targetPath, httpMethod, action, isAcknowledged, JSON.stringify({ "x-fixture": "true" }), minutesAgo(wafRows.indexOf(wafRows.find((row) => row[0] === eventId)) + 1)],
      );
    }

    const lakehouseRows = [
      ["lakehouse-fixture-001", "DELTA_COMPACTION", "declarations", "completed", 1000, 1000],
      ["lakehouse-fixture-002", "DELTA_COMPACTION", "payments", "failed", 500, 0],
      ["lakehouse-fixture-003", "ICEBERG_SNAPSHOT", "declarations", "running", 0, 0],
      ["lakehouse-fixture-004", "CDC_INGEST", "kyc_documents", "pending", 0, 0],
      ["lakehouse-fixture-005", "DATA_QUALITY", "declarations", "completed", 250, 250],
      ["lakehouse-fixture-006", "DELTA_COMPACTION", "audit_events", "completed", 100, 100],
    ];
    for (const [jobId, jobType, targetTable, status, rowsProcessed, rowsWritten] of lakehouseRows) {
      await client.query(
        `INSERT INTO lakehouse_jobs
          (job_id, job_type, target_table, status, rows_processed, rows_written, metadata, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8)`,
        [jobId, jobType, targetTable, status, rowsProcessed, rowsWritten, JSON.stringify({ fixture: true }), minutesAgo(lakehouseRows.indexOf(lakehouseRows.find((row) => row[0] === jobId)) + 1)],
      );
    }

    await client.query("COMMIT");
    console.log("Seeded deterministic PostgreSQL integration fixtures for Kafka, Temporal, WAF, and lakehouse routes.");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

try {
  await seed();
} finally {
  await pool.end();
}
