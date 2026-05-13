-- ─── CEP PATTERNS — 5 WCO Standard Fraud Patterns (correct schema) ────────
INSERT INTO cep_patterns (pattern_id, name, description, status, parameters)
VALUES
  (
    'WCO-CEP-001',
    'Split Shipment Detection',
    'Detects when a single consignment is artificially split across multiple declarations within a short window to evade duty thresholds. WCO SAFE Framework Annex II, Paragraph 4.1.',
    'enabled',
    '{"event_type":"declaration_submitted","window_seconds":86400,"threshold":3,"same_shipper":true,"same_consignee":true,"same_hs_prefix":true,"hs_prefix_length":6,"value_threshold_usd":5000,"time_window_hours":24,"min_occurrences":3}'
  ),
  (
    'WCO-CEP-002',
    'Under-Valuation Pattern',
    'Identifies declarations where the declared CIF value is more than 30% below the WCO reference price database benchmark, indicating deliberate under-declaration of goods value.',
    'enabled',
    '{"event_type":"declaration_submitted","window_seconds":3600,"threshold":1,"deviation_threshold_pct":30,"reference_source":"WCO_VALUATION_DB","apply_to_hs_chapters":["61","62","84","85","87"],"min_value_usd":10000}'
  ),
  (
    'WCO-CEP-003',
    'HS Code Mismatch / Tariff Jumping',
    'Detects systematic misclassification where the declared HS code does not match the AI OCR engine goods description, or a lower-duty code is consistently used for a high-duty commodity class.',
    'enabled',
    '{"event_type":"declaration_submitted","window_seconds":604800,"threshold":2,"nlp_confidence_threshold":0.85,"duty_difference_threshold_pct":15,"repeat_trader_window_days":7,"min_occurrences":2,"hs_chapters_monitored":["22","24","33","87","90"]}'
  ),
  (
    'WCO-CEP-004',
    'Anomalous Trade Route / Port Hopping',
    'Flags shipments transiting through an unusual number of intermediate ports or changing origin country mid-route — a common indicator of origin fraud, sanctions evasion, or transshipment abuse under ECOWAS Protocol Article 3.',
    'enabled',
    '{"event_type":"vessel_position_update","window_seconds":259200,"threshold":4,"max_expected_ports":3,"suspicious_transit_countries":["IRN","PRK","SYR","CUB","VEN"],"origin_change_detection":true,"time_window_hours":72,"min_port_hops":4}'
  ),
  (
    'WCO-CEP-005',
    'High-Risk Origin Concentration',
    'Monitors for a sudden surge of declarations from a single high-risk origin country within a 48-hour window, which may indicate coordinated smuggling operations or sanctions circumvention. Based on WCO Risk Management Compendium Volume 1.',
    'enabled',
    '{"event_type":"declaration_submitted","window_seconds":172800,"threshold":5,"high_risk_countries":["IRN","PRK","SYR","CUB","MMR","LBY","SDN","YEM","SOM"],"surge_threshold":5,"time_window_hours":48,"baseline_multiplier":3.0,"notify_intelligence_unit":true}'
  )
ON CONFLICT (pattern_id) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  status = EXCLUDED.status,
  parameters = EXCLUDED.parameters,
  updated_at = NOW();

-- Update trigger_count to reflect the seeded alerts
UPDATE cep_patterns p SET
  trigger_count = (SELECT COUNT(*) FROM cep_alerts a WHERE a.pattern_id = p.pattern_id),
  last_triggered_at = (SELECT MAX(a.detected_at) FROM cep_alerts a WHERE a.pattern_id = p.pattern_id)
WHERE pattern_id IN ('WCO-CEP-001','WCO-CEP-002','WCO-CEP-003','WCO-CEP-004','WCO-CEP-005');

SELECT 'cep_patterns: ' || (SELECT COUNT(*) FROM cep_patterns) || ', cep_alerts: ' || (SELECT COUNT(*) FROM cep_alerts);
