-- ─── TradeGateway™ NGSWTP — v30 Seed Script ────────────────────────────────
-- Seeds all 18 previously empty tables with production-realistic demo data.
-- Run: sudo -u postgres psql -d tradegateway -f scripts/seed-v30-tables.sql
-- ─────────────────────────────────────────────────────────────────────────────

BEGIN;

-- ─── 1. aeo_renewal_requests ─────────────────────────────────────────────────
-- Requires: aeo_applications(51,52,53), users(145-157)
INSERT INTO aeo_renewal_requests
  (application_id, trader_id, status, requested_at, processed_at, processed_by, notes, compliance_score_at_renewal)
VALUES
  (51, 145, 'approved',  NOW() - INTERVAL '90 days', NOW() - INTERVAL '80 days', 157, 'Annual renewal approved after compliance review. All obligations met.', 94),
  (52, 146, 'pending',   NOW() - INTERVAL '14 days', NULL, NULL, 'Awaiting compliance audit completion before processing.', NULL),
  (53, 147, 'rejected',  NOW() - INTERVAL '60 days', NOW() - INTERVAL '55 days', 157, 'Renewal rejected due to outstanding duty payments. Trader notified.', 61),
  (51, 148, 'approved',  NOW() - INTERVAL '180 days', NOW() - INTERVAL '170 days', 157, 'Renewal approved. Trader maintains exemplary compliance record.', 98),
  (52, 149, 'pending',   NOW() - INTERVAL '5 days',  NULL, NULL, 'New renewal request submitted. Under initial review.', NULL)
ON CONFLICT DO NOTHING;

-- ─── 2. api_usage_logs ───────────────────────────────────────────────────────
-- Requires: api_keys(6,7,8)
INSERT INTO api_usage_logs
  (api_key_id, endpoint, method, status_code, latency_ms, sandbox_mode, created_at)
VALUES
  (6, '/api/v1/declarations',         'GET',  200, 142, false, NOW() - INTERVAL '1 hour'),
  (6, '/api/v1/declarations',         'POST', 201, 387, false, NOW() - INTERVAL '2 hours'),
  (7, '/api/v1/declarations/NG20260688660', 'GET', 200, 89, false, NOW() - INTERVAL '3 hours'),
  (7, '/api/v1/hs-codes/lookup',      'GET',  200, 234, false, NOW() - INTERVAL '4 hours'),
  (8, '/api/v1/payments/initiate',    'POST', 202, 512, false, NOW() - INTERVAL '5 hours'),
  (6, '/api/v1/cargo/track',          'GET',  200, 178, false, NOW() - INTERVAL '6 hours'),
  (7, '/api/v1/permits',              'GET',  200, 95,  false, NOW() - INTERVAL '7 hours'),
  (8, '/api/v1/declarations',         'GET',  401, 12,  false, NOW() - INTERVAL '8 hours'),
  (6, '/api/v1/aeo/status',           'GET',  200, 67,  true,  NOW() - INTERVAL '9 hours'),
  (7, '/api/v1/risk/score',           'POST', 200, 1243, false, NOW() - INTERVAL '10 hours'),
  (8, '/api/v1/declarations',         'POST', 422, 88,  false, NOW() - INTERVAL '11 hours'),
  (6, '/api/v1/cargo/track',          'GET',  200, 201, true,  NOW() - INTERVAL '12 hours'),
  (7, '/api/v1/payments/status',      'GET',  200, 143, false, NOW() - INTERVAL '13 hours'),
  (8, '/api/v1/hs-codes/lookup',      'GET',  200, 312, false, NOW() - INTERVAL '14 hours'),
  (6, '/api/v1/declarations',         'GET',  200, 156, false, NOW() - INTERVAL '15 hours'),
  (7, '/api/v1/permits',              'POST', 201, 445, false, NOW() - INTERVAL '16 hours'),
  (8, '/api/v1/aeo/status',           'GET',  200, 78,  false, NOW() - INTERVAL '17 hours'),
  (6, '/api/v1/risk/score',           'POST', 200, 987, false, NOW() - INTERVAL '18 hours'),
  (7, '/api/v1/declarations',         'GET',  429, 8,   false, NOW() - INTERVAL '19 hours'),
  (8, '/api/v1/cargo/track',          'GET',  200, 134, false, NOW() - INTERVAL '20 hours')
ON CONFLICT DO NOTHING;

-- ─── 3. bulk_exports ─────────────────────────────────────────────────────────
-- Requires: users(145-159)
INSERT INTO bulk_exports
  (user_id, declaration_ids, declaration_count, failed_count, s3_url, s3_key, file_size_bytes, created_at, expires_at, label)
