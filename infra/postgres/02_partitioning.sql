-- =============================================================================
-- TradeGateway™ NGSWTP — PostgreSQL Table Partitioning
-- =============================================================================
-- Partitions high-volume tables by time to maintain query performance at scale.
-- Estimated volumes at steady state:
--   audit_logs:      ~500K rows/day
--   cargo_events:    ~200K rows/day
--   declarations:    ~50K rows/day
--   risk_scores:     ~50K rows/day
--   notifications:   ~100K rows/day
--
-- Strategy: RANGE partitioning by month on created_at / event_time
-- Retention: 24 months online, archive to Delta Lake after 6 months
-- Apply: psql -U postgres -d tradegateway -f 02_partitioning.sql
-- =============================================================================

-- ─── Audit Logs Partitioning ──────────────────────────────────────────────────
-- Convert audit_logs to partitioned table (requires data migration in prod)
-- In a fresh deployment, create directly as partitioned:

DO $$
BEGIN
  -- Check if audit_logs is already partitioned
  IF NOT EXISTS (
    SELECT 1 FROM pg_partitioned_table pt
    JOIN pg_class c ON c.oid = pt.partrelid
    WHERE c.relname = 'audit_logs'
  ) THEN
    RAISE NOTICE 'audit_logs is not partitioned. Run migration script to convert.';
  END IF;
END $$;

-- Create monthly partitions for audit_logs (2026-2028)
CREATE TABLE IF NOT EXISTS audit_logs_2026_01 PARTITION OF audit_logs
  FOR VALUES FROM ('2026-01-01') TO ('2026-02-01');
CREATE TABLE IF NOT EXISTS audit_logs_2026_02 PARTITION OF audit_logs
  FOR VALUES FROM ('2026-02-01') TO ('2026-03-01');
CREATE TABLE IF NOT EXISTS audit_logs_2026_03 PARTITION OF audit_logs
  FOR VALUES FROM ('2026-03-01') TO ('2026-04-01');
CREATE TABLE IF NOT EXISTS audit_logs_2026_04 PARTITION OF audit_logs
  FOR VALUES FROM ('2026-04-01') TO ('2026-05-01');
CREATE TABLE IF NOT EXISTS audit_logs_2026_05 PARTITION OF audit_logs
  FOR VALUES FROM ('2026-05-01') TO ('2026-06-01');
CREATE TABLE IF NOT EXISTS audit_logs_2026_06 PARTITION OF audit_logs
  FOR VALUES FROM ('2026-06-01') TO ('2026-07-01');
CREATE TABLE IF NOT EXISTS audit_logs_2026_07 PARTITION OF audit_logs
  FOR VALUES FROM ('2026-07-01') TO ('2026-08-01');
CREATE TABLE IF NOT EXISTS audit_logs_2026_08 PARTITION OF audit_logs
  FOR VALUES FROM ('2026-08-01') TO ('2026-09-01');
CREATE TABLE IF NOT EXISTS audit_logs_2026_09 PARTITION OF audit_logs
  FOR VALUES FROM ('2026-09-01') TO ('2026-10-01');
CREATE TABLE IF NOT EXISTS audit_logs_2026_10 PARTITION OF audit_logs
  FOR VALUES FROM ('2026-10-01') TO ('2026-11-01');
CREATE TABLE IF NOT EXISTS audit_logs_2026_11 PARTITION OF audit_logs
  FOR VALUES FROM ('2026-11-01') TO ('2026-12-01');
CREATE TABLE IF NOT EXISTS audit_logs_2026_12 PARTITION OF audit_logs
  FOR VALUES FROM ('2026-12-01') TO ('2027-01-01');
CREATE TABLE IF NOT EXISTS audit_logs_2027_01 PARTITION OF audit_logs
  FOR VALUES FROM ('2027-01-01') TO ('2027-02-01');
CREATE TABLE IF NOT EXISTS audit_logs_2027_02 PARTITION OF audit_logs
  FOR VALUES FROM ('2027-02-01') TO ('2027-03-01');
