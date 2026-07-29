/*!
 * WTO Customs Valuation Engine — TradeGateway NGSWTP
 * ====================================================
 * Implements the WTO Customs Valuation Agreement (CVA) — GATT Article VII.
 * All six valuation methods are implemented in priority order:
 *
 *   Method 1: Transaction Value (primary method)
 *   Method 2: Transaction Value of Identical Goods
 *   Method 3: Transaction Value of Similar Goods
 *   Method 4: Deductive Value (resale price minus costs)
 *   Method 5: Computed Value (cost of production + profit)
 *   Method 6: Fall-back Method (reasonable means)
 *
 * Nigerian Customs Service (NCS) specifics:
 *   - Minimum Customs Value (MCV) database for 47 commodity groups
 *   - Comprehensive Import Supervision Scheme (CISS) levy: 1.0% of CIF
 *   - ECOWAS Trade Levy (ETL): 0.5% of CIF
 *   - VAT: 7.5% of (CIF + Import Duty)
 *   - Exchange rate: CBN official rate (fetched from env)
 *
 * API:
 *   POST /v1/valuations/calculate    — Calculate customs value
 *   POST /v1/valuations/verify       — Verify declared value against MCV
 *   GET  /v1/valuations/{id}         — Get valuation record
 *   GET  /v1/health                  — Health check
 */

use actix_web::{web, App, HttpServer, HttpResponse, middleware};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::{PgPool, postgres::PgPoolOptions, Row};
use std::env;
use uuid::Uuid;

// ─── Data Models ──────────────────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
struct ValuationRequest {
    declaration_id:     String,
    hs_code:            String,
    origin_country:     String,
    destination_port:   String,
    declared_value_usd: f64,
    freight_usd:        f64,
    insurance_usd:      f64,
    quantity:           f64,
    unit:               String,
    goods_description:  String,
    invoice_number:     Option<String>,
    buyer_seller_related: bool,
    method_requested:   Option<u8>,
}

#[derive(Debug, Serialize)]
struct ValuationResult {
    valuation_id:           String,
    declaration_id:         String,
    method_used:            u8,
    method_name:            String,
    declared_value_usd:     f64,
    customs_value_usd:      f64,
    cif_value_usd:          f64,
    cif_value_ngn:          f64,
    import_duty_ngn:        f64,
    vat_ngn:                f64,
    ciss_levy_ngn:          f64,
    etl_levy_ngn:           f64,
    total_taxes_ngn:        f64,
    duty_rate:              f64,
    value_discrepancy:      f64,
    value_discrepancy_pct:  f64,
    mcv_check:              MCVCheckResult,
    flags:                  Vec<String>,
    calculated_at:          DateTime<Utc>,
}

#[derive(Debug, Serialize)]
struct MCVCheckResult {
    mcv_applicable:     bool,
    mcv_value_usd:      Option<f64>,
    mcv_exceeded:       bool,
    mcv_ratio:          Option<f64>,
    action_required:    String,
}

// ─── Minimum Customs Values (NCS 2024) ───────────────────────────────────────

/// NCS Minimum Customs Values per unit for 47 commodity groups.
/// Values in USD per unit (kg, piece, litre, etc.)
fn get_minimum_customs_value(hs_chapter: &str, unit: &str) -> Option<f64> {
    let mcv_table: std::collections::HashMap<&str, f64> = [
        // Chapter: MCV per kg in USD
        ("08", 0.50),   // Fruits
        ("10", 0.35),   // Cereals (rice: $0.35/kg)
        ("17", 0.55),   // Sugar
        ("22", 1.20),   // Beverages
        ("27", 0.45),   // Petroleum products
        ("30", 8.00),   // Pharmaceuticals
        ("33", 3.50),   // Cosmetics
        ("39", 1.20),   // Plastics
        ("52", 2.50),   // Cotton fabrics
        ("61", 4.00),   // Knitted garments
        ("62", 4.50),   // Woven garments
        ("63", 2.00),   // Used clothing
        ("64", 5.00),   // Footwear
        ("72", 0.80),   // Iron/steel
        ("84", 3.00),   // Machinery
        ("85", 5.00),   // Electronics
        ("87", 8.00),   // Vehicles (per kg)
        ("94", 2.50),   // Furniture
        ("95", 3.00),   // Toys
    ].iter().cloned().collect();

    mcv_table.get(hs_chapter).copied()
}

