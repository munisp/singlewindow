-- Phase-6 remediation: compliance/security schema changes.
-- Idempotent — safe to apply on environments where some objects already exist.
--
-- SW-S2-1/SW-22: declarations can be held for sanctions review (real enum status
-- instead of the undocumented 'held_sanctions' literal or a dishonest 'rejected').
-- NOTE: ALTER TYPE ... ADD VALUE cannot run inside a transaction block; apply
-- this statement standalone (drizzle-kit migrate runs statements sequentially).
ALTER TYPE "public"."declaration_status" ADD VALUE IF NOT EXISTS 'held_sanctions';

-- SW-5 / SW-S2-1 / SW-S2-3: webhook replay dedupe.
-- Every inbound webhook delivery (OGA, sanctions, CEP) is recorded exactly once;
-- redeliveries with the same (source, delivery_key) are acknowledged as duplicates
-- without re-applying side effects.
CREATE TABLE IF NOT EXISTS "webhook_receipts" (
  "id" serial PRIMARY KEY NOT NULL,
  "source" varchar(32) NOT NULL,
  "delivery_key" varchar(255) NOT NULL,
  "received_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "webhook_receipts_source_key_unique" UNIQUE ("source", "delivery_key")
);
CREATE INDEX IF NOT EXISTS "idx_webhook_receipts_source" ON "webhook_receipts" ("source");

-- SW-S2-3: gapless-enough alert id sequence replacing the COUNT(*)+1 race.
CREATE SEQUENCE IF NOT EXISTS "cep_alert_seq";

-- SW-G4: 4-eyes (dual control) approval records, Postgres-backed, consume-on-use.
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
);
CREATE INDEX IF NOT EXISTS "idx_four_eyes_action_entity"
  ON "four_eyes_requests" ("action", "entity_type", "entity_id");

-- SW-S2-8: documents uploaded while the AV scanner is unavailable are
-- quarantined (never silently activated).
ALTER TYPE "public"."document_vault_status" ADD VALUE IF NOT EXISTS 'quarantined';

-- SW-21: real persisted free-zone reconciliation runs.
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
  "triggered_by" integer REFERENCES "users"("id"),
  "created_at" timestamp DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "idx_fz_recon_zone" ON "freezone_reconciliation_runs" ("zone_id");
CREATE INDEX IF NOT EXISTS "idx_fz_recon_created" ON "freezone_reconciliation_runs" ("created_at");
