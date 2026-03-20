CREATE TYPE "public"."aeo_app_status" AS ENUM('draft', 'submitted', 'under_review', 'site_inspection_scheduled', 'site_inspection_done', 'approved', 'rejected', 'suspended');--> statement-breakpoint
CREATE TYPE "public"."aeo_status" AS ENUM('none', 'applied', 'certified', 'suspended');--> statement-breakpoint
CREATE TYPE "public"."aeo_tier" AS ENUM('standard', 'silver', 'gold');--> statement-breakpoint
CREATE TYPE "public"."alert_category" AS ENUM('authentication', 'network', 'integrity', 'anomaly', 'compliance');--> statement-breakpoint
CREATE TYPE "public"."alert_severity" AS ENUM('critical', 'high', 'medium', 'low', 'info');--> statement-breakpoint
CREATE TYPE "public"."audit_entity" AS ENUM('declaration', 'user', 'payment', 'permit', 'document');--> statement-breakpoint
CREATE TYPE "public"."declaration_status" AS ENUM('draft', 'submitted', 'under_assessment', 'docs_required', 'payment_pending', 'payment_confirmed', 'under_examination', 'examination_complete', 'cleared', 'rejected', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."declaration_type" AS ENUM('import', 'export', 'transit', 're_export');--> statement-breakpoint
CREATE TYPE "public"."document_status" AS ENUM('pending', 'verified', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."document_type" AS ENUM('commercial_invoice', 'bill_of_lading', 'packing_list', 'certificate_of_origin', 'phytosanitary_cert', 'import_permit', 'export_permit', 'insurance_cert', 'customs_bond', 'other');--> statement-breakpoint
CREATE TYPE "public"."notification_type" AS ENUM('declaration_submitted', 'declaration_cleared', 'declaration_rejected', 'payment_confirmed', 'permit_approved', 'permit_rejected', 'document_required', 'aeo_status_update', 'security_alert', 'system');--> statement-breakpoint
CREATE TYPE "public"."payment_method" AS ENUM('bank_transfer', 'mobile_money', 'card', 'bond');--> statement-breakpoint
CREATE TYPE "public"."payment_status" AS ENUM('pending', 'processing', 'confirmed', 'failed', 'refunded');--> statement-breakpoint
CREATE TYPE "public"."permit_status" AS ENUM('pending', 'under_review', 'approved', 'rejected', 'not_required');--> statement-breakpoint
CREATE TYPE "public"."profile_status" AS ENUM('pending', 'under_review', 'approved', 'suspended', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."risk_lane" AS ENUM('green', 'yellow', 'red', 'blue');--> statement-breakpoint
CREATE TYPE "public"."sanctions_entity" AS ENUM('individual', 'company', 'vessel', 'aircraft');--> statement-breakpoint
CREATE TYPE "public"."sanctions_result" AS ENUM('clear', 'potential_match', 'confirmed_match');--> statement-breakpoint
CREATE TYPE "public"."stakeholder_type" AS ENUM('trader', 'customs_officer', 'oga_officer', 'freight_forwarder', 'bank_officer', 'port_authority', 'system_admin', 'auditor');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('user', 'admin');--> statement-breakpoint
CREATE TABLE "aeo_applications" (
	"id" serial PRIMARY KEY NOT NULL,
	"trader_id" integer NOT NULL,
	"application_number" varchar(32) NOT NULL,
	"tier" "aeo_tier" DEFAULT 'standard' NOT NULL,
	"status" "aeo_app_status" DEFAULT 'draft' NOT NULL,
	"self_assessment_score" integer,
	"compliance_score" integer,
	"financial_standing_score" integer,
	"security_score" integer,
	"reviewer_notes" text,
	"assigned_reviewer_id" integer,
	"inspection_date" timestamp,
	"certificate_number" varchar(64),
	"certificate_issued_at" timestamp,
	"certificate_expires_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "aeo_applications_application_number_unique" UNIQUE("application_number")
);
--> statement-breakpoint
CREATE TABLE "audit_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"entity_type" "audit_entity" NOT NULL,
	"entity_id" integer NOT NULL,
	"action" varchar(128) NOT NULL,
	"actor_id" integer,
	"actor_type" varchar(64),
	"previous_state" json,
	"new_state" json,
	"ip_address" varchar(45),
	"user_agent" text,
	"metadata" json,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "declaration_documents" (
	"id" serial PRIMARY KEY NOT NULL,
	"declaration_id" integer NOT NULL,
	"document_type" "document_type" NOT NULL,
	"file_name" varchar(255) NOT NULL,
	"file_url" text NOT NULL,
	"file_key" varchar(512),
	"mime_type" varchar(128),
	"file_size_bytes" bigint,
	"ocr_extracted" boolean DEFAULT false,
	"ocr_data" json,
	"verified_by" integer,
	"verified_at" timestamp,
	"status" "document_status" DEFAULT 'pending',
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "declarations" (
	"id" serial PRIMARY KEY NOT NULL,
	"declaration_number" varchar(32) NOT NULL,
	"ucr" varchar(64),
	"trader_id" integer NOT NULL,
	"declaration_type" "declaration_type" NOT NULL,
	"status" "declaration_status" DEFAULT 'draft' NOT NULL,
	"risk_lane" "risk_lane" DEFAULT 'green',
	"risk_score" numeric(5, 2),
	"hs_code" varchar(12),
	"goods_description" text,
	"country_of_origin" varchar(3),
	"country_of_destination" varchar(3),
	"port_of_entry" varchar(64),
	"gross_weight" numeric(12, 3),
	"net_weight" numeric(12, 3),
	"number_of_packages" integer,
	"invoice_value" numeric(15, 2),
	"invoice_currency" varchar(3),
	"duty_amount" numeric(15, 2),
	"vat_amount" numeric(15, 2),
	"levy_amount" numeric(15, 2),
	"total_due" numeric(15, 2),
	"assigned_officer_id" integer,
	"ai_explanation" json,
	"sanctions_flags" json,
	"submitted_at" timestamp,
	"cleared_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "declarations_declaration_number_unique" UNIQUE("declaration_number"),
	CONSTRAINT "declarations_ucr_unique" UNIQUE("ucr")
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"type" "notification_type" NOT NULL,
	"title" varchar(255) NOT NULL,
	"message" text,
	"entity_type" varchar(64),
	"entity_id" integer,
	"read" boolean DEFAULT false,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "oga_permits" (
	"id" serial PRIMARY KEY NOT NULL,
	"declaration_id" integer NOT NULL,
	"agency_code" varchar(32) NOT NULL,
	"agency_name" varchar(128) NOT NULL,
	"permit_type" varchar(128),
	"status" "permit_status" DEFAULT 'pending' NOT NULL,
	"assigned_officer_id" integer,
	"review_notes" text,
	"permit_number" varchar(64),
	"expires_at" timestamp,
	"sla_deadline" timestamp,
	"responded_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payments" (
	"id" serial PRIMARY KEY NOT NULL,
	"declaration_id" integer NOT NULL,
	"trader_id" integer NOT NULL,
	"amount" numeric(15, 2) NOT NULL,
	"currency" varchar(3) DEFAULT 'USD' NOT NULL,
	"payment_method" "payment_method" NOT NULL,
	"status" "payment_status" DEFAULT 'pending' NOT NULL,
	"mojaloop_transfer_id" varchar(128),
	"tigerbeetle_account_id" varchar(64),
	"reference" varchar(128),
	"confirmed_at" timestamp,
	"failure_reason" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sanctions_checks" (
	"id" serial PRIMARY KEY NOT NULL,
	"declaration_id" integer,
	"entity_name" varchar(255) NOT NULL,
	"entity_type" "sanctions_entity" NOT NULL,
	"check_result" "sanctions_result" NOT NULL,
	"lists_checked" json,
	"match_details" json,
	"checked_by" integer,
	"override_reason" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "security_alerts" (
	"id" serial PRIMARY KEY NOT NULL,
	"alert_id" varchar(64) NOT NULL,
	"severity" "alert_severity" NOT NULL,
	"category" "alert_category" NOT NULL,
	"title" varchar(255) NOT NULL,
	"description" text,
	"source_ip" varchar(45),
	"target_service" varchar(128),
	"rule_id" varchar(32),
	"rule_description" text,
	"raw_event" json,
	"acknowledged" boolean DEFAULT false,
	"acknowledged_by" integer,
	"acknowledged_at" timestamp,
	"resolved_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "security_alerts_alert_id_unique" UNIQUE("alert_id")
);
--> statement-breakpoint
CREATE TABLE "stakeholder_profiles" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"stakeholder_type" "stakeholder_type" NOT NULL,
	"organization_name" varchar(255),
	"organization_code" varchar(64),
	"license_number" varchar(128),
	"tax_id" varchar(64),
	"country" varchar(3),
	"phone" varchar(32),
	"status" "profile_status" DEFAULT 'pending' NOT NULL,
	"aeo_status" "aeo_status" DEFAULT 'none' NOT NULL,
	"aeo_tier" "aeo_tier" DEFAULT 'standard',
	"approved_by" integer,
	"approved_at" timestamp,
	"rejection_reason" text,
	"metadata" json,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" serial PRIMARY KEY NOT NULL,
	"open_id" varchar(64) NOT NULL,
	"name" text,
	"email" varchar(320),
	"login_method" varchar(64),
	"role" "user_role" DEFAULT 'user' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"last_signed_in" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "users_open_id_unique" UNIQUE("open_id")
);
--> statement-breakpoint
ALTER TABLE "declaration_documents" ADD CONSTRAINT "declaration_documents_declaration_id_declarations_id_fk" FOREIGN KEY ("declaration_id") REFERENCES "public"."declarations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oga_permits" ADD CONSTRAINT "oga_permits_declaration_id_declarations_id_fk" FOREIGN KEY ("declaration_id") REFERENCES "public"."declarations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_declaration_id_declarations_id_fk" FOREIGN KEY ("declaration_id") REFERENCES "public"."declarations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sanctions_checks" ADD CONSTRAINT "sanctions_checks_declaration_id_declarations_id_fk" FOREIGN KEY ("declaration_id") REFERENCES "public"."declarations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stakeholder_profiles" ADD CONSTRAINT "stakeholder_profiles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_aeo_trader_id" ON "aeo_applications" USING btree ("trader_id");--> statement-breakpoint
CREATE INDEX "idx_ae_entity" ON "audit_events" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "idx_dd_declaration_id" ON "declaration_documents" USING btree ("declaration_id");--> statement-breakpoint
CREATE INDEX "idx_decl_trader_id" ON "declarations" USING btree ("trader_id");--> statement-breakpoint
CREATE INDEX "idx_decl_status" ON "declarations" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_decl_risk_lane" ON "declarations" USING btree ("risk_lane");--> statement-breakpoint
CREATE INDEX "idx_notif_user_id" ON "notifications" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_notif_read" ON "notifications" USING btree ("read");--> statement-breakpoint
CREATE INDEX "idx_oga_declaration_id" ON "oga_permits" USING btree ("declaration_id");--> statement-breakpoint
CREATE INDEX "idx_oga_status" ON "oga_permits" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_pay_declaration_id" ON "payments" USING btree ("declaration_id");--> statement-breakpoint
CREATE INDEX "idx_sc_declaration_id" ON "sanctions_checks" USING btree ("declaration_id");--> statement-breakpoint
CREATE INDEX "idx_sa_severity" ON "security_alerts" USING btree ("severity");--> statement-breakpoint
CREATE INDEX "idx_sa_category" ON "security_alerts" USING btree ("category");--> statement-breakpoint
CREATE INDEX "idx_sp_user_id" ON "stakeholder_profiles" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_sp_status" ON "stakeholder_profiles" USING btree ("status");