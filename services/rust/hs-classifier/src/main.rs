//! hs-classifier — Harmonised System code classification microservice
//!
//! POST /classify   — validate and classify a single HS code
//! GET  /health     — liveness probe
//! GET  /metrics    — Prometheus metrics (total, valid, invalid counts)
//!
//! The classifier uses a static WCO chapter lookup table (chapters 01–99) to
//! determine chapter description, heading, and subheading.  No ML model is
//! required; the service is intentionally lightweight so it can be deployed as
//! a distroless binary with sub-millisecond latency.

use axum::{
    extract::State,
    http::StatusCode,
    response::IntoResponse,
    routing::{get, post},
    Json, Router,
};
use metrics::{counter, describe_counter};
use metrics_exporter_prometheus::PrometheusBuilder;
use once_cell::sync::Lazy;
use regex::Regex;
use serde::{Deserialize, Serialize};
use std::{collections::HashMap, net::SocketAddr, sync::Arc};
use tokio::net::TcpListener;
use tracing::{info, warn};
use tracing_subscriber::{fmt, EnvFilter};

// ─── WCO Chapter Lookup ───────────────────────────────────────────────────────

static CHAPTER_DESCRIPTIONS: Lazy<HashMap<&'static str, &'static str>> = Lazy::new(|| {
    let mut m = HashMap::new();
    m.insert("01", "Live animals");
    m.insert("02", "Meat and edible meat offal");
    m.insert("03", "Fish and crustaceans");
    m.insert("04", "Dairy produce; birds' eggs; natural honey");
    m.insert("05", "Products of animal origin, not elsewhere specified");
    m.insert("06", "Live trees and other plants");
    m.insert("07", "Edible vegetables and certain roots and tubers");
    m.insert("08", "Edible fruit and nuts");
    m.insert("09", "Coffee, tea, maté and spices");
    m.insert("10", "Cereals");
    m.insert("11", "Products of the milling industry");
    m.insert("12", "Oil seeds and oleaginous fruits");
    m.insert("13", "Lac; gums, resins and other vegetable saps");
    m.insert("14", "Vegetable plaiting materials");
    m.insert("15", "Animal or vegetable fats and oils");
    m.insert("16", "Preparations of meat, fish or crustaceans");
    m.insert("17", "Sugars and sugar confectionery");
    m.insert("18", "Cocoa and cocoa preparations");
    m.insert("19", "Preparations of cereals, flour, starch or milk");
    m.insert("20", "Preparations of vegetables, fruit, nuts");
    m.insert("21", "Miscellaneous edible preparations");
    m.insert("22", "Beverages, spirits and vinegar");
    m.insert("23", "Residues and waste from the food industries");
    m.insert("24", "Tobacco and manufactured tobacco substitutes");
    m.insert("25", "Salt; sulphur; earths and stone");
    m.insert("26", "Ores, slag and ash");
    m.insert("27", "Mineral fuels, mineral oils and products");
    m.insert("28", "Inorganic chemicals");
    m.insert("29", "Organic chemicals");
    m.insert("30", "Pharmaceutical products");
    m.insert("31", "Fertilisers");
    m.insert("32", "Tanning or dyeing extracts");
    m.insert("33", "Essential oils and resinoids; perfumery");
    m.insert("34", "Soap, organic surface-active agents");
    m.insert("35", "Albuminoidal substances; modified starches; glues");
    m.insert("36", "Explosives; pyrotechnic products");
    m.insert("37", "Photographic or cinematographic goods");
    m.insert("38", "Miscellaneous chemical products");
    m.insert("39", "Plastics and articles thereof");
    m.insert("40", "Rubber and articles thereof");
    m.insert("41", "Raw hides and skins (other than furskins) and leather");
    m.insert("42", "Articles of leather; saddlery and harness");
    m.insert("43", "Furskins and artificial fur");
    m.insert("44", "Wood and articles of wood; wood charcoal");
    m.insert("45", "Cork and articles of cork");
    m.insert("46", "Manufactures of straw, esparto or other plaiting materials");
    m.insert("47", "Pulp of wood or of other fibrous cellulosic material");
    m.insert("48", "Paper and paperboard");
    m.insert("49", "Printed books, newspapers, pictures");
    m.insert("50", "Silk");
    m.insert("51", "Wool, fine or coarse animal hair");
    m.insert("52", "Cotton");
    m.insert("53", "Other vegetable textile fibres");
    m.insert("54", "Man-made filaments");
    m.insert("55", "Man-made staple fibres");
    m.insert("56", "Wadding, felt and nonwovens");
    m.insert("57", "Carpets and other textile floor coverings");
    m.insert("58", "Special woven fabrics");
    m.insert("59", "Impregnated, coated, covered or laminated textile fabrics");
    m.insert("60", "Knitted or crocheted fabrics");
    m.insert("61", "Articles of apparel and clothing accessories, knitted or crocheted");
    m.insert("62", "Articles of apparel and clothing accessories, not knitted or crocheted");
    m.insert("63", "Other made up textile articles");
    m.insert("64", "Footwear, gaiters and the like");
    m.insert("65", "Headgear and parts thereof");
    m.insert("66", "Umbrellas, sun umbrellas, walking-sticks");
    m.insert("67", "Prepared feathers and down");
    m.insert("68", "Articles of stone, plaster, cement, asbestos, mica");
    m.insert("69", "Ceramic products");
    m.insert("70", "Glass and glassware");
    m.insert("71", "Natural or cultured pearls, precious or semi-precious stones");
    m.insert("72", "Iron and steel");
    m.insert("73", "Articles of iron or steel");
    m.insert("74", "Copper and articles thereof");
    m.insert("75", "Nickel and articles thereof");
    m.insert("76", "Aluminium and articles thereof");
    m.insert("78", "Lead and articles thereof");
    m.insert("79", "Zinc and articles thereof");
    m.insert("80", "Tin and articles thereof");
    m.insert("81", "Other base metals; cermets");
    m.insert("82", "Tools, implements, cutlery, spoons and forks, of base metal");
    m.insert("83", "Miscellaneous articles of base metal");
    m.insert("84", "Nuclear reactors, boilers, machinery and mechanical appliances");
    m.insert("85", "Electrical machinery and equipment and parts thereof");
    m.insert("86", "Railway or tramway locomotives, rolling-stock");
    m.insert("87", "Vehicles other than railway or tramway rolling-stock");
    m.insert("88", "Aircraft, spacecraft, and parts thereof");
    m.insert("89", "Ships, boats and floating structures");
    m.insert("90", "Optical, photographic, cinematographic, measuring instruments");
    m.insert("91", "Clocks and watches and parts thereof");
    m.insert("92", "Musical instruments");
    m.insert("93", "Arms and ammunition");
    m.insert("94", "Furniture; bedding, mattresses, mattress supports");
    m.insert("95", "Toys, games and sports requisites");
    m.insert("96", "Miscellaneous manufactured articles");
    m.insert("97", "Works of art, collectors' pieces and antiques");
    m.insert("99", "Special classification provisions");
    m
});

