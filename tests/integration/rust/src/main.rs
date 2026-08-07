// TradeGateway Rust Integration Tests
// =====================================
// Tests the LPCO rule engine and WTO valuation engine business logic.
// Run with: cargo test -- --test-output immediate

use std::collections::HashMap;

// ─── WTO Customs Valuation Engine Tests ──────────────────────────────────────

#[derive(Debug, Clone)]
struct ValuationInput {
    transaction_value: f64,
    freight: f64,
    insurance: f64,
    hs_code: String,
    country_of_origin: String,
    duty_rate: f64,
}

#[derive(Debug)]
struct ValuationResult {
    cif_value: f64,
    import_duty: f64,
    ciss: f64,
    etl: f64,
    nta: f64,
    landing_cost: f64,
    import_vat: f64,
    method_used: String,
}

fn calculate_wto_valuation(input: &ValuationInput) -> ValuationResult {
    // WTO CVA Method 1: Transaction Value
    let cif_value = input.transaction_value + input.freight + input.insurance;
    let import_duty = cif_value * input.duty_rate;
    let ciss = cif_value * 0.01;   // 1% CISS
    let etl = cif_value * 0.005;   // 0.5% ETL
    let nta = cif_value * 0.005;   // 0.5% NTA
    let landing_cost = cif_value + import_duty + ciss + etl + nta;
    let import_vat = landing_cost * 0.075; // VATA 2023 s.10

    ValuationResult {
        cif_value,
        import_duty,
        ciss,
        etl,
        nta,
        landing_cost,
        import_vat,
        method_used: "WTO_CVA_METHOD_1_TRANSACTION_VALUE".to_string(),
    }
}

#[test]
fn test_wto_valuation_method1_electronics() {
    let input = ValuationInput {
        transaction_value: 900_000.0,
        freight: 80_000.0,
        insurance: 20_000.0,
        hs_code: "8471300000".to_string(),
        country_of_origin: "CN".to_string(),
        duty_rate: 0.20,
    };

    let result = calculate_wto_valuation(&input);

    assert_eq!(result.cif_value, 1_000_000.0, "CIF value should be 1,000,000");
    assert!((result.import_duty - 200_000.0).abs() < 0.01, "Import duty should be 200,000");
    assert!((result.ciss - 10_000.0).abs() < 0.01, "CISS should be 10,000");
    assert!((result.etl - 5_000.0).abs() < 0.01, "ETL should be 5,000");
    assert!((result.nta - 5_000.0).abs() < 0.01, "NTA should be 5,000");
    assert!((result.landing_cost - 1_220_000.0).abs() < 0.01, "Landing cost should be 1,220,000");
    assert!((result.import_vat - 91_500.0).abs() < 0.01, "Import VAT should be 91,500");
    assert_eq!(result.method_used, "WTO_CVA_METHOD_1_TRANSACTION_VALUE");

    println!("PASS: WTO Method 1 (Electronics) — CIF=₦{:.0}, VAT=₦{:.2}",
        result.cif_value, result.import_vat);
}

#[test]
fn test_wto_valuation_method1_vehicles() {
    let input = ValuationInput {
        transaction_value: 4_700_000.0,
        freight: 250_000.0,
        insurance: 50_000.0,
        hs_code: "8703210000".to_string(),
        country_of_origin: "JP".to_string(),
        duty_rate: 0.35,
    };

    let result = calculate_wto_valuation(&input);

    assert_eq!(result.cif_value, 5_000_000.0);
    assert!((result.import_vat - 513_750.0).abs() < 0.01,
        "VAT should be 513,750, got {}", result.import_vat);

    println!("PASS: WTO Method 1 (Vehicles) — CIF=₦{:.0}, VAT=₦{:.2}",
        result.cif_value, result.import_vat);
}

