-- Domain verification event audit trail.
-- This migration is safe to apply to environments where schema push has already
-- created some of the objects: each object is created idempotently.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

DO $$
BEGIN
  CREATE TYPE "domain_verification_outcome" AS ENUM ('success', 'failure', 'error');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "domain_verification_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL,
  "domain" varchar(253) NOT NULL,
  "outcome" "domain_verification_outcome" NOT NULL,
  "error_code" varchar(64),
  "detail" varchar(512),
  "created_at" timestamp NOT NULL DEFAULT now(),
  CONSTRAINT "domain_verification_events_tenant_id_tenants_id_fk"
    FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id")
    ON DELETE cascade ON UPDATE no action
);

CREATE INDEX IF NOT EXISTS "idx_dve_tenant_id"
  ON "domain_verification_events" USING btree ("tenant_id");
CREATE INDEX IF NOT EXISTS "idx_dve_domain"
  ON "domain_verification_events" USING btree ("domain");
CREATE INDEX IF NOT EXISTS "idx_dve_created_at"
  ON "domain_verification_events" USING btree ("created_at");
CREATE INDEX IF NOT EXISTS "idx_dve_outcome"
  ON "domain_verification_events" USING btree ("outcome");
