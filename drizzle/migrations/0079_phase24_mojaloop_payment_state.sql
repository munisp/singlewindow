-- Phase 24: mojaloop-gateway becomes the writer of the existing
-- mojaloop_payments table. Additive only: columns needed to persist the full
-- PaymentRecord lifecycle state (quote/steps/fulfilment/TigerBeetle refs and
-- timestamps). No data changes.
ALTER TABLE mojaloop_payments ADD COLUMN IF NOT EXISTS declaration_ref varchar(128);
ALTER TABLE mojaloop_payments ADD COLUMN IF NOT EXISTS trader_ref varchar(128);
ALTER TABLE mojaloop_payments ADD COLUMN IF NOT EXISTS fulfilment text;
ALTER TABLE mojaloop_payments ADD COLUMN IF NOT EXISTS quote jsonb;
ALTER TABLE mojaloop_payments ADD COLUMN IF NOT EXISTS steps jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE mojaloop_payments ADD COLUMN IF NOT EXISTS assessment_id varchar(64);
ALTER TABLE mojaloop_payments ADD COLUMN IF NOT EXISTS tb_pending_id varchar(64);
ALTER TABLE mojaloop_payments ADD COLUMN IF NOT EXISTS tb_posted_at timestamptz;
ALTER TABLE mojaloop_payments ADD COLUMN IF NOT EXISTS error_code varchar(64);
ALTER TABLE mojaloop_payments ADD COLUMN IF NOT EXISTS initiated_at timestamptz;
ALTER TABLE mojaloop_payments ADD COLUMN IF NOT EXISTS confirmed_at timestamptz;
-- The gateway's declaration/trader references are external string identifiers,
-- not users/declarations FK integers: allow the legacy FK columns to stay
-- NULL for gateway-written rows (constraint relaxation only, no data change).
ALTER TABLE mojaloop_payments ALTER COLUMN trader_id DROP NOT NULL;
ALTER TABLE mojaloop_payments ALTER COLUMN payer_fsp DROP NOT NULL;
CREATE INDEX IF NOT EXISTS idx_mj_payments_declaration_ref ON mojaloop_payments (declaration_ref);
CREATE INDEX IF NOT EXISTS idx_mj_payments_transfer_id ON mojaloop_payments (transfer_id);
