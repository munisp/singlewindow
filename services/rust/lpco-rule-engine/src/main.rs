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
//!   - CBN Form M requirements
//!
//! HTTP API:
//!   POST /api/lpco/validate          — Validate LPCO for HS code
//!   GET  /api/lpco/requirements/:hs  — Get LPCO requirements for HS code
//!   POST /api/lpco/batch-validate    — Batch validate multiple LPCOs
//!   GET  /api/lpco/mdas              — List all MDAs and their LPCO types
//!   GET  /health                     — Health check
//!   GET  /metrics                    — Prometheus metrics
//!
//! Port: 8100

use actix_web::{web, App, HttpResponse, HttpServer};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Arc;

// ─── Types ────────────────────────────────────────────────────────────────────

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
    pub issue_date: Option<String>,
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

fn build_lpco_rules() -> HashMap<String, Vec<LPCORequirement>> {
    let mut rules: HashMap<String, Vec<LPCORequirement>> = HashMap::new();

    // NAFDAC — Food, Drugs, Cosmetics, Medical Devices
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

    // SON/SONCAP — Regulated products
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
    let naqs_chapters = vec!["01", "02", "03", "04", "05", "06", "07", "08", "09", "10", "11", "12", "13", "14"];
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

    // NESREA — Chemicals, Hazardous Materials
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
    rules.entry("*".to_string()).or_default().push(LPCORequirement {
        mda: "CBN".to_string(),
        lpco_type: "FORM_M".to_string(),
        description: "CBN Form M for foreign exchange allocation".to_string(),
        mandatory: true,
        hs_chapters: vec!["*".to_string()],
        conditions: vec!["IMPORT".to_string(), "VALUE_GT_5000_USD".to_string()],
    });

    // NIMASA — Vessels and maritime equipment (Chapter 89)
    rules.entry("89".to_string()).or_default().push(LPCORequirement {
        mda: "NIMASA".to_string(),
        lpco_type: "VESSEL_REGISTRATION".to_string(),
        description: "NIMASA Vessel Registration Certificate".to_string(),
        mandatory: true,
        hs_chapters: vec!["89".to_string()],
        conditions: vec!["IMPORT".to_string()],
    });

    // NPA — Port clearance for all sea imports
    rules.entry("*".to_string()).or_default().push(LPCORequirement {
        mda: "NPA".to_string(),
        lpco_type: "PORT_CLEARANCE".to_string(),
        description: "NPA Port Clearance Certificate".to_string(),
        mandatory: true,
        hs_chapters: vec!["*".to_string()],
        conditions: vec!["IMPORT_SEA".to_string()],
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
        let hs_chapter = if req.hs_code.len() >= 2 {
            &req.hs_code[..2]
        } else {
            req.hs_code.as_str()
        };

        let mut missing_lpcos = Vec::new();
        let mut invalid_lpcos = Vec::new();
        let mut warnings = Vec::new();

        // Collect requirements for this HS chapter + universal rules
        let mut requirements: Vec<LPCORequirement> = Vec::new();
        if let Some(chapter_rules) = self.rules.get(hs_chapter) {
            requirements.extend(chapter_rules.clone());
        }
        if let Some(universal_rules) = self.rules.get("*") {
            requirements.extend(universal_rules.clone());
        }

        // Filter requirements by declaration type
        let applicable_requirements: Vec<&LPCORequirement> = requirements
            .iter()
            .filter(|r| {
                r.conditions.is_empty()
                    || r.conditions.iter().any(|c| {
                        c == &req.declaration_type
                            || c.starts_with("VALUE_")
                            || c.starts_with("IMPORT_")
                    })
            })
            .collect();

        // Check each requirement against submitted LPCOs
        for requirement in &applicable_requirements {
            let submitted = req.lpcos.iter().find(|l| {
                l.lpco_type == requirement.lpco_type && l.mda == requirement.mda
            });

            match submitted {
                None => {
                    if requirement.mandatory {
                        missing_lpcos.push((*requirement).clone());
                    } else {
                        warnings.push(format!(
                            "Optional LPCO not submitted: {} from {}",
                            requirement.lpco_type, requirement.mda
                        ));
                    }
                }
                Some(lpco) => {
                    // Validate status
                    let valid_statuses = ["ACTIVE", "VALID", "APPROVED", "ISSUED"];
                    if !valid_statuses.contains(&lpco.status.as_str()) {
                        invalid_lpcos.push(InvalidLPCO {
                            lpco_type: lpco.lpco_type.clone(),
                            reference_number: lpco.reference_number.clone(),
                            reason: format!(
                                "LPCO status is '{}', expected one of: {}",
                                lpco.status,
                                valid_statuses.join(", ")
                            ),
                        });
                        continue;
                    }

                    // Validate expiry using chrono for proper date arithmetic
                    if let Some(expiry_str) = &lpco.expiry_date {
                        let now: DateTime<Utc> = Utc::now();
                        // Try parsing ISO 8601 format first, then YYYY-MM-DD
                        let expiry_result = expiry_str
                            .parse::<DateTime<Utc>>()
                            .or_else(|_| {
                                chrono::NaiveDate::parse_from_str(expiry_str, "%Y-%m-%d")
                                    .map(|d| d.and_hms_opt(23, 59, 59).unwrap().and_utc())
                            });

                        match expiry_result {
                            Ok(expiry_dt) => {
                                if expiry_dt < now {
                                    invalid_lpcos.push(InvalidLPCO {
                                        lpco_type: lpco.lpco_type.clone(),
                                        reference_number: lpco.reference_number.clone(),
                                        reason: format!(
                                            "LPCO expired on {} (current time: {})",
                                            expiry_dt.format("%Y-%m-%d"),
                                            now.format("%Y-%m-%d")
                                        ),
                                    });
                                } else {
                                    // Warn if expiring within 30 days
                                    let days_until_expiry = (expiry_dt - now).num_days();
                                    if days_until_expiry <= 30 {
                                        warnings.push(format!(
                                            "LPCO {} (ref: {}) expires in {} days on {}",
                                            lpco.lpco_type,
                                            lpco.reference_number,
                                            days_until_expiry,
                                            expiry_dt.format("%Y-%m-%d")
                                        ));
                                    }
                                }
                            }
                            Err(_) => {
                                warnings.push(format!(
                                    "Could not parse expiry date '{}' for LPCO {} (ref: {})",
                                    expiry_str, lpco.lpco_type, lpco.reference_number
                                ));
                            }
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
        let hs_chapter = if hs_code.len() >= 2 { &hs_code[..2] } else { hs_code };
        let mut requirements = Vec::new();
        if let Some(chapter_rules) = self.rules.get(hs_chapter) {
            requirements.extend(chapter_rules.clone());
        }
        if let Some(universal_rules) = self.rules.get("*") {
            requirements.extend(universal_rules.clone());
        }
        requirements
    }

    pub fn list_mdas(&self) -> Vec<serde_json::Value> {
        vec![
            serde_json::json!({"code": "NAFDAC", "name": "National Agency for Food and Drug Administration and Control", "lpco_types": ["NAFDAC_PRODUCT_REGISTRATION"]}),
            serde_json::json!({"code": "SON", "name": "Standards Organisation of Nigeria", "lpco_types": ["SONCAP_CERTIFICATE"]}),
            serde_json::json!({"code": "NAQS", "name": "National Agricultural Quarantine Service", "lpco_types": ["PHYTOSANITARY_CERTIFICATE"]}),
            serde_json::json!({"code": "NSA", "name": "National Security Adviser", "lpco_types": ["END_USER_CERTIFICATE"]}),
            serde_json::json!({"code": "NESREA", "name": "National Environmental Standards and Regulations Enforcement Agency", "lpco_types": ["ENVIRONMENTAL_PERMIT"]}),
            serde_json::json!({"code": "CBN", "name": "Central Bank of Nigeria", "lpco_types": ["FORM_M"]}),
            serde_json::json!({"code": "NIMASA", "name": "Nigerian Maritime Administration and Safety Agency", "lpco_types": ["VESSEL_REGISTRATION"]}),
            serde_json::json!({"code": "NPA", "name": "Nigerian Ports Authority", "lpco_types": ["PORT_CLEARANCE"]}),
        ]
    }
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
    let all_valid = results.iter().all(|r| r.valid);
    HttpResponse::Ok().json(serde_json::json!({
        "results": results,
        "total": results.len(),
        "allValid": all_valid,
    }))
}

async fn list_mdas(engine: web::Data<Arc<LPCORuleEngine>>) -> HttpResponse {
    let mdas = engine.list_mdas();
    HttpResponse::Ok().json(serde_json::json!({
        "mdas": mdas,
        "count": mdas.len(),
    }))
}

async fn health() -> HttpResponse {
    HttpResponse::Ok().json(serde_json::json!({
        "status": "healthy",
        "service": "lpco-rule-engine",
        "version": "1.0.0",
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
            .route("/api/lpco/mdas", web::get().to(list_mdas))
    })
    .bind(format!("0.0.0.0:{}", port))?
    .run()
    .await
}