VALUES
  (157, '552,553,554,555,556', 5, 0,
   'https://storage.tradegateway.gov.ng/exports/bulk-export-admin-20260420.zip',
   'exports/bulk-export-admin-20260420.zip',
   2048576, NOW() - INTERVAL '2 days', NOW() + INTERVAL '28 days',
   'Weekly Declaration Export - April 2026 Week 3'),
  (154, '557,558,559', 3, 0,
   'https://storage.tradegateway.gov.ng/exports/bulk-export-trader-20260419.zip',
   'exports/bulk-export-trader-20260419.zip',
   512000, NOW() - INTERVAL '3 days', NOW() + INTERVAL '27 days',
   'Q1 2026 Import Declarations'),
  (157, '560,561,562,563,564,565,566,567,568,569', 10, 1,
   'https://storage.tradegateway.gov.ng/exports/bulk-export-admin-20260415.zip',
   'exports/bulk-export-admin-20260415.zip',
   4194304, NOW() - INTERVAL '7 days', NOW() + INTERVAL '23 days',
   'Monthly Compliance Export - March 2026'),
  (155, '570,571,572', 3, 0,
   'https://storage.tradegateway.gov.ng/exports/bulk-export-customs-20260410.zip',
   'exports/bulk-export-customs-20260410.zip',
   768000, NOW() - INTERVAL '12 days', NOW() + INTERVAL '18 days',
   'Customs Audit Sample - April 2026')
ON CONFLICT DO NOTHING;

-- ─── 4. compliance_email_schedule ────────────────────────────────────────────
INSERT INTO compliance_email_schedule
  (recipient_email, recipient_name, is_active, last_sent_at, last_sent_rows, created_at, updated_at, created_by, timezone, send_hour_local)
VALUES
  ('compliance@customs.gov.ng',      'NCS Compliance Unit',          true,  NOW() - INTERVAL '1 day',  47, NOW() - INTERVAL '30 days', NOW(), 157, 'Africa/Lagos', 6),
  ('director@tradegateway.gov.ng',   'Director General',             true,  NOW() - INTERVAL '1 day',  47, NOW() - INTERVAL '30 days', NOW(), 157, 'Africa/Lagos', 7),
  ('audit@revenue.gov.ng',           'Revenue Audit Division',       true,  NOW() - INTERVAL '7 days', 312, NOW() - INTERVAL '60 days', NOW(), 157, 'Africa/Lagos', 8),
  ('risk@customs.gov.ng',            'Risk Management Unit',         true,  NOW() - INTERVAL '1 day',  23, NOW() - INTERVAL '14 days', NOW(), 157, 'UTC', 4),
  ('trade-stats@ministry.gov.ng',    'Ministry of Trade Statistics', false, NULL,                       NULL, NOW() - INTERVAL '90 days', NOW(), 157, 'Africa/Lagos', 9)
ON CONFLICT DO NOTHING;

-- ─── 5. compliance_email_delivery_log ────────────────────────────────────────
INSERT INTO compliance_email_delivery_log
  (triggered_at, triggered_by, date_label, row_count, recipient_count, recipients, success, error_message, duration_ms)
VALUES
  (NOW() - INTERVAL '1 day',   'cron',   '2026-04-21', 47,  4, 'compliance@customs.gov.ng,director@tradegateway.gov.ng,audit@revenue.gov.ng,risk@customs.gov.ng', true,  NULL, 1234),
  (NOW() - INTERVAL '2 days',  'cron',   '2026-04-20', 52,  4, 'compliance@customs.gov.ng,director@tradegateway.gov.ng,audit@revenue.gov.ng,risk@customs.gov.ng', true,  NULL, 987),
  (NOW() - INTERVAL '3 days',  'cron',   '2026-04-19', 38,  4, 'compliance@customs.gov.ng,director@tradegateway.gov.ng,audit@revenue.gov.ng,risk@customs.gov.ng', true,  NULL, 1102),
  (NOW() - INTERVAL '4 days',  'cron',   '2026-04-18', 61,  4, 'compliance@customs.gov.ng,director@tradegateway.gov.ng,audit@revenue.gov.ng,risk@customs.gov.ng', false, 'SMTP connection timeout after 30s', 30001),
  (NOW() - INTERVAL '5 days',  'cron',   '2026-04-17', 44,  4, 'compliance@customs.gov.ng,director@tradegateway.gov.ng,audit@revenue.gov.ng,risk@customs.gov.ng', true,  NULL, 876),
  (NOW() - INTERVAL '7 days',  'manual', '2026-04-15', 312, 3, 'audit@revenue.gov.ng,compliance@customs.gov.ng,director@tradegateway.gov.ng', true, NULL, 2341),
  (NOW() - INTERVAL '14 days', 'cron',   '2026-04-08', 29,  4, 'compliance@customs.gov.ng,director@tradegateway.gov.ng,audit@revenue.gov.ng,risk@customs.gov.ng', true,  NULL, 1567)
ON CONFLICT DO NOTHING;

-- ─── 6. declaration_documents ────────────────────────────────────────────────
-- Requires: declarations(552,553,554), users(155,157)
INSERT INTO declaration_documents
  (declaration_id, document_type, file_name, file_url, file_key, mime_type, file_size_bytes, ocr_extracted, ocr_data, verified_by, verified_at, status, created_at)