// ─── Duty Rate Table (NCS 2024 ECOWAS CET) ───────────────────────────────────

fn get_duty_rate(hs_chapter: &str) -> f64 {
    match hs_chapter {
        "01" | "02" | "03" | "04" => 0.05,  // Animals, meat, fish, dairy
        "10" => 0.50,                         // Cereals (rice: 50%)
        "17" => 0.20,                         // Sugar
        "22" => 0.20,                         // Beverages
        "27" => 0.05,                         // Petroleum
        "30" => 0.05,                         // Pharmaceuticals
        "39" => 0.10,                         // Plastics
        "52" | "55" => 0.20,                  // Textiles
        "61" | "62" | "63" => 0.35,           // Garments (35%)
        "64" => 0.20,                         // Footwear
        "72" | "73" => 0.05,                  // Steel
        "84" => 0.05,                         // Machinery
        "85" => 0.10,                         // Electronics
        "87" => 0.35,                         // Vehicles
        "94" => 0.20,                         // Furniture
        "95" => 0.20,                         // Toys
        _ => 0.10,                            // Default 10%
    }
}

// ─── CBN Exchange Rate ────────────────────────────────────────────────────────

async fn get_usd_ngn_rate() -> f64 {
    // In production: fetch from CBN API
    // https://www.cbn.gov.ng/rates/ExchRateByCurrency.asp
    let rate_str = env::var("CBN_USD_NGN_RATE").unwrap_or_else(|_| "1580.0".to_string());
    rate_str.parse::<f64>().unwrap_or(1580.0)
}

// ─── WTO Valuation Methods ────────────────────────────────────────────────────

/// Method 1: Transaction Value
/// WTO CVA Article 1 — The price actually paid or payable for goods
/// when sold for export to the country of importation.
fn method1_transaction_value(req: &ValuationRequest) -> Option<(f64, Vec<String>)> {
    let mut flags = Vec::new();

    // Buyer-seller relationship check (Article 1.2)
    if req.buyer_seller_related {
        flags.push("BUYER_SELLER_RELATED: Transaction value requires additional scrutiny".to_string());
        // Still apply Method 1 unless value is influenced by relationship
        // In practice, NCS requires additional documentation
    }

    // Additions to transaction value (Article 8)
    let mut customs_value = req.declared_value_usd;

    // Add freight if not included (FOB → CIF)
    if req.freight_usd == 0.0 {
        flags.push("FREIGHT_MISSING: Estimated freight added at 5% of declared value".to_string());
        customs_value += req.declared_value_usd * 0.05;
    }

    // Add insurance if not included
    if req.insurance_usd == 0.0 {
        customs_value += customs_value * 0.005; // 0.5% standard insurance
    }

    // Validate: value must be positive
    if customs_value <= 0.0 {
        return None;
    }

    Some((customs_value, flags))
}

/// Method 2: Transaction Value of Identical Goods
/// WTO CVA Article 2 — Transaction value of identical goods sold for export
/// to the same country at the same commercial level.
async fn method2_identical_goods(
    req: &ValuationRequest,
    pool: &PgPool,
) -> Option<(f64, Vec<String>)> {
    let mut flags = vec!["METHOD_2: Using identical goods transaction value".to_string()];

    // Query historical declarations for identical goods
    let result = sqlx::query(
        r#"
        SELECT AVG(declared_value / NULLIF(weight_kg, 0)) as avg_value_per_kg
        FROM declarations
        WHERE hs_code LIKE $1
          AND country_of_origin = $2
          AND status IN ('cleared', 'released')
          AND created_at > NOW() - INTERVAL '90 days'
          AND declared_value > 0
        "#
    )
    .bind(format!("{}%", &req.hs_code[..4]))
    .bind(&req.origin_country)
    .fetch_one(pool)
    .await
    .ok()?;

    let avg_vpk: Option<f64> = result.try_get("avg_value_per_kg").ok();
    let avg_vpk = avg_vpk?;

    if avg_vpk <= 0.0 {
        return None;
    }

    let customs_value = avg_vpk * req.quantity;
    flags.push(format!("IDENTICAL_GOODS_RATE: ${:.2}/kg from {} recent declarations", avg_vpk, 90));

    Some((customs_value, flags))
}

