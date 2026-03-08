CREATE TYPE "public"."audit_outcome" AS ENUM('compliant', 'minor_discrepancy', 'major_discrepancy', 'fraud_suspected', 'pending');--> statement-breakpoint
CREATE TYPE "public"."audit_status" AS ENUM('scheduled', 'in_progress', 'completed', 'escalated', 'closed');--> statement-breakpoint
CREATE TYPE "public"."drawback_status" AS ENUM('draft', 'submitted', 'under_review', 'approved', 'rejected', 'paid');--> statement-breakpoint
CREATE TYPE "public"."drawback_type" AS ENUM('manufacturing', 'unused_merchandise', 'rejected_merchandise', 'substitution');--> statement-breakpoint
CREATE TABLE "duty_drawback_claims" (
	"id" serial PRIMARY KEY NOT NULL,
	"claim_number" varchar(32) NOT NULL,
	"trader_id" integer NOT NULL,
	"import_declaration_id" integer NOT NULL,
	"import_declaration_number" varchar(32) NOT NULL,
	"export_declaration_id" integer,
	"export_declaration_number" varchar(32),
	"drawback_type" "drawback_type" NOT NULL,
	"status" "drawback_status" DEFAULT 'draft' NOT NULL,
	"original_duty_paid" numeric(15, 2) NOT NULL,
	"claimed_amount" numeric(15, 2) NOT NULL,
	"approved_amount" numeric(15, 2),
	"paid_amount" numeric(15, 2),
	"hs_code" varchar(12),
	"goods_description" text,
	"import_quantity" numeric(12, 3),
	"export_quantity" numeric(12, 3),
	"quantity_unit" varchar(16),
	"re_export_evidence" json,
	"manufacturing_evidence" json,
	"reviewer_notes" text,
	"rejection_reason" text,
	"reviewed_by" integer,
	"import_date" timestamp,
	"export_date" timestamp,
	"submitted_at" timestamp,
	"reviewed_at" timestamp,
	"paid_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "duty_drawback_claims_claim_number_unique" UNIQUE("claim_number")
);
--> statement-breakpoint
CREATE TABLE "post_clearance_audits" (
	"id" serial PRIMARY KEY NOT NULL,
	"audit_number" varchar(32) NOT NULL,
	"declaration_id" integer NOT NULL,
	"declaration_number" varchar(32) NOT NULL,
	"trader_id" integer NOT NULL,
	"assigned_officer_id" integer,
	"status" "audit_status" DEFAULT 'scheduled' NOT NULL,
	"outcome" "audit_outcome" DEFAULT 'pending' NOT NULL,
	"trigger_reason" text,
	"declared_value" numeric(15, 2),
	"audited_value" numeric(15, 2),
	"value_difference" numeric(15, 2),
	"additional_duty_assessed" numeric(15, 2),
	"penalty_amount" numeric(15, 2),
	"findings" text,
	"officer_notes" text,
	"supporting_documents" json,
	"scheduled_date" timestamp,
	"started_at" timestamp,
	"completed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "post_clearance_audits_audit_number_unique" UNIQUE("audit_number")
);
--> statement-breakpoint
CREATE INDEX "idx_ddc_trader_id" ON "duty_drawback_claims" USING btree ("trader_id");--> statement-breakpoint
CREATE INDEX "idx_ddc_status" ON "duty_drawback_claims" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_ddc_import_decl" ON "duty_drawback_claims" USING btree ("import_declaration_id");--> statement-breakpoint
CREATE INDEX "idx_pca_declaration_id" ON "post_clearance_audits" USING btree ("declaration_id");--> statement-breakpoint
CREATE INDEX "idx_pca_trader_id" ON "post_clearance_audits" USING btree ("trader_id");--> statement-breakpoint
CREATE INDEX "idx_pca_status" ON "post_clearance_audits" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_pca_outcome" ON "post_clearance_audits" USING btree ("outcome");