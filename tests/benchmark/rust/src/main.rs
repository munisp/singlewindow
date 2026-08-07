// TradeGateway Rust Benchmark Server
// =====================================
// Exposes LPCO rule engine and WTO valuation endpoints for load testing.
use std::collections::HashMap;
use std::net::SocketAddr;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Instant;

use serde::{Deserialize, Serialize};
use tokio::net::TcpListener;
use tokio::io::{AsyncReadExt, AsyncWriteExt};

static REQUEST_COUNT: AtomicU64 = AtomicU64::new(0);
static ERROR_COUNT: AtomicU64 = AtomicU64::new(0);

// ─── Data Structures ──────────────────────────────────────────────────────────

#[derive(Deserialize)]
struct ValuationRequest {
    transaction_value: f64,
    freight: f64,
    insurance: f64,
    duty_rate: f64,
    hs_code: String,
}

#[derive(Serialize)]
struct ValuationResponse {
    cif_value: f64,
    import_duty: f64,
    ciss: f64,
    etl: f64,
    nta: f64,
    landing_cost: f64,
    import_vat: f64,
    method: String,
    latency_us: u128,
}

#[derive(Deserialize)]
struct LPCORequest {
    hs_code: String,
    country_of_origin: String,
    quantity: f64,
}

#[derive(Serialize)]
struct LPCOResponse {
    hs_code: String,
    agency: String,
    license_required: bool,
    inspection_required: bool,
    prohibited: bool,
    violations: Vec<String>,
    passed: bool,
    latency_us: u128,
}

#[derive(Deserialize)]
struct HSClassifyRequest {
    description: String,
}

#[derive(Serialize)]
struct HSClassifyResponse {
    hs_code: String,
    chapter: u32,
    duty_rate: f64,
    confidence: f64,
    latency_us: u128,
}

// ─── Business Logic ───────────────────────────────────────────────────────────

fn calculate_wto_valuation(req: &ValuationRequest) -> ValuationResponse {
    let start = Instant::now();
    let cif_value = req.transaction_value + req.freight + req.insurance;
    let import_duty = cif_value * req.duty_rate;
    let ciss = cif_value * 0.01;
    let etl = cif_value * 0.005;
    let nta = cif_value * 0.005;
    let landing_cost = cif_value + import_duty + ciss + etl + nta;
    let import_vat = landing_cost * 0.075;
    ValuationResponse {
        cif_value,
        import_duty,
        ciss,
        etl,
        nta,
        landing_cost,
        import_vat,
        method: "WTO_CVA_METHOD_1".to_string(),
        latency_us: start.elapsed().as_micros(),
    }
}

fn validate_lpco(req: &LPCORequest) -> LPCOResponse {
    let start = Instant::now();

    struct Rule {
        hs_prefix: &'static str,
        agency: &'static str,
        license_required: bool,
        max_quantity: Option<f64>,
        prohibited_origins: Vec<&'static str>,
        requires_inspection: bool,
    }

    let rules = vec![
        Rule { hs_prefix: "0201", agency: "NAQS", license_required: true, max_quantity: Some(10_000.0), prohibited_origins: vec!["UK"], requires_inspection: true },
        Rule { hs_prefix: "8471", agency: "NCC", license_required: false, max_quantity: None, prohibited_origins: vec![], requires_inspection: false },
        Rule { hs_prefix: "2710", agency: "DPR", license_required: true, max_quantity: None, prohibited_origins: vec![], requires_inspection: true },
        Rule { hs_prefix: "3004", agency: "NAFDAC", license_required: true, max_quantity: None, prohibited_origins: vec![], requires_inspection: true },
        Rule { hs_prefix: "8703", agency: "FRSC", license_required: false, max_quantity: None, prohibited_origins: vec![], requires_inspection: false },
        Rule { hs_prefix: "9301", agency: "NPS", license_required: true, max_quantity: Some(0.0), prohibited_origins: vec!["KP", "IR", "SY"], requires_inspection: true },
    ];

    for rule in &rules {
        if req.hs_code.starts_with(rule.hs_prefix) {
            let mut violations = Vec::new();
            let prohibited = rule.prohibited_origins.contains(&req.country_of_origin.as_str());
            if prohibited {
                violations.push(format!("Origin {} prohibited for HS {}", req.country_of_origin, req.hs_code));
            }
            if let Some(max_qty) = rule.max_quantity {
                if req.quantity > max_qty {
                    violations.push(format!("Quantity {:.0} exceeds max {:.0}", req.quantity, max_qty));
                }
            }
            return LPCOResponse {
                hs_code: req.hs_code.clone(),
                agency: rule.agency.to_string(),
                license_required: rule.license_required,
                inspection_required: rule.requires_inspection,
                prohibited,
                passed: violations.is_empty(),
                violations,
                latency_us: start.elapsed().as_micros(),
            };
        }
    }

    LPCOResponse {
        hs_code: req.hs_code.clone(),
        agency: "NONE".to_string(),
        license_required: false,
        inspection_required: false,
        prohibited: false,
        violations: vec![],
        passed: true,
        latency_us: start.elapsed().as_micros(),
    }
}

