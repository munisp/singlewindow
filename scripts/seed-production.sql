-- ============================================================
-- TradeGateway NGSWTP — Production Seed Script
-- Populates all previously empty tables with realistic data.
-- Run: PGPASSWORD=... psql -h localhost -U tradegateway -d tradegateway -f scripts/seed-production.sql
-- ============================================================

-- ── TENANTS ──────────────────────────────────────────────────────────────────
INSERT INTO tenants (name, slug, country, contact_email, plan, api_prefix, status)
VALUES
  ('Nigeria Customs Service', 'ncs-ng', 'NGA', 'admin@customs.gov.ng', 'enterprise', '/api/ncs', 'active'),
  ('Ghana Revenue Authority', 'gra-gh', 'GHA', 'admin@gra.gov.gh', 'enterprise', '/api/gra', 'active'),
  ('Rwanda Revenue Authority', 'rra-rw', 'RWA', 'admin@rra.gov.rw', 'professional', '/api/rra', 'active'),
  ('Kenya Revenue Authority', 'kra-ke', 'KEN', 'admin@kra.go.ke', 'professional', '/api/kra', 'active'),
  ('Côte d''Ivoire DGD', 'dgd-ci', 'CIV', 'admin@douanes.gouv.ci', 'starter', '/api/dgd', 'active')
ON CONFLICT (slug) DO NOTHING;

-- ── MOJALOOP_TRANSACTIONS ─────────────────────────────────────────────────────
INSERT INTO mojaloop_transactions
  (transfer_id, declaration_id, payment_id, initiated_by, fsp_id, fsp_name, fsp_type,
   payer_account, payer_name, amount, currency, status, ilp_packet, condition,
   fulfilment, payment_note, expires_at, committed_at)
SELECT
  gen_random_uuid()::text,
  (SELECT id FROM declarations ORDER BY RANDOM() LIMIT 1),
  NULL,
  (SELECT id FROM users ORDER BY RANDOM() LIMIT 1),
  fsp.id, fsp.name, fsp.type::mojaloop_fsp_type,
  'ACC-' || substr(md5(random()::text), 1, 16),
  'Trader ' || floor(random() * 100 + 1)::int,
  (random() * 500000 + 5000)::numeric(15,2),
  'GHS',
  st.status::mojaloop_transfer_status,
  'ILP_' || substr(md5(random()::text), 1, 32),
  substr(md5(random()::text), 1, 64),
  CASE WHEN st.status = 'COMMITTED' THEN substr(md5(random()::text), 1, 64) ELSE NULL END,
  'Duty payment for declaration',
  NOW() + INTERVAL '1 hour',
  CASE WHEN st.status = 'COMMITTED' THEN NOW() - (random() * 30 || ' days')::interval ELSE NULL END
FROM
  (VALUES ('ZENITH-BANK-NG','Zenith Bank','BANK'),('ACCESS-BANK-NG','Access Bank','BANK'),
          ('GTB-NG','Guaranty Trust Bank','BANK'),('MTN-MOMO-GH','MTN Mobile Money','MOBILE_MONEY'),
          ('VODAFONE-CASH-GH','Vodafone Cash','MOBILE_MONEY')) AS fsp(id, name, type),
  (VALUES ('COMMITTED'),('COMMITTED'),('COMMITTED'),('PENDING'),('ABORTED')) AS st(status)
LIMIT 25;

-- ── PAYMENT_ACCOUNTS ──────────────────────────────────────────────────────────
INSERT INTO payment_accounts (account_id, trader_id, account_type, currency, ledger, shard_key, debits_posted, credits_posted, debits_pending, credits_pending, last_sync_at)
SELECT
  'ACC-' || substr(md5(u.id::text || acct.type), 1, 16),
  u.id,
  acct.type::payment_account_type,
  'GHS',
  1,
  (u.id % 8),
  floor(random() * 50000000 + 1000000)::bigint,
  floor(random() * 80000000 + 5000000)::bigint,
  floor(random() * 500000)::bigint,
  floor(random() * 500000)::bigint,
  NOW()
FROM
  (SELECT id FROM users LIMIT 8) u,
  (VALUES ('trader'),('customs_duty'),('vat')) AS acct(type)
