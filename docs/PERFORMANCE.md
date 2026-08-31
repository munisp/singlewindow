# Performance Audit & Optimizations — Phase 11

Baseline: `main` @ `204ca2aa`. Branch: `phase11/perf`.
Doctrine: no behavior-damaging shortcuts; fail-closed posture preserved; every
change below is tied to an observed query pattern in the codebase.

## 1. Index audit

Method: enumerated all 163 `pgTable` definitions in `drizzle/schema.ts`,
extracted the 380+ existing schema-level indexes plus all indexes from
migrations `0001`–`0062` (notably `0059_production_indexes.sql`), then
cross-referenced the `WHERE` / `ORDER BY` patterns used by the hot list
endpoints in `server/routers/*`.

New migration: **`drizzle/migrations/0063_phase11_perf_indexes.sql`** — all
statements idempotent (`IF NOT EXISTS`), none duplicating or fully overlapping
existing indexes:

| Index | Table | Rationale |
|---|---|---|
| `idx_notif_user_read_created` | `notifications(user_id, read, created_at)` | `notifications.list` filters user_id (+read) ordered by created_at DESC; previously bitmap-AND + sort |
| `idx_manifests_submitted_by_created` | `manifests(submitted_by, created_at)` | `manifests.list` filter+order in one scan |
| `idx_manifests_created_at` | `manifests(created_at)` | admin `listAll` global DESC ordering |
| `idx_crf_trader_created` | `crf_documents(trader_id, created_at)` | `crf.list` filter+order |
| `idx_esd_schedule_delivered` | `export_schedule_deliveries(schedule_id, delivered_at)` | per-schedule "latest delivery" / delivery history |
| `idx_wd_sub_delivered` | `webhook_deliveries(subscription_id, delivered_at)` | `webhooks.deliveries` filter+order |
| `idx_aeo_renewals_pending_due` (partial) | `aeo_renewals(renewal_due_date) WHERE status='pending'` | status-filtered hot admin query, stays small |
| `idx_decl_status_id` | `declarations(status, id)` | keyset (cursor) pagination in `declarations.all` with status filter |
| `idx_dv_owner_active_created` (partial) | `document_vault(owner_id, created_at) WHERE status='active'` | default `documentVault.list` view |

FK coverage: all FK columns used as join/filter keys in routers
(`declarations.trader_id`, `payments.declaration_id`,
`oga_permits.declaration_id`, `document_vault.owner_id`, `fraud_case_links.*`,
`kyc_verifications.user_id`, …) were already indexed in schema or prior
migrations — no duplicates were added.

## 2. Pagination caps

Convention followed: existing `z.number().int().min(1).max(N).default(M)` +
`offset` pattern (as in `manifests.list`, `notifications.list`,
`declarations.all`). New inputs are optional, so existing clients calling the
procedures with no arguments are unaffected.

- `aeoRenewals.listPending` — was unbounded → default 100, max 500, offset
- `tenant.listTenants` — was unbounded → default 100, max 500, offset
- `webhooks.adminList` — was unbounded → default 100, max 500, offset
- `v138Features.aeoComments.list` — was unbounded → default 200, max 500
- `v138Features.docVersions.list` — was unbounded → default 50, max 200
- `v138Features.sanctionsEntities.list` — `pageSize` had **no max** → now
  min 1 / max 100 (also `page` now `min(1)`)
- `exportSchedules.listDue` (heartbeat path) — capped at 500/run, ordered by
  `next_run_at` so the oldest-due schedules are always processed first

Left intentionally uncapped: `cep.exportCepPatterns` and other *export*
endpoints where truncation would damage correctness (documented in §7);
config-cardinality tables (`healthThresholds`, `kpiTargets`,
`checklistTemplates`) whose row counts are bounded by definition.

## 3. N+1 fixes (per-row awaits in loops hitting the DB)

