-- Phase 9 WP-C: Maritime Single Window (MSW / IMO FAL) producing boundary
-- `blueeconomy-singlewindow-msw` (topic maritime.msw.v1).
-- Contract: blueeconomy-contracts proto/blueeconomy/msw/v1/msw.proto +
-- docs/msw.md (commit eb6b1ae, NORMATIVE).
--
-- Pratique-first (NPPM 2021) at the DB level where expressible:
--   * msw_boardings: a COMPLETED party containing any non-Port-Health agency
--     must carry the antecedent pratique grant digest (CHECK).
--   * msw_clearances: a DEPARTURE grant must carry the precondition checklist
--     digest (CHECK).
--   * msw_pratique.health_declaration_pk anchors every pratique decision to a
--     retained MDOH declaration row (FK).
-- Service-enforced (server/mswService.ts) because static CHECKs cannot
-- express temporal ordering:
--   * non-Port-Health boardings may only be SCHEDULED after a pratique grant
--     with no later refusal (PRATIQUE_REQUIRED);
--   * maker-checker: reviewing principal != submitting principal;
--   * monotonic per-(visit, form) version + digest chain;
--   * DEPARTURE grant preconditions (all submitted form versions accepted,
--     pratique granted, joint NIS/NCS/NDLEA/NIMASA boarding completed).

CREATE TYPE "msw_visit_status" AS ENUM ('DRAFT','SUBMITTED','UNDER_REVIEW','CLEARED_TO_ENTER','IN_PORT','CLEARED_TO_DEPART','DEPARTED','CANCELLED');--> statement-breakpoint
CREATE TYPE "msw_form_type" AS ENUM ('FAL1','FAL2','FAL3','FAL4','FAL5','FAL6','FAL7','MDOH');--> statement-breakpoint
CREATE TYPE "msw_agency" AS ENUM ('PORT_HEALTH','NIS','NCS','NDLEA','NIMASA','NPA');--> statement-breakpoint
CREATE TYPE "msw_clearance_kind" AS ENUM ('ARRIVAL','DEPARTURE');--> statement-breakpoint
CREATE TYPE "msw_declaration_status" AS ENUM ('SUBMITTED','ACCEPTED','RETURNED');--> statement-breakpoint
CREATE TYPE "msw_pratique_decision" AS ENUM ('GRANTED','REFUSED');--> statement-breakpoint
CREATE TYPE "msw_boarding_status" AS ENUM ('SCHEDULED','COMPLETED');--> statement-breakpoint
CREATE TYPE "msw_clearance_decision" AS ENUM ('GRANTED','REFUSED');--> statement-breakpoint

-- Public-id sequences (service-assigned immutable identifiers; the numeric
-- primary keys stay internal).
CREATE SEQUENCE "msw_visit_public_seq" START 1;--> statement-breakpoint
CREATE SEQUENCE "msw_declaration_public_seq" START 1;--> statement-breakpoint
CREATE SEQUENCE "msw_boarding_public_seq" START 1;--> statement-breakpoint
CREATE SEQUENCE "msw_clearance_public_seq" START 1;--> statement-breakpoint

CREATE TABLE "msw_visits" (
  "id" serial PRIMARY KEY NOT NULL,
  "visit_id" varchar(32) NOT NULL,
  "port_call_id" varchar(256),
  "port_call_verified" boolean NOT NULL DEFAULT false,
  "vessel_imo_number" varchar(7) NOT NULL,
  "vessel_name" varchar(256) NOT NULL,
  "vessel_flag_code" varchar(2) NOT NULL,
  "port_code" varchar(5) NOT NULL,
  "agent_reference" varchar(128) NOT NULL,
  "eta" timestamp NOT NULL,
  "etd" timestamp,
  "status" "msw_visit_status" NOT NULL DEFAULT 'SUBMITTED',
  "declared_by_user_id" integer NOT NULL,
  "declared_at" timestamp DEFAULT now() NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "msw_visits_visit_id_unique" UNIQUE ("visit_id"),
  CONSTRAINT "msw_visits_imo_format_chk" CHECK ("vessel_imo_number" ~ '^[0-9]{7}$')
);--> statement-breakpoint

CREATE TABLE "msw_agent_nominations" (
  "id" serial PRIMARY KEY NOT NULL,
  "visit_pk" integer NOT NULL,
  "agent_reference" varchar(128) NOT NULL,
  "nomination_document_digest_sha256" varchar(80) NOT NULL,
  "nomination_document" jsonb,
  "nominated_by_user_id" integer NOT NULL,
  "nominated_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "msw_nominations_digest_chk" CHECK ("nomination_document_digest_sha256" ~ '^sha256:[0-9a-f]{64}$')
);--> statement-breakpoint