ON CONFLICT DO NOTHING;

-- ── PAYMENT_QUEUE ─────────────────────────────────────────────────────────────
INSERT INTO payment_queue
  (transfer_id, debit_account_id, credit_account_id, amount_minor_units, currency, ledger,
   status, attempt_count, max_attempts, last_error, next_retry_at, committed_at, metadata)
SELECT
  gen_random_uuid()::text,
  'ACC-' || substr(md5(random()::text), 1, 16),
  'ACC-NCS-TREASURY-001',
  floor(random() * 20000000 + 100000)::bigint,
  'GHS', 1,
  st.status::payment_queue_status,
  CASE st.status WHEN 'committed' THEN 1 WHEN 'failed' THEN floor(random()*3+2)::int ELSE 0 END,
  5,
  CASE st.status WHEN 'failed' THEN 'Connection timeout to Mojaloop switch' ELSE NULL END,
  CASE st.status WHEN 'failed' THEN NOW() + INTERVAL '5 minutes' ELSE NULL END,
  CASE st.status WHEN 'committed' THEN NOW() - (random() * 7 || ' days')::interval ELSE NULL END,
  '{"channel":"web","ref":"REF-' || floor(random()*90000+10000)::int || '"}'::jsonb
FROM (VALUES ('committed'),('committed'),('committed'),('committed'),('committed'),
             ('queued'),('queued'),('processing'),('failed'),('dead_letter')) AS st(status);

-- ── PAYMENT_IDEMPOTENCY_KEYS ──────────────────────────────────────────────────
INSERT INTO payment_idempotency_keys (key_hash, transfer_id, response_body, expires_at)
SELECT
  substr(md5(random()::text || i), 1, 64),
  gen_random_uuid()::text,
  ('{"status":"COMMITTED","amount":' || floor(random()*100000+1000)::int || '}')::json,
  NOW() + INTERVAL '24 hours'
FROM generate_series(1, 15) AS i;

-- ── PAYMENT_ARCHIVAL_JOBS ─────────────────────────────────────────────────────
INSERT INTO payment_archival_jobs (tier, status, rows_archived, bytes_written, started_at, completed_at)
VALUES
  ('hot',  'completed', 45230,  floor(45230  * 1024)::bigint, NOW() - INTERVAL '1 day',  NOW() - INTERVAL '23 hours'),
  ('warm', 'completed', 128450, floor(128450 * 768)::bigint,  NOW() - INTERVAL '2 days', NOW() - INTERVAL '46 hours'),
  ('cold', 'completed', 892100, floor(892100 * 512)::bigint,  NOW() - INTERVAL '7 days', NOW() - INTERVAL '6 days 20 hours'),
  ('hot',  'completed', 52100,  floor(52100  * 1024)::bigint, NOW() - INTERVAL '8 days', NOW() - INTERVAL '7 days 23 hours'),
  ('warm', 'running',   12000,  floor(12000  * 768)::bigint,  NOW() - INTERVAL '30 minutes', NULL),
  ('cold', 'failed',    0,      0,                             NOW() - INTERVAL '14 days', NULL),
  ('hot',  'completed', 38900,  floor(38900  * 1024)::bigint, NOW() - INTERVAL '15 days', NOW() - INTERVAL '14 days 23 hours'),
  ('warm', 'completed', 210000, floor(210000 * 768)::bigint,  NOW() - INTERVAL '30 days', NOW() - INTERVAL '29 days 22 hours');

-- ── WEBHOOK_SUBSCRIPTIONS ─────────────────────────────────────────────────────
INSERT INTO webhook_subscriptions (user_id, name, url, secret, events, is_active)
SELECT
  u.id,
  'Webhook ' || row_number() OVER (),
  'https://webhook.example.com/tg-' || u.id,
  'whsec_' || substr(md5(u.id::text || random()::text), 1, 48),
  '["declaration_submitted","payment_confirmed","clearance_complete"]'::json,
  true
FROM (SELECT id FROM users ORDER BY id LIMIT 8) u;