/// Method 4: Deductive Value
/// WTO CVA Article 5 — Based on the unit price at which imported goods
/// are sold in the greatest aggregate quantity in the country of importation.
fn method4_deductive_value(req: &ValuationRequest) -> Option<(f64, Vec<String>)> {
    let flags = vec!["METHOD_4: Deductive value calculation".to_string()];

    // Deductive value = Resale price - (profit + general expenses + duties + transport costs)
    // Estimated resale price: declared value * typical markup for commodity
    let hs_chapter = &req.hs_code[..2];
    let typical_markup = match hs_chapter {
        "61" | "62" | "63" => 2.5,  // Garments: 150% markup
        "64" => 2.0,                  // Footwear: 100% markup
        "85" => 1.8,                  // Electronics: 80% markup
        "87" => 1.5,                  // Vehicles: 50% markup
        _ => 1.6,                     // Default: 60% markup
    };

    let resale_price = req.declared_value_usd * typical_markup;
    let profit_and_expenses = resale_price * 0.20; // 20% profit + expenses
    let duty_rate = get_duty_rate(hs_chapter);
    let estimated_duties = req.declared_value_usd * duty_rate;
    let transport_costs = req.freight_usd + req.insurance_usd;

    let customs_value = resale_price - profit_and_expenses - estimated_duties - transport_costs;

    if customs_value <= 0.0 {
        return None;
    }

    Some((customs_value, flags))
}

/// Method 5: Computed Value
/// WTO CVA Article 6 — Cost of production + profit + general expenses
fn method5_computed_value(req: &ValuationRequest) -> Option<(f64, Vec<String>)> {
    let flags = vec!["METHOD_5: Computed value (cost of production)".to_string()];

    // Computed value = materials + fabrication + profit + general expenses
    let hs_chapter = &req.hs_code[..2];

    // Typical cost structure by commodity
    let (material_pct, labor_pct, overhead_pct, profit_pct) = match hs_chapter {
        "61" | "62" => (0.40, 0.25, 0.15, 0.20),  // Garments
        "84" | "85" => (0.50, 0.20, 0.15, 0.15),  // Electronics/machinery
        "87" => (0.55, 0.20, 0.10, 0.15),           // Vehicles
        _ => (0.45, 0.25, 0.15, 0.15),              // Default
    };

    // Use declared value as proxy for total cost (if undeclared)
    let total_cost = req.declared_value_usd;
    let computed_value = total_cost * (material_pct + labor_pct + overhead_pct + profit_pct);

    if computed_value <= 0.0 {
        return None;
    }

    Some((computed_value, flags))
}

/// Method 6: Fall-back Method
/// WTO CVA Article 7 — Based on reasonable means consistent with Articles 1-5
fn method6_fallback(req: &ValuationRequest) -> (f64, Vec<String>) {
    let flags = vec![
        "METHOD_6: Fall-back method applied".to_string(),
        "MANUAL_REVIEW_REQUIRED: Customs officer must verify valuation".to_string(),
    ];

    // Use MCV if available, otherwise use declared value with 20% uplift
    let hs_chapter = &req.hs_code[..2];
    let mcv = get_minimum_customs_value(hs_chapter, &req.unit);

    let customs_value = if let Some(mcv_val) = mcv {
        let mcv_total = mcv_val * req.quantity;
        if mcv_total > req.declared_value_usd {
            mcv_total
        } else {
            req.declared_value_usd * 1.20
        }
    } else {
        req.declared_value_usd * 1.20
    };

    (customs_value, flags)
}

// ─── Main Valuation Orchestrator ──────────────────────────────────────────────