CREATE TABLE "msw_declarations" (
  "id" serial PRIMARY KEY NOT NULL,
  "declaration_id" varchar(32) NOT NULL,
  "visit_pk" integer NOT NULL,
  "form_type" "msw_form_type" NOT NULL,
  "version" integer NOT NULL,
  "form_payload_digest_sha256" varchar(80) NOT NULL,
  "prior_submission_digest_sha256" varchar(80) NOT NULL DEFAULT '',
  "contains_personal_data" boolean NOT NULL,
  "form_payload" jsonb NOT NULL,
  "status" "msw_declaration_status" NOT NULL DEFAULT 'SUBMITTED',
  "submitted_by_user_id" integer NOT NULL,
  "submitted_at" timestamp DEFAULT now() NOT NULL,
  "reviewing_agency" "msw_agency",
  "reviewed_by_user_id" integer,
  "return_reason_code" varchar(64),
  "review_note" text,
  "review_note_digest_sha256" varchar(80),
  "decided_at" timestamp,
  CONSTRAINT "msw_declarations_declaration_id_unique" UNIQUE ("declaration_id"),
  CONSTRAINT "msw_declarations_visit_form_version_unique" UNIQUE ("visit_pk", "form_type", "version"),
  CONSTRAINT "msw_declarations_version_positive_chk" CHECK ("version" >= 1),
  CONSTRAINT "msw_declarations_payload_digest_chk" CHECK ("form_payload_digest_sha256" ~ '^sha256:[0-9a-f]{64}$'),
  -- Version-chain shape: empty prior digest iff version 1.
  CONSTRAINT "msw_declarations_chain_shape_chk" CHECK (
    ("version" = 1 AND "prior_submission_digest_sha256" = '')
    OR ("version" > 1 AND "prior_submission_digest_sha256" ~ '^sha256:[0-9a-f]{64}$')
  ),
  -- NDPA PERSONAL category is exactly FAL4/FAL5/FAL6/MDOH.
  CONSTRAINT "msw_declarations_personal_data_chk" CHECK (
    "contains_personal_data" = ("form_type" IN ('FAL4','FAL5','FAL6','MDOH'))
  )
);--> statement-breakpoint

CREATE TABLE "msw_pratique" (
  "id" serial PRIMARY KEY NOT NULL,
  "visit_pk" integer NOT NULL,
  "decision" "msw_pratique_decision" NOT NULL,
  "health_declaration_pk" integer NOT NULL,
  "officer_reference" varchar(128) NOT NULL,
  "refusal_reason_code" varchar(64),
  "pratique_record_digest_sha256" varchar(80) NOT NULL,
  "decided_by_user_id" integer NOT NULL,
  "decided_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "msw_pratique_digest_chk" CHECK ("pratique_record_digest_sha256" ~ '^sha256:[0-9a-f]{64}$'),
  CONSTRAINT "msw_pratique_refusal_reason_chk" CHECK (
    ("decision" = 'REFUSED' AND "refusal_reason_code" IS NOT NULL AND "refusal_reason_code" <> '')
    OR ("decision" = 'GRANTED')
  )
);--> statement-breakpoint

CREATE TABLE "msw_boardings" (
  "id" serial PRIMARY KEY NOT NULL,
  "boarding_id" varchar(32) NOT NULL,
  "visit_pk" integer NOT NULL,
  "agencies" jsonb NOT NULL,
  "scheduled_by_agency" "msw_agency" NOT NULL,
  "scheduled_at" timestamp NOT NULL,
  "schedule_note_digest_sha256" varchar(80) NOT NULL DEFAULT '',
  "status" "msw_boarding_status" NOT NULL DEFAULT 'SCHEDULED',
  "started_at" timestamp,
  "completed_at" timestamp,
  "pratique_grant_digest_sha256" varchar(80) NOT NULL DEFAULT '',
  "outcome_digest_sha256" varchar(80),
  CONSTRAINT "msw_boardings_boarding_id_unique" UNIQUE ("boarding_id"),
  CONSTRAINT "msw_boardings_agencies_nonempty_chk" CHECK (jsonb_array_length("agencies") >= 1),
  -- Fail-closed agency set: every member is a wire-valid msw_agency value
  -- (jsonb containment: the party must be a subset of the legal set).
  CONSTRAINT "msw_boardings_agency_set_chk" CHECK (
    "agencies" <@ '["PORT_HEALTH","NIS","NCS","NDLEA","NIMASA","NPA"]'::jsonb
  ),
  -- Pratique-first at completion: a completed party containing any
  -- non-Port-Health agency must bind the antecedent pratique grant digest.
  CONSTRAINT "msw_boardings_pratique_first_chk" CHECK (
    "status" <> 'COMPLETED'
    OR "agencies" <@ '["PORT_HEALTH"]'::jsonb
    OR "pratique_grant_digest_sha256" ~ '^sha256:[0-9a-f]{64}$'
  ),
  CONSTRAINT "msw_boardings_completion_shape_chk" CHECK (
    "status" <> 'COMPLETED'
    OR ("started_at" IS NOT NULL AND "completed_at" IS NOT NULL
        AND "outcome_digest_sha256" ~ '^sha256:[0-9a-f]{64}$')
  )
);--> statement-breakpoint

