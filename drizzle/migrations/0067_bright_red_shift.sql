DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname='msw_agency') THEN
    CREATE TYPE "public"."msw_agency" AS ENUM('PORT_HEALTH', 'NIS', 'NCS', 'NDLEA', 'NIMASA', 'NPA');
  END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname='msw_boarding_status') THEN
    CREATE TYPE "public"."msw_boarding_status" AS ENUM('SCHEDULED', 'COMPLETED');
  END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname='msw_clearance_decision') THEN
    CREATE TYPE "public"."msw_clearance_decision" AS ENUM('GRANTED', 'REFUSED');
  END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname='msw_clearance_kind') THEN
    CREATE TYPE "public"."msw_clearance_kind" AS ENUM('ARRIVAL', 'DEPARTURE');
  END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname='msw_declaration_status') THEN
    CREATE TYPE "public"."msw_declaration_status" AS ENUM('SUBMITTED', 'ACCEPTED', 'RETURNED');
  END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname='msw_foreign_draft_status') THEN
    CREATE TYPE "public"."msw_foreign_draft_status" AS ENUM('DRAFT', 'ADMITTED', 'REJECTED');
  END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname='msw_form_type') THEN
    CREATE TYPE "public"."msw_form_type" AS ENUM('FAL1', 'FAL2', 'FAL3', 'FAL4', 'FAL5', 'FAL6', 'FAL7', 'MDOH');
  END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname='msw_pratique_decision') THEN
    CREATE TYPE "public"."msw_pratique_decision" AS ENUM('GRANTED', 'REFUSED');
  END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname='msw_visit_status') THEN
    CREATE TYPE "public"."msw_visit_status" AS ENUM('DRAFT', 'SUBMITTED', 'UNDER_REVIEW', 'CLEARED_TO_ENTER', 'IN_PORT', 'CLEARED_TO_DEPART', 'DEPARTED', 'CANCELLED');
  END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname='pcs_milestone') THEN
    CREATE TYPE "public"."pcs_milestone" AS ENUM('pre_arrival', 'arrived', 'berthed', 'ops_started', 'discharging', 'customs_hold', 'customs_released', 'gate_out', 'departed');
  END IF;
