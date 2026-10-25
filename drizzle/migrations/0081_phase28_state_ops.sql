-- Phase 28 (W1): stateOps — state blue-economy revenue module.
-- State licensing, concessions, aquaculture estates and blue-carbon MRV for
-- Nigeria's eight coastal states. Hand-written, precedent 0069-0080.
-- NO seed rows.

CREATE TABLE IF NOT EXISTS "state_licenses" (
  "id" serial PRIMARY KEY NOT NULL,
  "state" varchar(64) NOT NULL,
  "license_type" varchar(32) NOT NULL,
  "holder_name" varchar(255) NOT NULL,
  "holder_ref" varchar(128),
  "status" varchar(16) DEFAULT 'PENDING' NOT NULL,
  "fee_amount" numeric(14,2) DEFAULT 0 NOT NULL,
  "currency" char(3) DEFAULT 'NGN' NOT NULL,
  "issued_at" timestamptz,
  "expires_at" timestamptz,
  "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_state_licenses_state" ON "state_licenses" ("state");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_state_licenses_type" ON "state_licenses" ("license_type");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_state_licenses_status" ON "state_licenses" ("status");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "state_concessions" (
  "id" serial PRIMARY KEY NOT NULL,
  "state" varchar(64) NOT NULL,
  "concession_type" varchar(32) NOT NULL,
  "operator_name" varchar(255) NOT NULL,
  "annual_fee" numeric(14,2) DEFAULT 0 NOT NULL,
  "starts_on" date,
  "ends_on" date,
  "status" varchar(16) DEFAULT 'ACTIVE' NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_state_concessions_state" ON "state_concessions" ("state");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_state_concessions_type" ON "state_concessions" ("concession_type");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "aquaculture_estates" (
  "id" serial PRIMARY KEY NOT NULL,
  "state" varchar(64) NOT NULL,
  "name" varchar(255) NOT NULL,
  "location" varchar(255),
  "hectares" double precision DEFAULT 0 NOT NULL,
  "lease_fee_annual" numeric(14,2) DEFAULT 0 NOT NULL,
  "operator_name" varchar(255),
  "status" varchar(16) DEFAULT 'ACTIVE' NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_aquaculture_estates_state" ON "aquaculture_estates" ("state");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "blue_carbon_projects" (
  "id" serial PRIMARY KEY NOT NULL,
  "state" varchar(64) NOT NULL,
  "name" varchar(255) NOT NULL,
  "ecosystem" varchar(32) NOT NULL,
  "area_ha" double precision DEFAULT 0 NOT NULL,
  "status" varchar(24) DEFAULT 'PROPOSED' NOT NULL,
  "credits_issued" numeric(14,2) DEFAULT 0 NOT NULL,
  "price_per_tonne" numeric(10,2),
  "registry_ref" varchar(128),
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_blue_carbon_projects_state" ON "blue_carbon_projects" ("state");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_blue_carbon_projects_status" ON "blue_carbon_projects" ("status");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "mrv_evidence" (
  "id" serial PRIMARY KEY NOT NULL,
  "project_id" integer NOT NULL REFERENCES "blue_carbon_projects"("id"),
  "evidence_type" varchar(32) NOT NULL,
  "period" varchar(16),
  "co2_tonnes" numeric(14,2) DEFAULT 0 NOT NULL,
  "document_uri" text,
  "verification_hash" varchar(128),
  "verifier" varchar(255),
  "created_at" timestamptz DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_mrv_evidence_project" ON "mrv_evidence" ("project_id");