CREATE TABLE IF NOT EXISTS audit_logs_2027_03 PARTITION OF audit_logs
  FOR VALUES FROM ('2027-03-01') TO ('2027-04-01');
CREATE TABLE IF NOT EXISTS audit_logs_2027_04 PARTITION OF audit_logs
  FOR VALUES FROM ('2027-04-01') TO ('2027-05-01');
CREATE TABLE IF NOT EXISTS audit_logs_2027_05 PARTITION OF audit_logs
  FOR VALUES FROM ('2027-05-01') TO ('2027-06-01');
CREATE TABLE IF NOT EXISTS audit_logs_2027_06 PARTITION OF audit_logs
  FOR VALUES FROM ('2027-06-01') TO ('2027-07-01');
CREATE TABLE IF NOT EXISTS audit_logs_2027_07 PARTITION OF audit_logs
  FOR VALUES FROM ('2027-07-01') TO ('2027-08-01');
CREATE TABLE IF NOT EXISTS audit_logs_2027_08 PARTITION OF audit_logs
  FOR VALUES FROM ('2027-08-01') TO ('2027-09-01');
CREATE TABLE IF NOT EXISTS audit_logs_2027_09 PARTITION OF audit_logs
  FOR VALUES FROM ('2027-09-01') TO ('2027-10-01');
CREATE TABLE IF NOT EXISTS audit_logs_2027_10 PARTITION OF audit_logs
  FOR VALUES FROM ('2027-10-01') TO ('2027-11-01');
CREATE TABLE IF NOT EXISTS audit_logs_2027_11 PARTITION OF audit_logs
  FOR VALUES FROM ('2027-11-01') TO ('2027-12-01');
CREATE TABLE IF NOT EXISTS audit_logs_2027_12 PARTITION OF audit_logs
  FOR VALUES FROM ('2027-12-01') TO ('2028-01-01');

-- ─── Automatic Partition Creation Function ────────────────────────────────────
CREATE OR REPLACE FUNCTION create_monthly_partition(
  parent_table TEXT,
  partition_date DATE
) RETURNS VOID AS $$
DECLARE
  partition_name TEXT;
  start_date DATE;
  end_date DATE;
BEGIN
  start_date := DATE_TRUNC('month', partition_date);
  end_date := start_date + INTERVAL '1 month';
  partition_name := parent_table || '_' || TO_CHAR(start_date, 'YYYY_MM');

  IF NOT EXISTS (
    SELECT 1 FROM pg_class WHERE relname = partition_name
  ) THEN
    EXECUTE FORMAT(
      'CREATE TABLE %I PARTITION OF %I FOR VALUES FROM (%L) TO (%L)',
      partition_name, parent_table, start_date, end_date
    );
    RAISE NOTICE 'Created partition: %', partition_name;
  END IF;
END;
$$ LANGUAGE plpgsql;

-- ─── Scheduled Partition Maintenance ─────────────────────────────────────────
-- Call this monthly via pg_cron or external scheduler:
CREATE OR REPLACE FUNCTION maintain_partitions() RETURNS VOID AS $$
DECLARE
  next_month DATE := DATE_TRUNC('month', NOW()) + INTERVAL '1 month';
  month_after DATE := next_month + INTERVAL '1 month';
BEGIN
  -- Pre-create 2 months ahead for all partitioned tables
  PERFORM create_monthly_partition('audit_logs', next_month);
  PERFORM create_monthly_partition('audit_logs', month_after);
  PERFORM create_monthly_partition('cargo_events', next_month);
  PERFORM create_monthly_partition('cargo_events', month_after);
  PERFORM create_monthly_partition('risk_score_history', next_month);
  PERFORM create_monthly_partition('risk_score_history', month_after);
  RAISE NOTICE 'Partition maintenance complete for % and %', next_month, month_after;
END;
$$ LANGUAGE plpgsql;