fn classify_hs(req: &HSClassifyRequest) -> HSClassifyResponse {
    let start = Instant::now();
    let desc = req.description.to_lowercase();

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

    for (keyword, hs_code, chapter, duty_rate) in &rules {
        if desc.contains(keyword) {
            return HSClassifyResponse {
                hs_code: hs_code.to_string(),
                chapter: *chapter,
                duty_rate: *duty_rate,
                confidence: 0.92,
                latency_us: start.elapsed().as_micros(),
            };
        }
    }

    HSClassifyResponse {
        hs_code: "9999999999".to_string(),
        chapter: 99,
        duty_rate: 0.20,
        confidence: 0.30,
        latency_us: start.elapsed().as_micros(),
    }
}

// ─── HTTP Server ──────────────────────────────────────────────────────────────

fn make_response(status: u16, body: &str) -> String {
    format!(
        "HTTP/1.1 {} OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
        status,
        body.len(),
        body
    )
}

fn route_request(method: &str, path: &str, body: &str) -> String {
    REQUEST_COUNT.fetch_add(1, Ordering::Relaxed);

    match (method, path) {
        ("GET", "/health") => {
            make_response(200, r#"{"status":"ok","service":"tradegateway-rust-benchmark"}"#)
        }
        ("GET", "/v1/stats") => {
            let total = REQUEST_COUNT.load(Ordering::Relaxed);
            let errors = ERROR_COUNT.load(Ordering::Relaxed);
            let body = format!(
                r#"{{"total_requests":{},"total_errors":{},"error_rate_pct":{:.4}}}"#,
                total,
                errors,
                if total > 0 { errors as f64 / total as f64 * 100.0 } else { 0.0 }
            );
            make_response(200, &body)
        }
        ("POST", "/v1/wto/valuation") => {
            match serde_json::from_str::<ValuationRequest>(body) {
                Ok(req) => {
                    let result = calculate_wto_valuation(&req);
                    make_response(200, &serde_json::to_string(&result).unwrap())
                }
                Err(e) => {
                    ERROR_COUNT.fetch_add(1, Ordering::Relaxed);
                    make_response(400, &format!(r#"{{"error":"{}"}}"#, e))
                }
            }
        }
        ("POST", "/v1/lpco/validate") => {
            match serde_json::from_str::<LPCORequest>(body) {
                Ok(req) => {
                    let result = validate_lpco(&req);
                    make_response(200, &serde_json::to_string(&result).unwrap())
                }
                Err(e) => {
                    ERROR_COUNT.fetch_add(1, Ordering::Relaxed);
                    make_response(400, &format!(r#"{{"error":"{}"}}"#, e))
                }
            }
        }
        ("POST", "/v1/hs/classify") => {
            match serde_json::from_str::<HSClassifyRequest>(body) {
                Ok(req) => {
                    let result = classify_hs(&req);
                    make_response(200, &serde_json::to_string(&result).unwrap())
                }
                Err(e) => {
                    ERROR_COUNT.fetch_add(1, Ordering::Relaxed);
                    make_response(400, &format!(r#"{{"error":"{}"}}"#, e))
                }
            }
        }
        _ => make_response(404, r#"{"error":"not found"}"#),
    }
}

async fn handle_connection(mut stream: tokio::net::TcpStream) {
    let mut buf = vec![0u8; 8192];
    let n = match stream.read(&mut buf).await {
        Ok(n) if n > 0 => n,
        _ => return,
    };

    let request = String::from_utf8_lossy(&buf[..n]);
    let lines: Vec<&str> = request.lines().collect();

    if lines.is_empty() {
        return;
    }

    let first_line: Vec<&str> = lines[0].split_whitespace().collect();
    if first_line.len() < 2 {
        return;
    }

    let method = first_line[0];
    let path = first_line[1].split('?').next().unwrap_or(first_line[1]);

    // Find body (after blank line)
    let body = if let Some(pos) = request.find("\r\n\r\n") {
        &request[pos + 4..]
    } else if let Some(pos) = request.find("\n\n") {
        &request[pos + 2..]
    } else {
        ""
    };

    let response = route_request(method, path, body);
    let _ = stream.write_all(response.as_bytes()).await;
}

#[tokio::main]
async fn main() {
    let port = std::env::var("PORT").unwrap_or_else(|_| "8092".to_string());
    let addr: SocketAddr = format!("0.0.0.0:{}", port).parse().unwrap();

    let listener = TcpListener::bind(addr).await.unwrap();
    println!("Rust benchmark server listening on :{}", port);

    loop {
        match listener.accept().await {
            Ok((stream, _)) => {
                tokio::spawn(handle_connection(stream));
            }
            Err(e) => eprintln!("Accept error: {}", e),
        }
    }
}
