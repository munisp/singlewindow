# 1 Billion Payments/Day Architecture — TradeGateway NGSWTP

**Author:** Manus AI  
**Date:** April 2026  
**Version:** 2.0  
**Sources:** [backend.how — 1B Payments Per Day][1] · [GitHub — pratikgajjar/1b-payments][2]

---

## Executive Summary

The two reference sources analyse how a modern payment system can sustain **one billion transactions per day** (~11,574 transactions per second at peak) without sacrificing correctness, durability, or auditability. This document translates those lessons into concrete design decisions applied to the **TradeGateway NGSWTP** platform, which processes duty payments, bond releases, and inter-agency financial settlements for Ghana's national single-window trade system.

The core insight from both references is deceptively simple: **never process a payment synchronously in the HTTP request path**. Every payment must be enqueued, idempotency-keyed, and committed by a background worker that can retry safely. The HTTP layer only acknowledges receipt; the financial ledger only records committed state.

---

## 1. Problem Statement

Ghana's customs authority processes approximately 2.4 million import/export declarations annually, each of which triggers between one and five financial transactions (duty payment, VAT, levy, bond, drawback refund). During peak periods — the weeks before and after major holidays — transaction volume can spike by 4–6×. A synchronous payment architecture, where the HTTP response waits for the Mojaloop switch to confirm settlement, creates three failure modes:

1. **Timeout cascades:** The Mojaloop switch may take 3–30 seconds to confirm an ILP transfer. Under load, this exhausts the Node.js event loop and causes HTTP 503 errors.
2. **Double-charge risk:** A trader whose browser times out and resubmits the form will generate a second payment request against the same declaration, resulting in a duplicate charge.
3. **Audit gaps:** If the server crashes between initiating the transfer and recording it in the database, the financial record is lost even though the money moved.

The 1B payments/day architecture addresses all three failure modes through a combination of async queuing, idempotency keys, and a double-entry ledger mirror.

---

## 2. Key Lessons from the Reference Sources

### 2.1 Async-First Payment Pipeline

> "The secret to handling 1B payments/day is to never block the request thread on the payment outcome. Accept the payment intent, persist it durably, return a 202 Accepted, and let a worker pool drive it to completion." [1]

The reference implementation uses a PostgreSQL table as a durable queue rather than an in-memory message broker. This eliminates the operational complexity of Kafka or RabbitMQ for the payment path while retaining exactly-once delivery semantics through database transactions. The queue row is the single source of truth: if the worker crashes mid-flight, the row remains in `processing` status and is picked up by the next worker after a heartbeat timeout.

### 2.2 Idempotency Keys with SHA-256 Hashing

The reference repository demonstrates that idempotency must be enforced at the **application layer**, not delegated to the payment switch. The recommended approach is to hash a stable, business-meaningful composite key (user ID + declaration ID + amount + currency + FSP + account) using SHA-256, store the hash in a dedicated table, and return the cached response on any duplicate submission within a 24-hour window.

This is superior to using a client-supplied UUID because it survives browser refreshes, duplicate form submissions, and retry storms from mobile clients on flaky networks.

### 2.3 Exponential Back-off with Dead-Letter Queue

> "Retrying immediately after a failure is almost always wrong. The downstream system is likely still overloaded. Use exponential back-off with jitter, and move to a dead-letter queue after N attempts so that human operators can inspect and replay." [1]

The reference uses base-2 exponential back-off with a 1-hour ceiling: `delay = min(2^attempt × 1000ms, 3_600_000ms)`. After five failed attempts, the transfer is moved to `dead_letter` status and a notification is sent to the operations team. Dead-letter items can be bulk-retried once the downstream issue is resolved.

### 2.4 Double-Entry Balance Mirror

The reference architecture maintains a **balance mirror table** alongside the authoritative TigerBeetle ledger. The mirror stores `debits_posted`, `credits_posted`, `debits_pending`, and `credits_pending` per account, updated synchronously when a transfer is committed. This allows the application layer to answer balance queries without round-tripping to TigerBeetle on every API call, which is critical for the real-time duty calculator and bond sufficiency checks.

The mirror is sharded by a `shard_key` column (account ID modulo 16) to distribute write load across database partitions.

### 2.5 Hot/Warm/Cold Archival Tiers

> "Committed payments older than 7 days are rarely queried in real time. Move them to columnar Parquet files on object storage. Payments older than 90 days go to cold storage. Keep only the last 7 days in the hot OLTP table." [1]

The reference uses Apache Parquet as the archival format because it compresses 10–20× better than row-oriented formats for financial data, and it is directly queryable by Apache Spark, DuckDB, and AWS Athena for post-clearance audit and analytics.

---

## 3. Implementation in TradeGateway NGSWTP

### 3.1 Database Schema

Four new tables were added to `drizzle/schema.ts` and migrated to PostgreSQL:

| Table | Purpose |
|---|---|
| `payment_queue` | Durable async queue for all payment transfers |
| `payment_accounts` | Balance mirror with shard_key for read scaling |
| `payment_idempotency_keys` | SHA-256 keyed deduplication store (24 h TTL) |
| `payment_archival_jobs` | Audit log of Hot/Warm/Cold archival runs |

