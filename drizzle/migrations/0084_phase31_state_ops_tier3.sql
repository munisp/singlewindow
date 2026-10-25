-- Phase 31 (W1): stateOps tier-3 — blue-bond origination (issuances +
-- HMAC-verified impact reports) and data-intelligence subscriptions for
-- Nigeria's eight coastal states. Hand-written, precedent 0083.
-- NO seed rows.

CREATE TABLE IF NOT EXISTS "blue_bond_issuances" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "state" text NOT NULL,
  "bond_name" text NOT NULL,
  "issuer_name" text NOT NULL,
  "target_amount_naira" double precision NOT NULL,
  "raised_amount_naira" double precision DEFAULT 0 NOT NULL,
  "coupon_rate" double precision,
  "maturity_date" timestamptz,
  "use_of_proceeds" text,
  "facilitation_fee_naira" double precision DEFAULT 0 NOT NULL,
  "status" text DEFAULT 'proposed' NOT NULL,
  "verification_hash" text NOT NULL,
  "issued_at" timestamptz,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "blue_bond_issuances_status_check" CHECK ("status" IN ('proposed','approved','issued','closed','defaulted'))
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_blue_bond_issuances_state" ON "blue_bond_issuances" ("state");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_blue_bond_issuances_status" ON "blue_bond_issuances" ("status");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "bond_impact_reports" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "bond_id" uuid NOT NULL REFERENCES "blue_bond_issuances"("id"),
  "period" text NOT NULL,
  "allocation_naira" double precision NOT NULL,
  "impact_summary" text NOT NULL,
  "verification_hash" text NOT NULL,
  "reported_at" timestamptz DEFAULT now(),
  "created_at" timestamptz DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_bond_impact_reports_bond" ON "bond_impact_reports" ("bond_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "data_subscriptions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "subscriber_org" text NOT NULL,
  "contact_email" text,
  "tier" text NOT NULL,
  "dataset_scope" text NOT NULL,
  "state" text,
  "fee_naira" double precision NOT NULL,
  "period" text NOT NULL,
  "status" text DEFAULT 'active' NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "data_subscriptions_tier_check" CHECK ("tier" IN ('explorer','professional','enterprise')),
  CONSTRAINT "data_subscriptions_status_check" CHECK ("status" IN ('active','suspended','expired'))
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_data_subscriptions_tier" ON "data_subscriptions" ("tier");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_data_subscriptions_status" ON "data_subscriptions" ("status");
