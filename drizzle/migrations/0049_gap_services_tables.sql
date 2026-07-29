-- Migration: 0006_gap_services_tables
-- Adds new tables for UCR, Manifests, Valuation, CRF, Mojaloop, and LPCO

-- UCRs
CREATE TABLE IF NOT EXISTS ucrs (
  id SERIAL PRIMARY KEY,
  ucr_number VARCHAR(64) NOT NULL UNIQUE,
  trader_id INTEGER NOT NULL REFERENCES users(id),
  ucr_type VARCHAR(16) NOT NULL DEFAULT 'SINGLE',
  consignee_ref VARCHAR(128) NOT NULL,
  port_of_entry VARCHAR(64) NOT NULL,
  declaration_id INTEGER REFERENCES declarations(id),
  status VARCHAR(32) NOT NULL DEFAULT 'CREATED',
  activated_at TIMESTAMPTZ,
  closed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_ucrs_trader_id ON ucrs(trader_id);
CREATE INDEX IF NOT EXISTS idx_ucrs_status ON ucrs(status);
CREATE INDEX IF NOT EXISTS idx_ucrs_declaration_id ON ucrs(declaration_id);

-- Manifests
CREATE TABLE IF NOT EXISTS manifests (
  id SERIAL PRIMARY KEY,
  manifest_number VARCHAR(64) NOT NULL UNIQUE,
  manifest_type VARCHAR(8) NOT NULL,
  submitted_by INTEGER NOT NULL REFERENCES users(id),
  vessel_name VARCHAR(128) NOT NULL,
  voyage_number VARCHAR(64) NOT NULL,
  port_of_loading VARCHAR(64) NOT NULL,
  port_of_discharge VARCHAR(64) NOT NULL,
  eta TIMESTAMPTZ,
  ata TIMESTAMPTZ,
  status VARCHAR(32) NOT NULL DEFAULT 'DRAFT',
  total_bls INTEGER DEFAULT 0,
  accepted_at TIMESTAMPTZ,
  rejected_at TIMESTAMPTZ,
  rejection_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_manifests_submitted_by ON manifests(submitted_by);
CREATE INDEX IF NOT EXISTS idx_manifests_status ON manifests(status);
CREATE INDEX IF NOT EXISTS idx_manifests_type ON manifests(manifest_type);
CREATE INDEX IF NOT EXISTS idx_manifests_port ON manifests(port_of_discharge);

-- Bills of Lading
CREATE TABLE IF NOT EXISTS bills_of_lading (
  id SERIAL PRIMARY KEY,
  manifest_id INTEGER NOT NULL REFERENCES manifests(id),
  bl_number VARCHAR(64) NOT NULL,
  shipper VARCHAR(256) NOT NULL,
  consignee VARCHAR(256) NOT NULL,
  notify_party VARCHAR(256),
  description TEXT NOT NULL,
  hs_code VARCHAR(16),
  weight_kg NUMERIC(12,2),
  num_packages INTEGER,
  container_nos TEXT[],
  status VARCHAR(32) NOT NULL DEFAULT 'ACTIVE',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_bls_manifest_id ON bills_of_lading(manifest_id);
CREATE INDEX IF NOT EXISTS idx_bls_bl_number ON bills_of_lading(bl_number);

-- Valuation References
CREATE TABLE IF NOT EXISTS valuation_references (
  id SERIAL PRIMARY KEY,
  hs_code VARCHAR(10) NOT NULL,
  description TEXT NOT NULL,
  reference_price NUMERIC(14,4) NOT NULL,
  currency VARCHAR(3) NOT NULL DEFAULT 'USD',
  unit VARCHAR(32) NOT NULL DEFAULT 'kg',
  source VARCHAR(128) NOT NULL DEFAULT 'NCS',
  valid_from TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  valid_to TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_valuation_hs_code ON valuation_references(hs_code);

-- CRF Documents
CREATE TABLE IF NOT EXISTS crf_documents (
  id SERIAL PRIMARY KEY,
  crf_number VARCHAR(64) NOT NULL UNIQUE,
  declaration_id INTEGER REFERENCES declarations(id),
  ucr_number VARCHAR(64),
  trader_id INTEGER NOT NULL REFERENCES users(id),
  reporting_period VARCHAR(16) NOT NULL,
  hs_code VARCHAR(16),
  declared_value NUMERIC(14,2),
  currency VARCHAR(3) NOT NULL DEFAULT 'USD',
  country_of_origin VARCHAR(2),
  port_of_entry VARCHAR(64),
  status VARCHAR(32) NOT NULL DEFAULT 'DRAFT',
  submitted_at TIMESTAMPTZ,
  accepted_at TIMESTAMPTZ,
  rejected_at TIMESTAMPTZ,
  rejection_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_crf_trader_id ON crf_documents(trader_id);
CREATE INDEX IF NOT EXISTS idx_crf_status ON crf_documents(status);
CREATE INDEX IF NOT EXISTS idx_crf_period ON crf_documents(reporting_period);

-- Mojaloop Payments (Go service extended table)
CREATE TABLE IF NOT EXISTS mojaloop_payments (
  id SERIAL PRIMARY KEY,
  payment_ref VARCHAR(64) NOT NULL UNIQUE,
  declaration_id INTEGER REFERENCES declarations(id),
  trader_id INTEGER NOT NULL REFERENCES users(id),
  payment_type VARCHAR(32) NOT NULL,
  amount NUMERIC(14,2) NOT NULL,
  currency VARCHAR(3) NOT NULL DEFAULT 'NGN',
  payer_fsp VARCHAR(64) NOT NULL,
  quote_id VARCHAR(64),
  transfer_id VARCHAR(64),
  status VARCHAR(32) NOT NULL DEFAULT 'PENDING',
  completed_at TIMESTAMPTZ,
  failed_at TIMESTAMPTZ,
  failure_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_mj_payments_trader ON mojaloop_payments(trader_id);
CREATE INDEX IF NOT EXISTS idx_mj_payments_status ON mojaloop_payments(status);
CREATE INDEX IF NOT EXISTS idx_mj_payments_declaration ON mojaloop_payments(declaration_id);

-- LPCO Records
CREATE TABLE IF NOT EXISTS lpco_records (
  id SERIAL PRIMARY KEY,
  declaration_id INTEGER NOT NULL REFERENCES declarations(id),
  trader_id INTEGER NOT NULL REFERENCES users(id),
  lpco_type VARCHAR(64) NOT NULL,
  mda VARCHAR(32) NOT NULL,
  reference_number VARCHAR(128) NOT NULL,
  issue_date TIMESTAMPTZ,
  expiry_date TIMESTAMPTZ,
  status VARCHAR(32) NOT NULL DEFAULT 'PENDING',
  validation_status VARCHAR(32) DEFAULT 'UNVALIDATED',
  validation_message TEXT,
  validated_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_lpco_declaration_id ON lpco_records(declaration_id);
CREATE INDEX IF NOT EXISTS idx_lpco_trader_id ON lpco_records(trader_id);
CREATE INDEX IF NOT EXISTS idx_lpco_mda ON lpco_records(mda);
CREATE INDEX IF NOT EXISTS idx_lpco_expiry ON lpco_records(expiry_date);
