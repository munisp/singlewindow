-- WP-6 trade-finance consent evidence mirror (digest-only audit rows).

CREATE TABLE IF NOT EXISTS "trade_finance_consent_evidence" (
  "id" serial PRIMARY KEY NOT NULL,
  "consent_id" varchar(128) NOT NULL,
  "trader_user_id" integer NOT NULL REFERENCES "users"("id"),
  "trader_ref" varchar(256) NOT NULL,
  "bank_id" varchar(128) NOT NULL,
  "action" varchar(32) NOT NULL,
  "envelope_digest_sha256" varchar(128) NOT NULL,
  "detail" jsonb,
  "created_at" timestamp DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "idx_tfce_trader_user_id" ON "trade_finance_consent_evidence" ("trader_user_id");
CREATE INDEX IF NOT EXISTS "idx_tfce_consent_id" ON "trade_finance_consent_evidence" ("consent_id");
