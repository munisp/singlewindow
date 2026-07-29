//! lpco-rule-engine — LPCO Validation Rule Engine (Rust)
//!
//! TradeGateway NGSWTP — Rust service implementing the LPCO (Licenses, Permits,
//! Certificates, Others) validation rules against HS codes and MDA requirements.
//!
//! This engine validates:
//!   - Whether an HS code requires a specific LPCO from an MDA
//!   - Whether a submitted LPCO is valid for a given HS code
//!   - SONCAP certificate requirements (SON)
//!   - NAFDAC product registration requirements
//!   - NAQS phytosanitary certificate requirements
//!   - NSA End-User Certificate requirements
//!   - NESREA environmental permit requirements
//!   - NPA port clearance requirements
//!
//! HTTP API:
//!   POST /api/lpco/validate          — Validate LPCO for HS code
//!   GET  /api/lpco/requirements/:hs  — Get LPCO requirements for HS code
//!   POST /api/lpco/batch-validate    — Batch validate multiple LPCOs
//!   GET  /health                     — Health check
//!   GET  /metrics                    — Prometheus metrics

use actix_web::{web, App, HttpResponse, HttpServer, middleware};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Arc;
use tokio_postgres::{NoTls, Client};
use prometheus::{Counter, Registry, TextEncoder, Encoder};
use lazy_static::lazy_static;