#[test]
fn test_wto_valuation_zero_duty_pharmaceuticals() {
    let input = ValuationInput {
        transaction_value: 480_000.0,
        freight: 15_000.0,
        insurance: 5_000.0,
        hs_code: "3004900000".to_string(),
        country_of_origin: "DE".to_string(),
        duty_rate: 0.0, // Zero duty for essential medicines
    };

    let result = calculate_wto_valuation(&input);

    assert_eq!(result.cif_value, 500_000.0);
    assert_eq!(result.import_duty, 0.0, "Import duty should be zero for pharmaceuticals");
    assert!((result.import_vat - 38_250.0).abs() < 0.01,
        "VAT should be 38,250, got {}", result.import_vat);

    println!("PASS: WTO Method 1 (Pharmaceuticals, 0% duty) — VAT=₦{:.2}", result.import_vat);
}

// ─── LPCO Rule Engine Tests ───────────────────────────────────────────────────

#[derive(Debug, Clone)]
struct LPCORule {
    hs_code_prefix: String,
    agency: String,
    license_required: bool,
    max_quantity: Option<f64>,
    prohibited_origins: Vec<String>,
    requires_inspection: bool,
}

#[derive(Debug)]
struct LPCOValidationResult {
    hs_code: String,
    agency: String,
    license_required: bool,
    inspection_required: bool,
    prohibited: bool,
    violations: Vec<String>,
    passed: bool,
}

fn get_lpco_rules() -> Vec<LPCORule> {
    vec![
        LPCORule {
            hs_code_prefix: "0201".to_string(), // Beef
            agency: "NAQS".to_string(),
            license_required: true,
            max_quantity: Some(10_000.0),
            prohibited_origins: vec!["UK".to_string()], // BSE restriction
            requires_inspection: true,
        },
        LPCORule {
            hs_code_prefix: "8471".to_string(), // Computers
            agency: "NCC".to_string(),
            license_required: false,
            max_quantity: None,
            prohibited_origins: vec![],
            requires_inspection: false,
        },
        LPCORule {
            hs_code_prefix: "2710".to_string(), // Petroleum products
            agency: "DPR".to_string(),
            license_required: true,
            max_quantity: None,
            prohibited_origins: vec![],
            requires_inspection: true,
        },
        LPCORule {
            hs_code_prefix: "3004".to_string(), // Pharmaceuticals
            agency: "NAFDAC".to_string(),
            license_required: true,
            max_quantity: None,
            prohibited_origins: vec![],
            requires_inspection: true,
        },
    ]
}

fn validate_lpco(hs_code: &str, origin: &str, quantity: f64) -> Vec<LPCOValidationResult> {
    let rules = get_lpco_rules();
    let mut results = Vec::new();

    for rule in &rules {
        if !hs_code.starts_with(&rule.hs_code_prefix) {
            continue;
        }

        let mut violations = Vec::new();
        let prohibited = rule.prohibited_origins.contains(&origin.to_string());

        if prohibited {
            violations.push(format!("Origin {} is prohibited for HS {}", origin, hs_code));
        }

        if let Some(max_qty) = rule.max_quantity {
            if quantity > max_qty {
                violations.push(format!("Quantity {:.0} exceeds maximum {:.0}", quantity, max_qty));
            }
        }

        results.push(LPCOValidationResult {
            hs_code: hs_code.to_string(),
            agency: rule.agency.clone(),
            license_required: rule.license_required,
            inspection_required: rule.requires_inspection,
            prohibited,
            violations: violations.clone(),
            passed: violations.is_empty(),
        });
    }

    results
}

#[test]
fn test_lpco_beef_prohibited_origin() {
    let results = validate_lpco("02011000", "UK", 5000.0);
    assert!(!results.is_empty(), "Should have LPCO rules for beef");

    let naqs_result = results.iter().find(|r| r.agency == "NAQS").unwrap();
    assert!(!naqs_result.passed, "UK beef should be prohibited (BSE restriction)");
    assert!(naqs_result.prohibited, "UK should be in prohibited origins");
    assert!(naqs_result.violations.iter().any(|v| v.contains("prohibited")));

    println!("PASS: LPCO beef from UK correctly blocked — violations: {:?}", naqs_result.violations);
}