CREATE TABLE "msw_clearances" (
  "id" serial PRIMARY KEY NOT NULL,
  "clearance_id" varchar(32) NOT NULL,
  "visit_pk" integer NOT NULL,
  "kind" "msw_clearance_kind" NOT NULL,
  "decision" "msw_clearance_decision" NOT NULL,
  "decided_by_agency" "msw_agency" NOT NULL,
  "refusal_reason_code" varchar(64),
  "precondition_checklist_digest_sha256" varchar(80) NOT NULL DEFAULT '',
  "conditions_digest_sha256" varchar(80) NOT NULL DEFAULT '',
  "refusal_record_digest_sha256" varchar(80) NOT NULL DEFAULT '',
  "decided_by_user_id" integer NOT NULL,
  "decided_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "msw_clearances_clearance_id_unique" UNIQUE ("clearance_id"),
  -- A DEPARTURE grant must bind the evaluated precondition checklist digest
  -- (consumers fail closed without it).
  CONSTRAINT "msw_clearances_departure_precondition_chk" CHECK (
    NOT ("kind" = 'DEPARTURE' AND "decision" = 'GRANTED')
    OR "precondition_checklist_digest_sha256" ~ '^sha256:[0-9a-f]{64}$'
  ),
  CONSTRAINT "msw_clearances_refusal_shape_chk" CHECK (
    "decision" <> 'REFUSED'
    OR ("refusal_reason_code" IS NOT NULL AND "refusal_reason_code" <> ''
        AND "refusal_record_digest_sha256" ~ '^sha256:[0-9a-f]{64}$')
  )
);--> statement-breakpoint

ALTER TABLE "msw_visits" ADD CONSTRAINT "msw_visits_declared_by_fk" FOREIGN KEY ("declared_by_user_id") REFERENCES "users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "msw_agent_nominations" ADD CONSTRAINT "msw_nominations_visit_fk" FOREIGN KEY ("visit_pk") REFERENCES "msw_visits"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "msw_agent_nominations" ADD CONSTRAINT "msw_nominations_user_fk" FOREIGN KEY ("nominated_by_user_id") REFERENCES "users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "msw_declarations" ADD CONSTRAINT "msw_declarations_visit_fk" FOREIGN KEY ("visit_pk") REFERENCES "msw_visits"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "msw_declarations" ADD CONSTRAINT "msw_declarations_submitter_fk" FOREIGN KEY ("submitted_by_user_id") REFERENCES "users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "msw_declarations" ADD CONSTRAINT "msw_declarations_reviewer_fk" FOREIGN KEY ("reviewed_by_user_id") REFERENCES "users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "msw_pratique" ADD CONSTRAINT "msw_pratique_visit_fk" FOREIGN KEY ("visit_pk") REFERENCES "msw_visits"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "msw_pratique" ADD CONSTRAINT "msw_pratique_mdoh_fk" FOREIGN KEY ("health_declaration_pk") REFERENCES "msw_declarations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "msw_pratique" ADD CONSTRAINT "msw_pratique_officer_fk" FOREIGN KEY ("decided_by_user_id") REFERENCES "users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "msw_boardings" ADD CONSTRAINT "msw_boardings_visit_fk" FOREIGN KEY ("visit_pk") REFERENCES "msw_visits"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "msw_clearances" ADD CONSTRAINT "msw_clearances_visit_fk" FOREIGN KEY ("visit_pk") REFERENCES "msw_visits"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "msw_clearances" ADD CONSTRAINT "msw_clearances_decider_fk" FOREIGN KEY ("decided_by_user_id") REFERENCES "users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint

CREATE INDEX "idx_msw_visits_port_call" ON "msw_visits" ("port_call_id");--> statement-breakpoint
CREATE INDEX "idx_msw_visits_vessel_imo" ON "msw_visits" ("vessel_imo_number");--> statement-breakpoint
CREATE INDEX "idx_msw_visits_status" ON "msw_visits" ("status");--> statement-breakpoint
CREATE INDEX "idx_msw_agent_nominations_visit" ON "msw_agent_nominations" ("visit_pk");--> statement-breakpoint
CREATE INDEX "idx_msw_declarations_visit" ON "msw_declarations" ("visit_pk");--> statement-breakpoint
CREATE INDEX "idx_msw_declarations_form" ON "msw_declarations" ("visit_pk", "form_type");--> statement-breakpoint
CREATE INDEX "idx_msw_pratique_visit" ON "msw_pratique" ("visit_pk");--> statement-breakpoint
CREATE INDEX "idx_msw_boardings_visit" ON "msw_boardings" ("visit_pk");--> statement-breakpoint
CREATE INDEX "idx_msw_clearances_visit" ON "msw_clearances" ("visit_pk");--> statement-breakpoint
