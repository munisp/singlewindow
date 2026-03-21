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
INSERT INTO onboarding_progress (user_id, current_step, completed_at, created_at, updated_at)
SELECT u.id, 6, NOW(), NOW(), NOW()
FROM users u
WHERE u.open_id LIKE 'demo-%'
ON CONFLICT (user_id) DO UPDATE
  SET current_step  = 6,
      completed_at  = NOW(),
      updated_at    = NOW();

-- 3. Verify
SELECT u.open_id, u.name, u.role, op.completed_at IS NOT NULL AS onboarding_done
FROM users u
LEFT JOIN onboarding_progress op ON op.user_id = u.id
WHERE u.open_id LIKE 'demo-%'
ORDER BY u.open_id;