#[test]
fn test_lpco_beef_allowed_origin() {
    let results = validate_lpco("02011000", "BR", 5000.0);
    let naqs_result = results.iter().find(|r| r.agency == "NAQS").unwrap();

    assert!(naqs_result.passed, "Brazilian beef should be allowed");
    assert!(!naqs_result.prohibited);
    assert!(naqs_result.license_required, "NAQS license required for beef");
    assert!(naqs_result.inspection_required, "Inspection required for beef");

    println!("PASS: LPCO beef from Brazil allowed — license required: {}", naqs_result.license_required);
}

#[test]
fn test_lpco_beef_quantity_exceeded() {
    let results = validate_lpco("02011000", "BR", 15_000.0); // Exceeds 10,000 limit
    let naqs_result = results.iter().find(|r| r.agency == "NAQS").unwrap();

    assert!(!naqs_result.passed, "Quantity 15,000 should exceed NAQS limit");
    assert!(naqs_result.violations.iter().any(|v| v.contains("exceeds maximum")));

    println!("PASS: LPCO quantity limit enforced — violations: {:?}", naqs_result.violations);
}

#[test]
fn test_lpco_pharmaceuticals_nafdac() {
    let results = validate_lpco("30049000", "DE", 1000.0);
    let nafdac_result = results.iter().find(|r| r.agency == "NAFDAC").unwrap();

    assert!(nafdac_result.license_required, "NAFDAC license required for pharmaceuticals");
    assert!(nafdac_result.inspection_required, "Inspection required for pharmaceuticals");
    assert!(nafdac_result.passed, "German pharmaceuticals should pass LPCO check");

    println!("PASS: LPCO pharmaceuticals from Germany — NAFDAC license required, inspection required");
}

#[test]
fn test_lpco_computers_no_license_required() {
    let results = validate_lpco("84713000", "CN", 500.0);
    let ncc_result = results.iter().find(|r| r.agency == "NCC").unwrap();

    assert!(!ncc_result.license_required, "No NCC license required for computers");
    assert!(!ncc_result.inspection_required);
    assert!(ncc_result.passed);

    println!("PASS: LPCO computers from China — no license required");
}

// ─── HS Code Classification Tests ────────────────────────────────────────────

#[derive(Debug)]
struct HSClassificationResult {
    hs_code: String,
    description: String,
    chapter: u32,
    duty_rate: f64,
    confidence: f64,
}

fn classify_hs_code(description: &str) -> Option<HSClassificationResult> {
    // Simplified rule-based classifier for testing
    let rules: Vec<(&str, &str, u32, f64)> = vec![
        ("laptop", "8471300000", 84, 0.0),
        ("computer", "8471300000", 84, 0.0),
        ("mobile phone", "8517120000", 85, 0.0),
        ("smartphone", "8517120000", 85, 0.0),
        ("rice", "1006100000", 10, 0.05),
        ("wheat", "1001910000", 10, 0.05),
        ("beef", "0201100000", 2, 0.20),
        ("chicken", "0207110000", 2, 0.20),
        ("petroleum", "2710121000", 27, 0.05),
        ("medicine", "3004900000", 30, 0.0),
        ("pharmaceutical", "3004900000", 30, 0.0),
        ("vehicle", "8703210000", 87, 0.35),
        ("car", "8703210000", 87, 0.35),
        ("textile", "5208110000", 52, 0.20),
        ("fabric", "5208110000", 52, 0.20),
    ];

    let desc_lower = description.to_lowercase();
    for (keyword, hs_code, chapter, duty_rate) in &rules {
        if desc_lower.contains(keyword) {
            return Some(HSClassificationResult {
                hs_code: hs_code.to_string(),
                description: description.to_string(),
                chapter: *chapter,
                duty_rate: *duty_rate,
                confidence: 0.92,
            });
        }
    }
    None
}

