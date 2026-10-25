-- Phase 30 (W1): stateOps tier-2 — tourism operators & visitor-levy
-- declarations, mariculture farms, training academies & HMAC-verified
-- certifications, and renewable energy credits (RECs) for Nigeria's eight
-- coastal states. Hand-written, precedent 0082.
-- NO seed rows.

CREATE TABLE IF NOT EXISTS "tourism_operators" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "state" text NOT NULL,
  "operator_name" text NOT NULL,
  "operator_type" text NOT NULL,
  "site_description" text,
  "licence_fee_naira" double precision NOT NULL,
  "visitor_levy_naira" double precision DEFAULT 0 NOT NULL,
  "status" text DEFAULT 'active' NOT NULL,
  "issued_at" timestamptz DEFAULT now(),
  "expires_at" timestamptz,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "tourism_operators_operator_type_check" CHECK ("operator_type" IN ('beach_resort','boat_tour','eco_lodge','mangrove_boardwalk','jet_ski','other'))
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_tourism_operators_state" ON "tourism_operators" ("state");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_tourism_operators_status" ON "tourism_operators" ("status");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "tourism_levy_declarations" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "operator_id" uuid NOT NULL REFERENCES "tourism_operators"("id"),
  "period" text NOT NULL,
  "visitor_count" integer NOT NULL,
  "levy_due_naira" double precision NOT NULL,
  "status" text DEFAULT 'declared' NOT NULL,
  "declared_at" timestamptz DEFAULT now(),
  "created_at" timestamptz DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_tourism_levy_declarations_operator" ON "tourism_levy_declarations" ("operator_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_tourism_levy_declarations_status" ON "tourism_levy_declarations" ("status");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "mariculture_farms" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "state" text NOT NULL,
  "estate_id" uuid REFERENCES "aquaculture_estates"("id"),
  "farm_type" text NOT NULL,
  "operator_name" text NOT NULL,
  "area_hectares" double precision,
  "lease_fee_naira" double precision NOT NULL,
  "offtaker_name" text,
  "status" text DEFAULT 'active' NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "mariculture_farms_farm_type_check" CHECK ("farm_type" IN ('seaweed','oyster','mussel','shrimp','finfish_cage'))
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_mariculture_farms_state" ON "mariculture_farms" ("state");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_mariculture_farms_status" ON "mariculture_farms" ("status");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "training_academies" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "state" text NOT NULL,
  "academy_name" text NOT NULL,
  "program_type" text NOT NULL,
  "capacity" integer,
  "status" text DEFAULT 'active' NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "training_academies_program_type_check" CHECK ("program_type" IN ('fishery_skills','boat_handling','diving','hospitality','stcw_adjacent'))
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_training_academies_state" ON "training_academies" ("state");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_training_academies_status" ON "training_academies" ("status");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "training_certifications" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "academy_id" uuid NOT NULL REFERENCES "training_academies"("id"),
  "trainee_name" text NOT NULL,
  "program" text NOT NULL,
  "cert_no" text NOT NULL UNIQUE,
  "cert_fee_naira" double precision DEFAULT 0 NOT NULL,
  "verification_hash" text NOT NULL,
  "issued_at" timestamptz DEFAULT now(),
  "created_at" timestamptz DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_training_certifications_academy" ON "training_certifications" ("academy_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_training_certifications_cert_no" ON "training_certifications" ("cert_no");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "renewable_energy_credits" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "state" text NOT NULL,
  "project_name" text NOT NULL,
  "source" text NOT NULL,
  "mwh" double precision NOT NULL,
  "period" text NOT NULL,
  "credit_price_naira" double precision NOT NULL,
  "status" text DEFAULT 'issued' NOT NULL,
  "verification_hash" text NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "renewable_energy_credits_source_check" CHECK ("source" IN ('tidal','offshore_wind','solar_floating'))
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_renewable_energy_credits_state" ON "renewable_energy_credits" ("state");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_renewable_energy_credits_status" ON "renewable_energy_credits" ("status");