VALUES
  (552, 'commercial_invoice', 'invoice-NG20260688660.pdf',
   'https://storage.tradegateway.gov.ng/docs/invoice-NG20260688660.pdf',
   'docs/invoice-NG20260688660.pdf', 'application/pdf', 245760,
   true, '{"supplier":"Shenzhen Electronics Ltd","total_value":45230.00,"currency":"USD","items":12}',
   155, NOW() - INTERVAL '5 days', 'verified', NOW() - INTERVAL '6 days'),
  (552, 'bill_of_lading', 'bl-NG20260688660.pdf',
   'https://storage.tradegateway.gov.ng/docs/bl-NG20260688660.pdf',
   'docs/bl-NG20260688660.pdf', 'application/pdf', 189440,
   true, '{"vessel":"MV ATLANTIC STAR","voyage":"ATL-2026-047","bl_number":"MSCUATL047001"}',
   155, NOW() - INTERVAL '5 days', 'verified', NOW() - INTERVAL '6 days'),
  (552, 'packing_list', 'packing-NG20260688660.pdf',
   'https://storage.tradegateway.gov.ng/docs/packing-NG20260688660.pdf',
   'docs/packing-NG20260688660.pdf', 'application/pdf', 98304,
   true, '{"packages":48,"gross_weight_kg":1240,"net_weight_kg":1180}',
   NULL, NULL, 'pending', NOW() - INTERVAL '6 days'),
  (553, 'commercial_invoice', 'invoice-NG20260688663.pdf',
   'https://storage.tradegateway.gov.ng/docs/invoice-NG20260688663.pdf',
   'docs/invoice-NG20260688663.pdf', 'application/pdf', 312320,
   true, '{"supplier":"Lagos Agro Exports Ltd","total_value":12800.00,"currency":"USD","items":3}',
   157, NOW() - INTERVAL '3 days', 'verified', NOW() - INTERVAL '4 days'),
  (553, 'certificate_of_origin', 'coo-NG20260688663.pdf',
   'https://storage.tradegateway.gov.ng/docs/coo-NG20260688663.pdf',
   'docs/coo-NG20260688663.pdf', 'application/pdf', 76800,
   false, NULL, NULL, NULL, 'pending', NOW() - INTERVAL '4 days'),
  (554, 'import_permit', 'permit-NG20260688665.pdf',
   'https://storage.tradegateway.gov.ng/docs/permit-NG20260688665.pdf',
   'docs/permit-NG20260688665.pdf', 'application/pdf', 134144,
   true, '{"permit_number":"NAFDAC-2026-0847","valid_until":"2026-12-31","product":"Pharmaceutical raw materials"}',
   155, NOW() - INTERVAL '1 day', 'verified', NOW() - INTERVAL '2 days'),
  (554, 'phytosanitary_cert', 'phyto-NG20260688665.pdf',
   'https://storage.tradegateway.gov.ng/docs/phyto-NG20260688665.pdf',
   'docs/phyto-NG20260688665.pdf', 'application/pdf', 89088,
   false, NULL, NULL, NULL, 'rejected', NOW() - INTERVAL '2 days')
ON CONFLICT DO NOTHING;

-- ─── 7. document_shares ──────────────────────────────────────────────────────
-- Requires: document_vault(57,58,59,60,61), users(145-159)
INSERT INTO document_shares
  (document_id, created_by, token, password_hash, expires_at, max_downloads, download_count, label, revoked_at, created_at)
VALUES
  (57, 145, 'share_tok_a1b2c3d4e5f6789012345678901234ab', NULL,
   NOW() + INTERVAL '7 days', 5, 2,
   'Invoice for Customs Broker Review', NULL, NOW() - INTERVAL '2 days'),
  (58, 146, 'share_tok_b2c3d4e5f6789012345678901234bc56', '$2b$12$hashedpassword1234567890abcdef',
   NOW() + INTERVAL '3 days', 1, 0,
   'Confidential BL - Authorized Personnel Only', NULL, NOW() - INTERVAL '1 day'),
  (59, 147, 'share_tok_c3d4e5f6789012345678901234cd7890', NULL,
   NOW() + INTERVAL '14 days', 10, 7,
   'Packing List for Warehouse', NULL, NOW() - INTERVAL '5 days'),
  (60, 154, 'share_tok_d4e5f6789012345678901234de9012ef', NULL,
   NOW() - INTERVAL '1 day', 3, 3,
   'Expired Share - Permit Copy', NOW() - INTERVAL '1 day', NOW() - INTERVAL '10 days'),
  (61, 157, 'share_tok_e5f6789012345678901234ef01234567', NULL,
   NOW() + INTERVAL '30 days', NULL, 0,
   'Compliance Certificate - Unlimited Downloads', NULL, NOW() - INTERVAL '3 days')
ON CONFLICT DO NOTHING;

-- ─── 8. document_versions ────────────────────────────────────────────────────
-- Requires: document_vault(57-61), declarations(552-554), users(145-159)
INSERT INTO document_versions
  (original_document_id, declaration_id, uploaded_by, category, description, file_name, file_size, mime_type, s3_key, s3_url, replaced_at, replaced_by, version_note)
