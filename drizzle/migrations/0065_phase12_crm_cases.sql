-- Phase 12 — Stakeholder-360 CRM: case/ticket workflow.
--
-- crm_cases holds support/dispute cases raised against a unified stakeholder
-- (party) profile. No CRM data duplicates trade data: the 360 view is a
-- query-time aggregation across declarations/payments/permits/certificates/
-- API usage keyed by stakeholder_profiles.id / users.id.
--
-- State machine (enforced app-level in server/crm/cases.ts):
--   open → triaged → in_progress → resolved → closed
-- Maker-checker: dispute-type cases require a resolution approval by a
-- DIFFERENT officer (resolution_approved_by != resolved_by) before close.
--
-- RLS pattern follows 0064_phase11_tenant_rls.sql (ENABLE + FORCE,
-- DROP POLICY IF EXISTS, GUC helpers current_app_tenant_id()/is_platform_admin()).
-- CRM cases are officer-scoped: platform admins and sessions carrying the
-- case's tenant GUC (or no tenant isolation configured) may act; creators may
-- always read their own cases.

CREATE TABLE IF NOT EXISTS "crm_cases" (
  "id" serial PRIMARY KEY NOT NULL,
  "case_number" varchar(24) NOT NULL UNIQUE,
  "subject" varchar(240) NOT NULL,
  "description" text,
  "case_type" varchar(32) DEFAULT 'general' NOT NULL,   -- general | declaration | payment | verification | dispute
  "priority" varchar(16) DEFAULT 'medium' NOT NULL,     -- low | medium | high | critical
  "status" varchar(20) DEFAULT 'open' NOT NULL,         -- open | triaged | in_progress | resolved | closed
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
  CONSTRAINT "crm_cases_stakeholder_fk"
    FOREIGN KEY ("stakeholder_profile_id") REFERENCES "public"."stakeholder_profiles"("id")
    ON DELETE no action ON UPDATE no action,
  CONSTRAINT "crm_cases_declaration_fk"
    FOREIGN KEY ("declaration_id") REFERENCES "public"."declarations"("id")
    ON DELETE no action ON UPDATE no action,
  CONSTRAINT "crm_cases_tenant_fk"
    FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id")
    ON DELETE no action ON UPDATE no action,
  CONSTRAINT "crm_cases_created_by_fk"
    FOREIGN KEY ("created_by") REFERENCES "public"."users"("id")
    ON DELETE no action ON UPDATE no action,
  CONSTRAINT "crm_cases_assigned_to_fk"
    FOREIGN KEY ("assigned_to") REFERENCES "public"."users"("id")
    ON DELETE no action ON UPDATE no action,
  CONSTRAINT "crm_cases_resolved_by_fk"
    FOREIGN KEY ("resolved_by") REFERENCES "public"."users"("id")
    ON DELETE no action ON UPDATE no action,
  CONSTRAINT "crm_cases_resolution_approved_by_fk"
    FOREIGN KEY ("resolution_approved_by") REFERENCES "public"."users"("id")
    ON DELETE no action ON UPDATE no action
);

CREATE INDEX IF NOT EXISTS "idx_crm_cases_status" ON "crm_cases" USING btree ("status");
CREATE INDEX IF NOT EXISTS "idx_crm_cases_stakeholder" ON "crm_cases" USING btree ("stakeholder_profile_id");
CREATE INDEX IF NOT EXISTS "idx_crm_cases_assigned" ON "crm_cases" USING btree ("assigned_to");
CREATE INDEX IF NOT EXISTS "idx_crm_cases_tenant" ON "crm_cases" USING btree ("tenant_id");
CREATE INDEX IF NOT EXISTS "idx_crm_cases_created_by" ON "crm_cases" USING btree ("created_by");
CREATE INDEX IF NOT EXISTS "idx_crm_cases_created_at" ON "crm_cases" USING btree ("created_at");

-- Immutable transition history (also feeds the client case timeline).
CREATE TABLE IF NOT EXISTS "crm_case_events" (
  "id" serial PRIMARY KEY NOT NULL,
  "case_id" integer NOT NULL,
  "event_type" varchar(40) NOT NULL,                    -- created | assigned | transition | resolution | resolution_approved | closed | note
  "from_status" varchar(20),
  "to_status" varchar(20),
  "actor_id" integer NOT NULL,
  "note" text,
  "created_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "crm_case_events_case_fk"
    FOREIGN KEY ("case_id") REFERENCES "public"."crm_cases"("id")
    ON DELETE cascade ON UPDATE no action,
  CONSTRAINT "crm_case_events_actor_fk"
    FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id")
    ON DELETE no action ON UPDATE no action
);

CREATE INDEX IF NOT EXISTS "idx_crm_case_events_case" ON "crm_case_events" USING btree ("case_id");

-- =============================================================================
-- RLS — same doctrine as 0064: platform admins bypass; tenant-scoped sessions
-- act only on their tenant's rows; creators/assignees can always read rows
-- they participate in. Writes are additionally gated app-level by officer
-- role procedures (keycloakCustomsOfficerProcedure / adminProcedure).
-- =============================================================================
ALTER TABLE crm_cases ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm_cases FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS crm_cases_select ON crm_cases;
CREATE POLICY crm_cases_select ON crm_cases
  FOR SELECT
  USING (
    is_platform_admin()
    OR created_by::text = current_app_user_id()
    OR assigned_to::text = current_app_user_id()
    OR tenant_id IS NULL
    OR tenant_id::text = current_app_tenant_id()
  );

DROP POLICY IF EXISTS crm_cases_insert ON crm_cases;
CREATE POLICY crm_cases_insert ON crm_cases
  FOR INSERT
  WITH CHECK (
    is_platform_admin()
    OR tenant_id IS NULL
    OR tenant_id::text = current_app_tenant_id()
  );

DROP POLICY IF EXISTS crm_cases_update ON crm_cases;
CREATE POLICY crm_cases_update ON crm_cases
  FOR UPDATE
  USING (
    is_platform_admin()
    OR tenant_id IS NULL
    OR tenant_id::text = current_app_tenant_id()
  );

DROP POLICY IF EXISTS crm_cases_delete ON crm_cases;
CREATE POLICY crm_cases_delete ON crm_cases
  FOR DELETE
  USING (is_platform_admin());

ALTER TABLE crm_case_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm_case_events FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS crm_case_events_select ON crm_case_events;
CREATE POLICY crm_case_events_select ON crm_case_events
  FOR SELECT
  USING (
    is_platform_admin()
    OR EXISTS (
      SELECT 1 FROM crm_cases c
      WHERE c.id = crm_case_events.case_id
        AND (
          c.created_by::text = current_app_user_id()
          OR c.assigned_to::text = current_app_user_id()
          OR c.tenant_id IS NULL
          OR c.tenant_id::text = current_app_tenant_id()
        )
    )
  );

DROP POLICY IF EXISTS crm_case_events_insert ON crm_case_events;
CREATE POLICY crm_case_events_insert ON crm_case_events
  FOR INSERT
  WITH CHECK (
    is_platform_admin()
    OR EXISTS (
      SELECT 1 FROM crm_cases c
      WHERE c.id = crm_case_events.case_id
        AND (c.tenant_id IS NULL OR c.tenant_id::text = current_app_tenant_id())
    )
  );
