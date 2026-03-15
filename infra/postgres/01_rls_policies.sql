-- =============================================================================
-- TradeGateway™ NGSWTP — PostgreSQL Row-Level Security (RLS) Policies
-- =============================================================================
-- Enforces multi-tenant data isolation at the database layer.
-- All application connections use role "app_user" (limited privileges).
-- Service accounts use "service_account" (elevated, bypasses RLS where needed).
-- Admin connections use "admin_user" (full access).
--
-- Apply: psql -U postgres -d tradegateway -f 01_rls_policies.sql
-- =============================================================================

-- ─── Roles ────────────────────────────────────────────────────────────────────
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'app_user') THEN
    CREATE ROLE app_user NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'service_account') THEN
    CREATE ROLE service_account NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'readonly_user') THEN
    CREATE ROLE readonly_user NOLOGIN;
  END IF;
END $$;

-- ─── Current user context helpers ─────────────────────────────────────────────
-- The application sets these at the start of every transaction:
--   SET LOCAL app.current_user_id = '<user-id>';
--   SET LOCAL app.current_role = 'trader|customs_officer|oga_officer|admin';
--   SET LOCAL app.current_trader_id = '<trader-id>';  -- for trader sessions

CREATE OR REPLACE FUNCTION current_app_user_id() RETURNS TEXT AS $$
  SELECT COALESCE(current_setting('app.current_user_id', true), '')
$$ LANGUAGE SQL STABLE SECURITY DEFINER;

CREATE OR REPLACE FUNCTION current_app_role() RETURNS TEXT AS $$
  SELECT COALESCE(current_setting('app.current_role', true), 'anonymous')
$$ LANGUAGE SQL STABLE SECURITY DEFINER;

CREATE OR REPLACE FUNCTION current_app_trader_id() RETURNS TEXT AS $$
  SELECT COALESCE(current_setting('app.current_trader_id', true), '')
$$ LANGUAGE SQL STABLE SECURITY DEFINER;

CREATE OR REPLACE FUNCTION is_admin() RETURNS BOOLEAN AS $$
  SELECT current_app_role() IN ('admin', 'superadmin', 'customs_commissioner')
$$ LANGUAGE SQL STABLE SECURITY DEFINER;

CREATE OR REPLACE FUNCTION is_customs_officer() RETURNS BOOLEAN AS $$
  SELECT current_app_role() IN ('customs_officer', 'customs_supervisor', 'admin')
$$ LANGUAGE SQL STABLE SECURITY DEFINER;

-- =============================================================================
-- DECLARATIONS TABLE — Traders see only their own; officers see all
-- =============================================================================
ALTER TABLE declarations ENABLE ROW LEVEL SECURITY;
ALTER TABLE declarations FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS declarations_trader_select ON declarations;
CREATE POLICY declarations_trader_select ON declarations
  FOR SELECT
  USING (
    is_admin()
    OR is_customs_officer()
    OR trader_id = current_app_trader_id()
    OR current_app_role() = 'oga_officer'
  );

DROP POLICY IF EXISTS declarations_trader_insert ON declarations;
CREATE POLICY declarations_trader_insert ON declarations
  FOR INSERT
  WITH CHECK (
    trader_id = current_app_trader_id()
    OR is_admin()
  );

DROP POLICY IF EXISTS declarations_trader_update ON declarations;
CREATE POLICY declarations_trader_update ON declarations
  FOR UPDATE
  USING (
    is_customs_officer()
    OR is_admin()
    OR (trader_id = current_app_trader_id() AND status = 'draft')
  );

-- =============================================================================
-- USERS TABLE — Users see only their own profile; admins see all
-- =============================================================================
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE users FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS users_self_select ON users;
CREATE POLICY users_self_select ON users
  FOR SELECT
  USING (
    is_admin()
    OR open_id = current_app_user_id()
  );

DROP POLICY IF EXISTS users_self_update ON users;
CREATE POLICY users_self_update ON users
  FOR UPDATE
  USING (open_id = current_app_user_id() OR is_admin());

-- =============================================================================
-- TRADER PROFILES — Traders see only their own; officers see all
-- =============================================================================
ALTER TABLE trader_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE trader_profiles FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS trader_profiles_select ON trader_profiles;
CREATE POLICY trader_profiles_select ON trader_profiles
  FOR SELECT
  USING (
    is_admin()
    OR is_customs_officer()
    OR user_id::text = current_app_user_id()
  );

DROP POLICY IF EXISTS trader_profiles_insert ON trader_profiles;
CREATE POLICY trader_profiles_insert ON trader_profiles
  FOR INSERT
  WITH CHECK (user_id::text = current_app_user_id() OR is_admin());

DROP POLICY IF EXISTS trader_profiles_update ON trader_profiles;
CREATE POLICY trader_profiles_update ON trader_profiles
  FOR UPDATE
  USING (user_id::text = current_app_user_id() OR is_admin());