VALUES
  (57, 552, 145, 'commercial_invoice', 'Corrected invoice with updated HS codes',
   'invoice-NG20260688660-v2.pdf', 251904, 'application/pdf',
   'docs/versions/invoice-NG20260688660-v2.pdf',
   'https://storage.tradegateway.gov.ng/docs/versions/invoice-NG20260688660-v2.pdf',
   NOW() - INTERVAL '4 days', 155, 'HS code correction for items 7-9; original had 8471 instead of 8473'),
  (58, 552, 145, 'bill_of_lading', 'Updated BL with corrected consignee address',
   'bl-NG20260688660-v2.pdf', 192512, 'application/pdf',
   'docs/versions/bl-NG20260688660-v2.pdf',
   'https://storage.tradegateway.gov.ng/docs/versions/bl-NG20260688660-v2.pdf',
   NOW() - INTERVAL '3 days', 155, 'Consignee address correction per shipper amendment notice'),
  (59, 553, 146, 'certificate_of_origin', 'Re-issued CoO with correct HS tariff heading',
   'coo-NG20260688663-v2.pdf', 79872, 'application/pdf',
   'docs/versions/coo-NG20260688663-v2.pdf',
   'https://storage.tradegateway.gov.ng/docs/versions/coo-NG20260688663-v2.pdf',
   NOW() - INTERVAL '2 days', 157, 'Original CoO had incorrect tariff heading 0901 instead of 0902'),
  (60, 554, 147, 'import_permit', 'Renewed permit with extended validity',
   'permit-NG20260688665-v2.pdf', 138240, 'application/pdf',
   'docs/versions/permit-NG20260688665-v2.pdf',
   'https://storage.tradegateway.gov.ng/docs/versions/permit-NG20260688665-v2.pdf',
   NOW() - INTERVAL '1 day', 155, 'NAFDAC permit renewed for additional 6 months; original expired 2026-06-30')
ON CONFLICT DO NOTHING;

-- ─── 9. fraud_case_evidence ──────────────────────────────────────────────────
-- Requires: fraud_cases(32-36), users(150-158)
INSERT INTO fraud_case_evidence
  (case_id, uploaded_by, file_key, file_url, file_name, mime_type, file_size_bytes, description, created_at)
VALUES
  (32, 158, 'fraud/evidence/case32-invoice-discrepancy.pdf',
   'https://storage.tradegateway.gov.ng/fraud/evidence/case32-invoice-discrepancy.pdf',
   'invoice-discrepancy-analysis.pdf', 'application/pdf', 524288,
   'Comparative analysis of declared invoice vs. actual transaction records from correspondent bank. Value discrepancy of $47,000 identified.', NOW() - INTERVAL '10 days'),
  (32, 158, 'fraud/evidence/case32-risk-score-history.json',
   'https://storage.tradegateway.gov.ng/fraud/evidence/case32-risk-score-history.json',
   'risk-score-history-export.json', 'application/json', 12288,
   'Historical risk scoring data showing pattern of anomalous declarations over 6 months.', NOW() - INTERVAL '9 days'),
  (33, 150, 'fraud/evidence/case33-hs-mismatch.pdf',
   'https://storage.tradegateway.gov.ng/fraud/evidence/case33-hs-mismatch.pdf',
   'hs-code-mismatch-report.pdf', 'application/pdf', 389120,
   'Physical inspection report confirming goods do not match declared HS code 8471. Actual goods are 8542 (integrated circuits).', NOW() - INTERVAL '15 days'),
  (34, 158, 'fraud/evidence/case34-duplicate-bl.pdf',
   'https://storage.tradegateway.gov.ng/fraud/evidence/case34-duplicate-bl.pdf',
   'duplicate-bill-of-lading.pdf', 'application/pdf', 204800,
   'Two declarations submitted with identical bill of lading number MSCUATL047001. Shipping line confirms only one shipment.', NOW() - INTERVAL '20 days'),
  (35, 150, 'fraud/evidence/case35-valuation-evidence.xlsx',
   'https://storage.tradegateway.gov.ng/fraud/evidence/case35-valuation-evidence.xlsx',
   'market-valuation-comparison.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 98304,
   'Market price comparison for declared goods. Declared value 40% below WTO transaction value threshold.', NOW() - INTERVAL '5 days'),
  (36, 158, 'fraud/evidence/case36-surveillance-footage.mp4',
   'https://storage.tradegateway.gov.ng/fraud/evidence/case36-surveillance-footage.mp4',
   'port-surveillance-2026-04-10.mp4', 'video/mp4', 52428800,
   'CCTV footage from Apapa Port Gate 7 showing undeclared goods being loaded onto truck. Timestamp 2026-04-10 02:34 UTC.', NOW() - INTERVAL '12 days')
ON CONFLICT DO NOTHING;

-- ─── 10. fraud_case_notes ────────────────────────────────────────────────────
INSERT INTO fraud_case_notes
  (case_id, author_id, content, is_internal, created_at, updated_at)
