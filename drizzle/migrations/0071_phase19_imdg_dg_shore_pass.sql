-- Phase 19 (F5a): IMDG dangerous-goods line items + shore-pass lifecycle.
-- Appended to the chain; no history rewritten. Hand-written minimal delta
-- (snapshot chain only reaches 0048), following the 0069/0070 precedent.
--
-- declaration_dg_items: structurally-validated IMDG line items per customs
-- declaration (UN number / IMO class+division / packing group / PSN /
-- flashpoint / EmS). NO substance database — a declaration is DG-flagged by
-- the existence of ≥1 item row (derived flag, never stored, never stale).
CREATE TABLE "declaration_dg_items" (
	"id" serial PRIMARY KEY NOT NULL,
	"declaration_id" integer NOT NULL,
	"un_number" varchar(4) NOT NULL,
	"imo_class" varchar(8) NOT NULL,
	"packing_group" varchar(8),
	"proper_shipping_name" varchar(256) NOT NULL,
	"flashpoint_celsius" numeric(6,1),
	"ems_codes" json,
	"marine_pollutant" boolean DEFAULT false NOT NULL,
	"quantity_description" varchar(256),
	"created_by" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "declaration_dg_items_un_number_check" CHECK ("un_number" ~ '^[0-9]{4}$'),
	CONSTRAINT "declaration_dg_items_packing_group_check" CHECK ("packing_group" IS NULL OR "packing_group" IN ('I','II','III'))
);
--> statement-breakpoint
ALTER TABLE "declaration_dg_items" ADD CONSTRAINT "declaration_dg_items_declaration_id_declarations_id_fk" FOREIGN KEY ("declaration_id") REFERENCES "public"."declarations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "declaration_dg_items" ADD CONSTRAINT "declaration_dg_items_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_dg_items_declaration" ON "declaration_dg_items" USING btree ("declaration_id");--> statement-breakpoint
CREATE INDEX "idx_dg_items_un_number" ON "declaration_dg_items" USING btree ("un_number");--> statement-breakpoint
-- shore_pass_applications: SUBMITTED → APPROVED|REJECTED; APPROVED → REVOKED|EXPIRED.
-- verification_status gates approval: NOT_REQUESTED|VERIFIED may be decided;
-- FAILED|NOT_CONFIGURED (upstream seafarer registry not configured) fail closed.
CREATE TABLE "shore_pass_applications" (
	"id" serial PRIMARY KEY NOT NULL,
	"application_number" varchar(32) NOT NULL UNIQUE,
	"vessel_imo_number" varchar(7) NOT NULL,
	"voyage_number" varchar(64) NOT NULL,
	"port_code" varchar(5) NOT NULL,
	"crew_family_name" varchar(128) NOT NULL,
	"crew_given_names" varchar(128) NOT NULL,
	"crew_nationality_code" varchar(2) NOT NULL,
	"crew_rank_or_rating" varchar(64) NOT NULL,
	"crew_date_of_birth" varchar(10) NOT NULL,
	"purpose" text NOT NULL,
	"stcw_certificate_number" varchar(64),
	"verification_status" varchar(16) DEFAULT 'NOT_REQUESTED' NOT NULL,
	"verification_outcome" varchar(16),
	"status" varchar(16) DEFAULT 'SUBMITTED' NOT NULL,
	"requested_by" integer NOT NULL,
	"decided_by" integer,
	"decision_reason" text,
	"valid_from" timestamp,
	"valid_until" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "shore_pass_imo_check" CHECK ("vessel_imo_number" ~ '^[0-9]{7}$'),
	CONSTRAINT "shore_pass_status_check" CHECK ("status" IN ('SUBMITTED','APPROVED','REJECTED','REVOKED','EXPIRED')),
	CONSTRAINT "shore_pass_verification_check" CHECK ("verification_status" IN ('NOT_REQUESTED','VERIFIED','FAILED','NOT_CONFIGURED'))
);
--> statement-breakpoint
ALTER TABLE "shore_pass_applications" ADD CONSTRAINT "shore_pass_applications_requested_by_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shore_pass_applications" ADD CONSTRAINT "shore_pass_applications_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_shore_pass_vessel" ON "shore_pass_applications" USING btree ("vessel_imo_number","voyage_number");--> statement-breakpoint
CREATE INDEX "idx_shore_pass_status" ON "shore_pass_applications" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_shore_pass_requested_by" ON "shore_pass_applications" USING btree ("requested_by");--> statement-breakpoint
-- shore_pass_events: append-only audit trail, one row per transition.
CREATE TABLE "shore_pass_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"application_id" integer NOT NULL,
	"action" varchar(32) NOT NULL,
	"from_status" varchar(16),
	"to_status" varchar(16),
	"actor_id" integer NOT NULL,
	"detail" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "shore_pass_events" ADD CONSTRAINT "shore_pass_events_application_id_shore_pass_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."shore_pass_applications"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_shore_pass_events_app" ON "shore_pass_events" USING btree ("application_id");
