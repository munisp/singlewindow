-- ─── CEP PATTERNS — 5 WCO Standard Fraud Patterns ────────────────────────
INSERT INTO cep_patterns (pattern_id, name, description, event_type, window_seconds, threshold, severity, status, parameters)
VALUES
  (
    'WCO-CEP-001',
    'Split Shipment Detection',
    'Detects when a single consignment is artificially split across multiple declarations within a short window to evade duty thresholds. WCO SAFE Framework Annex II.',
    'declaration_submitted',
    86400, 3, 'high', 'enabled',
    '{"same_shipper":true,"same_consignee":true,"same_hs_prefix":true,"hs_prefix_length":6,"value_threshold_usd":5000,"time_window_hours":24,"min_occurrences":3}'
  ),
  (
    'WCO-CEP-002',
    'Under-Valuation Pattern',
    'Identifies declarations where the declared CIF value is more than 30% below the WCO reference price database benchmark, indicating deliberate under-declaration.',
    'declaration_submitted',
    3600, 1, 'critical', 'enabled',
    '{"deviation_threshold_pct":30,"reference_source":"WCO_VALUATION_DB","apply_to_hs_chapters":["61","62","84","85","87"],"min_value_usd":10000}'
  ),
  (
    'WCO-CEP-003',
    'HS Code Mismatch / Tariff Jumping',
    'Detects systematic misclassification where declared HS code does not match the AI OCR engine goods description, or a lower-duty code is consistently used for a high-duty commodity.',
    'declaration_submitted',
    604800, 2, 'high', 'enabled',
    '{"nlp_confidence_threshold":0.85,"duty_difference_threshold_pct":15,"repeat_trader_window_days":7,"min_occurrences":2,"hs_chapters_monitored":["22","24","33","87","90"]}'
  ),
  (
    'WCO-CEP-004',
    'Anomalous Trade Route / Port Hopping',
    'Flags shipments transiting through an unusual number of intermediate ports or changing origin country mid-route — indicator of origin fraud or sanctions evasion under ECOWAS Protocol Article 3.',
    'vessel_position_update',
    259200, 4, 'medium', 'enabled',
    '{"max_expected_ports":3,"suspicious_transit_countries":["IRN","PRK","SYR","CUB","VEN"],"origin_change_detection":true,"time_window_hours":72,"min_port_hops":4}'
  ),
  (
    'WCO-CEP-005',
    'High-Risk Origin Concentration',
    'Monitors for a sudden surge of declarations from a single high-risk origin country within 48 hours, indicating coordinated smuggling or sanctions circumvention. WCO Risk Management Compendium Vol 1.',
    'declaration_submitted',
    172800, 5, 'critical', 'enabled',
    '{"high_risk_countries":["IRN","PRK","SYR","CUB","MMR","LBY","SDN","YEM","SOM"],"surge_threshold":5,"time_window_hours":48,"baseline_multiplier":3.0,"notify_intelligence_unit":true}'
  )
ON CONFLICT (pattern_id) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  status = EXCLUDED.status,
  parameters = EXCLUDED.parameters,
  updated_at = NOW();