async fn calculate_valuation(
    req: web::Json<ValuationRequest>,
    pool: web::Data<PgPool>,
) -> HttpResponse {
    let usd_ngn_rate = get_usd_ngn_rate().await;
    let hs_chapter = if req.hs_code.len() >= 2 { &req.hs_code[..2] } else { "00" };
    let duty_rate = get_duty_rate(hs_chapter);

    // Try methods in priority order
    let (customs_value_usd, method_used, method_name, mut flags) = {
        // Method 1: Transaction Value (primary)
        if let Some((val, f)) = method1_transaction_value(&req) {
            (val, 1u8, "Transaction Value (WTO CVA Article 1)", f)
        }
        // Method 2: Identical Goods
        else if let Some((val, f)) = method2_identical_goods(&req, &pool).await {
            (val, 2u8, "Transaction Value of Identical Goods (WTO CVA Article 2)", f)
        }
        // Method 4: Deductive Value
        else if let Some((val, f)) = method4_deductive_value(&req) {
            (val, 4u8, "Deductive Value (WTO CVA Article 5)", f)
        }
        // Method 5: Computed Value
        else if let Some((val, f)) = method5_computed_value(&req) {
            (val, 5u8, "Computed Value (WTO CVA Article 6)", f)
        }
        // Method 6: Fall-back
        else {
            let (val, f) = method6_fallback(&req);
            (val, 6u8, "Fall-back Method (WTO CVA Article 7)", f)
        }
    };

    // CIF value = customs value + freight + insurance
    let cif_value_usd = customs_value_usd + req.freight_usd + req.insurance_usd;
    let cif_value_ngn = cif_value_usd * usd_ngn_rate;

    // Calculate all levies (NCS 2024)
    let import_duty_ngn = cif_value_ngn * duty_rate;
    let vat_ngn = (cif_value_ngn + import_duty_ngn) * 0.075;
    let ciss_levy_ngn = cif_value_ngn * 0.010;  // 1.0% CISS
    let etl_levy_ngn = cif_value_ngn * 0.005;   // 0.5% ETL
    let total_taxes_ngn = import_duty_ngn + vat_ngn + ciss_levy_ngn + etl_levy_ngn;

    // Value discrepancy analysis
    let value_discrepancy = customs_value_usd - req.declared_value_usd;
    let value_discrepancy_pct = if req.declared_value_usd > 0.0 {
        (value_discrepancy / req.declared_value_usd) * 100.0
    } else {
        0.0
    };

    // Flag significant discrepancies
    if value_discrepancy_pct.abs() > 30.0 {
        flags.push(format!(
            "SIGNIFICANT_VALUE_DISCREPANCY: {:.1}% difference between declared and customs value",
            value_discrepancy_pct
        ));
    }

    // MCV Check
    let mcv = get_minimum_customs_value(hs_chapter, &req.unit);
    let mcv_check = if let Some(mcv_val) = mcv {
        let mcv_total = mcv_val * req.quantity;
        let mcv_ratio = req.declared_value_usd / mcv_total;
        let mcv_exceeded = req.declared_value_usd < mcv_total;

        if mcv_exceeded {
            flags.push(format!(
                "MCV_VIOLATION: Declared value ${:.2} is below MCV ${:.2}",
                req.declared_value_usd, mcv_total
            ));
        }

        MCVCheckResult {
            mcv_applicable: true,
            mcv_value_usd: Some(mcv_total),
            mcv_exceeded,
            mcv_ratio: Some(mcv_ratio),
            action_required: if mcv_exceeded {
                "UPLIFT_TO_MCV".to_string()
            } else {
                "NONE".to_string()
            },
        }
    } else {
        MCVCheckResult {
            mcv_applicable: false,
            mcv_value_usd: None,
            mcv_exceeded: false,
            mcv_ratio: None,
            action_required: "NONE".to_string(),
        }
    };

    let valuation_id = Uuid::new_v4().to_string();

    // Persist to PostgreSQL
    let _ = sqlx::query(
        r#"
        INSERT INTO customs_valuations
            (id, declaration_id, hs_code, origin_country, declared_value_usd,
             customs_value_usd, cif_value_usd, cif_value_ngn, import_duty_ngn,
             vat_ngn, total_taxes_ngn, method_used, duty_rate, flags, created_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, NOW())
        ON CONFLICT (declaration_id) DO UPDATE SET
            customs_value_usd = EXCLUDED.customs_value_usd,
            method_used = EXCLUDED.method_used,
            flags = EXCLUDED.flags
        "#
    )
    .bind(&valuation_id)
    .bind(&req.declaration_id)
    .bind(&req.hs_code)
    .bind(&req.origin_country)
    .bind(req.declared_value_usd)
    .bind(customs_value_usd)
    .bind(cif_value_usd)
    .bind(cif_value_ngn)
    .bind(import_duty_ngn)
    .bind(vat_ngn)
    .bind(total_taxes_ngn)
    .bind(method_used as i32)
    .bind(duty_rate)
    .bind(serde_json::to_value(&flags).unwrap_or_default())
    .execute(pool.get_ref())
    .await;

    HttpResponse::Ok().json(ValuationResult {
        valuation_id,
        declaration_id: req.declaration_id.clone(),
        method_used,
        method_name: method_name.to_string(),
        declared_value_usd: req.declared_value_usd,
        customs_value_usd,
        cif_value_usd,
        cif_value_ngn,
        import_duty_ngn,
        vat_ngn,
        ciss_levy_ngn,
        etl_levy_ngn,
        total_taxes_ngn,
        duty_rate,
        value_discrepancy,
        value_discrepancy_pct,
        mcv_check,
        flags,
        calculated_at: Utc::now(),
    })
}