The `payment_queue` table carries a composite index on `(status, next_retry_at)` so the worker query — `SELECT * FROM payment_queue WHERE status = 'queued' AND next_retry_at <= NOW() LIMIT 100` — uses an index-only scan even at millions of rows.

### 3.2 tRPC Router: `batchPayments`

The `server/routers/batchPayments.ts` router exposes six procedures:

| Procedure | Type | Description |
|---|---|---|
| `enqueue` | mutation | Idempotent enqueue with SHA-256 dedup |
| `getQueueStats` | query | Live counts by status + idempotency key count |
| `listQueue` | query | Paginated queue items with status filter |
| `retryDeadLetters` | mutation | Bulk-retry dead-letter items older than 1 hour |
| `getAccountBalance` | query | Balance mirror read for a given account ID |
| `listArchivalJobs` | query | Paginated archival job log with tier filter |

### 3.3 Idempotency on `mojaloop.initiatePayment`

The existing `mojaloop.initiatePayment` mutation was retrofitted with an idempotency check. Before generating a new `transferId`, the procedure hashes the composite key `userId:declarationId:amount:currency:fspId:payerAccount` using `crypto.subtle.digest("SHA-256")` and queries `payment_idempotency_keys`. If a match is found and has not expired, a `CONFLICT` error is returned with the original transfer ID, allowing the client to redirect the user to the existing payment status page rather than initiating a duplicate charge.

After a successful initiation, the idempotency key is stored with a 24-hour expiry using `onConflictDoNothing()` to handle the rare case of a concurrent duplicate request arriving in the same millisecond.

### 3.4 Background Payment Queue Worker

A persistent background worker (`server/paymentWorker.ts`) starts automatically with the server and polls `payment_queue` every 5 seconds. The worker lifecycle is:

1. **Heartbeat recovery** — any item stuck in `processing` for more than 60 seconds (indicating a crashed worker cycle) is reset to `queued` with an immediate `next_retry_at`.
2. **Atomic claim** — a batch of up to 50 `queued` items with `next_retry_at <= NOW()` are claimed by setting `status = 'processing'`.
3. **Mojaloop call** — each item calls `PUT /transfers/{transferId}` on the Mojaloop ILP switch. In development mode (when the switch is unreachable), the worker simulates a deterministic success/failure outcome.
4. **Commit or retry** — on success, `status` is set to `committed`, the balance mirror is updated, and `mojaloop_transactions` is updated. On failure, `attempt_count` is incremented and `next_retry_at` is set to `now + calcBackoffMs(attempt_count)`.
5. **Dead-letter** — after `max_attempts` failures, `status` is set to `dead_letter` and the platform owner is notified via `notifyOwner()`.

The worker is stopped gracefully on `SIGTERM` and `SIGINT` to allow in-flight items to complete.

### 3.5 Hot/Warm/Cold Archival Cron

A nightly cron job runs at 02:00 UTC inside `server/_core/index.ts`. For each tier, it:

1. Computes the time window (e.g., for `warm`: 7–90 days ago).
2. Counts committed transfers in that window.
3. Inserts a `payment_archival_jobs` record with a simulated Parquet URI (`s3://tradegateway-archive/{tier}/{date}/{jobId}.parquet`).
4. Marks the job `completed`.

In production, step 3 would invoke an Apache Spark job or a DuckDB `COPY TO PARQUET` statement before deleting the rows from the hot table. The current implementation records the metadata without the actual file export, which is appropriate for the development environment.

### 3.6 Daily Balance Drift Reconciliation

A second nightly cron job runs at 03:00 UTC, one hour after the archival cron. The `server/balanceDrift.ts` module iterates over every row in `payment_accounts` and computes:

- **Queue credit sum** — `SUM(amount_minor_units) WHERE credit_account_id = ? AND status = 'committed'`
- **Queue debit sum** — `SUM(amount_minor_units) WHERE debit_account_id = ? AND status = 'committed'`
- **Drift** — `mirror_value - queue_sum` for both credits and debits

If any account has non-zero drift, a structured report is logged to the console and sent to the platform owner via `notifyOwner()`. The report identifies each drifting account, the direction of drift (mirror OVER or UNDER), and the exact minor-unit discrepancy. The runbook SQL in §7 can then be used to investigate the root cause.

### 3.7 Payment Queue UI Dashboard

A new page at `/app/finance/payment-queue` (admin) and `/app/trader/payment-queue` (trader) provides:

- **Six stat cards** refreshed every 10 seconds: queued, processing, committed, failed, dead-letter, active idempotency keys.
- **Queue Items tab:** paginated table with status filter and a "Retry Dead Letters" action button.
- **Archival Jobs tab:** paginated log of Hot/Warm/Cold archival runs with tier filter.

---

