-- Phase 29 (W1): stateOps extension — fisheries permits, IUU penalties,
-- small craft registry, dredging permits/declarations (royalty accrual),
-- water transport routes (jetty levies) and state revenue shares for
-- Nigeria's eight coastal states. Hand-written, precedent 0081.
-- NO seed rows.

CREATE TABLE IF NOT EXISTS "fisheries_permits" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "state" text NOT NULL,
  "permit_type" text NOT NULL,
  "vessel_name" text,
  "vessel_reg_no" text,
  "operator_name" text NOT NULL,
  "fee_naira" double precision NOT NULL,
  "status" text DEFAULT 'active' NOT NULL,
  "issued_at" timestamptz DEFAULT now(),
  "expires_at" timestamptz,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "fisheries_permits_permit_type_check" CHECK ("permit_type" IN ('industrial','artisanal','crab_shrimp','collection'))
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_fisheries_permits_state" ON "fisheries_permits" ("state");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_fisheries_permits_status" ON "fisheries_permits" ("status");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "iuu_penalties" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "state" text NOT NULL,
  "permit_id" uuid REFERENCES "fisheries_permits"("id"),
  "vessel_name" text NOT NULL,
  "offence" text NOT NULL,
  "fine_naira" double precision NOT NULL,
  "status" text DEFAULT 'assessed' NOT NULL,
  "assessed_at" timestamptz DEFAULT now(),
  "paid_at" timestamptz,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_iuu_penalties_state" ON "iuu_penalties" ("state");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_iuu_penalties_status" ON "iuu_penalties" ("status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_iuu_penalties_permit" ON "iuu_penalties" ("permit_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "small_craft_registry" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "state" text NOT NULL,
  "registration_no" text NOT NULL UNIQUE,
  "craft_type" text NOT NULL,
  "owner_name" text NOT NULL,
  "capacity" integer,
  "safety_cert_expires_at" timestamptz,
  "registration_fee_naira" double precision NOT NULL,
  "status" text DEFAULT 'active' NOT NULL,
  "registered_at" timestamptz DEFAULT now(),
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_small_craft_registry_state" ON "small_craft_registry" ("state");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_small_craft_registry_status" ON "small_craft_registry" ("status");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "dredging_permits" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "state" text NOT NULL,
  "operator_name" text NOT NULL,
  "site_description" text NOT NULL,
  "royalty_per_m3_naira" double precision NOT NULL,
  "status" text DEFAULT 'active' NOT NULL,
  "issued_at" timestamptz DEFAULT now(),
  "expires_at" timestamptz,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_dredging_permits_state" ON "dredging_permits" ("state");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_dredging_permits_status" ON "dredging_permits" ("status");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "dredging_declarations" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "permit_id" uuid NOT NULL REFERENCES "dredging_permits"("id"),
  "period" text NOT NULL,
  "volume_m3" double precision NOT NULL,
  "royalty_due_naira" double precision NOT NULL,
  "status" text DEFAULT 'declared' NOT NULL,
  "declared_at" timestamptz DEFAULT now(),
  "created_at" timestamptz DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_dredging_declarations_permit" ON "dredging_declarations" ("permit_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_dredging_declarations_status" ON "dredging_declarations" ("status");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "water_transport_routes" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "state" text NOT NULL,
  "route_name" text NOT NULL,
  "operator_name" text NOT NULL,
  "fare_naira" double precision NOT NULL,
  "jetty_levy_per_trip_naira" double precision DEFAULT 0 NOT NULL,
  "status" text DEFAULT 'active' NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_water_transport_routes_state" ON "water_transport_routes" ("state");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_water_transport_routes_status" ON "water_transport_routes" ("status");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "state_revenue_shares" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "state" text NOT NULL,
  "source" text NOT NULL,
  "share_percent" double precision NOT NULL,
  "effective_from" timestamptz DEFAULT now(),
  "created_at" timestamptz DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_state_revenue_shares_state" ON "state_revenue_shares" ("state");
