CREATE TABLE "geoip_seed_jobs" (
	"id" serial PRIMARY KEY NOT NULL,
	"job_id" varchar(128) NOT NULL,
	"filename" varchar(256) NOT NULL,
	"s3_key" text,
	"status" varchar(32) DEFAULT 'pending' NOT NULL,
	"rows_inserted" integer DEFAULT 0,
	"rows_skipped" integer DEFAULT 0,
	"rows_total" integer DEFAULT 0,
	"error_message" text,
	"triggered_by" varchar(64),
	"started_at" timestamp,
	"completed_at" timestamp,
	"duration_ms" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "geoip_seed_jobs_job_id_unique" UNIQUE("job_id")
);
--> statement-breakpoint
CREATE TABLE "workflow_input_schemas" (
	"id" serial PRIMARY KEY NOT NULL,
	"workflow_type" varchar(128) NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"json_schema" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"description" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "uq_workflow_schema_type_version" UNIQUE("workflow_type","version")
);
--> statement-breakpoint
CREATE INDEX "idx_geoip_seed_status" ON "geoip_seed_jobs" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_geoip_seed_created" ON "geoip_seed_jobs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "idx_workflow_schemas_type" ON "workflow_input_schemas" USING btree ("workflow_type");--> statement-breakpoint
CREATE INDEX "idx_workflow_schemas_active" ON "workflow_input_schemas" USING btree ("is_active");