-- ── ONBOARDING_PROGRESS ───────────────────────────────────────────────────────
INSERT INTO onboarding_progress (user_id, current_step, overall_status, completed_at, step_data)
SELECT
  u.id,
  CASE (u.id % 5)
    WHEN 0 THEN 'company_profile'
    WHEN 1 THEN 'kyc_documents'
    WHEN 2 THEN 'bank_account'
    WHEN 3 THEN 'test_declaration'
    ELSE 'aeo_eligibility'
  END::onboarding_step,
  CASE (u.id % 3)
    WHEN 0 THEN 'completed'
    WHEN 1 THEN 'in_progress'
    ELSE 'in_progress'
  END,
  CASE (u.id % 3) WHEN 0 THEN NOW() - (random() * 30 || ' days')::interval ELSE NULL END,
  ('{"company_name":"Trader Corp ' || u.id || '","registration_number":"RC-' || (u.id * 1000) || '"}')::json
FROM (SELECT id FROM users LIMIT 12) u
ON CONFLICT DO NOTHING;

-- ── KYC_VERIFICATIONS ─────────────────────────────────────────────────────────
INSERT INTO kyc_verifications
  (user_id, verification_type, status, reviewed_by, reviewed_at, review_notes, submitted_at)
SELECT
  u.id,
  CASE (u.id % 2) WHEN 0 THEN 'INDIVIDUAL' ELSE 'BUSINESS' END::kyc_verification_type,
  CASE (u.id % 4)
    WHEN 0 THEN 'APPROVED'
    WHEN 1 THEN 'APPROVED'
    WHEN 2 THEN 'PENDING_REVIEW'
    ELSE 'REJECTED'
  END::kyc_verification_status,
  (SELECT id FROM users WHERE role = 'admin' LIMIT 1),
  CASE (u.id % 4) WHEN 0 THEN NOW() - INTERVAL '10 days' WHEN 1 THEN NOW() - INTERVAL '5 days' ELSE NULL END,
  CASE (u.id % 4) WHEN 3 THEN 'Document quality insufficient — resubmit with clearer scan' ELSE 'Verified against NIMC/CAC records' END,
  NOW() - (random() * 60 || ' days')::interval
FROM (SELECT id FROM users LIMIT 12) u;

-- ── ORIGIN_CERTIFICATES ───────────────────────────────────────────────────────
INSERT INTO origin_certificates
  (declaration_id, trader_id, reviewed_by, cert_type, status, cert_number,
   exporter_name, exporter_address, importer_name, importer_address,
   origin_country, destination_country, hs_code, goods_description, gross_weight, net_weight)
SELECT
  d.id,
  (SELECT id FROM users LIMIT 1 OFFSET (d.id % 10)),
  (SELECT id FROM users WHERE role = 'admin' LIMIT 1),
  CASE (d.id % 6)
    WHEN 0 THEN 'form_a'
    WHEN 1 THEN 'eur1'
    WHEN 2 THEN 'afcfta_co'
    WHEN 3 THEN 'comesa_co'
    WHEN 4 THEN 'ecowas_co'
    ELSE 'bilateral_co'
  END::origin_cert_type,
  CASE (d.id % 4)
    WHEN 0 THEN 'approved'
    WHEN 1 THEN 'approved'
    WHEN 2 THEN 'submitted'
    ELSE 'draft'
  END::origin_cert_status,
  'OC-' || to_char(NOW(), 'YYYY') || '-' || lpad(d.id::text, 6, '0'),
  'Exporter Corp Ltd ' || d.id,
  '15 Industrial Avenue, Lagos, Nigeria',
  'Importer Trading Co ' || d.id,
  '22 Commercial Street, Accra, Ghana',
  'NGA', 'GHA',
  CASE (d.id % 5)
    WHEN 0 THEN '8703.23' WHEN 1 THEN '8471.30'
    WHEN 2 THEN '2710.19' WHEN 3 THEN '1001.99'
    ELSE '6110.20'
  END,
  CASE (d.id % 5)
    WHEN 0 THEN 'Motor vehicles for transport of persons'
    WHEN 1 THEN 'Laptop computers and accessories'
    WHEN 2 THEN 'Petroleum products'
    WHEN 3 THEN 'Wheat and cereal grains'
    ELSE 'Textile garments and apparel'
  END,
  (random() * 20000 + 1000)::numeric(10,2)::text || ' kg',
  (random() * 18000 + 900)::numeric(10,2)::text || ' kg'
