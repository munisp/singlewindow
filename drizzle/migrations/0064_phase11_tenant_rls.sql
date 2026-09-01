-- Phase-11 remediation: RLS for the multi-tenancy plane, document vault and
-- consent evidence. These tables previously had ZERO policies — isolation
-- rested solely on app-level checks (routers/tenant.ts requireTenantMembership),
-- so one missed check in any future procedure = cross-tenant read/write.
-- tenant_keycloak_config holds realm secrets/role mappings (highest blast
-- radius), so it is the most restrictive policy set below.
--
-- Pattern: follows 0052_phase6_rls.sql — ENABLE + FORCE ROW LEVEL SECURITY,
-- DROP POLICY IF EXISTS before every CREATE POLICY (idempotent), helper
-- functions reading transaction-scoped GUCs.
--
-- APP-ROLE REQUIREMENT (unchanged from 0052): the runtime database role must
-- NOT be a superuser and must NOT have BYPASSRLS, or these policies are
-- silently ignored. Provision with NOBYPASSRLS (see 0052 header).
--
-- TENANT CONTEXT: tenant-scoped paths set the tenant GUC transaction-locally:
--   SELECT set_config('app.current_tenant_id', '<tenant-uuid>', true);
-- withRlsContext (server/db.ts) accepts an optional tenantId and sets it.
-- Platform-level roles (admin/superadmin/customs_commissioner via is_admin(),
-- or the dedicated 'platform_admin' app role) bypass tenant restriction
-- explicitly — that distinction is deliberate: tenant officers are NOT
-- platform-wide, platform admins ARE.

-- ─── Tenant context helpers ─────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION current_app_tenant_id() RETURNS TEXT AS $$
  SELECT COALESCE(current_setting('app.current_tenant_id', true), '')
$$ LANGUAGE SQL STABLE SECURITY DEFINER;

CREATE OR REPLACE FUNCTION is_platform_admin() RETURNS BOOLEAN AS $$
  SELECT current_app_role() IN ('platform_admin', 'admin', 'superadmin', 'customs_commissioner')
$$ LANGUAGE SQL STABLE SECURITY DEFINER;

-- =============================================================================
-- TENANTS — a tenant row is visible to platform admins, to sessions carrying
-- that tenant's GUC, and to users with a membership row. Writes: platform
-- admin, or the tenant's own session (tenant-admin ops stay gated app-level
-- by requireTenantMembership).
-- =============================================================================
ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenants FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenants_select ON tenants;
CREATE POLICY tenants_select ON tenants
  FOR SELECT
  USING (
    is_platform_admin()
    OR id::text = current_app_tenant_id()
    OR EXISTS (
      SELECT 1 FROM tenant_users tu
      WHERE tu.tenant_id = tenants.id
        AND tu.user_id::text = current_app_user_id()
    )
  );

DROP POLICY IF EXISTS tenants_insert ON tenants;
CREATE POLICY tenants_insert ON tenants
  FOR INSERT
  WITH CHECK (is_platform_admin());

DROP POLICY IF EXISTS tenants_update ON tenants;
CREATE POLICY tenants_update ON tenants
  FOR UPDATE
  USING (is_platform_admin() OR id::text = current_app_tenant_id());

DROP POLICY IF EXISTS tenants_delete ON tenants;
CREATE POLICY tenants_delete ON tenants
  FOR DELETE
  USING (is_platform_admin());

-- =============================================================================
-- TENANT_USERS — membership rows. Visible to platform admins, the member
-- themselves, and sessions scoped to that tenant. Writable by platform admin
-- or the tenant-scoped session (app-level role checks still apply).
-- =============================================================================
ALTER TABLE tenant_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_users FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_users_select ON tenant_users;
CREATE POLICY tenant_users_select ON tenant_users
  FOR SELECT
  USING (
    is_platform_admin()
    OR user_id::text = current_app_user_id()
    OR tenant_id::text = current_app_tenant_id()
  );

DROP POLICY IF EXISTS tenant_users_insert ON tenant_users;
CREATE POLICY tenant_users_insert ON tenant_users
  FOR INSERT
  WITH CHECK (is_platform_admin() OR tenant_id::text = current_app_tenant_id());

DROP POLICY IF EXISTS tenant_users_update ON tenant_users;
CREATE POLICY tenant_users_update ON tenant_users
  FOR UPDATE
  USING (is_platform_admin() OR tenant_id::text = current_app_tenant_id());

DROP POLICY IF EXISTS tenant_users_delete ON tenant_users;
CREATE POLICY tenant_users_delete ON tenant_users
  FOR DELETE
  USING (is_platform_admin() OR tenant_id::text = current_app_tenant_id());

-- =============================================================================
-- TENANT_KEYCLOAK_CONFIG — realm secrets + role mappings. DEFAULT DENY except
-- platform admin or the tenant-scoped session (the login discovery path must
-- set app.current_tenant_id). Never member-readable: secrets stay server-side.
-- =============================================================================
ALTER TABLE tenant_keycloak_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_keycloak_config FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_kc_select ON tenant_keycloak_config;
CREATE POLICY tenant_kc_select ON tenant_keycloak_config
  FOR SELECT
  USING (is_platform_admin() OR tenant_id::text = current_app_tenant_id());

DROP POLICY IF EXISTS tenant_kc_insert ON tenant_keycloak_config;
CREATE POLICY tenant_kc_insert ON tenant_keycloak_config
  FOR INSERT
  WITH CHECK (is_platform_admin());