VALUES
  (32, 158, 'Initial investigation opened following automated risk engine alert. Trader has 3 prior declarations with similar value discrepancies. Referred to Financial Intelligence Unit.', true, NOW() - INTERVAL '10 days', NOW() - INTERVAL '10 days'),
  (32, 157, 'FIU has been notified. Case escalated to senior investigator. Trader account temporarily suspended pending investigation outcome.', true, NOW() - INTERVAL '8 days', NOW() - INTERVAL '8 days'),
  (32, 158, 'Bank records subpoenaed. Awaiting response from correspondent bank in Singapore. Expected 5-7 business days.', true, NOW() - INTERVAL '6 days', NOW() - INTERVAL '6 days'),
  (33, 150, 'Physical examination completed. Goods confirmed to be integrated circuits (HS 8542) not computer peripherals (HS 8471) as declared. Duty difference: NGN 2.4M.', true, NOW() - INTERVAL '14 days', NOW() - INTERVAL '14 days'),
  (33, 157, 'Trader notified of discrepancy and given 48 hours to provide explanation. Penalty assessment initiated.', false, NOW() - INTERVAL '13 days', NOW() - INTERVAL '13 days'),
  (33, 150, 'Trader responded claiming clerical error by customs agent. Agent license suspended pending review.', true, NOW() - INTERVAL '11 days', NOW() - INTERVAL '11 days'),
  (34, 158, 'Duplicate BL case confirmed. Shipping line MSCU provided written confirmation only one shipment on voyage ATL-2026-047. Second declaration is fraudulent.', true, NOW() - INTERVAL '19 days', NOW() - INTERVAL '19 days'),
  (35, 150, 'Valuation dispute raised. Trader provided purchase order showing price. Discrepancy may be due to bulk discount not reflected in declared value. Reviewing WTO valuation rules.', true, NOW() - INTERVAL '4 days', NOW() - INTERVAL '4 days'),
  (36, 158, 'Surveillance footage reviewed. Vehicle registration traced to logistics company. Company director summoned for questioning.', true, NOW() - INTERVAL '11 days', NOW() - INTERVAL '11 days'),
  (36, 157, 'Director appeared for questioning. Claims no knowledge of undeclared goods. Investigation ongoing. Logistics company license suspended.', true, NOW() - INTERVAL '9 days', NOW() - INTERVAL '9 days')
ON CONFLICT DO NOTHING;

-- ─── 11. geofence_events ─────────────────────────────────────────────────────
-- Requires: geofences(12-16)
INSERT INTO geofence_events
  (geofence_id, mmsi, vessel_name, event_type, lat, lon, speed, notification_sent, occurred_at)
VALUES
  (12, '636091234', 'MV ATLANTIC STAR',    'enter', 6.4281,  3.4219,  8.2, true,  NOW() - INTERVAL '2 hours'),
  (12, '636091234', 'MV ATLANTIC STAR',    'exit',  6.4412,  3.4387,  9.1, true,  NOW() - INTERVAL '1 hour'),
  (13, '636092345', 'MV LAGOS PIONEER',    'enter', 6.4350,  3.4280,  0.0, true,  NOW() - INTERVAL '6 hours'),
  (14, '636093456', 'MV OGUN TRADER',      'enter', 6.4200,  3.4100,  4.5, true,  NOW() - INTERVAL '12 hours'),
  (14, '636093456', 'MV OGUN TRADER',      'exit',  6.4180,  3.4080,  5.2, true,  NOW() - INTERVAL '10 hours'),
  (15, '636094567', 'MV BIGHT CARRIER',    'enter', 6.4450,  3.4350,  0.0, true,  NOW() - INTERVAL '18 hours'),
  (16, '636095678', 'MV GULF NAVIGATOR',   'exit',  6.4300,  3.4250,  11.3, true, NOW() - INTERVAL '24 hours'),
  (12, '636096789', 'MV APAPA STAR',       'enter', 6.4290,  3.4230,  6.8, true,  NOW() - INTERVAL '36 hours'),
  (13, '636097890', 'MV TIN CAN EXPRESS',  'enter', 6.4320,  3.4260,  0.0, false, NOW() - INTERVAL '3 hours'),
  (12, '636098901', 'MV WEST AFRICA LINK', 'enter', 6.4270,  3.4210,  7.4, true,  NOW() - INTERVAL '48 hours'),
  (15, '636099012', 'MV BONNY TRADER',     'enter', 6.4400,  3.4330,  0.0, true,  NOW() - INTERVAL '4 hours'),
  (16, '566001234', 'MV MERIDIAN COAST',   'exit',  6.4250,  3.4190,  12.1, true, NOW() - INTERVAL '5 hours')
ON CONFLICT DO NOTHING;

-- ─── 12. keycloak_config ─────────────────────────────────────────────────────
INSERT INTO keycloak_config
  (enabled, realm_url, client_id, client_secret, discovery_url, jwks_uri, issuer, role_mappings, scopes, fallback_enabled, last_tested_at, last_test_result, last_test_error, updated_by, created_at, updated_at)