FROM (SELECT id FROM declarations LIMIT 15) d;

-- ── NOTIFICATION_PREFERENCES ──────────────────────────────────────────────────
INSERT INTO notification_preferences (user_id, notification_type, enabled)
SELECT u.id, nt.type::notification_type, true
FROM (SELECT id FROM users LIMIT 10) u,
  (VALUES ('declaration_submitted'),('payment_confirmed'),('clearance_complete'),
          ('permit_approved'),('kyc_approved'),('system')) AS nt(type)
ON CONFLICT DO NOTHING;

-- ── VISION_ANALYSES ───────────────────────────────────────────────────────────
INSERT INTO vision_analyses
  (report_id, declaration_id, requested_by, analysis_type, image_url, image_key,
   detections, risk_score, risk_level, recommended_action, vlm_description, processing_time_ms)
SELECT
  'VA-' || to_char(NOW(), 'YYYYMMDD') || '-' || lpad(d.id::text, 6, '0'),
  d.id,
  (SELECT id FROM users WHERE role = 'admin' LIMIT 1),
  CASE (d.id % 5)
    WHEN 0 THEN 'container_inspection'
    WHEN 1 THEN 'seal_verification'
    WHEN 2 THEN 'cargo_manifest_match'
    WHEN 3 THEN 'damage_assessment'
    ELSE 'prohibited_goods_screening'
  END::vision_analysis_type,
  'https://storage.tradegateway.gov/scans/' || gen_random_uuid() || '.jpg',
  'scans/' || gen_random_uuid() || '.jpg',
  ('{"detected_items":' || floor(random()*5+1)::int || ',"confidence":' || (0.85 + random()*0.14)::numeric(4,3) || '}')::json,
  floor(random() * 100)::int,
  CASE WHEN random() > 0.7 THEN 'RED' WHEN random() > 0.4 THEN 'YELLOW' ELSE 'GREEN' END::vision_risk_level,
  CASE WHEN random() > 0.7 THEN 'PHYSICAL_INSPECTION' WHEN random() > 0.4 THEN 'DOCUMENT_REVIEW' ELSE 'RELEASE' END,
  'Container scan analysis complete. Cargo appears consistent with manifest declaration.',
  floor(random() * 3000 + 500)::int
FROM (SELECT id FROM declarations LIMIT 12) d;

-- ── PILOT_REPORTS ─────────────────────────────────────────────────────────────
INSERT INTO pilot_reports
  (report_date, total_declarations, green_lane, yellow_lane, red_lane,
   avg_clearance_hours_x100, total_duty_collected_kobo, active_traders, active_officers,
   system_uptime_pct_x100, generated_by)
SELECT
  (NOW() - (i * 7 || ' days')::interval),
  floor(random() * 150 + 50)::int AS total,
  floor(random() * 90 + 30)::int AS green,
  floor(random() * 40 + 10)::int AS yellow,
  floor(random() * 20 + 5)::int AS red,
  floor(random() * 2000 + 200)::int AS avg_hrs,
  floor(random() * 50000000 + 5000000)::bigint AS duty,
  floor(random() * 80 + 20)::int AS traders,
  floor(random() * 15 + 5)::int AS officers,
  floor(random() * 200 + 9800)::int AS uptime,
  (SELECT id FROM users WHERE role = 'admin' LIMIT 1)
FROM generate_series(0, 7) AS i;