-- =============================================================================
-- DOCUMENTS — Owners see their own; officers see all
-- =============================================================================
ALTER TABLE documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE documents FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS documents_select ON documents;
CREATE POLICY documents_select ON documents
  FOR SELECT
  USING (
    is_admin()
    OR is_customs_officer()
    OR uploaded_by::text = current_app_user_id()
  );

DROP POLICY IF EXISTS documents_insert ON documents;
CREATE POLICY documents_insert ON documents
  FOR INSERT
  WITH CHECK (uploaded_by::text = current_app_user_id() OR is_admin());

-- =============================================================================
-- PAYMENTS — Traders see only their own payments
-- =============================================================================
ALTER TABLE payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE payments FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS payments_select ON payments;
CREATE POLICY payments_select ON payments
  FOR SELECT
  USING (
    is_admin()
    OR is_customs_officer()
    OR trader_id = current_app_trader_id()
  );

-- =============================================================================
-- AUDIT LOGS — Append-only; admins and officers can read; no one can delete
-- =============================================================================
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS audit_logs_select ON audit_logs;
CREATE POLICY audit_logs_select ON audit_logs
  FOR SELECT
  USING (is_admin() OR is_customs_officer());

DROP POLICY IF EXISTS audit_logs_insert ON audit_logs;
CREATE POLICY audit_logs_insert ON audit_logs
  FOR INSERT
  WITH CHECK (true);  -- All authenticated sessions can insert audit events

-- Prevent deletion of audit logs (immutable audit trail)
DROP POLICY IF EXISTS audit_logs_no_delete ON audit_logs;
CREATE POLICY audit_logs_no_delete ON audit_logs
  FOR DELETE
  USING (false);  -- Nobody can delete audit logs

-- =============================================================================
-- NOTIFICATIONS — Users see only their own
-- =============================================================================
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS notifications_select ON notifications;
CREATE POLICY notifications_select ON notifications
  FOR SELECT
  USING (user_id::text = current_app_user_id() OR is_admin());

DROP POLICY IF EXISTS notifications_update ON notifications;
CREATE POLICY notifications_update ON notifications
  FOR UPDATE
  USING (user_id::text = current_app_user_id() OR is_admin());

-- =============================================================================
-- CARGO TRACKING — Traders see their own cargo; officers see all
-- =============================================================================
ALTER TABLE cargo_tracking ENABLE ROW LEVEL SECURITY;
ALTER TABLE cargo_tracking FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS cargo_tracking_select ON cargo_tracking;
CREATE POLICY cargo_tracking_select ON cargo_tracking
  FOR SELECT
  USING (
    is_admin()
    OR is_customs_officer()
    OR current_app_role() = 'port_operator'
    OR EXISTS (
      SELECT 1 FROM declarations d
      WHERE d.id = cargo_tracking.declaration_id
        AND d.trader_id = current_app_trader_id()
    )
  );

-- =============================================================================
-- AEO APPLICATIONS — Traders see their own; admins see all
-- =============================================================================
ALTER TABLE aeo_applications ENABLE ROW LEVEL SECURITY;
ALTER TABLE aeo_applications FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS aeo_applications_select ON aeo_applications;
CREATE POLICY aeo_applications_select ON aeo_applications
  FOR SELECT
  USING (
    is_admin()
    OR is_customs_officer()
    OR trader_id = current_app_trader_id()
  );

-- =============================================================================
-- FRAUD CASES — Officers and admins only; no trader access
-- =============================================================================
ALTER TABLE fraud_cases ENABLE ROW LEVEL SECURITY;
ALTER TABLE fraud_cases FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS fraud_cases_select ON fraud_cases;
CREATE POLICY fraud_cases_select ON fraud_cases
  FOR SELECT
  USING (is_admin() OR is_customs_officer());

DROP POLICY IF EXISTS fraud_cases_insert ON fraud_cases;
CREATE POLICY fraud_cases_insert ON fraud_cases
  FOR INSERT
  WITH CHECK (is_admin() OR is_customs_officer());

-- =============================================================================
-- SANCTIONS SCREENING RESULTS — Officers and admins only
-- =============================================================================
ALTER TABLE sanctions_results ENABLE ROW LEVEL SECURITY;
ALTER TABLE sanctions_results FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS sanctions_results_select ON sanctions_results;
CREATE POLICY sanctions_results_select ON sanctions_results
  FOR SELECT
  USING (is_admin() OR is_customs_officer());

-- =============================================================================
-- GRANT PRIVILEGES
-- =============================================================================
GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA public TO app_user;
GRANT ALL ON ALL TABLES IN SCHEMA public TO service_account;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO readonly_user;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO app_user;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO service_account;

-- Service account bypasses RLS (needed for background jobs, cron tasks)
ALTER ROLE service_account BYPASSRLS;

COMMENT ON FUNCTION current_app_user_id() IS 'Returns the current authenticated user ID from session context';
COMMENT ON FUNCTION current_app_role() IS 'Returns the current user role from session context';
COMMENT ON FUNCTION is_admin() IS 'Returns true if the current session has admin privileges';
