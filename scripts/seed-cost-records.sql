-- ─── COST RECORDS — 90 days of realistic FinOps data ─────────────────────
-- 8 services × 90 days = 720 rows across 3 categories
-- Costs stored in cents (integer), e.g. 125000 = $1,250.00

INSERT INTO cost_records (tenant_name, namespace, service, category, period_date, compute_cost_usd, storage_cost_usd, network_cost_usd, total_cost_usd, cpu_request_millicores, memory_request_mib, cpu_usage_millicores, memory_usage_mib, efficiency)
SELECT
  'TradeGateway Platform',
  svc_ns,
  svc_name,
  svc_cat,
  CURRENT_DATE - (n || ' days')::INTERVAL,
  -- compute cost with slight daily variation
  (base_compute + (RANDOM() * base_compute * 0.15 - base_compute * 0.075))::INTEGER,
  (base_storage + (RANDOM() * base_storage * 0.05))::INTEGER,
  (base_network + (RANDOM() * base_network * 0.20 - base_network * 0.10))::INTEGER,
  (base_compute + base_storage + base_network + (RANDOM() * (base_compute + base_storage + base_network) * 0.10))::INTEGER,
  cpu_req, mem_req,
  (cpu_req * (0.55 + RANDOM() * 0.35))::INTEGER,
  (mem_req * (0.60 + RANDOM() * 0.30))::INTEGER,
  (55 + (RANDOM() * 35))::INTEGER
FROM generate_series(0, 89) AS n,
(VALUES
  ('declaration-engine',  'customs-core',       'Declaration Engine',    'compute',    285000,  12000, 18000, 4000, 8192),
  ('risk-ai-engine',      'ai-services',        'Risk AI Engine',        'compute',    420000,  28000, 22000, 8000, 16384),
  ('payment-gateway',     'finance',            'Payment Gateway',       'compute',    185000,   8000, 45000, 2000, 4096),
  ('cargo-tracking',      'logistics',          'Cargo Tracking',        'compute',    165000,  15000, 32000, 3000, 6144),
  ('document-mgmt',       'customs-core',       'Document Management',   'storage',    120000,  65000,  8000, 2000, 4096),
  ('oga-integration',     'integrations',       'OGA Integration Hub',   'compute',    210000,  10000, 28000, 4000, 8192),
  ('analytics-platform',  'analytics',          'Analytics Platform',    'compute',    380000,  95000, 15000, 6000, 32768),
  ('security-siem',       'security',           'Security / SIEM',       'security',   145000,  22000, 12000, 3000, 8192)
) AS services(svc_name, svc_ns, svc_label, svc_cat, base_compute, base_storage, base_network, cpu_req, mem_req)
ON CONFLICT DO NOTHING;

SELECT 'cost_records seeded: ' || COUNT(*) || ' rows across ' || COUNT(DISTINCT service) || ' services' FROM cost_records;