-- ─── Performance Indexes on Partitioned Tables ────────────────────────────────
-- These are created on the parent and inherited by all partitions:
CREATE INDEX IF NOT EXISTS idx_audit_logs_user_created
  ON audit_logs (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_audit_logs_entity
  ON audit_logs (entity_type, entity_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_audit_logs_action
  ON audit_logs (action, created_at DESC);

-- ─── Declarations Performance Indexes ────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_declarations_trader_status
  ON declarations (trader_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_declarations_ucr
  ON declarations (ucr) WHERE ucr IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_declarations_hs_code
  ON declarations (hs_code, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_declarations_status_created
  ON declarations (status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_declarations_port_of_entry
  ON declarations (port_of_entry, status);

CREATE INDEX IF NOT EXISTS idx_declarations_risk_lane
  ON declarations (risk_lane, created_at DESC) WHERE risk_lane IS NOT NULL;

-- Full-text search on goods description
CREATE INDEX IF NOT EXISTS idx_declarations_goods_fts
  ON declarations USING GIN (to_tsvector('english', COALESCE(goods_description, '')));

-- ─── Users and Profiles Indexes ───────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_users_open_id ON users (open_id);
CREATE INDEX IF NOT EXISTS idx_users_email ON users (email) WHERE email IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_users_role ON users (role);

CREATE INDEX IF NOT EXISTS idx_trader_profiles_user_id ON trader_profiles (user_id);
CREATE INDEX IF NOT EXISTS idx_trader_profiles_tin ON trader_profiles (tin) WHERE tin IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_trader_profiles_status ON trader_profiles (status);

-- ─── Payments Indexes ─────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_payments_declaration_id ON payments (declaration_id);
CREATE INDEX IF NOT EXISTS idx_payments_trader_id ON payments (trader_id);
CREATE INDEX IF NOT EXISTS idx_payments_status ON payments (status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_payments_reference ON payments (payment_reference) WHERE payment_reference IS NOT NULL;

-- ─── Documents Indexes ────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_documents_declaration_id ON documents (declaration_id);
CREATE INDEX IF NOT EXISTS idx_documents_uploaded_by ON documents (uploaded_by);
CREATE INDEX IF NOT EXISTS idx_documents_type ON documents (document_type);

-- ─── Cargo Tracking Indexes ───────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_cargo_tracking_declaration ON cargo_tracking (declaration_id);
CREATE INDEX IF NOT EXISTS idx_cargo_tracking_ucr ON cargo_tracking (ucr) WHERE ucr IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_cargo_tracking_container ON cargo_tracking (container_number) WHERE container_number IS NOT NULL;

-- ─── Notifications Indexes ────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_notifications_user_unread
  ON notifications (user_id, created_at DESC) WHERE is_read = false;

CREATE INDEX IF NOT EXISTS idx_notifications_user_created
  ON notifications (user_id, created_at DESC);

-- ─── AEO Indexes ──────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_aeo_applications_trader ON aeo_applications (trader_id);
CREATE INDEX IF NOT EXISTS idx_aeo_applications_status ON aeo_applications (status);
CREATE INDEX IF NOT EXISTS idx_aeo_certificates_number ON aeo_certificates (certificate_number);
CREATE INDEX IF NOT EXISTS idx_aeo_certificates_expiry ON aeo_certificates (expiry_date) WHERE status = 'active';

-- ─── Fraud Cases Indexes ──────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_fraud_cases_status ON fraud_cases (status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_fraud_cases_trader ON fraud_cases (trader_id) WHERE trader_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_fraud_cases_risk_score ON fraud_cases (risk_score DESC);

-- ─── OGA Integrations Indexes ─────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_oga_requests_declaration ON oga_requests (declaration_id);
CREATE INDEX IF NOT EXISTS idx_oga_requests_agency_status ON oga_requests (agency_code, status);
CREATE INDEX IF NOT EXISTS idx_oga_requests_pending
  ON oga_requests (agency_code, created_at) WHERE status = 'pending';

-- ─── Sanctions Results Indexes ────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_sanctions_results_declaration ON sanctions_results (declaration_id);
CREATE INDEX IF NOT EXISTS idx_sanctions_results_hit ON sanctions_results (is_hit, created_at DESC) WHERE is_hit = true;

RAISE NOTICE 'All indexes and partitions created successfully';