VALUES
  (false,
   'https://keycloak.tradegateway.gov.ng/realms/tradegateway',
   'tradegateway-platform',
   'kc_secret_placeholder_change_in_production',
   'https://keycloak.tradegateway.gov.ng/realms/tradegateway/.well-known/openid-configuration',
   'https://keycloak.tradegateway.gov.ng/realms/tradegateway/protocol/openid-connect/certs',
   'https://keycloak.tradegateway.gov.ng/realms/tradegateway',
   '{"customs_officer":"officer","trader":"trader","oga_officer":"oga","admin":"admin","security_analyst":"security"}',
   '["openid","profile","email","roles"]',
   true,
   NOW() - INTERVAL '7 days',
   'failed',
   'Connection refused: keycloak.tradegateway.gov.ng:443 (placeholder — configure Keycloak in production)',
   157,
   NOW() - INTERVAL '7 days',
   NOW() - INTERVAL '7 days')
ON CONFLICT DO NOTHING;

-- ─── 13. notification_digest_settings ────────────────────────────────────────
-- Requires: users(145-159)
INSERT INTO notification_digest_settings
  (user_id, digest_frequency, last_digest_sent_at, updated_at)
VALUES
  (145, 'daily',  NOW() - INTERVAL '1 day',  NOW() - INTERVAL '1 day'),
  (146, 'weekly', NOW() - INTERVAL '7 days', NOW() - INTERVAL '7 days'),
  (147, 'none',   NULL,                       NOW() - INTERVAL '30 days'),
  (148, 'daily',  NOW() - INTERVAL '1 day',  NOW() - INTERVAL '1 day'),
  (149, 'weekly', NOW() - INTERVAL '7 days', NOW() - INTERVAL '7 days'),
  (150, 'daily',  NOW() - INTERVAL '1 day',  NOW() - INTERVAL '1 day'),
  (151, 'none',   NULL,                       NOW() - INTERVAL '14 days'),
  (154, 'daily',  NOW() - INTERVAL '1 day',  NOW() - INTERVAL '1 day'),
  (155, 'daily',  NOW() - INTERVAL '1 day',  NOW() - INTERVAL '1 day'),
  (157, 'daily',  NOW() - INTERVAL '1 day',  NOW() - INTERVAL '1 day'),
  (158, 'weekly', NOW() - INTERVAL '7 days', NOW() - INTERVAL '7 days'),
  (159, 'none',   NULL,                       NOW() - INTERVAL '5 days')
ON CONFLICT DO NOTHING;

-- ─── 14. onboarding_analytics ────────────────────────────────────────────────
INSERT INTO onboarding_analytics
  (user_id, step, action, time_spent_seconds, error_count, metadata, recorded_at)
VALUES
  (145, 'profile_setup',      'complete', 187, 0, '{"fields_filled":8,"avatar_uploaded":true}', NOW() - INTERVAL '30 days'),
  (145, 'first_declaration',  'complete', 543, 2, '{"declaration_type":"import","hs_code_lookups":3}', NOW() - INTERVAL '29 days'),
  (145, 'payment_setup',      'complete', 234, 0, '{"payment_method":"bank_transfer","bank":"GTBank"}', NOW() - INTERVAL '29 days'),
  (146, 'profile_setup',      'complete', 312, 1, '{"fields_filled":7,"avatar_uploaded":false}', NOW() - INTERVAL '20 days'),
  (146, 'first_declaration',  'abandon',  89,  3, '{"declaration_type":"export","last_step":"hs_code"}', NOW() - INTERVAL '19 days'),
  (146, 'first_declaration',  'complete', 678, 1, '{"declaration_type":"export","hs_code_lookups":5}', NOW() - INTERVAL '18 days'),
  (147, 'profile_setup',      'complete', 145, 0, '{"fields_filled":9,"avatar_uploaded":true}', NOW() - INTERVAL '15 days'),
  (147, 'document_upload',    'complete', 423, 0, '{"documents_uploaded":4,"ocr_triggered":true}', NOW() - INTERVAL '14 days'),
  (148, 'profile_setup',      'start',    45,  0, '{"fields_filled":2}', NOW() - INTERVAL '5 days'),
  (148, 'profile_setup',      'abandon',  45,  0, '{"fields_filled":2,"reason":"session_timeout"}', NOW() - INTERVAL '5 days'),
  (154, 'profile_setup',      'complete', 98,  0, '{"fields_filled":9,"avatar_uploaded":true}', NOW() - INTERVAL '60 days'),
  (154, 'first_declaration',  'complete', 287, 0, '{"declaration_type":"import","hs_code_lookups":1}', NOW() - INTERVAL '59 days'),
  (159, 'api_key_creation',   'complete', 67,  0, '{"environment":"sandbox","key_type":"read_write"}', NOW() - INTERVAL '10 days'),
  (159, 'api_first_call',     'complete', 234, 1, '{"endpoint":"/api/v1/declarations","status":200}', NOW() - INTERVAL '9 days')
