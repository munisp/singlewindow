-- =============================================================================
-- TradeGateway™ NGSWTP — Additional Production Indexes
-- =============================================================================
-- These indexes optimize the most common query patterns across the platform.
-- Run after the initial schema migration (drizzle-kit migrate).
-- All indexes use CONCURRENTLY to avoid locking in production.
-- =============================================================================

-- ─── Payments ─────────────────────────────────────────────────────────────────
-- Trader payment history dashboard (most common query)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_pay_trader_status_created
  ON payments (trader_id, status, created_at DESC);

-- Payment status monitoring
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_pay_status_created
  ON payments (status, created_at DESC);

-- TigerBeetle account lookup
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_pay_tigerbeetle_account
  ON payments (tigerbeetle_account_id)
  WHERE tigerbeetle_account_id IS NOT NULL;

-- Mojaloop transfer lookup
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_pay_mojaloop_transfer
  ON payments (mojaloop_transfer_id)
  WHERE mojaloop_transfer_id IS NOT NULL;

-- ─── Audit Events ─────────────────────────────────────────────────────────────
-- Actor-based audit trail (who did what)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_ae_actor_created
  ON audit_events (actor_id, created_at DESC)
  WHERE actor_id IS NOT NULL;

-- Time-range queries for compliance reporting
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_ae_created_at
  ON audit_events (created_at DESC);

-- Action-based filtering
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_ae_action
  ON audit_events (action, created_at DESC);

-- ─── User Notifications ───────────────────────────────────────────────────────
-- Notification feed (user + unread + time)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_un_user_read_created
  ON user_notifications (user_id, is_read, created_at DESC);

-- ─── Declarations ─────────────────────────────────────────────────────────────
-- Time-range analytics
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_decl_created_at
  ON declarations (created_at DESC);

-- HS code analysis
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_decl_hs_code
  ON declarations (hs_code)
  WHERE hs_code IS NOT NULL;

-- Country of origin analysis
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_decl_country_origin
  ON declarations (country_of_origin)
  WHERE country_of_origin IS NOT NULL;

-- ─── OGA Permits ──────────────────────────────────────────────────────────────
-- Multi-agency permit lookup per declaration
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_oga_decl_status
  ON oga_permits (declaration_id, status);

-- Agency workload monitoring
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_oga_agency_status
  ON oga_permits (agency_code, status, created_at DESC);

-- ─── KYC Verifications ────────────────────────────────────────────────────────
-- Onboarding status check
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_kyc_ver_user_status
  ON kyc_verifications (user_id, status, created_at DESC);

-- ─── OpenAppSec WAF Events ────────────────────────────────────────────────────
-- WAF dashboard time + severity filter
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_waf_created_severity
  ON open_appsec_events (created_at DESC, severity);

-- Unacknowledged events filter
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_waf_unacknowledged
  ON open_appsec_events (is_acknowledged, created_at DESC)
  WHERE is_acknowledged = false;

-- Source IP lookup
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_waf_source_ip
  ON open_appsec_events (source_ip, created_at DESC);

-- ─── Lakehouse Jobs ───────────────────────────────────────────────────────────
-- Job monitoring dashboard
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_lh_status_created
  ON lakehouse_jobs (status, created_at DESC);

-- Job type filter
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_lh_job_type
  ON lakehouse_jobs (job_type, created_at DESC);

-- ─── Fluvio Topic Offsets ─────────────────────────────────────────────────────
-- Consumer lag monitoring
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_fluvio_topic_group
  ON fluvio_topic_offsets (topic, consumer_group);

-- ─── Temporal Workflows ───────────────────────────────────────────────────────
-- Active workflow lookup
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_temporal_wf_status_started
  ON temporal_workflows (status, start_time DESC);

-- ─── Stakeholder Profiles ─────────────────────────────────────────────────────
-- Organization code lookup (for trader onboarding)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_sp_org_code
  ON stakeholder_profiles (organization_code)
  WHERE organization_code IS NOT NULL;

-- Tax ID lookup
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_sp_tax_id
  ON stakeholder_profiles (tax_id)
  WHERE tax_id IS NOT NULL;

-- ─── Fraud Cases ──────────────────────────────────────────────────────────────
-- Active fraud case monitoring
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_fraud_status_created
  ON fraud_cases (status, created_at DESC);

-- ─── Risk Scan Results ────────────────────────────────────────────────────────
-- Nightly scan history
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_risk_scan_created
  ON risk_scan_results (created_at DESC);

-- ─── Sanctions Checks ─────────────────────────────────────────────────────────
-- Sanctions hit monitoring
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_sanctions_hit_created
  ON sanctions_checks (is_hit, created_at DESC);

ANALYZE;