// ─── Regex ────────────────────────────────────────────────────────────────────

/// Accepts codes in formats: 8471, 8471.30, 8471.30.00, 847130, 8471300000
/// Strips dots/spaces and validates digit count (4, 6, 8, or 10 digits).
static HS_RE: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"^\d{4}(\d{2}(\d{2}(\d{2})?)?)?$").unwrap()
});

// ─── Types ────────────────────────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
struct ClassifyRequest {
    hs_code: String,
    #[serde(default)]
    description: Option<String>,
}

#[derive(Debug, Serialize)]
struct ClassifyResponse {
    hs_code: String,
    normalised: String,
    valid: bool,
    chapter: String,
    heading: String,
    subheading: String,
    chapter_description: String,
    confidence: f64,
    source: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    description: Option<String>,
}

#[derive(Debug, Serialize)]
struct HealthResponse {
    status: &'static str,
    service: &'static str,
    version: &'static str,
}

// ─── App State ────────────────────────────────────────────────────────────────

#[derive(Clone)]
struct AppState {
    prometheus_handle: Arc<metrics_exporter_prometheus::PrometheusHandle>,
}

// ─── Classification Logic ─────────────────────────────────────────────────────

fn classify(raw: &str) -> ClassifyResponse {
    // Normalise: strip dots, spaces, dashes
    let normalised: String = raw.chars().filter(|c| c.is_ascii_digit()).collect();

    let valid = HS_RE.is_match(&normalised);
    let chapter = normalised.get(0..2).unwrap_or("00").to_string();
    let heading = normalised.get(0..4).unwrap_or("0000").to_string();
    let subheading = normalised.get(0..6).unwrap_or("000000").to_string();

    let chapter_description = CHAPTER_DESCRIPTIONS
        .get(chapter.as_str())
        .copied()
        .unwrap_or("Unknown chapter")
        .to_string();

    // Confidence: 1.0 for 10-digit, 0.9 for 8-digit, 0.8 for 6-digit, 0.7 for 4-digit, 0.0 invalid
    let confidence = if !valid {
        0.0
    } else {
        match normalised.len() {
            10 => 1.0,
            8 => 0.9,
            6 => 0.8,
            4 => 0.7,
            _ => 0.5,
        }
    };

    ClassifyResponse {
        hs_code: raw.to_string(),
        normalised,
        valid,
        chapter,
        heading,
        subheading,
        chapter_description,
        confidence,
        source: "hs-classifier-v1".to_string(),
        description: None,
    }
}

