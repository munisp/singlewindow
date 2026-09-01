-- Phase 12 — API marketplace monetization tiers (WP-8 extension).
--
-- marketplace_tiers defines the commercial plans; api_keys.tier_id binds a key
-- to a plan. Billing is QUERY-TIME aggregation over api_usage_logs (no billing
-- data duplication): GET /v1/marketplace/usage/{key_id}/invoice itemizes
-- production (non-sandbox) calls per endpoint and prices them at the bound
-- tier's price_per_call_usd. Sandbox calls are itemized at zero price.
--
-- RLS doctrine per 0064: tier catalogue is readable by any authenticated
-- session (it is public commercial metadata); tier writes are platform-admin
-- only. Key→tier binding remains governed by api_keys ownership checks.

CREATE TABLE IF NOT EXISTS "marketplace_tiers" (
  "id" serial PRIMARY KEY NOT NULL,
  "code" varchar(20) NOT NULL UNIQUE,                  -- free | builder | enterprise
  "name" varchar(80) NOT NULL,
  "rate_limit_per_minute" integer NOT NULL,            -- applied to api_keys.rate_limit on bind
  "monthly_call_quota" integer,                        -- NULL = unmetered quota (enterprise)
  "price_per_call_usd" numeric(10, 6) DEFAULT '0' NOT NULL,
  "monthly_fee_usd" numeric(10, 2) DEFAULT '0' NOT NULL,
  "features" json,
  "created_at" timestamp DEFAULT now() NOT NULL
);

-- Idempotent catalogue seed (ON CONFLICT keeps operator-tuned pricing).
INSERT INTO "marketplace_tiers"
  ("code", "name", "rate_limit_per_minute", "monthly_call_quota", "price_per_call_usd", "monthly_fee_usd", "features")
VALUES
  ('free',       'Free',       60,   10000,    '0',       '0',     '["catalogue:read"]'),
  ('builder',    'Builder',    600,  1000000,  '0.002',   '49',    '["catalogue:read","verification:read","reports:read"]'),
  ('enterprise', 'Enterprise', 6000, NULL,     '0.001',   '499',   '["catalogue:read","verification:read","reports:read","declarations:read","sla"]')
ON CONFLICT ("code") DO NOTHING;

ALTER TABLE "api_keys" ADD COLUMN IF NOT EXISTS "tier_id" integer;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'api_keys_tier_fk'
  ) THEN
    ALTER TABLE "api_keys"
      ADD CONSTRAINT "api_keys_tier_fk"
      FOREIGN KEY ("tier_id") REFERENCES "public"."marketplace_tiers"("id")
      ON DELETE no action ON UPDATE no action;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "idx_api_keys_tier" ON "api_keys" USING btree ("tier_id");

-- Existing keys default to the free tier so billing never silently zero-rates
-- an unclassified key (fail-closed pricing).
UPDATE "api_keys" k
SET "tier_id" = t.id
FROM "marketplace_tiers" t
WHERE k."tier_id" IS NULL AND t."code" = 'free';

ALTER TABLE marketplace_tiers ENABLE ROW LEVEL SECURITY;
ALTER TABLE marketplace_tiers FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS marketplace_tiers_select ON marketplace_tiers;
CREATE POLICY marketplace_tiers_select ON marketplace_tiers
  FOR SELECT
  USING (true);  -- public commercial metadata

DROP POLICY IF EXISTS marketplace_tiers_insert ON marketplace_tiers;
CREATE POLICY marketplace_tiers_insert ON marketplace_tiers
  FOR INSERT
  WITH CHECK (is_platform_admin());

DROP POLICY IF EXISTS marketplace_tiers_update ON marketplace_tiers;
CREATE POLICY marketplace_tiers_update ON marketplace_tiers
  FOR UPDATE
  USING (is_platform_admin());

DROP POLICY IF EXISTS marketplace_tiers_delete ON marketplace_tiers;
CREATE POLICY marketplace_tiers_delete ON marketplace_tiers
  FOR DELETE
  USING (is_platform_admin());
