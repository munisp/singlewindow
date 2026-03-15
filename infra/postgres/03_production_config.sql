-- =============================================================================
-- TradeGateway™ NGSWTP — PostgreSQL Production Configuration
-- =============================================================================
-- Run as superuser after cluster initialization.
-- Configures: connection limits, statement timeouts, pg_stat_statements,
-- pg_cron for partition maintenance, logical replication for read replicas.
-- =============================================================================

-- ─── Extensions ───────────────────────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS pg_stat_statements;
CREATE EXTENSION IF NOT EXISTS pg_trgm;          -- Fuzzy text search (sanctions screening)
CREATE EXTENSION IF NOT EXISTS btree_gin;         -- GIN indexes on scalar types
CREATE EXTENSION IF NOT EXISTS pgcrypto;          -- gen_random_uuid(), crypt()
CREATE EXTENSION IF NOT EXISTS pg_cron;           -- Scheduled partition maintenance
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";       -- uuid_generate_v4()
CREATE EXTENSION IF NOT EXISTS unaccent;          -- Accent-insensitive search

-- ─── Connection Limits per Role ───────────────────────────────────────────────
ALTER ROLE app_user CONNECTION LIMIT 200;
ALTER ROLE service_account CONNECTION LIMIT 50;
ALTER ROLE readonly_user CONNECTION LIMIT 30;

-- ─── Statement Timeouts ───────────────────────────────────────────────────────
-- Prevent runaway queries from blocking the system
ALTER ROLE app_user SET statement_timeout = '30s';
ALTER ROLE service_account SET statement_timeout = '120s';
ALTER ROLE readonly_user SET statement_timeout = '60s';

-- Lock timeout prevents deadlock cascades
ALTER ROLE app_user SET lock_timeout = '5s';
ALTER ROLE service_account SET lock_timeout = '10s';

-- Idle transaction timeout (prevents connection leaks)
ALTER ROLE app_user SET idle_in_transaction_session_timeout = '60s';
ALTER ROLE service_account SET idle_in_transaction_session_timeout = '300s';

-- ─── Work Memory (per sort/hash operation) ────────────────────────────────────
ALTER ROLE app_user SET work_mem = '16MB';
ALTER ROLE service_account SET work_mem = '64MB';
ALTER ROLE readonly_user SET work_mem = '32MB';

-- ─── Scheduled Partition Maintenance via pg_cron ──────────────────────────────
-- Run partition maintenance on the 1st of each month at 02:00 UTC
SELECT cron.schedule(
  'monthly-partition-maintenance',
  '0 2 1 * *',
  'SELECT maintain_partitions()'
);

-- Vacuum and analyze high-volume tables daily at 03:00 UTC
SELECT cron.schedule(
  'daily-vacuum-declarations',
  '0 3 * * *',
  'VACUUM ANALYZE declarations, audit_logs, cargo_tracking, payments, notifications'
);

-- ─── Logical Replication for Read Replicas ────────────────────────────────────
-- Enable on primary only:
-- ALTER SYSTEM SET wal_level = 'logical';
-- ALTER SYSTEM SET max_replication_slots = 10;
-- ALTER SYSTEM SET max_wal_senders = 10;

-- Create publication for all tables (read replica sync):
CREATE PUBLICATION IF NOT EXISTS tradegateway_pub FOR ALL TABLES;

-- ─── Audit Trigger Function ───────────────────────────────────────────────────
-- Automatically records all INSERT/UPDATE/DELETE on sensitive tables
CREATE OR REPLACE FUNCTION audit_trigger_fn() RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO audit_logs (
    user_id, action, entity_type, entity_id,
    old_values, new_values, ip_address, created_at
  ) VALUES (
    current_app_user_id(),
    TG_OP,
    TG_TABLE_NAME,
    CASE TG_OP
      WHEN 'DELETE' THEN OLD.id::text
      ELSE NEW.id::text
    END,
    CASE TG_OP WHEN 'INSERT' THEN NULL ELSE TO_JSONB(OLD) END,
    CASE TG_OP WHEN 'DELETE' THEN NULL ELSE TO_JSONB(NEW) END,
    COALESCE(current_setting('app.client_ip', true), 'unknown'),
    NOW()
  );
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Apply audit trigger to sensitive tables:
DROP TRIGGER IF EXISTS audit_declarations ON declarations;
CREATE TRIGGER audit_declarations
  AFTER INSERT OR UPDATE OR DELETE ON declarations
  FOR EACH ROW EXECUTE FUNCTION audit_trigger_fn();