ON CONFLICT DO NOTHING;

-- ─── 15. pilot_participants ───────────────────────────────────────────────────
-- Requires: users(145-159)
INSERT INTO pilot_participants
  (user_id, pilot_role, scope, organisation, contact_email, is_active, joined_at, notes)
VALUES
  (145, 'trader',      'apapa_apmt',    'Lagos Imports Ltd',              'trader1@lagosimports.com',   true,  NOW() - INTERVAL '90 days', 'Phase 1 pilot trader. High volume importer. Excellent feedback on declaration workflow.'),
  (146, 'trader',      'tin_can_island', 'West Africa Exports Co.',       'trader2@waexports.com',      true,  NOW() - INTERVAL '85 days', 'Phase 1 pilot trader. Focus on export declarations. Provided valuable UX feedback.'),
  (147, 'trader',      'both',          'Continental Trading Ltd',        'trader3@continental.com',    true,  NOW() - INTERVAL '80 days', 'Phase 2 pilot participant. Tests both import and export workflows.'),
  (150, 'ncs_officer', 'apapa_apmt',    'Nigeria Customs Service',        'officer1@customs.gov.ng',    true,  NOW() - INTERVAL '90 days', 'Senior customs officer. Key stakeholder for officer workflow validation.'),
  (151, 'ncs_officer', 'tin_can_island', 'Nigeria Customs Service',       'officer2@customs.gov.ng',    true,  NOW() - INTERVAL '85 days', 'Customs officer specializing in risk assessment. Testing AI risk scoring integration.'),
  (156, 'oga_officer', 'both',          'NAFDAC',                         'officer@nafdac.gov.ng',      true,  NOW() - INTERVAL '75 days', 'NAFDAC representative. Testing pharmaceutical and food import permit workflows.'),
  (159, 'trader',      'apapa_apmt',    'DevTrader API Test Account',     'dev@tradegateway.gov.ng',    false, NOW() - INTERVAL '60 days', 'Developer test account. Used for API integration testing. Deactivated after Phase 1.')
ON CONFLICT DO NOTHING;

-- ─── 16. tenant_keycloak_config ──────────────────────────────────────────────
-- Requires: tenants(7f8e7bed..., 076d88e7..., fdaff6b7...)
INSERT INTO tenant_keycloak_config
  (tenant_id, realm, client_id, client_secret, discovery_url, role_mappings, enabled, created_at, updated_at)
VALUES
  ('7f8e7bed-00b6-48d9-bc52-a88a5427b02a',
   'tradegateway-tenant-alpha',
   'tg-tenant-alpha-client',
   'tenant_alpha_secret_placeholder',
   'https://keycloak.tradegateway.gov.ng/realms/tradegateway-tenant-alpha/.well-known/openid-configuration',
   '{"admin":"admin","user":"trader","officer":"officer"}',
   true, NOW() - INTERVAL '30 days', NOW() - INTERVAL '30 days'),
  ('076d88e7-b003-4ba5-9535-600d3ec15c49',
   'tradegateway-tenant-beta',
   'tg-tenant-beta-client',
   'tenant_beta_secret_placeholder',
   'https://keycloak.tradegateway.gov.ng/realms/tradegateway-tenant-beta/.well-known/openid-configuration',
   '{"admin":"admin","member":"trader"}',
   false, NOW() - INTERVAL '15 days', NOW() - INTERVAL '15 days'),
  ('fdaff6b7-ba15-4eb1-a8b6-2849314e7b6b',
   'tradegateway-tenant-gamma',
   'tg-tenant-gamma-client',
   'tenant_gamma_secret_placeholder',
   'https://keycloak.tradegateway.gov.ng/realms/tradegateway-tenant-gamma/.well-known/openid-configuration',
   '{"superadmin":"admin","staff":"trader","compliance":"officer"}',
   true, NOW() - INTERVAL '7 days', NOW() - INTERVAL '7 days')
ON CONFLICT DO NOTHING;

-- ─── 17. tenant_users ────────────────────────────────────────────────────────
-- Requires: tenants(7f8e7bed..., 076d88e7..., fdaff6b7...), users(145-159)
INSERT INTO tenant_users
  (tenant_id, user_id, role, created_at)
