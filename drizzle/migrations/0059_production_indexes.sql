-- =============================================================================
-- Migration 0048: Additional production indexes for query optimization
-- =============================================================================
-- These indexes optimize the most common query patterns across the platform.
-- All use IF NOT EXISTS to be idempotent.

CREATE INDEX IF NOT EXISTS idx_pay_trader_status_created ON "payments" ("trader_id", "status", "created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_pay_status_created ON "payments" ("status", "created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_ae_actor_created ON "audit_events" ("actor_id", "created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_ae_created_at ON "audit_events" ("created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_ae_action ON "audit_events" ("action", "created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_un_user_read_created ON "user_notifications" ("user_id", "is_read", "created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_decl_created_at ON "declarations" ("created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_decl_hs_code ON "declarations" ("hs_code");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_oga_decl_status ON "oga_permits" ("declaration_id", "status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_oga_agency_status ON "oga_permits" ("agency_code", "status", "created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_kyc_ver_user_status ON "kyc_verifications" ("user_id", "status", "created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_waf_created_severity ON "open_appsec_events" ("created_at", "severity");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_waf_unacknowledged ON "open_appsec_events" ("is_acknowledged", "created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_lh_status_created ON "lakehouse_jobs" ("status", "created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_fluvio_topic_group ON "fluvio_topic_offsets" ("topic", "consumer_group");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_temporal_wf_status_started ON "temporal_workflows" ("status", "start_time");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_sp_org_code ON "stakeholder_profiles" ("organization_code");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_sp_tax_id ON "stakeholder_profiles" ("tax_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_fraud_status_created ON "fraud_cases" ("status", "created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_sanctions_hit_created ON "sanctions_checks" ("is_hit", "created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_risk_scan_created ON "risk_scan_results" ("created_at");