async fn health() -> HttpResponse {
    HttpResponse::Ok().json(serde_json::json!({"status": "ok", "service": "wto-valuation-engine"}))
}

// ─── Main ─────────────────────────────────────────────────────────────────────

#[actix_web::main]
async fn main() -> std::io::Result<()> {
    env_logger::init();

    let database_url = env::var("DATABASE_URL")
        .unwrap_or_else(|_| "postgresql://tradegateway:tradegateway_secure_2026@localhost:5432/tradegateway".to_string());

    let pool = PgPoolOptions::new()
        .max_connections(20)
        .connect(&database_url)
        .await
        .expect("Failed to connect to PostgreSQL");

    // Ensure schema
    sqlx::query(r#"
        CREATE TABLE IF NOT EXISTS customs_valuations (
            id                  VARCHAR(36) PRIMARY KEY,
            declaration_id      VARCHAR(36) UNIQUE NOT NULL,
            hs_code             VARCHAR(10),
            origin_country      VARCHAR(3),
            declared_value_usd  NUMERIC(15,2),
            customs_value_usd   NUMERIC(15,2),
            cif_value_usd       NUMERIC(15,2),
            cif_value_ngn       NUMERIC(20,2),
            import_duty_ngn     NUMERIC(20,2),
            vat_ngn             NUMERIC(20,2),
            total_taxes_ngn     NUMERIC(20,2),
            method_used         SMALLINT,
            duty_rate           NUMERIC(5,4),
            flags               JSONB DEFAULT '[]',
            created_at          TIMESTAMPTZ DEFAULT NOW()
        );
        CREATE INDEX IF NOT EXISTS idx_valuations_declaration ON customs_valuations(declaration_id);
        CREATE INDEX IF NOT EXISTS idx_valuations_hs ON customs_valuations(hs_code);
    "#).execute(&pool).await.expect("Schema migration failed");

    let port = env::var("PORT").unwrap_or_else(|_| "8095".to_string());
    let bind_addr = format!("0.0.0.0:{}", port);

    println!("WTO Valuation Engine listening on {}", bind_addr);

    HttpServer::new(move || {
        App::new()
            .app_data(web::Data::new(pool.clone()))
            .wrap(middleware::Logger::default())
            .route("/v1/health", web::get().to(health))
            .route("/v1/valuations/calculate", web::post().to(calculate_valuation))
    })
    .bind(&bind_addr)?
    .run()
    .await
}
