CREATE TYPE "public"."fraud_case_link_type" AS ENUM('same_trader', 'same_vessel', 'same_route', 'same_method', 'related_network');--> statement-breakpoint
CREATE TYPE "public"."vision_batch_job_status" AS ENUM('queued', 'processing', 'completed', 'failed', 'cancelled');--> statement-breakpoint
CREATE TABLE "fraud_case_links" (
	"id" serial PRIMARY KEY NOT NULL,
	"case_id" integer NOT NULL,
	"linked_case_id" integer NOT NULL,
	"link_type" "fraud_case_link_type" NOT NULL,
	"confidence" real DEFAULT 0.8,
	"notes" text,
	"created_by" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "nl_query_templates" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"name" varchar(128) NOT NULL,
	"description" text,
	"question" text NOT NULL,
	"category" varchar(64) DEFAULT 'custom' NOT NULL,
	"use_count" integer DEFAULT 0 NOT NULL,
	"is_shared" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "vision_batch_jobs" (
	"id" serial PRIMARY KEY NOT NULL,
	"batch_id" varchar(64) NOT NULL,
	"submitted_by" integer NOT NULL,
	"declaration_id" integer,
	"total_documents" integer DEFAULT 0 NOT NULL,
	"processed_documents" integer DEFAULT 0 NOT NULL,
	"status" "vision_batch_job_status" DEFAULT 'queued' NOT NULL,
	"priority" varchar(16) DEFAULT 'normal' NOT NULL,
	"documents" json,
	"results" json,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "vision_batch_jobs_batch_id_unique" UNIQUE("batch_id")
);
--> statement-breakpoint
ALTER TABLE "sla_escalations" ADD COLUMN "resolved_by" integer;--> statement-breakpoint
ALTER TABLE "sla_escalations" ADD COLUMN "resolution_note" text;--> statement-breakpoint
ALTER TABLE "sla_escalations" ADD COLUMN "reason" text;--> statement-breakpoint
ALTER TABLE "sla_escalations" ADD COLUMN "lane" varchar(16);--> statement-breakpoint
ALTER TABLE "sla_escalations" ADD COLUMN "elapsed_ms" bigint;--> statement-breakpoint
ALTER TABLE "sla_escalations" ADD COLUMN "threshold_ms" bigint;--> statement-breakpoint
ALTER TABLE "sla_escalations" ADD COLUMN "resolved" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "sla_escalations" ADD COLUMN "escalated_by" integer;--> statement-breakpoint
ALTER TABLE "fraud_case_links" ADD CONSTRAINT "fraud_case_links_case_id_fraud_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."fraud_cases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fraud_case_links" ADD CONSTRAINT "fraud_case_links_linked_case_id_fraud_cases_id_fk" FOREIGN KEY ("linked_case_id") REFERENCES "public"."fraud_cases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fraud_case_links" ADD CONSTRAINT "fraud_case_links_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nl_query_templates" ADD CONSTRAINT "nl_query_templates_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vision_batch_jobs" ADD CONSTRAINT "vision_batch_jobs_submitted_by_users_id_fk" FOREIGN KEY ("submitted_by") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vision_batch_jobs" ADD CONSTRAINT "vision_batch_jobs_declaration_id_declarations_id_fk" FOREIGN KEY ("declaration_id") REFERENCES "public"."declarations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_fcl_case_id" ON "fraud_case_links" USING btree ("case_id");--> statement-breakpoint
CREATE INDEX "idx_fcl_linked_case_id" ON "fraud_case_links" USING btree ("linked_case_id");--> statement-breakpoint
CREATE INDEX "idx_nl_query_templates_user_id" ON "nl_query_templates" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_nl_query_templates_shared" ON "nl_query_templates" USING btree ("is_shared");--> statement-breakpoint
CREATE INDEX "idx_vbj_submitted_by" ON "vision_batch_jobs" USING btree ("submitted_by");--> statement-breakpoint
CREATE INDEX "idx_vbj_status" ON "vision_batch_jobs" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_vbj_batch_id" ON "vision_batch_jobs" USING btree ("batch_id");--> statement-breakpoint
ALTER TABLE "sla_escalations" ADD CONSTRAINT "sla_escalations_resolved_by_users_id_fk" FOREIGN KEY ("resolved_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sla_escalations" ADD CONSTRAINT "sla_escalations_escalated_by_users_id_fk" FOREIGN KEY ("escalated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_sla_esc_resolved" ON "sla_escalations" USING btree ("resolved");