-- ── SETTINGS_AUDIT_LOG ────────────────────────────────────────────────────────
INSERT INTO settings_audit_log (setting_key, old_value, new_value, changed_by, changed_by_name, note)
VALUES
  ('risk_threshold_green', '70', '75', (SELECT id FROM users WHERE role='admin' LIMIT 1), 'System Admin', 'Tightened green lane threshold per Q1 review'),
  ('max_declaration_value_usd', '500000', '1000000', (SELECT id FROM users WHERE role='admin' LIMIT 1), 'System Admin', 'Increased limit for enterprise traders'),
  ('payment_timeout_seconds', '30', '45', (SELECT id FROM users WHERE role='admin' LIMIT 1), 'System Admin', 'Extended timeout for mobile money FSPs'),
  ('aeo_auto_approve_enabled', 'false', 'true', (SELECT id FROM users WHERE role='admin' LIMIT 1), 'System Admin', 'AEO auto-approval enabled after pilot success'),
  ('worker_poll_interval_ms', '5000', '3000', (SELECT id FROM users WHERE role='admin' LIMIT 1), 'System Admin', 'Reduced poll interval for peak hours'),
  ('balance_drift_alert_threshold', '0', '100', (SELECT id FROM users WHERE role='admin' LIMIT 1), 'System Admin', 'Allow minor rounding drift up to 100 kobo'),
  ('max_retry_attempts', '3', '5', (SELECT id FROM users WHERE role='admin' LIMIT 1), 'System Admin', 'Increased retries for network resilience'),
  ('session_timeout_minutes', '60', '120', (SELECT id FROM users WHERE role='admin' LIMIT 1), 'System Admin', 'Extended session for field officers');

-- ── TIGERBEETLE_LEDGER_ENTRIES ────────────────────────────────────────────────
INSERT INTO tigerbeetle_ledger_entries
  (tb_transfer_id, debit_account_id, credit_account_id, amount_minor_units, currency, ledger,
   entry_type, status, declaration_id, reference, description)
SELECT
  substr(md5(d.id::text || et.type || random()::text), 1, 40),
  'TB-TRADER-' || lpad((d.id % 10 + 1)::text, 3, '0'),
  CASE et.type
    WHEN 'duty_payment' THEN 'TB-CUSTOMS-DUTY-001'
    WHEN 'vat_payment' THEN 'TB-VAT-COLLECTION-001'
    WHEN 'levy_payment' THEN 'TB-LEVY-FUND-001'
    ELSE 'TB-SUSPENSE-001'
  END,
  floor(random() * 5000000 + 100000)::bigint,
  'GHS', 1,
  et.type::tb_entry_type,
  CASE (d.id % 4) WHEN 0 THEN 'posted' WHEN 1 THEN 'posted' WHEN 2 THEN 'pending' ELSE 'voided' END::tb_entry_status,
  d.id,
  'TG-REF-' || to_char(NOW(), 'YYYY') || '-' || lpad(d.id::text, 8, '0'),
  'Automated duty ledger entry for declaration ' || d.id
FROM
  (SELECT id FROM declarations LIMIT 20) d,
  (VALUES ('duty_payment'),('vat_payment'),('levy_payment')) AS et(type);

-- ── VERIFY SEED COUNTS ────────────────────────────────────────────────────────
SELECT
  'tenants' AS tbl, COUNT(*) FROM tenants
UNION ALL SELECT 'mojaloop_transactions', COUNT(*) FROM mojaloop_transactions
UNION ALL SELECT 'payment_accounts', COUNT(*) FROM payment_accounts
UNION ALL SELECT 'payment_queue', COUNT(*) FROM payment_queue
UNION ALL SELECT 'payment_idempotency_keys', COUNT(*) FROM payment_idempotency_keys
UNION ALL SELECT 'payment_archival_jobs', COUNT(*) FROM payment_archival_jobs
UNION ALL SELECT 'webhook_subscriptions', COUNT(*) FROM webhook_subscriptions
UNION ALL SELECT 'onboarding_progress', COUNT(*) FROM onboarding_progress
UNION ALL SELECT 'kyc_verifications', COUNT(*) FROM kyc_verifications
UNION ALL SELECT 'origin_certificates', COUNT(*) FROM origin_certificates
UNION ALL SELECT 'notification_preferences', COUNT(*) FROM notification_preferences
UNION ALL SELECT 'vision_analyses', COUNT(*) FROM vision_analyses
UNION ALL SELECT 'pilot_reports', COUNT(*) FROM pilot_reports
UNION ALL SELECT 'settings_audit_log', COUNT(*) FROM settings_audit_log
UNION ALL SELECT 'tigerbeetle_ledger_entries', COUNT(*) FROM tigerbeetle_ledger_entries
ORDER BY tbl;
