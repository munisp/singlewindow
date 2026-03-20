CREATE TYPE "public"."fraud_case_priority" AS ENUM('low', 'medium', 'high', 'critical');--> statement-breakpoint
CREATE TYPE "public"."fraud_case_status" AS ENUM('open', 'under_review', 'escalated', 'closed_confirmed', 'closed_cleared', 'referred_prosecution');--> statement-breakpoint
CREATE TABLE "fraud_case_evidence" (
	"id" serial PRIMARY KEY NOT NULL,
	"case_id" integer NOT NULL,
	"uploaded_by" integer NOT NULL,
	"file_key" varchar(512) NOT NULL,
	"file_url" text NOT NULL,
	"file_name" varchar(255) NOT NULL,
	"mime_type" varchar(128),
	"file_size_bytes" bigint,
	"description" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fraud_case_notes" (
	"id" serial PRIMARY KEY NOT NULL,
	"case_id" integer NOT NULL,
	"author_id" integer NOT NULL,
	"content" text NOT NULL,
	"is_internal" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fraud_cases" (
	"id" serial PRIMARY KEY NOT NULL,
	"case_number" varchar(32) NOT NULL,
	"trader_id" integer NOT NULL,
	"title" varchar(255) NOT NULL,
	"description" text,
	"status" "fraud_case_status" DEFAULT 'open' NOT NULL,
	"priority" "fraud_case_priority" DEFAULT 'medium' NOT NULL,
	"assigned_to" integer,
	"created_by" integer NOT NULL,
	"linked_declaration_ids" json DEFAULT '[]'::json,
	"risk_score" real,
	"closure_reason" text,
	"closed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "fraud_cases_case_number_unique" UNIQUE("case_number")
);
--> statement-breakpoint
CREATE TABLE "risk_scan_results" (
	"id" serial PRIMARY KEY NOT NULL,
	"scan_run_at" timestamp DEFAULT now() NOT NULL,
	"total_declarations_scanned" integer DEFAULT 0 NOT NULL,
	"high_risk_count" integer DEFAULT 0 NOT NULL,
	"new_cases_created" integer DEFAULT 0 NOT NULL,
	"threshold_used" real NOT NULL,
	"scan_period_hours" integer NOT NULL,
	"flagged_declaration_ids" json DEFAULT '[]'::json,
	"notification_sent" boolean DEFAULT false NOT NULL,
	"run_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "fraud_case_evidence" ADD CONSTRAINT "fraud_case_evidence_case_id_fraud_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."fraud_cases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fraud_case_notes" ADD CONSTRAINT "fraud_case_notes_case_id_fraud_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."fraud_cases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_fce_case_id" ON "fraud_case_evidence" USING btree ("case_id");--> statement-breakpoint
CREATE INDEX "idx_fcn_case_id" ON "fraud_case_notes" USING btree ("case_id");--> statement-breakpoint
CREATE INDEX "idx_fc_trader_id" ON "fraud_cases" USING btree ("trader_id");--> statement-breakpoint
CREATE INDEX "idx_fc_status" ON "fraud_cases" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_fc_assigned_to" ON "fraud_cases" USING btree ("assigned_to");--> statement-breakpoint
CREATE INDEX "idx_fc_created_by" ON "fraud_cases" USING btree ("created_by");--> statement-breakpoint
CREATE INDEX "idx_rsr_scan_run_at" ON "risk_scan_results" USING btree ("scan_run_at");