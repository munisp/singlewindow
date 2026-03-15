/// middleware.rs — Kafka, Fluvio, Lakehouse, APISIX, and Keycloak integration
/// for the Rust graph-risk (GNN risk propagation) service.
///
/// Kafka topics consumed: declaration.submitted (triggers GNN graph scoring)
/// Kafka topics published: declaration.risk-scored (GNN propagated risk score)
/// Fluvio: Streams graph risk scores to real-time risk dashboard
/// Lakehouse: Ingests GNN graph snapshots and propagated scores for model retraining
/// APISIX: Registers /api/v1/graph-risk/* route on startup
/// Keycloak: Validates JWT on HTTP scoring endpoint
/// Redis: Caches propagated risk scores (TTL 120s) and graph snapshots (TTL 600s)

use reqwest::Client;
use serde::{Deserialize, Serialize};
use std::env;
use std::time::Duration;
use tracing::{info, warn};

// ─── Event Types ──────────────────────────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct DeclarationSubmittedEvent {
    pub declaration_id: String,
    pub ucr: String,
    pub trader_id: String,
    pub hs_code: String,
    pub customs_value: f64,
    pub country_of_origin: String,
    pub submitted_at: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct GraphRiskScoredEvent {
    pub declaration_id: String,
    pub ucr: String,
    pub base_score: f32,
    pub propagated_score: f32,
    pub lane: String,
    pub graph_factors: Vec<serde_json::Value>,
    pub confidence: f32,
    pub node_count: u32,
    pub edge_count: u32,
    pub scored_at: String,
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
            client: Client::builder().timeout(Duration::from_millis(500)).build().unwrap(),
        }
    }

    pub async fn cache_graph_score(&self, declaration_id: &str, score: f32, lane: &str) {
        let key = format!("graph:score:{}", declaration_id);
        let value = serde_json::json!({"score": score, "lane": lane}).to_string();
        let url = format!("{}/SETEX/{}/120/{}", self.base_url, key, value);
        let _ = self.client.get(&url).send().await;
    }

    pub async fn get_cached_graph_score(&self, declaration_id: &str) -> Option<serde_json::Value> {
        let key = format!("graph:score:{}", declaration_id);
        let url = format!("{}/GET/{}", self.base_url, key);
        let resp = self.client.get(&url).send().await.ok()?;
        let body: serde_json::Value = resp.json().await.ok()?;
        serde_json::from_str(body["GET"].as_str()?).ok()
    }

    pub async fn cache_trader_graph_snapshot(&self, trader_id: &str, snapshot: &serde_json::Value) {
        let key = format!("graph:trader:{}", trader_id);
        let value = serde_json::to_string(snapshot).unwrap_or_default();
        let url = format!("{}/SETEX/{}/600/{}", self.base_url, key, value);
        let _ = self.client.get(&url).send().await;
    }
}

// ─── Fluvio Client ────────────────────────────────────────────────────────────

pub struct FluvioClient {
    base_url: String,
    client: Client,
}

impl FluvioClient {
    pub fn new() -> Self {
        Self {
            base_url: env::var("FLUVIO_HTTP_URL")
                .unwrap_or_else(|_| "http://fluvio:9003".to_string()),
            client: Client::builder().timeout(Duration::from_secs(3)).build().unwrap(),
        }
    }

    pub async fn stream_graph_risk_score(&self, evt: &GraphRiskScoredEvent) {
        let url = format!("{}/produce/declaration.risk-scored", self.base_url);
        if let Err(e) = self.client.post(&url).json(evt).send().await {
            warn!(error = %e, "Fluvio graph risk stream failed (non-fatal)");
        } else {
            info!(declaration_id = %evt.declaration_id, score = evt.propagated_score, "Graph risk streamed via Fluvio");
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
        Self {
            base_url: env::var("LAKEHOUSE_HTTP_URL")
                .unwrap_or_else(|_| "http://lakehouse-ingest:8097".to_string()),
            client: Client::builder().timeout(Duration::from_secs(10)).build().unwrap(),
        }
    }

    pub async fn ingest_graph_score(&self, evt: &GraphRiskScoredEvent) {
        let payload = serde_json::json!({
            "table": "graph_risk_scores",
            "records": [{
                "declaration_id": evt.declaration_id,
                "ucr": evt.ucr,
                "base_score": evt.base_score,
                "propagated_score": evt.propagated_score,
                "lane": evt.lane,
                "confidence": evt.confidence,
                "node_count": evt.node_count,
                "edge_count": evt.edge_count,
                "scored_at": evt.scored_at,
                "partition_date": &evt.scored_at[..10]
            }]
        });
        let url = format!("{}/ingest", self.base_url);
        match self.client.post(&url).json(&payload).send().await {
            Ok(_) => info!(declaration_id = %evt.declaration_id, "Graph score ingested to lakehouse"),
            Err(e) => warn!(error = %e, "Lakehouse graph score ingest failed (non-fatal)"),
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
            "id": "graph-risk-api",
            "name": "graph-risk",
            "uri": "/api/v1/graph-risk/*",
            "methods": ["GET", "POST"],
            "upstream": {
                "type": "roundrobin",
                "nodes": { format!("{}:{}", service_host, service_port): 1 }
            },
            "plugins": {
                "openid-connect": {"bearer_only": true, "realm": "tradegateway"},
                "prometheus": {},
                "response-rewrite": {"headers": {"X-Service": "graph-risk"}}
            }
        });
        let url = format!("{}/apisix/admin/routes/graph-risk-api", self.admin_url);
        match self.client.put(&url)
            .header("X-API-KEY", &self.admin_key)
            .json(&route)
            .send().await {
            Ok(_) => info!("APISIX route registered: /api/v1/graph-risk/*"),
            Err(e) => warn!(error = %e, "APISIX graph-risk route registration failed"),
        }
    }
}
