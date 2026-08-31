-- Phase 8: PCS Trader Portal read models + enum extensions.
-- Thin read/projection layer over blueeconomy-port-interoperability
-- (ports.*.v1 Kafka events, envelope v1.0). Idempotent — safe to re-apply.
ALTER TYPE "notification_type" ADD VALUE IF NOT EXISTS 'pcs_booking_confirmed';
ALTER TYPE "notification_type" ADD VALUE IF NOT EXISTS 'pcs_gate_window';
ALTER TYPE "notification_type" ADD VALUE IF NOT EXISTS 'pcs_berth_change';
ALTER TYPE "notification_type" ADD VALUE IF NOT EXISTS 'pcs_invoice_issued';
ALTER TYPE "document_vault_category" ADD VALUE IF NOT EXISTS 'delivery_order';
ALTER TYPE "document_vault_category" ADD VALUE IF NOT EXISTS 'gate_pass';
ALTER TYPE "document_vault_category" ADD VALUE IF NOT EXISTS 'terminal_notice';
ALTER TYPE "document_vault_category" ADD VALUE IF NOT EXISTS 'pcs_correspondence';

DO $$ BEGIN
  CREATE TYPE "pcs_milestone" AS ENUM (
    'pre_arrival', 'arrived', 'berthed', 'ops_started', 'discharging',
    'customs_hold', 'customs_released', 'gate_out', 'departed'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "pcs_consignments" (
  "id" serial PRIMARY KEY NOT NULL,
  "trader_user_id" integer NOT NULL REFERENCES "users"("id") ON DELETE cascade,
  "manifest_id" integer REFERENCES "manifests"("id") ON DELETE set null,
  "bl_number" varchar(64),
  "container_nos" jsonb NOT NULL DEFAULT '[]',
  "consignee" varchar(256),
  "port_code" varchar(8),
  "port_call_id" varchar(256),
  "declaration_urn" varchar(128),
  "last_milestone" "pcs_milestone",
  "last_milestone_at" timestamp,
  "source_event_ids" jsonb NOT NULL DEFAULT '[]',
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "pcs_consignments_bl_manifest_unique" UNIQUE ("bl_number", "manifest_id")
);
CREATE INDEX IF NOT EXISTS "idx_pcs_consignments_trader" ON "pcs_consignments" ("trader_user_id");
CREATE INDEX IF NOT EXISTS "idx_pcs_consignments_bl" ON "pcs_consignments" ("bl_number");
CREATE INDEX IF NOT EXISTS "idx_pcs_consignments_port_call" ON "pcs_consignments" ("port_call_id");

CREATE TABLE IF NOT EXISTS "pcs_milestones" (
  "id" serial PRIMARY KEY NOT NULL,
  "consignment_id" integer NOT NULL REFERENCES "pcs_consignments"("id") ON DELETE cascade,
  "milestone" "pcs_milestone" NOT NULL,
  "occurred_at" timestamp NOT NULL,
  "recorded_at" timestamp DEFAULT now() NOT NULL,
  "source_topic" varchar(64) NOT NULL,
  "source_event_id" uuid NOT NULL,
  "provenance_signature_verified" boolean NOT NULL,
  CONSTRAINT "pcs_milestones_consignment_event_unique" UNIQUE ("consignment_id", "source_event_id")
);
CREATE INDEX IF NOT EXISTS "idx_pcs_milestones_consignment" ON "pcs_milestones" ("consignment_id");

CREATE TABLE IF NOT EXISTS "pcs_booking_links" (
  "id" serial PRIMARY KEY NOT NULL,
  "trader_user_id" integer NOT NULL REFERENCES "users"("id") ON DELETE cascade,
  "booking_id" varchar(128) NOT NULL,
  "consignment_id" integer REFERENCES "pcs_consignments"("id") ON DELETE set null,
  "created_via" varchar(16) NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "pcs_booking_links_booking_unique" UNIQUE ("booking_id")
);
CREATE INDEX IF NOT EXISTS "idx_pcs_booking_links_trader" ON "pcs_booking_links" ("trader_user_id");

CREATE TABLE IF NOT EXISTS "pcs_billing_snapshots" (
  "id" serial PRIMARY KEY NOT NULL,
  "booking_id" varchar(128) NOT NULL,
  "invoice_id" varchar(128),
  "amount_kobo" bigint NOT NULL,
  "currency" varchar(3) NOT NULL DEFAULT 'NGN',
  "status" varchar(32) NOT NULL,
  "receipt_id" varchar(128),
  "ledger_commit_hash" varchar(128),
  "projection_lag_ms" integer,
  "source_event_id" uuid NOT NULL UNIQUE,
  "occurred_at" timestamp NOT NULL,
  "recorded_at" timestamp DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "idx_pcs_billing_booking" ON "pcs_billing_snapshots" ("booking_id");