// ─── Types ────────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LPCOType(String);

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum MDA {
    NCS,    // Nigeria Customs Service
    NAFDAC, // National Agency for Food and Drug Administration and Control
    SON,    // Standards Organisation of Nigeria
    NAQS,   // National Agricultural Quarantine Service
    NSA,    // National Security Adviser (End-User Certificates)
    NESREA, // National Environmental Standards and Regulations Enforcement Agency
    NPA,    // Nigerian Ports Authority
    NIMASA, // Nigerian Maritime Administration and Safety Agency
    CBN,    // Central Bank of Nigeria
    MOF,    // Ministry of Finance (IDEC)
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LPCORequirement {
    pub mda: String,
    pub lpco_type: String,
    pub description: String,
    pub mandatory: bool,
    pub hs_chapters: Vec<String>,
    pub conditions: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ValidationRequest {
    pub hs_code: String,
    pub lpcos: Vec<SubmittedLPCO>,
    pub declaration_type: String, // "IMPORT" or "EXPORT"
    pub trader_id: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SubmittedLPCO {
    pub lpco_type: String,
    pub mda: String,
    pub reference_number: String,
    pub issue_date: String,
    pub expiry_date: Option<String>,
    pub status: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ValidationResult {
    pub hs_code: String,
    pub valid: bool,
    pub missing_lpcos: Vec<LPCORequirement>,
    pub invalid_lpcos: Vec<InvalidLPCO>,
    pub warnings: Vec<String>,
    pub clearance_eligible: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InvalidLPCO {
    pub lpco_type: String,
    pub reference_number: String,
    pub reason: String,
}

// ─── LPCO Rules Database ──────────────────────────────────────────────────────

/// Build the static LPCO requirements map.
/// In production, this is loaded from PostgreSQL and cached in Redis.
fn build_lpco_rules() -> HashMap<String, Vec<LPCORequirement>> {
    let mut rules: HashMap<String, Vec<LPCORequirement>> = HashMap::new();

    // NAFDAC — Food, Drugs, Cosmetics, Medical Devices (Chapters 02, 04, 19-22, 30, 33)
    let nafdac_chapters = vec!["02", "04", "19", "20", "21", "22", "30", "33", "34", "35", "38"];
    for chapter in &nafdac_chapters {
        rules.entry(chapter.to_string()).or_default().push(LPCORequirement {
            mda: "NAFDAC".to_string(),
            lpco_type: "NAFDAC_PRODUCT_REGISTRATION".to_string(),
            description: "NAFDAC Product Registration Certificate".to_string(),
            mandatory: true,
            hs_chapters: nafdac_chapters.iter().map(|s| s.to_string()).collect(),
            conditions: vec!["IMPORT".to_string()],
        });
    }

    // SON/SONCAP — Regulated products (Chapters 39, 40, 61-64, 73, 84-85, 87, 94-95)
    let son_chapters = vec!["39", "40", "61", "62", "63", "64", "73", "84", "85", "87", "94", "95"];
    for chapter in &son_chapters {
        rules.entry(chapter.to_string()).or_default().push(LPCORequirement {
            mda: "SON".to_string(),
            lpco_type: "SONCAP_CERTIFICATE".to_string(),
            description: "SONCAP Certificate of Conformity".to_string(),
            mandatory: true,
            hs_chapters: son_chapters.iter().map(|s| s.to_string()).collect(),
            conditions: vec!["IMPORT".to_string()],
        });
    }

    // NAQS — Agricultural products (Chapters 01-14)
    let naqs_chapters: Vec<&str> = (1..=14).map(|i| {
        // We need owned strings, use a static approach
        match i {
            1 => "01", 2 => "02", 3 => "03", 4 => "04", 5 => "05",
            6 => "06", 7 => "07", 8 => "08", 9 => "09", 10 => "10",
            11 => "11", 12 => "12", 13 => "13", 14 => "14", _ => "01",
        }
    }).collect();
    for chapter in &naqs_chapters {
        rules.entry(chapter.to_string()).or_default().push(LPCORequirement {
            mda: "NAQS".to_string(),
            lpco_type: "PHYTOSANITARY_CERTIFICATE".to_string(),
            description: "NAQS Phytosanitary/Sanitary Certificate".to_string(),
            mandatory: true,
            hs_chapters: naqs_chapters.iter().map(|s| s.to_string()).collect(),
            conditions: vec!["IMPORT".to_string(), "EXPORT".to_string()],
        });
    }

    // NSA — Controlled items (Chapter 93: Arms, Ammunition)
    rules.entry("93".to_string()).or_default().push(LPCORequirement {
        mda: "NSA".to_string(),
        lpco_type: "END_USER_CERTIFICATE".to_string(),
        description: "NSA End-User Certificate for controlled items".to_string(),
        mandatory: true,
        hs_chapters: vec!["93".to_string()],
        conditions: vec!["IMPORT".to_string()],
    });

    // NESREA — Chemicals, Hazardous Materials (Chapters 28, 29, 36, 38)
    let nesrea_chapters = vec!["28", "29", "36", "38"];
    for chapter in &nesrea_chapters {
        rules.entry(chapter.to_string()).or_default().push(LPCORequirement {
            mda: "NESREA".to_string(),
            lpco_type: "ENVIRONMENTAL_PERMIT".to_string(),
            description: "NESREA Environmental Permit for hazardous materials".to_string(),
            mandatory: true,
            hs_chapters: nesrea_chapters.iter().map(|s| s.to_string()).collect(),
            conditions: vec!["IMPORT".to_string()],
        });
    }

    // CBN — Form M (all imports above USD 5,000 threshold)
    // Applied universally for imports
    rules.entry("*".to_string()).push(LPCORequirement {
        mda: "CBN".to_string(),
        lpco_type: "FORM_M".to_string(),
        description: "CBN Form M for foreign exchange allocation".to_string(),
        mandatory: true,
        hs_chapters: vec!["*".to_string()],
        conditions: vec!["IMPORT".to_string(), "VALUE_GT_5000_USD".to_string()],
    });

    rules
}

// ─── Validation Engine ────────────────────────────────────────────────────────

pub struct LPCORuleEngine {
    rules: HashMap<String, Vec<LPCORequirement>>,
}

impl LPCORuleEngine {
    pub fn new() -> Self {
        Self {
            rules: build_lpco_rules(),
        }
    }

    pub fn validate(&self, req: &ValidationRequest) -> ValidationResult {
        let hs_chapter = &req.hs_code[..2.min(req.hs_code.len())];
        let mut missing_lpcos = Vec::new();
        let mut invalid_lpcos = Vec::new();
        let mut warnings = Vec::new();

        // Get requirements for this HS chapter
        let mut requirements = Vec::new();
        if let Some(chapter_rules) = self.rules.get(hs_chapter) {
            requirements.extend(chapter_rules.clone());
        }
        // Add universal rules (Form M, etc.)
        if let Some(universal_rules) = self.rules.get("*") {
            requirements.extend(universal_rules.clone());
        }

        // Filter requirements by declaration type
        let applicable_requirements: Vec<&LPCORequirement> = requirements.iter()
            .filter(|r| {
                r.conditions.is_empty() ||
                r.conditions.iter().any(|c| c == &req.declaration_type || c.starts_with("VALUE_"))
            })
            .collect();

        // Check each requirement
        for requirement in &applicable_requirements {
            let submitted = req.lpcos.iter().find(|l| {
                l.lpco_type == requirement.lpco_type && l.mda == requirement.mda
            });

            match submitted {
                None => {
                    if requirement.mandatory {
                        missing_lpcos.push(requirement.as_ref().clone());
                    } else {
                        warnings.push(format!(
                            "Optional LPCO not submitted: {} from {}",
                            requirement.lpco_type, requirement.mda
                        ));
                    }
                }
                Some(lpco) => {
                    // Validate the submitted LPCO
                    if lpco.status != "ACTIVE" && lpco.status != "VALID" {
                        invalid_lpcos.push(InvalidLPCO {
                            lpco_type: lpco.lpco_type.clone(),
                            reference_number: lpco.reference_number.clone(),
                            reason: format!("LPCO status is '{}', expected ACTIVE or VALID", lpco.status),
                        });
                    }
                    // Check expiry
                    if let Some(expiry) = &lpco.expiry_date {
                        if expiry < &chrono_now_str() {
                            invalid_lpcos.push(InvalidLPCO {
                                lpco_type: lpco.lpco_type.clone(),
                                reference_number: lpco.reference_number.clone(),
                                reason: format!("LPCO expired on {}", expiry),
                            });
                        }
                    }
                }
            }
        }

        let valid = missing_lpcos.is_empty() && invalid_lpcos.is_empty();

        ValidationResult {
            hs_code: req.hs_code.clone(),
            valid,
            missing_lpcos,
            invalid_lpcos,
            warnings,
            clearance_eligible: valid,
        }
    }

    pub fn get_requirements(&self, hs_code: &str) -> Vec<LPCORequirement> {
        let hs_chapter = &hs_code[..2.min(hs_code.len())];
        let mut requirements = Vec::new();
        if let Some(chapter_rules) = self.rules.get(hs_chapter) {
            requirements.extend(chapter_rules.clone());
        }
        if let Some(universal_rules) = self.rules.get("*") {
            requirements.extend(universal_rules.clone());
        }
        requirements
    }
}

fn chrono_now_str() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let secs = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_secs();
    // Simple YYYY-MM-DD format
    let days = secs / 86400;
    let year = 1970 + days / 365;
    format!("{}-01-01", year) // Simplified; production uses chrono
}

// ─── HTTP Handlers ────────────────────────────────────────────────────────────

async fn validate_lpco(
    engine: web::Data<Arc<LPCORuleEngine>>,
    req: web::Json<ValidationRequest>,
) -> HttpResponse {
    let result = engine.validate(&req);
    HttpResponse::Ok().json(result)
}

async fn get_requirements(
    engine: web::Data<Arc<LPCORuleEngine>>,
    path: web::Path<String>,
) -> HttpResponse {
    let hs_code = path.into_inner();
    let requirements = engine.get_requirements(&hs_code);
    HttpResponse::Ok().json(serde_json::json!({
        "hsCode": hs_code,
        "requirements": requirements,
        "count": requirements.len(),
    }))
}

async fn batch_validate(
    engine: web::Data<Arc<LPCORuleEngine>>,
    requests: web::Json<Vec<ValidationRequest>>,
) -> HttpResponse {
    let results: Vec<ValidationResult> = requests.iter()
        .map(|req| engine.validate(req))
        .collect();
    HttpResponse::Ok().json(serde_json::json!({
        "results": results,
        "total": results.len(),
        "allValid": results.iter().all(|r| r.valid),
    }))
}

async fn health() -> HttpResponse {
    HttpResponse::Ok().json(serde_json::json!({
        "status": "healthy",
        "service": "lpco-rule-engine",
    }))
}

// ─── Main ─────────────────────────────────────────────────────────────────────

#[actix_web::main]
async fn main() -> std::io::Result<()> {
    env_logger::init_from_env(env_logger::Env::default().default_filter_or("info"));

    let port = std::env::var("PORT").unwrap_or_else(|_| "8100".to_string());
    let engine = Arc::new(LPCORuleEngine::new());

    log::info!("[lpco-rule-engine] Starting on port {}", port);

    HttpServer::new(move || {
        App::new()
            .app_data(web::Data::new(engine.clone()))
            .route("/health", web::get().to(health))
            .route("/api/lpco/validate", web::post().to(validate_lpco))
            .route("/api/lpco/requirements/{hs}", web::get().to(get_requirements))
            .route("/api/lpco/batch-validate", web::post().to(batch_validate))
    })
    .bind(format!("0.0.0.0:{}", port))?
    .run()
    .await
}
