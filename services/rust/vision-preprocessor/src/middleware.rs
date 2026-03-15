/// middleware.rs — Kafka, Redis, Fluvio, Keycloak, APISIX, and Lakehouse
/// integration for the Rust vision-preprocessor service.
///
/// Kafka topics consumed: cargo.vision.request (new image batch for processing)
/// Kafka topics published: cargo.vision.result (processed tiles + metadata)
/// Fluvio: Streams real-time processing progress to the port dashboard
/// Redis: Caches preprocessed tile metadata (TTL 300s) to avoid reprocessing
/// Keycloak: Validates JWT on the HTTP upload endpoint
/// APISIX: Registers /api/v1/vision/* route on startup
/// Lakehouse: Ingests vision analysis results for cargo anomaly analytics

use reqwest::Client;
use serde::{Deserialize, Serialize};
use std::env;
use std::time::Duration;
use tracing::{info, warn};

fn kafka_brokers() -> String {
    env::var("KAFKA_BROKERS").unwrap_or_else(|_| "kafka:9092".to_string())
}

// ─── Event Types ──────────────────────────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct VisionRequestEvent {
    pub request_id: String,
    pub declaration_id: String,
    pub ucr: String,
    pub image_urls: Vec<String>,
    pub analysis_type: String, // CONTAINER_SCAN, DOCUMENT_OCR, CARGO_INSPECTION
    pub priority: String,      // HIGH, NORMAL, LOW
    pub requested_at: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct VisionResultEvent {
    pub request_id: String,
    pub declaration_id: String,
    pub ucr: String,
    pub tile_count: u32,
    pub anomaly_detected: bool,
    pub anomaly_score: f32,
    pub anomaly_regions: Vec<serde_json::Value>,
    pub ocr_text: Option<String>,
    pub processing_ms: u64,
    pub processed_at: String,
    pub source: String,
}

// ─── Redis Client ─────────────────────────────────────────────────────────────

pub struct RedisClient {
    base_url: String,
    client: Client,
}

impl RedisClient {
    pub fn new() -> Self {
        let base_url = env::var("REDIS_HTTP_URL")
            .unwrap_or_else(|_| "http://redis:7379".to_string());
        Self {
            base_url,
            client: Client::builder()
                .timeout(Duration::from_millis(500))
                .build()
                .unwrap(),
        }
    }

    pub async fn cache_vision_result(&self, request_id: &str, result: &serde_json::Value) {
        let key = format!("vision:result:{}", request_id);
        let value = serde_json::to_string(result).unwrap_or_default();
        let url = format!("{}/SETEX/{}/300/{}", self.base_url, key, value);
        let _ = self.client.get(&url).send().await;
    }

    pub async fn get_cached_vision_result(&self, request_id: &str) -> Option<serde_json::Value> {
        let key = format!("vision:result:{}", request_id);
        let url = format!("{}/GET/{}", self.base_url, key);
        let resp = self.client.get(&url).send().await.ok()?;
        let body: serde_json::Value = resp.json().await.ok()?;
        serde_json::from_str(body["GET"].as_str()?).ok()
    }
}

// ─── Fluvio Client ────────────────────────────────────────────────────────────

pub struct FluvioClient {
    base_url: String,
    client: Client,
}

impl FluvioClient {
    pub fn new() -> Self {
        let base_url = env::var("FLUVIO_HTTP_URL")
            .unwrap_or_else(|_| "http://fluvio:9003".to_string());
        Self {
            base_url,
            client: Client::builder()
                .timeout(Duration::from_secs(3))
                .build()
                .unwrap(),
        }
    }

    pub async fn stream_vision_progress(&self, evt: &VisionResultEvent) {
        let url = format!("{}/produce/cargo.vision.result", self.base_url);
        if let Err(e) = self.client.post(&url).json(evt).send().await {
            warn!(error = %e, "Fluvio vision progress stream failed (non-fatal)");
        } else {
            info!(request_id = %evt.request_id, "Vision result streamed via Fluvio");
        }
    }
}

// ─── Lakehouse Client ─────────────────────────────────────────────────────────

pub struct LakehouseClient {
    base_url: String,
    client: Client,
}

impl LakehouseClient {
    pub fn new() -> Self {
        let base_url = env::var("LAKEHOUSE_HTTP_URL")
            .unwrap_or_else(|_| "http://lakehouse-ingest:8097".to_string());
        Self {
            base_url,
            client: Client::builder()
                .timeout(Duration::from_secs(10))
                .build()
                .unwrap(),
        }
    }

    pub async fn ingest_vision_result(&self, result: &VisionResultEvent) {
        let payload = serde_json::json!({
            "table": "vision_analyses",
            "records": [{
                "request_id": result.request_id,
                "declaration_id": result.declaration_id,
                "ucr": result.ucr,
                "tile_count": result.tile_count,
                "anomaly_detected": result.anomaly_detected,
                "anomaly_score": result.anomaly_score,
                "processing_ms": result.processing_ms,
                "processed_at": result.processed_at,
                "partition_date": &result.processed_at[..10]
            }]
        });
        let url = format!("{}/ingest", self.base_url);
        match self.client.post(&url).json(&payload).send().await {
            Ok(_) => info!(request_id = %result.request_id, "Vision result ingested to lakehouse"),
            Err(e) => warn!(error = %e, "Lakehouse vision ingest failed (non-fatal)"),
        }
    }
}

// ─── APISIX Registration ──────────────────────────────────────────────────────

pub struct APISIXClient {
    admin_url: String,
    admin_key: String,
    client: Client,
}

impl APISIXClient {
    pub fn new() -> Self {
        Self {
            admin_url: env::var("APISIX_ADMIN_URL")
                .unwrap_or_else(|_| "http://apisix:9180".to_string()),
            admin_key: env::var("APISIX_ADMIN_KEY")
                .unwrap_or_else(|_| "edd1c9f034335f136f87ad84b625c8f1".to_string()),
            client: Client::builder().timeout(Duration::from_secs(5)).build().unwrap(),
        }
    }

    pub async fn register_routes(&self, service_host: &str, service_port: u16) {
        let route = serde_json::json!({
            "id": "vision-preprocessor-api",
            "name": "vision-preprocessor",
            "uri": "/api/v1/vision/*",
            "methods": ["GET", "POST"],
            "upstream": {
                "type": "roundrobin",
                "nodes": { format!("{}:{}", service_host, service_port): 1 }
            },
            "plugins": {
                "openid-connect": {"bearer_only": true, "realm": "tradegateway"},
                "prometheus": {},
                "response-rewrite": {"headers": {"X-Service": "vision-preprocessor"}}
            }
        });
        let url = format!("{}/apisix/admin/routes/vision-preprocessor-api", self.admin_url);
        match self.client.put(&url)
            .header("X-API-KEY", &self.admin_key)
            .json(&route)
            .send().await {
            Ok(_) => info!("APISIX route registered: /api/v1/vision/*"),
            Err(e) => warn!(error = %e, "APISIX vision route registration failed"),
        }
    }
}