VALUES
  ('7f8e7bed-00b6-48d9-bc52-a88a5427b02a', 145, 'admin',   NOW() - INTERVAL '30 days'),
  ('7f8e7bed-00b6-48d9-bc52-a88a5427b02a', 146, 'trader',  NOW() - INTERVAL '28 days'),
  ('7f8e7bed-00b6-48d9-bc52-a88a5427b02a', 147, 'trader',  NOW() - INTERVAL '25 days'),
  ('7f8e7bed-00b6-48d9-bc52-a88a5427b02a', 150, 'officer', NOW() - INTERVAL '30 days'),
  ('076d88e7-b003-4ba5-9535-600d3ec15c49', 148, 'admin',   NOW() - INTERVAL '15 days'),
  ('076d88e7-b003-4ba5-9535-600d3ec15c49', 149, 'viewer',  NOW() - INTERVAL '14 days'),
  ('076d88e7-b003-4ba5-9535-600d3ec15c49', 151, 'officer', NOW() - INTERVAL '15 days'),
  ('fdaff6b7-ba15-4eb1-a8b6-2849314e7b6b', 154, 'admin',   NOW() - INTERVAL '7 days'),
  ('fdaff6b7-ba15-4eb1-a8b6-2849314e7b6b', 155, 'officer', NOW() - INTERVAL '7 days'),
  ('fdaff6b7-ba15-4eb1-a8b6-2849314e7b6b', 157, 'admin',   NOW() - INTERVAL '7 days')
ON CONFLICT DO NOTHING;

-- ─── 18. webhook_deliveries ──────────────────────────────────────────────────
-- Requires: webhook_subscriptions(1-5)
INSERT INTO webhook_deliveries
  (subscription_id, event_type, payload, status_code, response_body, success, attempt_count, delivered_at)
VALUES
  (1, 'declaration.submitted',
   '{"event":"declaration.submitted","declaration_id":552,"declaration_number":"NG20260688660","trader_id":145,"timestamp":"2026-04-22T08:00:00Z"}',
   200, '{"received":true,"message_id":"msg_a1b2c3d4"}', true, 1, NOW() - INTERVAL '2 hours'),
  (1, 'declaration.cleared',
   '{"event":"declaration.cleared","declaration_id":552,"declaration_number":"NG20260688660","clearance_time":"2026-04-22T10:30:00Z","timestamp":"2026-04-22T10:30:00Z"}',
   200, '{"received":true,"message_id":"msg_b2c3d4e5"}', true, 1, NOW() - INTERVAL '1 hour'),
  (2, 'payment.completed',
   '{"event":"payment.completed","payment_id":"pay_xyz789","amount":45230.00,"currency":"USD","declaration_id":552,"timestamp":"2026-04-22T09:15:00Z"}',
   200, '{"status":"ok"}', true, 1, NOW() - INTERVAL '90 minutes'),
  (3, 'declaration.submitted',
   '{"event":"declaration.submitted","declaration_id":553,"declaration_number":"NG20260688663","trader_id":146,"timestamp":"2026-04-21T14:00:00Z"}',
   500, 'Internal Server Error', false, 1, NOW() - INTERVAL '1 day'),
  (3, 'declaration.submitted',
   '{"event":"declaration.submitted","declaration_id":553,"declaration_number":"NG20260688663","trader_id":146,"timestamp":"2026-04-21T14:00:00Z"}',
   200, '{"received":true}', true, 2, NOW() - INTERVAL '23 hours'),
  (4, 'risk.flagged',
   '{"event":"risk.flagged","declaration_id":554,"declaration_number":"NG20260688665","risk_score":87,"risk_lane":"red","timestamp":"2026-04-20T11:00:00Z"}',
   200, '{"acknowledged":true,"alert_id":"alert_001"}', true, 1, NOW() - INTERVAL '2 days'),
  (5, 'document.verified',
   '{"event":"document.verified","document_id":57,"declaration_id":552,"document_type":"commercial_invoice","verified_by":155,"timestamp":"2026-04-22T07:00:00Z"}',
   404, 'Not Found', false, 3, NOW() - INTERVAL '3 hours'),
  (1, 'aeo.status_changed',
   '{"event":"aeo.status_changed","trader_id":145,"old_status":"active","new_status":"suspended","reason":"investigation","timestamp":"2026-04-15T09:00:00Z"}',
   200, '{"received":true}', true, 1, NOW() - INTERVAL '7 days'),
  (2, 'cargo.arrived',
   '{"event":"cargo.arrived","vessel":"MV ATLANTIC STAR","mmsi":"636091234","port":"APAPA","eta":"2026-04-22T06:00:00Z","timestamp":"2026-04-22T06:00:00Z"}',
   200, '{"status":"ok"}', true, 1, NOW() - INTERVAL '4 hours'),
  (3, 'payment.failed',
   '{"event":"payment.failed","payment_id":"pay_abc123","amount":12800.00,"currency":"USD","error":"insufficient_funds","timestamp":"2026-04-19T16:00:00Z"}',
   200, '{"received":true}', true, 1, NOW() - INTERVAL '3 days')
ON CONFLICT DO NOTHING;

COMMIT;

-- Verify row counts
SELECT tablename, n_live_tup AS rows
FROM pg_stat_user_tables
WHERE tablename IN (
  'aeo_renewal_requests','api_usage_logs','bulk_exports',
  'compliance_email_delivery_log','compliance_email_schedule',
  'declaration_documents','document_shares','document_versions',
  'fraud_case_evidence','fraud_case_notes','geofence_events',
  'keycloak_config','notification_digest_settings','onboarding_analytics',
  'pilot_participants','tenant_keycloak_config','tenant_users','webhook_deliveries'
)
ORDER BY tablename;