## 4. Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                    TRADER / CUSTOMS OFFICER                     │
│                  (Browser / Mobile / USSD)                      │
└──────────────────────────┬──────────────────────────────────────┘
                           │ POST /api/trpc/mojaloop.initiatePayment
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│              tRPC Procedure: mojaloop.initiatePayment           │
│  1. SHA-256 idempotency check → CONFLICT if duplicate           │
│  2. Persist to mojaloop_transactions (status: PENDING)          │
│  3. Store idempotency key (24 h TTL)                            │
│  4. Return 202 { transferId, status: "PENDING" }                │
└──────────────────────────┬──────────────────────────────────────┘
                           │ (async)
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│                     payment_queue table                         │
│  status: queued → processing → committed | failed → dead_letter │
│  attempt_count: 0..5  next_retry_at: exp back-off (max 1 h)    │
└──────────────────────────┬──────────────────────────────────────┘
                           │ Worker poll (every 5 s)
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│              Mojaloop ILP Transfer (async settlement)           │
│  On COMMITTED: update payment_accounts balance mirror           │
│                create TigerBeetle ledger entry                  │
│                update mojaloop_transactions status              │
└──────────────────────────┬──────────────────────────────────────┘
                           │ Nightly cron (02:00 UTC)
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│                  Hot/Warm/Cold Archival                         │
│  Hot  (≤7d):  PostgreSQL payment_queue (OLTP)                   │
│  Warm (7–90d): Parquet on S3 (queryable via Spark/DuckDB)       │
│  Cold (>90d):  Parquet on S3 Glacier (audit/compliance only)    │
└─────────────────────────────────────────────────────────────────┘
```

---

## 5. Throughput Analysis

The following table projects the capacity of this architecture at various transaction volumes, assuming a single PostgreSQL instance with the composite index on `payment_queue(status, next_retry_at)`:

| Transactions/Day | TPS (avg) | TPS (peak 3×) | PostgreSQL writes/s | Notes |
|---|---|---|---|---|
| 2.4 M (current) | 28 | 83 | 83 | Well within single-node capacity |
| 10 M (5-year target) | 116 | 347 | 347 | Requires read replica for balance mirror |
| 100 M | 1,157 | 3,472 | 3,472 | Requires Citus or TiDB sharding |
| 1 B | 11,574 | 34,722 | 34,722 | Requires distributed queue (Kafka + TigerBeetle) |

For Ghana's current and projected 5-year volumes, the PostgreSQL-backed queue is entirely sufficient. The architecture is designed to be upgraded incrementally: replacing the `payment_queue` table with a Kafka topic and the balance mirror with a TigerBeetle cluster requires only changes to the worker and the `batchPayments` router — the tRPC API surface and the UI remain unchanged.

---

## 6. Security Considerations

**Idempotency key confidentiality.** The SHA-256 hash of the composite key is stored, not the plaintext. This prevents an attacker who gains read access to the `payment_idempotency_keys` table from reconstructing the original payment parameters.

**Dead-letter access control.** The `retryDeadLetters` mutation is now protected by `adminProcedure`, which enforces `ctx.user.role === 'admin'` and returns a `FORBIDDEN` error for any non-admin caller. The frontend additionally hides the "Retry Dead Letters" button for non-admin users by checking `user?.role === 'admin'` from `useAuth()`. This dual enforcement (server + client) ensures traders cannot replay other users' failed payments even if they discover the API endpoint directly.

**Archival URI integrity.** The `storageUri` field in `payment_archival_jobs` must be validated before any downstream job reads from it, to prevent path traversal attacks if the field is ever user-influenced.

---

## 7. Operational Runbook

### Investigating a Dead-Letter Item

1. Navigate to **Finance → Payment Queue** in the dashboard.
2. Filter by status `dead_letter`.
3. Note the `transferId` and `lastError` column.
4. Check `mojaloop_transactions` for the corresponding row.
5. If the error is transient (network timeout, FSP downtime), click **Retry Dead Letters**.
6. If the error is permanent (invalid account, insufficient funds), manually update the declaration status and notify the trader.

### Verifying Balance Mirror Accuracy

Run the following SQL to compare the mirror against the sum of committed queue items:

```sql
SELECT
  pa.account_id,
  pa.credits_posted AS mirror_credits,
  COALESCE(SUM(pq.amount_minor_units) FILTER (WHERE pq.credit_account_id = pa.account_id AND pq.status = 'committed'), 0) AS queue_credits,
  pa.credits_posted - COALESCE(SUM(pq.amount_minor_units) FILTER (WHERE pq.credit_account_id = pa.account_id AND pq.status = 'committed'), 0) AS drift
FROM payment_accounts pa
LEFT JOIN payment_queue pq ON pq.credit_account_id = pa.account_id
GROUP BY pa.id
HAVING ABS(pa.credits_posted - COALESCE(SUM(pq.amount_minor_units) FILTER (WHERE pq.credit_account_id = pa.account_id AND pq.status = 'committed'), 0)) > 0;
```

Any rows returned indicate mirror drift and should trigger a reconciliation job.

---

## References

[1]: https://backend.how/posts/1b-payments-per-day/ "backend.how — How to Process 1 Billion Payments Per Day"
[2]: https://github.com/pratikgajjar/1b-payments "GitHub — pratikgajjar/1b-payments: Reference implementation"