-- ─── CEP ALERTS — 15 sample alerts linked to patterns ─────────────────────
INSERT INTO cep_alerts (alert_id, pattern_id, pattern_name, severity, status, details, risk_score, detected_at)
VALUES
  ('CEP-2026-0001','WCO-CEP-001','Split Shipment Detection','high','open',
   '{"trader":"Ikeja Electronics Ltd","declarations":["DEC-2026-08821","DEC-2026-08822","DEC-2026-08823"],"hs_code":"8471.30","total_value_usd":42000,"shipper":"Shenzhen Tech Exports Co"}',82,NOW()-INTERVAL '2 hours'),
  ('CEP-2026-0002','WCO-CEP-002','Under-Valuation Pattern','critical','investigating',
   '{"trader":"Lagos General Imports","declaration":"DEC-2026-08750","declared_value_usd":8500,"wco_reference_usd":32000,"deviation_pct":73.4,"hs_code":"6110.20","goods":"Cotton Knitwear"}',95,NOW()-INTERVAL '6 hours'),
  ('CEP-2026-0003','WCO-CEP-003','HS Code Mismatch / Tariff Jumping','high','open',
   '{"trader":"Abuja Auto Parts Ltd","declaration":"DEC-2026-08690","declared_hs":"8708.99","ai_suggested_hs":"8703.23","duty_difference_pct":22.5,"goods_description":"Passenger vehicle chassis"}',88,NOW()-INTERVAL '12 hours'),
  ('CEP-2026-0004','WCO-CEP-004','Anomalous Trade Route / Port Hopping','medium','open',
   '{"vessel":"MV FORTUNE STAR","mmsi":"636015432","declared_origin":"CHN","ports_transited":["CNSHA","SGSIN","MYPEN","AEJEA","NGAPP"],"port_hop_count":5,"flag_country":"PAN"}',71,NOW()-INTERVAL '18 hours'),
  ('CEP-2026-0005','WCO-CEP-005','High-Risk Origin Concentration','critical','open',
   '{"origin_country":"IRN","declarations_count":7,"time_window_hours":48,"baseline_count":1,"surge_multiplier":7.0,"traders":["Alpha Imports","Beta Trading","Gamma Logistics"]}',97,NOW()-INTERVAL '1 hour'),
  ('CEP-2026-0006','WCO-CEP-001','Split Shipment Detection','high','resolved',
   '{"trader":"Kano Textile Merchants","declarations":["DEC-2026-08501","DEC-2026-08502","DEC-2026-08503","DEC-2026-08504"],"hs_code":"6204.62","total_value_usd":28000,"shipper":"Guangzhou Textile Co"}',79,NOW()-INTERVAL '3 days'),
  ('CEP-2026-0007','WCO-CEP-002','Under-Valuation Pattern','critical','resolved',
   '{"trader":"Port Harcourt Electronics","declaration":"DEC-2026-08320","declared_value_usd":15000,"wco_reference_usd":48000,"deviation_pct":68.7,"hs_code":"8517.12","goods":"Smartphones"}',93,NOW()-INTERVAL '4 days'),
  ('CEP-2026-0008','WCO-CEP-003','HS Code Mismatch / Tariff Jumping','high','false_positive',
   '{"trader":"Calabar Beverages Ltd","declaration":"DEC-2026-08210","declared_hs":"2202.10","ai_suggested_hs":"2204.21","duty_difference_pct":18.0,"goods_description":"Non-alcoholic beverages","resolution":"Goods correctly classified as non-alcoholic"}',55,NOW()-INTERVAL '5 days'),
  ('CEP-2026-0009','WCO-CEP-004','Anomalous Trade Route / Port Hopping','medium','investigating',
   '{"vessel":"MV OCEAN PIONEER","mmsi":"538007891","declared_origin":"TUR","ports_transited":["TRIZM","EGPSD","DJJIB","YEMOH","NGAPP"],"port_hop_count":5,"flag_country":"MHL"}',68,NOW()-INTERVAL '30 hours'),
  ('CEP-2026-0010','WCO-CEP-005','High-Risk Origin Concentration','critical','investigating',
   '{"origin_country":"PRK","declarations_count":5,"time_window_hours":48,"baseline_count":0,"surge_multiplier":999,"traders":["Unnamed Importer A","Unnamed Importer B"]}',99,NOW()-INTERVAL '8 hours'),
  ('CEP-2026-0011','WCO-CEP-001','Split Shipment Detection','medium','open',
   '{"trader":"Warri Petroleum Supplies","declarations":["DEC-2026-09100","DEC-2026-09101","DEC-2026-09102"],"hs_code":"2710.19","total_value_usd":165000,"shipper":"Dubai Fuel Trading LLC"}',74,NOW()-INTERVAL '4 hours'),
  ('CEP-2026-0012','WCO-CEP-002','Under-Valuation Pattern','high','open',
   '{"trader":"Onne Industrial Supplies","declaration":"DEC-2026-09050","declared_value_usd":22000,"wco_reference_usd":68000,"deviation_pct":67.6,"hs_code":"8428.20","goods":"Mobile cranes"}',91,NOW()-INTERVAL '9 hours'),
  ('CEP-2026-0013','WCO-CEP-003','HS Code Mismatch / Tariff Jumping','medium','open',
   '{"trader":"Lagos Pharma Distributors","declaration":"DEC-2026-08980","declared_hs":"3004.90","ai_suggested_hs":"3002.15","duty_difference_pct":12.5,"goods_description":"Biological vaccines vs pharmaceutical preparations"}',66,NOW()-INTERVAL '15 hours'),
  ('CEP-2026-0014','WCO-CEP-004','Anomalous Trade Route / Port Hopping','high','open',
   '{"vessel":"MV CASPIAN TRADER","mmsi":"273456789","declared_origin":"RUS","ports_transited":["RUNAK","IRBND","PKKAR","INBOM","NGAPP"],"port_hop_count":5,"flag_country":"COM","sanctions_flag":true}',86,NOW()-INTERVAL '22 hours'),
  ('CEP-2026-0015','WCO-CEP-005','High-Risk Origin Concentration','critical','open',
   '{"origin_country":"SYR","declarations_count":6,"time_window_hours":48,"baseline_count":1,"surge_multiplier":6.0,"traders":["Levant Trade Co","Eastern Med Imports","Damascus Goods Ltd"]}',96,NOW()-INTERVAL '3 hours')
ON CONFLICT (alert_id) DO NOTHING;

SELECT 'cep_patterns: ' || (SELECT COUNT(*) FROM cep_patterns) || ', cep_alerts: ' || (SELECT COUNT(*) FROM cep_alerts);
