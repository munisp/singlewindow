-- =============================================================================
-- Migration 0063: Phase 11 performance indexes (composite / partial / FK)
-- =============================================================================
-- Rationale per index below. All statements are idempotent (IF NOT EXISTS) and
-- none duplicate or fully overlap existing indexes from drizzle/schema.ts or
-- migrations 0001-0062 (verified by cross-referencing schema index definitions
-- and 0059_production_indexes.sql).

-- notifications.list filters user_id [+ read] and orders by created_at DESC.
-- Existing single-column indexes (idx_notif_user_id, idx_notif_read) force a
-- bitmap-AND + sort; the composite serves filter+order in one scan.
CREATE INDEX IF NOT EXISTS idx_notif_user_read_created ON "notifications" ("user_id", "read", "created_at");
--> statement-breakpoint

-- manifests.list filters submitted_by (+status) and orders by created_at DESC.
-- Existing idx_manifests_submitted_by cannot avoid the sort step.
CREATE INDEX IF NOT EXISTS idx_manifests_submitted_by_created ON "manifests" ("submitted_by", "created_at");
--> statement-breakpoint

-- manifests.listAll (admin) orders by created_at DESC with optional status
-- filter; no existing index covers the global ordering.
CREATE INDEX IF NOT EXISTS idx_manifests_created_at ON "manifests" ("created_at");
--> statement-breakpoint

-- crf.list filters trader_id (+status/period) and orders by created_at DESC;
-- existing idx_crf_trader_id leaves the sort unserved.
CREATE INDEX IF NOT EXISTS idx_crf_trader_created ON "crf_documents" ("trader_id", "created_at");
--> statement-breakpoint

-- exportSchedules deliveries lookups (listDeliveries / lastDeliveries) filter
-- schedule_id and order by delivered_at DESC; the composite turns the per-row
-- "latest delivery" query into an index-only descent.
CREATE INDEX IF NOT EXISTS idx_esd_schedule_delivered ON "export_schedule_deliveries" ("schedule_id", "delivered_at");
--> statement-breakpoint

-- webhooks.deliveries filters subscription_id and orders by delivered_at DESC;
-- only idx_webhook_deliveries_sub_id exists today.
CREATE INDEX IF NOT EXISTS idx_wd_sub_delivered ON "webhook_deliveries" ("subscription_id", "delivered_at");
--> statement-breakpoint

-- aeoRenewals.listPending is a status-filtered hot admin query ordered by
-- renewal_due_date. Partial index keeps it small (only pending rows).
CREATE INDEX IF NOT EXISTS idx_aeo_renewals_pending_due ON "aeo_renewals" ("renewal_due_date") WHERE "status" = 'pending';
--> statement-breakpoint

-- declarations.all uses keyset pagination (id < cursor ORDER BY id DESC) most
-- often with a status filter; (status, id) lets PG satisfy filter + keyset
-- ordering from one index. Complements, does not duplicate, idx_decl_status.
CREATE INDEX IF NOT EXISTS idx_decl_status_id ON "declarations" ("status", "id");
--> statement-breakpoint

-- documentVault.list hot path: owner_id + status='active' (the default input)
-- ordered by created_at DESC. Partial composite serves the default view;
-- non-default statuses still use idx_dv_owner_status.
CREATE INDEX IF NOT EXISTS idx_dv_owner_active_created ON "document_vault" ("owner_id", "created_at") WHERE "status" = 'active';
