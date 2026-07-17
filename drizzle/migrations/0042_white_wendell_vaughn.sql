CREATE TABLE "aeo_renewals" (
	"id" serial PRIMARY KEY NOT NULL,
	"aeo_application_id" integer NOT NULL,
	"trader_id" integer NOT NULL,
	"status" varchar(32) DEFAULT 'pending' NOT NULL,
	"submitted_at" timestamp,
	"reviewed_at" timestamp,
	"reviewed_by" integer,
	"review_notes" text,
	"expiry_date" timestamp,
	"renewal_due_date" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bond_expiry_alerts" (
	"id" serial PRIMARY KEY NOT NULL,
	"bond_id" integer NOT NULL,
	"trader_id" integer NOT NULL,
	"alert_type" varchar(32) NOT NULL,
	"sent_at" timestamp DEFAULT now() NOT NULL,
	"notification_id" integer
);
--> statement-breakpoint
CREATE TABLE "cron_run_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"job_name" varchar(128) NOT NULL,
	"status" varchar(32) DEFAULT 'success' NOT NULL,
	"triggered_by" varchar(64) DEFAULT 'scheduler' NOT NULL,
	"duration_ms" integer,
	"result_summary" text,
	"error_message" text,
	"started_at" timestamp DEFAULT now() NOT NULL,
	"completed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "declaration_risk_history" (
	"id" serial PRIMARY KEY NOT NULL,
	"declaration_id" integer NOT NULL,
	"risk_score" integer NOT NULL,
	"risk_lane" varchar(16),
	"triggered_by" varchar(64) DEFAULT 'system' NOT NULL,
	"factors" json,
	"recorded_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "export_schedules" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"export_type" varchar(64) NOT NULL,
	"cadence" varchar(32) DEFAULT 'weekly' NOT NULL,
	"filter_preset" varchar(16) DEFAULT '30' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"last_run_at" timestamp,
	"next_run_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "health_thresholds" (
	"id" serial PRIMARY KEY NOT NULL,
	"component_name" varchar(128) NOT NULL,
	"degraded_ms" integer DEFAULT 500 NOT NULL,
	"unhealthy_ms" integer DEFAULT 2000 NOT NULL,
	"updated_by" varchar(128),
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "health_thresholds_component_name_unique" UNIQUE("component_name")
);
--> statement-breakpoint
CREATE TABLE "oga_bulk_actions" (
	"id" serial PRIMARY KEY NOT NULL,
	"performed_by" integer NOT NULL,
	"action" varchar(32) NOT NULL,
	"permit_ids" json NOT NULL,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "post_clearance_audit_schedule" (
	"id" serial PRIMARY KEY NOT NULL,
	"declaration_id" integer NOT NULL,
	"trader_id" integer NOT NULL,
	"scheduled_by" varchar(64) DEFAULT 'system' NOT NULL,
	"audit_type" varchar(32) DEFAULT 'random' NOT NULL,
	"status" varchar(32) DEFAULT 'scheduled' NOT NULL,
	"scheduled_date" timestamp,
	"completed_at" timestamp,
	"assigned_officer" integer,
	"findings" text,
	"risk_score" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sanctions_batch_jobs" (
	"id" serial PRIMARY KEY NOT NULL,
	"submitted_by" integer NOT NULL,
	"file_name" varchar(255) NOT NULL,
	"file_url" text NOT NULL,
	"file_key" varchar(512),
	"total_rows" integer DEFAULT 0,
	"processed_rows" integer DEFAULT 0,
	"match_count" integer DEFAULT 0,
	"status" varchar(32) DEFAULT 'pending' NOT NULL,
	"error_message" text,
	"result_file_url" text,
	"started_at" timestamp,
	"completed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "threshold_audit_log" (
	"id" serial PRIMARY KEY NOT NULL,
	"component_name" varchar(128) NOT NULL,
	"changed_by" varchar(128) NOT NULL,
	"changed_by_user_id" integer,
	"from_degraded_ms" integer NOT NULL,
	"to_degraded_ms" integer NOT NULL,
	"from_unhealthy_ms" integer,
	"to_unhealthy_ms" integer,
	"change_reason" text,
	"changed_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "document_vault" ADD COLUMN "expires_at" timestamp;--> statement-breakpoint
ALTER TABLE "document_vault" ADD COLUMN "expiry_notified_at" timestamp;--> statement-breakpoint
ALTER TABLE "fraud_cases" ADD COLUMN "severity" varchar(16) DEFAULT 'medium';--> statement-breakpoint
ALTER TABLE "fraud_cases" ADD COLUMN "estimated_loss" numeric(15, 2);--> statement-breakpoint
CREATE INDEX "idx_aeo_renewals_trader" ON "aeo_renewals" USING btree ("trader_id");--> statement-breakpoint
CREATE INDEX "idx_aeo_renewals_status" ON "aeo_renewals" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_aeo_renewals_due" ON "aeo_renewals" USING btree ("renewal_due_date");--> statement-breakpoint
CREATE INDEX "idx_bond_expiry_alerts_bond" ON "bond_expiry_alerts" USING btree ("bond_id");--> statement-breakpoint
CREATE INDEX "idx_bond_expiry_alerts_trader" ON "bond_expiry_alerts" USING btree ("trader_id");--> statement-breakpoint
CREATE INDEX "idx_cron_run_logs_job" ON "cron_run_logs" USING btree ("job_name");--> statement-breakpoint
CREATE INDEX "idx_cron_run_logs_status" ON "cron_run_logs" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_cron_run_logs_started" ON "cron_run_logs" USING btree ("started_at");--> statement-breakpoint
CREATE INDEX "idx_drh_declaration" ON "declaration_risk_history" USING btree ("declaration_id");--> statement-breakpoint
CREATE INDEX "idx_drh_recorded_at" ON "declaration_risk_history" USING btree ("recorded_at");--> statement-breakpoint
CREATE INDEX "idx_export_schedules_user" ON "export_schedules" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_export_schedules_next_run" ON "export_schedules" USING btree ("next_run_at");--> statement-breakpoint
CREATE INDEX "idx_export_schedules_active" ON "export_schedules" USING btree ("is_active");--> statement-breakpoint
CREATE INDEX "idx_health_thresholds_component" ON "health_thresholds" USING btree ("component_name");--> statement-breakpoint
CREATE INDEX "idx_oga_bulk_officer" ON "oga_bulk_actions" USING btree ("performed_by");--> statement-breakpoint
CREATE INDEX "idx_pcas_declaration" ON "post_clearance_audit_schedule" USING btree ("declaration_id");--> statement-breakpoint
CREATE INDEX "idx_pcas_status" ON "post_clearance_audit_schedule" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_pcas_scheduled_date" ON "post_clearance_audit_schedule" USING btree ("scheduled_date");--> statement-breakpoint
CREATE INDEX "idx_sanctions_batch_user" ON "sanctions_batch_jobs" USING btree ("submitted_by");--> statement-breakpoint
CREATE INDEX "idx_sanctions_batch_status" ON "sanctions_batch_jobs" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_threshold_audit_component" ON "threshold_audit_log" USING btree ("component_name");--> statement-breakpoint
CREATE INDEX "idx_threshold_audit_changed_at" ON "threshold_audit_log" USING btree ("changed_at");--> statement-breakpoint
CREATE INDEX "idx_dv_expires_at" ON "document_vault" USING btree ("expires_at");