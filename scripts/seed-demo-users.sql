-- ============================================================
-- TradeGateway™ NGSWTP — Demo User Seed Script (PostgreSQL)
-- Seeds 6 demo personas with correct roles and marks onboarding
-- as complete so they land directly in their portal dashboards.
-- ============================================================

-- 1. Upsert the 6 demo users with their correct roles
INSERT INTO users (open_id, name, email, login_method, role, created_at, updated_at, last_signed_in)
VALUES
  ('demo-trader',    'Amara Diallo',     'amara.diallo@demo.tradegateway.ng',     'demo', 'user',            NOW(), NOW(), NOW()),
  ('demo-customs',   'Kwame Asante',     'kwame.asante@demo.tradegateway.ng',     'demo', 'customs_officer', NOW(), NOW(), NOW()),
  ('demo-oga',       'Fatima Al-Hassan', 'fatima.alhassan@demo.tradegateway.ng',  'demo', 'oga_officer',     NOW(), NOW(), NOW()),
  ('demo-admin',     'Chidi Okonkwo',    'chidi.okonkwo@demo.tradegateway.ng',    'demo', 'admin',           NOW(), NOW(), NOW()),
  ('demo-security',  'Ngozi Eze',        'ngozi.eze@demo.tradegateway.ng',        'demo', 'customs_officer', NOW(), NOW(), NOW()),
  ('demo-developer', 'Tunde Adeyemi',    'tunde.adeyemi@demo.tradegateway.ng',    'demo', 'user',            NOW(), NOW(), NOW())
ON CONFLICT (open_id) DO UPDATE
  SET name          = EXCLUDED.name,
      email         = EXCLUDED.email,
      login_method  = EXCLUDED.login_method,
      role          = EXCLUDED.role,
      updated_at    = NOW(),
      last_signed_in = NOW();

-- 2. Mark onboarding complete for all demo users
-- (so they skip the onboarding wizard and land directly in their portal)
-- NOTE: current_step is the onboarding_step enum (5 text values); the last
-- step is 'aeo_eligibility'. overall_status must be 'completed'.
INSERT INTO onboarding_progress (user_id, current_step, overall_status, completed_at, created_at, updated_at)
SELECT u.id, 'aeo_eligibility', 'completed', NOW(), NOW(), NOW()
FROM users u
WHERE u.open_id LIKE 'demo-%'
ON CONFLICT (user_id) DO UPDATE
  SET current_step   = 'aeo_eligibility',
      overall_status = 'completed',
      completed_at   = NOW(),
      updated_at     = NOW();

-- 3. Approved stakeholder profiles — the declaration workflow fail-closes
-- without an approved profile ("trader profile must be approved before
-- submitting declarations"), so demo personas need these to be usable.
INSERT INTO stakeholder_profiles (user_id, stakeholder_type, organization_name, tax_id, country, status, approved_at, created_at, updated_at)
SELECT u.id, 'trader', u.name || ' Org', 'TIN-90012345', 'NG', 'approved', NOW(), NOW(), NOW()
FROM users u WHERE u.open_id = 'demo-trader'
ON CONFLICT (user_id) DO UPDATE SET status = 'approved', approved_at = NOW(), updated_at = NOW();

INSERT INTO stakeholder_profiles (user_id, stakeholder_type, organization_name, country, status, approved_at, created_at, updated_at)
SELECT u.id, 'customs_officer', 'Nigeria Customs Service', 'NG', 'approved', NOW(), NOW(), NOW()
FROM users u WHERE u.open_id IN ('demo-customs', 'demo-security')
ON CONFLICT (user_id) DO UPDATE SET status = 'approved', approved_at = NOW(), updated_at = NOW();

INSERT INTO stakeholder_profiles (user_id, stakeholder_type, organization_name, country, status, approved_at, created_at, updated_at)
SELECT u.id, 'oga_officer', 'NAFDAC', 'NG', 'approved', NOW(), NOW(), NOW()
FROM users u WHERE u.open_id = 'demo-oga'
ON CONFLICT (user_id) DO UPDATE SET status = 'approved', approved_at = NOW(), updated_at = NOW();

-- 4. Approved KYC for the demo trader — declarations.submit enforces the
-- KYC gate (B5), so without this the demo trader can never submit.
INSERT INTO kyc_verifications (user_id, verification_type, status, reviewed_at, submitted_at, created_at, updated_at)
SELECT u.id, 'INDIVIDUAL', 'APPROVED', NOW(), NOW(), NOW(), NOW()
FROM users u
WHERE u.open_id = 'demo-trader'
  AND NOT EXISTS (SELECT 1 FROM kyc_verifications k WHERE k.user_id = u.id AND k.status = 'APPROVED');

-- 5. Demo tenant + memberships. Officer declaration lists are tenant-scoped
-- (Phase-11: fail closed — an officer with no tenant sees an empty queue),
-- so all demo personas must share one tenant for the demo flows to work.
INSERT INTO tenants (name, slug, country, contact_email, api_prefix, plan, status, created_at, updated_at)
VALUES ('Demo Tenant Nigeria', 'demo-ng', 'NG', 'demo@tradegateway.ng', '/demo-ng', 'government', 'active', NOW(), NOW())
ON CONFLICT (slug) DO NOTHING;

INSERT INTO tenant_users (tenant_id, user_id, role, created_at)
SELECT t.id, u.id, CASE WHEN u.role = 'admin' THEN 'admin' ELSE 'member' END, NOW()
FROM tenants t, users u
WHERE t.slug = 'demo-ng' AND u.open_id LIKE 'demo-%'
  AND NOT EXISTS (SELECT 1 FROM tenant_users tu WHERE tu.tenant_id = t.id AND tu.user_id = u.id);

-- 6. Verify
SELECT u.open_id, u.name, u.role,
       op.overall_status AS onboarding,
       sp.status AS profile_status
FROM users u
LEFT JOIN onboarding_progress op ON op.user_id = u.id
LEFT JOIN stakeholder_profiles sp ON sp.user_id = u.id
WHERE u.open_id LIKE 'demo-%'
ORDER BY u.open_id;