// ─── Handlers ─────────────────────────────────────────────────────────────────

async fn handle_classify(
    Json(req): Json<ClassifyRequest>,
) -> impl IntoResponse {
    counter!("hs_classifications_total").increment(1);

    let mut result = classify(&req.hs_code);
    result.description = req.description;

    if result.valid {
        counter!("hs_valid_total").increment(1);
        info!(hs_code = %req.hs_code, chapter = %result.chapter, "HS code classified");
    } else {
        counter!("hs_invalid_total").increment(1);
        warn!(hs_code = %req.hs_code, "Invalid HS code");
    }

    (StatusCode::OK, Json(result))
}

async fn handle_health() -> impl IntoResponse {
    Json(HealthResponse {
        status: "ok",
        service: "hs-classifier",
        version: env!("CARGO_PKG_VERSION"),
    })
}

async fn handle_metrics(State(state): State<AppState>) -> impl IntoResponse {
    state.prometheus_handle.render()
}

// ─── Main ─────────────────────────────────────────────────────────────────────

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(EnvFilter::from_default_env().add_directive("hs_classifier=info".parse()?))
        .json()
        .init();

    // Register Prometheus metrics
    let builder = PrometheusBuilder::new();
    let handle = builder.install_recorder()?;

    describe_counter!("hs_classifications_total", "Total HS code classification requests");
    describe_counter!("hs_valid_total", "Total valid HS codes classified");
    describe_counter!("hs_invalid_total", "Total invalid HS codes rejected");

    let state = AppState {
        prometheus_handle: Arc::new(handle),
    };

    let app = Router::new()
        .route("/classify", post(handle_classify))
        .route("/health", get(handle_health))
        .route("/metrics", get(handle_metrics))
        .with_state(state)
        .layer(
            tower_http::cors::CorsLayer::permissive(),
        );

    let port: u16 = std::env::var("PORT")
        .unwrap_or_else(|_| "8090".to_string())
        .parse()?;
    let addr = SocketAddr::from(([0, 0, 0, 0], port));

    info!(%addr, "hs-classifier starting");
    let listener = TcpListener::bind(addr).await?;
    axum::serve(listener, app).await?;

    Ok(())
}

// ─── Unit Tests ───────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_valid_6digit() {
        let r = classify("847130");
        assert!(r.valid);
        assert_eq!(r.chapter, "84");
        assert_eq!(r.heading, "8471");
        assert_eq!(r.subheading, "847130");
        assert!((r.confidence - 0.8).abs() < 0.01);
    }

    #[test]
    fn test_valid_dotted() {
        let r = classify("8471.30.00");
        assert!(r.valid);
        assert_eq!(r.normalised, "84713000");
        assert!((r.confidence - 0.9).abs() < 0.01);
    }

    #[test]
    fn test_valid_10digit() {
        let r = classify("8471300000");
        assert!(r.valid);
        assert!((r.confidence - 1.0).abs() < 0.01);
    }

    #[test]
    fn test_invalid_too_short() {
        let r = classify("84");
        assert!(!r.valid);
        assert!((r.confidence - 0.0).abs() < 0.01);
    }

    #[test]
    fn test_invalid_letters() {
        let r = classify("8471AB");
        assert!(!r.valid);
    }

    #[test]
    fn test_chapter_84_description() {
        let r = classify("840000");
        assert_eq!(r.chapter, "84");
        assert!(r.chapter_description.contains("machinery"));
    }

    #[test]
    fn test_chapter_85_description() {
        let r = classify("850000");
        assert_eq!(r.chapter, "85");
        assert!(r.chapter_description.contains("Electrical"));
    }

    #[test]
    fn test_unknown_chapter() {
        // Chapter 77 is reserved/unused in WCO
        let r = classify("770000");
        assert_eq!(r.chapter_description, "Unknown chapter");
    }

    #[test]
    fn test_4digit_heading_only() {
        let r = classify("8471");
        assert!(r.valid);
        assert!((r.confidence - 0.7).abs() < 0.01);
    }
}