| Location | Before | After |
|---|---|---|
| `exportSchedules.lastDeliveries` | 1 query per schedule | single `SELECT DISTINCT ON (schedule_id)` batched with `inArray` |
| `fraudCases` graph export (link expansion) | 1 query per link | one `inArray` fetch + in-memory map; per-link `LIMIT 1` semantics preserved |
| `ogaBulkApprove.bulkApprove` | 2 queries per declaration (fetch + permit sync) | one `inArray` fetch for declarations, one for permits, grouped in memory; status-sync and notification behavior unchanged |
| `sanctionsBatch.detectConflicts` | 1 existence query per input row | one `inArray` fetch on `entityName`, first-match map mirrors old `LIMIT 1` semantics |
| `batchPayments.getQueueStats` | 5 separate `COUNT(*)` scans | single `GROUP BY status` scan |
| `batchPayments.retryDeadLetters` | 1 UPDATE per item | single batch `UPDATE … WHERE id IN (...)` |

## 4. PostgreSQL pool configuration

`server/db.ts` created `new Pool({ connectionString })` with node-postgres
defaults (max=10, no connection timeout, idle clients never reaped). Now
env-configurable with documented, bounded defaults (invalid values are
ignored — a misconfigured env cannot produce an unbounded or zero-sized pool;
credentials still come only from `DATABASE_URL`):

| Env var | Default | Bounds |
|---|---|---|
| `PG_POOL_MAX` | 10 | 1–100 |
| `PG_POOL_MIN` | 0 | 0–100 |
| `PG_IDLE_TIMEOUT_MS` | 30000 | 1000–600000 |
| `PG_CONN_TIMEOUT_MS` | 5000 | 500–60000 |
| `PG_MAX_USES` | 7500 | 0–1000000 |

## 5. Hot-path checks (verified, no change needed)

- **Response compression**: handled at the edge — APISIX gateway enables the
  `gzip` plugin (`infra/apisix/config.yaml`). Adding app-level compression
  would double-compress; intentionally not added.
- **Static asset caching**: already correct — hashed Vite assets served with
  `maxAge: 1y, immutable: true`; HTML served `no-cache, no-store`
  (`server/_core/vite.ts`).

## 6. Expected impact

- Notification, manifest, CRF, document-vault and declarations list endpoints
  move from seq-scan+sort (or bitmap-AND+sort) to index-ordered scans; impact
  grows with table size (O(log n) lookups + no sort temp).
- `lastDeliveries` goes from N+1 round trips to 2 total regardless of schedule
  count; fraud-case graph export from 1+L to 2 per depth level.
- Pool: bounded connection acquisition time (5 s fail-fast instead of
  hanging), idle connection reaping, and client recycling to mitigate
  long-lived connection memory bloat.

## 7. Remaining recommendations (need load-test infra)

1. **Load-test before/after**: run k6/Gatling against `declarations.all`,
   `notifications.list`, `manifests.list` at production-scale data to quantify
   latency deltas and validate the new indexes with `EXPLAIN ANALYZE`.
2. **Export endpoints** (`cep.exportCepPatterns`, bulk CSV exports): move to
   streaming/chunked responses rather than capping, so completeness is
   preserved without OOM risk.
3. **pg_trgm + GIN indexes** for the `ilike '%…%'` searches in
   `declarations.all` and `sanctionsEntities.list` — requires the pg_trgm
   extension and a migration validated against production data volume.
4. **Pool sizing under load**: current default max=10 is conservative; tune
   `PG_POOL_MAX` against PgBouncer/managed-PG limits during load testing.
5. **Offset pagination at depth**: deep offsets are O(offset); consider
   extending the keyset/cursor pattern (already used by `declarations.all`)
   to other large admin lists.
6. **N+1 residue**: batch-mutation loops that remain
   (`notificationPreferences` upserts, `v138Features` checklist reorder) are
   input-bounded (≤100 items) and low-frequency; revisit only if load tests
   show them hot.