DROP TRIGGER IF EXISTS audit_payments ON payments;
CREATE TRIGGER audit_payments
  AFTER INSERT OR UPDATE OR DELETE ON payments
  FOR EACH ROW EXECUTE FUNCTION audit_trigger_fn();

DROP TRIGGER IF EXISTS audit_trader_profiles ON trader_profiles;
CREATE TRIGGER audit_trader_profiles
  AFTER INSERT OR UPDATE OR DELETE ON trader_profiles
  FOR EACH ROW EXECUTE FUNCTION audit_trigger_fn();

DROP TRIGGER IF EXISTS audit_aeo_applications ON aeo_applications;
CREATE TRIGGER audit_aeo_applications
  AFTER INSERT OR UPDATE OR DELETE ON aeo_applications
  FOR EACH ROW EXECUTE FUNCTION audit_trigger_fn();

DROP TRIGGER IF EXISTS audit_fraud_cases ON fraud_cases;
CREATE TRIGGER audit_fraud_cases
  AFTER INSERT OR UPDATE OR DELETE ON fraud_cases
  FOR EACH ROW EXECUTE FUNCTION audit_trigger_fn();

-- ─── Immutable Audit Log Protection ──────────────────────────────────────────
-- Prevent UPDATE and DELETE on audit_logs at the trigger level (belt and suspenders)
CREATE OR REPLACE FUNCTION prevent_audit_modification() RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'Audit logs are immutable and cannot be modified or deleted';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS protect_audit_logs ON audit_logs;
CREATE TRIGGER protect_audit_logs
  BEFORE UPDATE OR DELETE ON audit_logs
  FOR EACH ROW EXECUTE FUNCTION prevent_audit_modification();

-- ─── Updated_at Auto-update Trigger ───────────────────────────────────────────
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply to all tables with updated_at column:
DO $$
DECLARE
  tbl TEXT;
BEGIN
  FOR tbl IN
    SELECT table_name FROM information_schema.columns
    WHERE table_schema = 'public'
      AND column_name = 'updated_at'
      AND table_name NOT LIKE '%_2026_%'
      AND table_name NOT LIKE '%_2027_%'
  LOOP
    EXECUTE FORMAT(
      'DROP TRIGGER IF EXISTS set_updated_at ON %I;
       CREATE TRIGGER set_updated_at BEFORE UPDATE ON %I
       FOR EACH ROW EXECUTE FUNCTION set_updated_at()',
      tbl, tbl
    );
  END LOOP;
END $$;

-- ─── PgBouncer Connection Pooling Config (reference) ─────────────────────────
-- Deploy PgBouncer in transaction pooling mode:
-- pool_mode = transaction
-- max_client_conn = 1000
-- default_pool_size = 25
-- min_pool_size = 5
-- reserve_pool_size = 5
-- reserve_pool_timeout = 3
-- server_idle_timeout = 600
-- client_idle_timeout = 0
-- server_lifetime = 3600

COMMENT ON TABLE audit_logs IS 'Immutable audit trail — append-only, partitioned by month';
COMMENT ON TABLE declarations IS 'Customs declarations — partitioned by created_at month';
COMMENT ON FUNCTION maintain_partitions() IS 'Call monthly to pre-create next 2 months of partitions';
COMMENT ON FUNCTION audit_trigger_fn() IS 'Automatic audit trail trigger — applied to all sensitive tables';