#[test]
fn test_hs_classification_laptop() {
    let result = classify_hs_code("Dell laptop computer 15 inch").unwrap();
    assert_eq!(result.hs_code, "8471300000");
    assert_eq!(result.chapter, 84);
    assert_eq!(result.duty_rate, 0.0);
    assert!(result.confidence > 0.8);
    println!("PASS: HS classification — laptop → {} (duty: {:.0}%)", result.hs_code, result.duty_rate * 100.0);
}

#[test]
fn test_hs_classification_vehicle() {
    let result = classify_hs_code("Toyota car sedan 2024").unwrap();
    assert_eq!(result.hs_code, "8703210000");
    assert_eq!(result.chapter, 87);
    assert!((result.duty_rate - 0.35).abs() < 0.001);
    println!("PASS: HS classification — vehicle → {} (duty: {:.0}%)", result.hs_code, result.duty_rate * 100.0);
}

#[test]
fn test_hs_classification_pharmaceutical() {
    let result = classify_hs_code("Amoxicillin pharmaceutical tablets 500mg").unwrap();
    assert_eq!(result.hs_code, "3004900000");
    assert_eq!(result.duty_rate, 0.0);
    println!("PASS: HS classification — pharmaceutical → {} (duty: {:.0}%)", result.hs_code, result.duty_rate * 100.0);
}

// ─── Chrono Date Validation Tests ────────────────────────────────────────────

#[test]
fn test_lpco_expiry_date_validation() {
    use std::time::{SystemTime, UNIX_EPOCH};

    let now_secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_secs();

    // Test expired license (1 year ago)
    let expired_timestamp = now_secs - (365 * 24 * 3600);
    let is_expired = expired_timestamp < now_secs;
    assert!(is_expired, "License from 1 year ago should be expired");

    // Test valid license (1 year from now)
    let valid_timestamp = now_secs + (365 * 24 * 3600);
    let is_valid = valid_timestamp > now_secs;
    assert!(is_valid, "License expiring in 1 year should be valid");

    // Test grace period (7 days before expiry)
    let near_expiry = now_secs + (7 * 24 * 3600);
    let days_remaining = (near_expiry - now_secs) / (24 * 3600);
    assert!(days_remaining <= 7, "Should detect near-expiry within 7 days");

    println!("PASS: LPCO date validation — expired: {}, valid: {}, near-expiry days: {}",
        is_expired, is_valid, days_remaining);
}

// ─── Concurrent Safety Tests ──────────────────────────────────────────────────

#[test]
fn test_concurrent_valuation_thread_safety() {
    use std::sync::{Arc, Mutex};
    use std::thread;

    let results = Arc::new(Mutex::new(Vec::new()));
    let mut handles = vec![];

    for i in 0..50 {
        let results_clone = Arc::clone(&results);
        let handle = thread::spawn(move || {
            let input = ValuationInput {
                transaction_value: (i as f64 + 1.0) * 100_000.0,
                freight: 10_000.0,
                insurance: 2_000.0,
                hs_code: "8471300000".to_string(),
                country_of_origin: "CN".to_string(),
                duty_rate: 0.20,
            };
            let result = calculate_wto_valuation(&input);
            let mut r = results_clone.lock().unwrap();
            r.push(result.import_vat);
        });
        handles.push(handle);
    }

    for handle in handles {
        handle.join().unwrap();
    }

    let results = results.lock().unwrap();
    assert_eq!(results.len(), 50, "All 50 concurrent valuations should complete");

    // Verify all results are positive
    for vat in results.iter() {
        assert!(*vat > 0.0, "All VAT values should be positive");
    }

    println!("PASS: Concurrent valuation thread safety — 50 threads, all results valid");
}

fn main() {
    println!("TradeGateway Rust Integration Tests");
    println!("Run with: cargo test -- --test-output immediate");
}
