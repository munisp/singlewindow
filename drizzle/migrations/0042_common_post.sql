CREATE TABLE "cron_run_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"job_name" varchar(128) NOT NULL,
	"task_uid" varchar(128),
	"triggered_by" varchar(32) DEFAULT 'scheduler' NOT NULL,
	"status" varchar(16) DEFAULT 'success' NOT NULL,
	"duration_ms" integer,
	"result_summary" text,
	"error_message" text,
	"triggered_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "health_thresholds" (
	"id" serial PRIMARY KEY NOT NULL,
	"component_name" varchar(64) NOT NULL,
	"degraded_ms" integer DEFAULT 500 NOT NULL,
	"unhealthy_ms" integer DEFAULT 2000 NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"updated_by" varchar(128),
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "health_thresholds_component_name_unique" UNIQUE("component_name")
);
--> statement-breakpoint
ALTER TABLE "document_vault" ADD COLUMN "expires_at" timestamp;--> statement-breakpoint
ALTER TABLE "document_vault" ADD COLUMN "expiry_notified_at" timestamp;--> statement-breakpoint
ALTER TABLE "fraud_cases" ADD COLUMN "severity" varchar(16) DEFAULT 'medium';--> statement-breakpoint
ALTER TABLE "fraud_cases" ADD COLUMN "estimated_loss" numeric(15, 2);--> statement-breakpoint
CREATE INDEX "idx_cron_run_logs_job" ON "cron_run_logs" USING btree ("job_name");--> statement-breakpoint
CREATE INDEX "idx_cron_run_logs_triggered" ON "cron_run_logs" USING btree ("triggered_at");--> statement-breakpoint
CREATE INDEX "idx_cron_run_logs_status" ON "cron_run_logs" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_health_thresholds_component" ON "health_thresholds" USING btree ("component_name");--> statement-breakpoint
CREATE INDEX "idx_dv_expires_at" ON "document_vault" USING btree ("expires_at");