DROP POLICY IF EXISTS tenant_kc_update ON tenant_keycloak_config;
CREATE POLICY tenant_kc_update ON tenant_keycloak_config
  FOR UPDATE
  USING (is_platform_admin() OR tenant_id::text = current_app_tenant_id());

DROP POLICY IF EXISTS tenant_kc_delete ON tenant_keycloak_config;
CREATE POLICY tenant_kc_delete ON tenant_keycloak_config
  FOR DELETE
  USING (is_platform_admin());

-- =============================================================================
-- TENANT_BRANDING — white-label config. Read: platform admin or the tenant's
-- own session (the on-demand-TLS/hostname path sets the tenant GUC). Write:
-- platform admin or tenant-scoped session.
-- =============================================================================
ALTER TABLE tenant_branding ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_branding FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_branding_select ON tenant_branding;
CREATE POLICY tenant_branding_select ON tenant_branding
  FOR SELECT
  USING (is_platform_admin() OR tenant_id::text = current_app_tenant_id());

DROP POLICY IF EXISTS tenant_branding_insert ON tenant_branding;
CREATE POLICY tenant_branding_insert ON tenant_branding
  FOR INSERT
  WITH CHECK (is_platform_admin() OR tenant_id::text = current_app_tenant_id());

DROP POLICY IF EXISTS tenant_branding_update ON tenant_branding;
CREATE POLICY tenant_branding_update ON tenant_branding
  FOR UPDATE
  USING (is_platform_admin() OR tenant_id::text = current_app_tenant_id());

DROP POLICY IF EXISTS tenant_branding_delete ON tenant_branding;
CREATE POLICY tenant_branding_delete ON tenant_branding
  FOR DELETE
  USING (is_platform_admin());

-- =============================================================================
-- DOCUMENT_VAULT — owner-only by default; officers see documents explicitly
-- shared with their function; platform admin sees all. No tenant GUC here —
-- isolation is per-owner with role-scoped sharing, mirroring access_level.
-- =============================================================================
ALTER TABLE document_vault ENABLE ROW LEVEL SECURITY;
ALTER TABLE document_vault FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS document_vault_select ON document_vault;
CREATE POLICY document_vault_select ON document_vault
  FOR SELECT
  USING (
    is_platform_admin()
    OR owner_id::text = current_app_user_id()
    OR (is_customs_officer() AND access_level IN ('shared_with_customs', 'public'))
    OR (current_app_role() = 'oga_officer' AND access_level IN ('shared_with_oga', 'public'))
  );

DROP POLICY IF EXISTS document_vault_insert ON document_vault;
CREATE POLICY document_vault_insert ON document_vault
  FOR INSERT
  WITH CHECK (owner_id::text = current_app_user_id() OR is_platform_admin());

DROP POLICY IF EXISTS document_vault_update ON document_vault;
CREATE POLICY document_vault_update ON document_vault
  FOR UPDATE
  USING (owner_id::text = current_app_user_id() OR is_platform_admin());

DROP POLICY IF EXISTS document_vault_delete ON document_vault;
CREATE POLICY document_vault_delete ON document_vault
  FOR DELETE
  USING (owner_id::text = current_app_user_id() OR is_platform_admin());

-- =============================================================================
-- DOCUMENT_SHARES — presigned share links. Creator-only (+ platform admin).
-- Token redemption is a server-side path and runs with the platform role.
-- =============================================================================
ALTER TABLE document_shares ENABLE ROW LEVEL SECURITY;
ALTER TABLE document_shares FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS document_shares_select ON document_shares;
CREATE POLICY document_shares_select ON document_shares
  FOR SELECT
  USING (created_by::text = current_app_user_id() OR is_platform_admin());

DROP POLICY IF EXISTS document_shares_insert ON document_shares;
CREATE POLICY document_shares_insert ON document_shares
  FOR INSERT
  WITH CHECK (created_by::text = current_app_user_id() OR is_platform_admin());

DROP POLICY IF EXISTS document_shares_update ON document_shares;
CREATE POLICY document_shares_update ON document_shares
  FOR UPDATE
  USING (created_by::text = current_app_user_id() OR is_platform_admin());

DROP POLICY IF EXISTS document_shares_delete ON document_shares;
CREATE POLICY document_shares_delete ON document_shares
  FOR DELETE
  USING (created_by::text = current_app_user_id() OR is_platform_admin());

-- =============================================================================
-- TRADE_FINANCE_CONSENT_EVIDENCE — consent lifecycle digest rows. Trader sees
-- own evidence; finance/compliance officers and platform admin see all.
-- Append-only: no UPDATE/DELETE policies (default deny).
-- =============================================================================
ALTER TABLE trade_finance_consent_evidence ENABLE ROW LEVEL SECURITY;
ALTER TABLE trade_finance_consent_evidence FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tfce_select ON trade_finance_consent_evidence;
CREATE POLICY tfce_select ON trade_finance_consent_evidence
  FOR SELECT
  USING (
    is_platform_admin()
    OR trader_user_id::text = current_app_user_id()
    OR current_app_role() IN ('finance_officer', 'compliance_officer', 'auditor')
  );

DROP POLICY IF EXISTS tfce_insert ON trade_finance_consent_evidence;
CREATE POLICY tfce_insert ON trade_finance_consent_evidence
  FOR INSERT
  WITH CHECK (trader_user_id::text = current_app_user_id() OR is_platform_admin());