END $$;--> statement-breakpoint
ALTER TYPE "public"."audit_entity" ADD VALUE IF NOT EXISTS 'privileged_action';--> statement-breakpoint
ALTER TYPE "public"."audit_entity" ADD VALUE IF NOT EXISTS 'four_eyes_request';--> statement-breakpoint
ALTER TYPE "public"."declaration_status" ADD VALUE IF NOT EXISTS 'held_sanctions';--> statement-breakpoint
ALTER TYPE "public"."document_vault_category" ADD VALUE IF NOT EXISTS 'delivery_order';--> statement-breakpoint
ALTER TYPE "public"."document_vault_category" ADD VALUE IF NOT EXISTS 'gate_pass';--> statement-breakpoint
ALTER TYPE "public"."document_vault_category" ADD VALUE IF NOT EXISTS 'terminal_notice';--> statement-breakpoint
ALTER TYPE "public"."document_vault_category" ADD VALUE IF NOT EXISTS 'pcs_correspondence';--> statement-breakpoint
ALTER TYPE "public"."document_vault_status" ADD VALUE IF NOT EXISTS 'quarantined';--> statement-breakpoint
ALTER TYPE "public"."notification_type" ADD VALUE IF NOT EXISTS 'pcs_booking_confirmed';--> statement-breakpoint
ALTER TYPE "public"."notification_type" ADD VALUE IF NOT EXISTS 'pcs_gate_window';--> statement-breakpoint
ALTER TYPE "public"."notification_type" ADD VALUE IF NOT EXISTS 'pcs_berth_change';--> statement-breakpoint
ALTER TYPE "public"."notification_type" ADD VALUE IF NOT EXISTS 'pcs_invoice_issued';--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "api_key_elevation_requests" (
	"id" serial PRIMARY KEY NOT NULL,
	"organisation_id" integer NOT NULL,
	"api_key_id" integer NOT NULL,
	"justification" text NOT NULL,
	"requested_by" integer NOT NULL,
	"reviewed_by" integer,
	"status" varchar(20) DEFAULT 'pending' NOT NULL,
	"review_notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"reviewed_at" timestamp
);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "bills_of_lading" (
	"id" serial PRIMARY KEY NOT NULL,
	"manifest_id" integer NOT NULL,
	"bl_number" varchar(64) NOT NULL,
	"shipper" varchar(256) NOT NULL,
	"consignee" varchar(256) NOT NULL,
	"notify_party" varchar(256),
	"description" text NOT NULL,
	"hs_code" varchar(16),
	"weight_kg" numeric(12, 2),
	"num_packages" integer,
	"container_nos" text[],
	"status" varchar(32) DEFAULT 'ACTIVE' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "container_ocr_reads" (
	"id" serial PRIMARY KEY NOT NULL,
	"event_id" varchar(128) NOT NULL,
	"camera_id" varchar(64) NOT NULL,
	"container_code" varchar(16) NOT NULL,
	"status" varchar(16) NOT NULL,
	"confidence" numeric(5, 4),
	"check_digit_valid" boolean DEFAULT false NOT NULL,
	"model_version" varchar(128),
	"match_status" varchar(16) NOT NULL,
	"declaration_id" integer,
	"occurred_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "container_ocr_reads_event_id_unique" UNIQUE("event_id")
);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "crf_documents" (
	"id" serial PRIMARY KEY NOT NULL,
	"crf_number" varchar(64) NOT NULL,
	"declaration_id" integer,
	"ucr_number" varchar(64),
	"trader_id" integer NOT NULL,
	"reporting_period" varchar(16) NOT NULL,
	"hs_code" varchar(16),
	"declared_value" numeric(14, 2),
	"currency" varchar(3) DEFAULT 'USD' NOT NULL,
	"country_of_origin" varchar(2),
	"port_of_entry" varchar(64),
	"status" varchar(32) DEFAULT 'DRAFT' NOT NULL,
	"submitted_at" timestamp,
	"accepted_at" timestamp,
	"rejected_at" timestamp,
	"rejection_reason" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "crf_documents_crf_number_unique" UNIQUE("crf_number")
);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "crm_case_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"case_id" integer NOT NULL,
	"event_type" varchar(40) NOT NULL,
	"from_status" varchar(20),
	"to_status" varchar(20),
	"actor_id" integer NOT NULL,
	"note" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "crm_cases" (
	"id" serial PRIMARY KEY NOT NULL,
	"case_number" varchar(24) NOT NULL,
	"subject" varchar(240) NOT NULL,
	"description" text,
	"case_type" varchar(32) DEFAULT 'general' NOT NULL,
	"priority" varchar(16) DEFAULT 'medium' NOT NULL,
	"status" varchar(20) DEFAULT 'open' NOT NULL,
	"stakeholder_profile_id" integer,
	"declaration_id" integer,
	"tenant_id" uuid,
	"created_by" integer NOT NULL,
	"assigned_to" integer,
	"resolution_summary" text,
	"resolved_by" integer,
	"resolved_at" timestamp,
	"resolution_approved_by" integer,
	"resolution_approved_at" timestamp,
	"sla_triage_due" timestamp,
	"sla_resolution_due" timestamp,
	"triaged_at" timestamp,
	"closed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "crm_cases_case_number_unique" UNIQUE("case_number")
);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "developer_organisations" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(200) NOT NULL,
	"contact_email" varchar(320) NOT NULL,
	"tier" varchar(20) DEFAULT 'sandbox' NOT NULL,
	"status" varchar(20) DEFAULT 'active' NOT NULL,
	"registered_by" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "four_eyes_requests" (
	"id" serial PRIMARY KEY NOT NULL,
	"action" varchar(100) NOT NULL,
	"entity_type" varchar(100) NOT NULL,
	"entity_id" varchar(100) NOT NULL,
	"requested_by" integer NOT NULL,
	"status" varchar(20) DEFAULT 'pending' NOT NULL,
	"approved_by" integer,
	"approved_at" timestamp,
	"consumed_at" timestamp,
	"expires_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "freezone_reconciliation_runs" (
	"id" serial PRIMARY KEY NOT NULL,
	"zone_id" varchar(64) DEFAULT 'all' NOT NULL,
	"tolerance_pct" real NOT NULL,
	"total_items" integer DEFAULT 0 NOT NULL,
	"matched" integer DEFAULT 0 NOT NULL,
	"unmatched" integer DEFAULT 0 NOT NULL,
	"surplus" integer DEFAULT 0 NOT NULL,
	"reconciliation_rate" real,
	"report" jsonb,
	"triggered_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "lpco_records" (
	"id" serial PRIMARY KEY NOT NULL,
	"declaration_id" integer NOT NULL,
	"trader_id" integer NOT NULL,
	"lpco_type" varchar(64) NOT NULL,
	"mda" varchar(32) NOT NULL,
	"reference_number" varchar(128) NOT NULL,
	"issue_date" timestamp,
	"expiry_date" timestamp,
	"status" varchar(32) DEFAULT 'PENDING' NOT NULL,
	"validation_status" varchar(32) DEFAULT 'UNVALIDATED',
	"validation_message" text,
	"validated_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "manifests" (
	"id" serial PRIMARY KEY NOT NULL,
	"manifest_number" varchar(64) NOT NULL,
	"manifest_type" varchar(8) NOT NULL,
	"submitted_by" integer NOT NULL,
	"vessel_name" varchar(128) NOT NULL,
	"voyage_number" varchar(64) NOT NULL,
	"port_of_loading" varchar(64) NOT NULL,
	"port_of_discharge" varchar(64) NOT NULL,
	"eta" timestamp,
	"ata" timestamp,
	"status" varchar(32) DEFAULT 'DRAFT' NOT NULL,
	"total_bls" integer DEFAULT 0,
	"accepted_at" timestamp,
	"rejected_at" timestamp,
	"rejection_reason" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "manifests_manifest_number_unique" UNIQUE("manifest_number")
);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "marketplace_tiers" (
	"id" serial PRIMARY KEY NOT NULL,
	"code" varchar(20) NOT NULL,
	"name" varchar(80) NOT NULL,
	"rate_limit_per_minute" integer NOT NULL,
	"monthly_call_quota" integer,
	"price_per_call_usd" numeric(10, 6) DEFAULT '0' NOT NULL,
	"monthly_fee_usd" numeric(10, 2) DEFAULT '0' NOT NULL,
	"features" json,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "marketplace_tiers_code_unique" UNIQUE("code")
);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "mojaloop_payments" (
	"id" serial PRIMARY KEY NOT NULL,
	"payment_ref" varchar(64) NOT NULL,
	"declaration_id" integer,
	"trader_id" integer NOT NULL,
	"payment_type" varchar(32) NOT NULL,
	"amount" numeric(14, 2) NOT NULL,
	"currency" varchar(3) DEFAULT 'NGN' NOT NULL,
	"payer_fsp" varchar(64) NOT NULL,
	"quote_id" varchar(64),
	"transfer_id" varchar(64),
	"status" varchar(32) DEFAULT 'PENDING' NOT NULL,
	"completed_at" timestamp,
	"failed_at" timestamp,
	"failure_reason" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "mojaloop_payments_payment_ref_unique" UNIQUE("payment_ref")
);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "msw_agent_nominations" (
	"id" serial PRIMARY KEY NOT NULL,
	"visit_pk" integer NOT NULL,
	"agent_reference" varchar(128) NOT NULL,
	"nomination_document_digest_sha256" varchar(80) NOT NULL,
	"nomination_document" jsonb,
	"nominated_by_user_id" integer NOT NULL,
	"nominated_at" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "msw_boardings" (
	"id" serial PRIMARY KEY NOT NULL,
	"boarding_id" varchar(32) NOT NULL,
	"visit_pk" integer NOT NULL,
	"agencies" jsonb NOT NULL,
	"scheduled_by_agency" "msw_agency" NOT NULL,
	"scheduled_at" timestamp NOT NULL,
	"schedule_note_digest_sha256" varchar(80) DEFAULT '' NOT NULL,
	"status" "msw_boarding_status" DEFAULT 'SCHEDULED' NOT NULL,
	"started_at" timestamp,
	"completed_at" timestamp,
	"pratique_grant_digest_sha256" varchar(80) DEFAULT '' NOT NULL,
	"outcome_digest_sha256" varchar(80),
	CONSTRAINT "msw_boardings_boarding_id_unique" UNIQUE("boarding_id")
);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "msw_clearances" (
	"id" serial PRIMARY KEY NOT NULL,
	"clearance_id" varchar(32) NOT NULL,
	"visit_pk" integer NOT NULL,
	"kind" "msw_clearance_kind" NOT NULL,
	"decision" "msw_clearance_decision" NOT NULL,
	"decided_by_agency" "msw_agency" NOT NULL,
	"refusal_reason_code" varchar(64),
	"precondition_checklist_digest_sha256" varchar(80) DEFAULT '' NOT NULL,
	"conditions_digest_sha256" varchar(80) DEFAULT '' NOT NULL,
	"refusal_record_digest_sha256" varchar(80) DEFAULT '' NOT NULL,
	"decided_by_user_id" integer NOT NULL,
	"decided_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "msw_clearances_clearance_id_unique" UNIQUE("clearance_id")
);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "msw_declarations" (
	"id" serial PRIMARY KEY NOT NULL,
	"declaration_id" varchar(32) NOT NULL,
	"visit_pk" integer NOT NULL,
	"form_type" "msw_form_type" NOT NULL,
	"version" integer NOT NULL,
	"form_payload_digest_sha256" varchar(80) NOT NULL,
	"prior_submission_digest_sha256" varchar(80) DEFAULT '' NOT NULL,
	"contains_personal_data" boolean NOT NULL,
	"form_payload" jsonb NOT NULL,
	"status" "msw_declaration_status" DEFAULT 'SUBMITTED' NOT NULL,
	"submitted_by_user_id" integer NOT NULL,
	"submitted_at" timestamp DEFAULT now() NOT NULL,
	"reviewing_agency" "msw_agency",
	"reviewed_by_user_id" integer,
	"return_reason_code" varchar(64),
	"review_note" text,
	"review_note_digest_sha256" varchar(80),
	"decided_at" timestamp,
	CONSTRAINT "msw_declarations_declaration_id_unique" UNIQUE("declaration_id"),
	CONSTRAINT "msw_declarations_visit_form_version_unique" UNIQUE("visit_pk","form_type","version")
);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "msw_foreign_drafts" (
	"id" serial PRIMARY KEY NOT NULL,
	"draft_id" varchar(40) NOT NULL,
	"form_type" "msw_form_type" NOT NULL,
	"foreign_sender" varchar(128) NOT NULL,
	"source_message_id" varchar(128) NOT NULL,
	"envelope_event_id" varchar(80) NOT NULL,
	"envelope_digest_sha256" varchar(80) NOT NULL,
	"form_payload" jsonb NOT NULL,
	"contains_personal_data" boolean NOT NULL,
	"status" "msw_foreign_draft_status" DEFAULT 'DRAFT' NOT NULL,
	"received_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "msw_foreign_drafts_draft_id_unique" UNIQUE("draft_id"),
	CONSTRAINT "msw_foreign_drafts_message_unique" UNIQUE("foreign_sender","source_message_id")
);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "msw_pratique" (
	"id" serial PRIMARY KEY NOT NULL,
	"visit_pk" integer NOT NULL,
	"decision" "msw_pratique_decision" NOT NULL,
	"health_declaration_pk" integer NOT NULL,
	"officer_reference" varchar(128) NOT NULL,
	"refusal_reason_code" varchar(64),
	"pratique_record_digest_sha256" varchar(80) NOT NULL,
	"decided_by_user_id" integer NOT NULL,
	"decided_at" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "msw_visits" (
	"id" serial PRIMARY KEY NOT NULL,
	"visit_id" varchar(32) NOT NULL,
	"port_call_id" varchar(256),
	"port_call_verified" boolean DEFAULT false NOT NULL,
	"vessel_imo_number" varchar(7) NOT NULL,
	"vessel_name" varchar(256) NOT NULL,
	"vessel_flag_code" varchar(2) NOT NULL,
	"port_code" varchar(5) NOT NULL,
	"agent_reference" varchar(128) NOT NULL,
	"eta" timestamp NOT NULL,
	"etd" timestamp,
	"status" "msw_visit_status" DEFAULT 'SUBMITTED' NOT NULL,
	"declared_by_user_id" integer NOT NULL,
	"declared_at" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "msw_visits_visit_id_unique" UNIQUE("visit_id")
);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "pcs_billing_snapshots" (
	"id" serial PRIMARY KEY NOT NULL,
	"booking_id" varchar(128) NOT NULL,
	"invoice_id" varchar(128),
	"amount_kobo" bigint NOT NULL,
	"currency" varchar(3) DEFAULT 'NGN' NOT NULL,
	"status" varchar(32) NOT NULL,
	"receipt_id" varchar(128),
	"ledger_commit_hash" varchar(128),
	"projection_lag_ms" integer,
	"source_event_id" uuid NOT NULL,
	"occurred_at" timestamp NOT NULL,
	"recorded_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "pcs_billing_snapshots_source_event_id_unique" UNIQUE("source_event_id")
);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "pcs_booking_links" (
	"id" serial PRIMARY KEY NOT NULL,
	"trader_user_id" integer NOT NULL,
	"booking_id" varchar(128) NOT NULL,
	"consignment_id" integer,
	"created_via" varchar(16) NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "pcs_booking_links_booking_unique" UNIQUE("booking_id")
);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "pcs_consignments" (
	"id" serial PRIMARY KEY NOT NULL,
	"trader_user_id" integer NOT NULL,
	"manifest_id" integer,
	"bl_number" varchar(64),
	"container_nos" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"consignee" varchar(256),
	"port_code" varchar(8),
	"port_call_id" varchar(256),
	"declaration_urn" varchar(128),
	"last_milestone" "pcs_milestone",
	"last_milestone_at" timestamp,
	"source_event_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "pcs_consignments_bl_manifest_unique" UNIQUE("bl_number","manifest_id")
);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "pcs_milestones" (
	"id" serial PRIMARY KEY NOT NULL,
	"consignment_id" integer NOT NULL,
	"milestone" "pcs_milestone" NOT NULL,
	"occurred_at" timestamp NOT NULL,
	"recorded_at" timestamp DEFAULT now() NOT NULL,
	"source_topic" varchar(64) NOT NULL,
	"source_event_id" uuid NOT NULL,
	"provenance_signature_verified" boolean NOT NULL,
	CONSTRAINT "pcs_milestones_consignment_event_unique" UNIQUE("consignment_id","source_event_id")
);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "push_tokens" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"token" varchar(512) NOT NULL,
	"platform" varchar(16) NOT NULL,
	"registered_at" timestamp DEFAULT now() NOT NULL,
	"last_seen_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "push_tokens_user_platform_unique" UNIQUE("user_id","platform")
);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "trade_finance_consent_evidence" (
	"id" serial PRIMARY KEY NOT NULL,
	"consent_id" varchar(128) NOT NULL,
	"trader_user_id" integer NOT NULL,
	"trader_ref" varchar(256) NOT NULL,
	"bank_id" varchar(128) NOT NULL,
	"action" varchar(32) NOT NULL,
	"envelope_digest_sha256" varchar(128) NOT NULL,
	"detail" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ucrs" (
	"id" serial PRIMARY KEY NOT NULL,
	"ucr_number" varchar(64) NOT NULL,
	"trader_id" integer NOT NULL,
	"ucr_type" varchar(16) DEFAULT 'SINGLE' NOT NULL,
	"consignee_ref" varchar(128) NOT NULL,
	"port_of_entry" varchar(64) NOT NULL,
	"declaration_id" integer,
	"status" varchar(32) DEFAULT 'CREATED' NOT NULL,
	"activated_at" timestamp,
	"closed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "ucrs_ucr_number_unique" UNIQUE("ucr_number")
);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "valuation_references" (
	"id" serial PRIMARY KEY NOT NULL,
	"hs_code" varchar(10) NOT NULL,
	"description" text NOT NULL,
	"reference_price" numeric(14, 4) NOT NULL,
	"currency" varchar(3) DEFAULT 'USD' NOT NULL,
	"unit" varchar(32) DEFAULT 'kg' NOT NULL,
	"source" varchar(128) DEFAULT 'NCS' NOT NULL,
	"valid_from" timestamp DEFAULT now() NOT NULL,
	"valid_to" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "webhook_receipts" (
	"id" serial PRIMARY KEY NOT NULL,
	"source" varchar(32) NOT NULL,
	"delivery_key" varchar(255) NOT NULL,
	"received_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "webhook_receipts_source_key_unique" UNIQUE("source","delivery_key")
);--> statement-breakpoint

ALTER TABLE "audit_tasks" ALTER COLUMN "risk_score" SET DATA TYPE numeric(7, 4);--> statement-breakpoint

ALTER TABLE "api_keys" ADD COLUMN IF NOT EXISTS "tier_id" integer;--> statement-breakpoint

ALTER TABLE "port_congestion_events" ADD COLUMN IF NOT EXISTS "source" varchar(32) DEFAULT 'live';--> statement-breakpoint

ALTER TABLE "vessel_tracking_events" ADD COLUMN IF NOT EXISTS "source_event_id" varchar(64);--> statement-breakpoint

ALTER TABLE "vessel_tracking_events" ADD COLUMN IF NOT EXISTS "position_report_id" varchar(64);--> statement-breakpoint

ALTER TABLE "vessel_tracking_events" ADD COLUMN IF NOT EXISTS "source_kid" varchar(96);--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "api_key_elevation_requests" ADD CONSTRAINT "api_key_elevation_requests_organisation_id_developer_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."developer_organisations"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "api_key_elevation_requests" ADD CONSTRAINT "api_key_elevation_requests_api_key_id_api_keys_id_fk" FOREIGN KEY ("api_key_id") REFERENCES "public"."api_keys"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "api_key_elevation_requests" ADD CONSTRAINT "api_key_elevation_requests_requested_by_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "api_key_elevation_requests" ADD CONSTRAINT "api_key_elevation_requests_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "bills_of_lading" ADD CONSTRAINT "bills_of_lading_manifest_id_manifests_id_fk" FOREIGN KEY ("manifest_id") REFERENCES "public"."manifests"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "container_ocr_reads" ADD CONSTRAINT "container_ocr_reads_declaration_id_declarations_id_fk" FOREIGN KEY ("declaration_id") REFERENCES "public"."declarations"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "crf_documents" ADD CONSTRAINT "crf_documents_declaration_id_declarations_id_fk" FOREIGN KEY ("declaration_id") REFERENCES "public"."declarations"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "crf_documents" ADD CONSTRAINT "crf_documents_trader_id_users_id_fk" FOREIGN KEY ("trader_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "crm_case_events" ADD CONSTRAINT "crm_case_events_case_id_crm_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."crm_cases"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "crm_case_events" ADD CONSTRAINT "crm_case_events_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "crm_cases" ADD CONSTRAINT "crm_cases_stakeholder_profile_id_stakeholder_profiles_id_fk" FOREIGN KEY ("stakeholder_profile_id") REFERENCES "public"."stakeholder_profiles"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "crm_cases" ADD CONSTRAINT "crm_cases_declaration_id_declarations_id_fk" FOREIGN KEY ("declaration_id") REFERENCES "public"."declarations"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "crm_cases" ADD CONSTRAINT "crm_cases_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "crm_cases" ADD CONSTRAINT "crm_cases_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "crm_cases" ADD CONSTRAINT "crm_cases_assigned_to_users_id_fk" FOREIGN KEY ("assigned_to") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "crm_cases" ADD CONSTRAINT "crm_cases_resolved_by_users_id_fk" FOREIGN KEY ("resolved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "crm_cases" ADD CONSTRAINT "crm_cases_resolution_approved_by_users_id_fk" FOREIGN KEY ("resolution_approved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "developer_organisations" ADD CONSTRAINT "developer_organisations_registered_by_users_id_fk" FOREIGN KEY ("registered_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "four_eyes_requests" ADD CONSTRAINT "four_eyes_requests_requested_by_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "four_eyes_requests" ADD CONSTRAINT "four_eyes_requests_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "freezone_reconciliation_runs" ADD CONSTRAINT "freezone_reconciliation_runs_triggered_by_users_id_fk" FOREIGN KEY ("triggered_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "lpco_records" ADD CONSTRAINT "lpco_records_declaration_id_declarations_id_fk" FOREIGN KEY ("declaration_id") REFERENCES "public"."declarations"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "lpco_records" ADD CONSTRAINT "lpco_records_trader_id_users_id_fk" FOREIGN KEY ("trader_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "manifests" ADD CONSTRAINT "manifests_submitted_by_users_id_fk" FOREIGN KEY ("submitted_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "mojaloop_payments" ADD CONSTRAINT "mojaloop_payments_declaration_id_declarations_id_fk" FOREIGN KEY ("declaration_id") REFERENCES "public"."declarations"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "mojaloop_payments" ADD CONSTRAINT "mojaloop_payments_trader_id_users_id_fk" FOREIGN KEY ("trader_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "msw_agent_nominations" ADD CONSTRAINT "msw_agent_nominations_visit_pk_msw_visits_id_fk" FOREIGN KEY ("visit_pk") REFERENCES "public"."msw_visits"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "msw_agent_nominations" ADD CONSTRAINT "msw_agent_nominations_nominated_by_user_id_users_id_fk" FOREIGN KEY ("nominated_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "msw_boardings" ADD CONSTRAINT "msw_boardings_visit_pk_msw_visits_id_fk" FOREIGN KEY ("visit_pk") REFERENCES "public"."msw_visits"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "msw_clearances" ADD CONSTRAINT "msw_clearances_visit_pk_msw_visits_id_fk" FOREIGN KEY ("visit_pk") REFERENCES "public"."msw_visits"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "msw_clearances" ADD CONSTRAINT "msw_clearances_decided_by_user_id_users_id_fk" FOREIGN KEY ("decided_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "msw_declarations" ADD CONSTRAINT "msw_declarations_visit_pk_msw_visits_id_fk" FOREIGN KEY ("visit_pk") REFERENCES "public"."msw_visits"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "msw_declarations" ADD CONSTRAINT "msw_declarations_submitted_by_user_id_users_id_fk" FOREIGN KEY ("submitted_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "msw_declarations" ADD CONSTRAINT "msw_declarations_reviewed_by_user_id_users_id_fk" FOREIGN KEY ("reviewed_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "msw_pratique" ADD CONSTRAINT "msw_pratique_visit_pk_msw_visits_id_fk" FOREIGN KEY ("visit_pk") REFERENCES "public"."msw_visits"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "msw_pratique" ADD CONSTRAINT "msw_pratique_health_declaration_pk_msw_declarations_id_fk" FOREIGN KEY ("health_declaration_pk") REFERENCES "public"."msw_declarations"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "msw_pratique" ADD CONSTRAINT "msw_pratique_decided_by_user_id_users_id_fk" FOREIGN KEY ("decided_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "msw_visits" ADD CONSTRAINT "msw_visits_declared_by_user_id_users_id_fk" FOREIGN KEY ("declared_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "pcs_booking_links" ADD CONSTRAINT "pcs_booking_links_trader_user_id_users_id_fk" FOREIGN KEY ("trader_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "pcs_booking_links" ADD CONSTRAINT "pcs_booking_links_consignment_id_pcs_consignments_id_fk" FOREIGN KEY ("consignment_id") REFERENCES "public"."pcs_consignments"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "pcs_consignments" ADD CONSTRAINT "pcs_consignments_trader_user_id_users_id_fk" FOREIGN KEY ("trader_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "pcs_consignments" ADD CONSTRAINT "pcs_consignments_manifest_id_manifests_id_fk" FOREIGN KEY ("manifest_id") REFERENCES "public"."manifests"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "pcs_milestones" ADD CONSTRAINT "pcs_milestones_consignment_id_pcs_consignments_id_fk" FOREIGN KEY ("consignment_id") REFERENCES "public"."pcs_consignments"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "trade_finance_consent_evidence" ADD CONSTRAINT "trade_finance_consent_evidence_trader_user_id_users_id_fk" FOREIGN KEY ("trader_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "ucrs" ADD CONSTRAINT "ucrs_trader_id_users_id_fk" FOREIGN KEY ("trader_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "ucrs" ADD CONSTRAINT "ucrs_declaration_id_declarations_id_fk" FOREIGN KEY ("declaration_id") REFERENCES "public"."declarations"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_elev_req_org" ON "api_key_elevation_requests" USING btree ("organisation_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_elev_req_status" ON "api_key_elevation_requests" USING btree ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_bls_manifest_id" ON "bills_of_lading" USING btree ("manifest_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_bls_bl_number" ON "bills_of_lading" USING btree ("bl_number");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_cor_container_code" ON "container_ocr_reads" USING btree ("container_code");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_cor_match_status" ON "container_ocr_reads" USING btree ("match_status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_cor_declaration" ON "container_ocr_reads" USING btree ("declaration_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_crf_trader_id" ON "crf_documents" USING btree ("trader_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_crf_status" ON "crf_documents" USING btree ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_crf_period" ON "crf_documents" USING btree ("reporting_period");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_crm_case_events_case" ON "crm_case_events" USING btree ("case_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_crm_cases_status" ON "crm_cases" USING btree ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_crm_cases_stakeholder" ON "crm_cases" USING btree ("stakeholder_profile_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_crm_cases_assigned" ON "crm_cases" USING btree ("assigned_to");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_crm_cases_tenant" ON "crm_cases" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_crm_cases_created_by" ON "crm_cases" USING btree ("created_by");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_crm_cases_created_at" ON "crm_cases" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_dev_orgs_registered_by" ON "developer_organisations" USING btree ("registered_by");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_dev_orgs_tier" ON "developer_organisations" USING btree ("tier");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_four_eyes_action_entity" ON "four_eyes_requests" USING btree ("action","entity_type","entity_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_fz_recon_zone" ON "freezone_reconciliation_runs" USING btree ("zone_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_fz_recon_created" ON "freezone_reconciliation_runs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_lpco_declaration_id" ON "lpco_records" USING btree ("declaration_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_lpco_trader_id" ON "lpco_records" USING btree ("trader_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_lpco_mda" ON "lpco_records" USING btree ("mda");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_lpco_expiry" ON "lpco_records" USING btree ("expiry_date");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_manifests_submitted_by" ON "manifests" USING btree ("submitted_by");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_manifests_status" ON "manifests" USING btree ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_manifests_type" ON "manifests" USING btree ("manifest_type");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_manifests_port" ON "manifests" USING btree ("port_of_discharge");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_mj_payments_trader" ON "mojaloop_payments" USING btree ("trader_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_mj_payments_status" ON "mojaloop_payments" USING btree ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_mj_payments_declaration" ON "mojaloop_payments" USING btree ("declaration_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_msw_agent_nominations_visit" ON "msw_agent_nominations" USING btree ("visit_pk");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_msw_boardings_visit" ON "msw_boardings" USING btree ("visit_pk");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_msw_clearances_visit" ON "msw_clearances" USING btree ("visit_pk");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_msw_declarations_visit" ON "msw_declarations" USING btree ("visit_pk");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_msw_declarations_form" ON "msw_declarations" USING btree ("visit_pk","form_type");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_msw_foreign_drafts_sender" ON "msw_foreign_drafts" USING btree ("foreign_sender");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_msw_pratique_visit" ON "msw_pratique" USING btree ("visit_pk");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_msw_visits_port_call" ON "msw_visits" USING btree ("port_call_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_msw_visits_vessel_imo" ON "msw_visits" USING btree ("vessel_imo_number");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_msw_visits_status" ON "msw_visits" USING btree ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_pcs_billing_booking" ON "pcs_billing_snapshots" USING btree ("booking_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_pcs_booking_links_trader" ON "pcs_booking_links" USING btree ("trader_user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_pcs_consignments_trader" ON "pcs_consignments" USING btree ("trader_user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_pcs_consignments_bl" ON "pcs_consignments" USING btree ("bl_number");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_pcs_consignments_port_call" ON "pcs_consignments" USING btree ("port_call_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_pcs_milestones_consignment" ON "pcs_milestones" USING btree ("consignment_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_push_tokens_user" ON "push_tokens" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_tfce_trader_user_id" ON "trade_finance_consent_evidence" USING btree ("trader_user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_tfce_consent_id" ON "trade_finance_consent_evidence" USING btree ("consent_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_ucrs_trader_id" ON "ucrs" USING btree ("trader_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_ucrs_status" ON "ucrs" USING btree ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_ucrs_declaration_id" ON "ucrs" USING btree ("declaration_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_valuation_hs_code" ON "valuation_references" USING btree ("hs_code");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_webhook_receipts_source" ON "webhook_receipts" USING btree ("source");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uq_vte_source_event_id" ON "vessel_tracking_events" USING btree ("source_event_id") WHERE "source_event_id" IS NOT NULL;