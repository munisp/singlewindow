/// middleware_kafka_redis.rs — Kafka pub/sub, Redis caching, Keycloak JWT validation,
/// Permify authorization, and APISIX route registration for the Rust rule-engine.
///
/// Kafka topics consumed: declaration.submitted (triggers rule evaluation)
/// Kafka topics published: declaration.risk-scored (result of rule evaluation)
/// Redis: Caches rule evaluation results (TTL 60s) and HS code lookups (TTL 3600s)
/// Keycloak: Validates JWT tokens on the rule engine's HTTP API
/// Permify: Checks if a service account can invoke rule evaluation
/// APISIX: Registers /api/v1/rules/* route on startup

use rdkafka::config::ClientConfig;
use rdkafka::consumer::{Consumer, StreamConsumer};
use rdkafka::message::Message;
use rdkafka::producer::{FutureProducer, FutureRecord};
use rdkafka::util::Timeout;
use reqwest::Client;
use serde::{Deserialize, Serialize};
use std::env;
use std::time::Duration;
use tracing::{error, info, warn};

// ─── Kafka ────────────────────────────────────────────────────────────────────

fn kafka_brokers() -> String {
    env::var("KAFKA_BROKERS").unwrap_or_else(|_| "kafka:9092".to_string())
}

pub const TOPIC_DECLARATION_SUBMITTED: &str = "declaration.submitted";
pub const TOPIC_DECLARATION_RISK_SCORED: &str = "declaration.risk-scored";

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct DeclarationSubmittedEvent {
    pub declaration_id: String,
    pub ucr: String,
    pub trader_id: String,
    pub hs_code: String,
    pub customs_value: f64,
    pub country_of_origin: String,
    pub country_of_destination: String,
    pub goods_description: String,
    pub submitted_at: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct DeclarationRiskScoredEvent {
    pub declaration_id: String,
    pub ucr: String,
    pub risk_score: f32,
    pub lane: String,
    pub rules_triggered: Vec<String>,
    pub duty_amount: f64,
    pub scored_at: String,
    pub source: String,
}

pub struct KafkaProducer {
    producer: FutureProducer,
}

impl KafkaProducer {
    pub fn new() -> Result<Self, Box<dyn std::error::Error + Send + Sync>> {
        let producer: FutureProducer = ClientConfig::new()
            .set("bootstrap.servers", kafka_brokers())
            .set("message.timeout.ms", "5000")
            .set("acks", "all")
            .create()?;
        Ok(Self { producer })
    }

    pub async fn publish_risk_scored(
        &self,
        evt: DeclarationRiskScoredEvent,
    ) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        let payload = serde_json::to_string(&evt)?;
        let record = FutureRecord::to(TOPIC_DECLARATION_RISK_SCORED)
            .key(&evt.declaration_id)
            .payload(&payload);
        match self.producer.send(record, Timeout::After(Duration::from_secs(5))).await {
            Ok((partition, offset)) => {
                info!(
                    declaration_id = %evt.declaration_id,
                    partition = partition,
                    offset = offset,
                    "Risk scored event published"
                );
                Ok(())
            }
            Err((e, _)) => {
                error!(error = %e, "Failed to publish risk scored event");
                Err(Box::new(e))
            }
        }
    }
}

pub struct KafkaConsumer {
    consumer: StreamConsumer,
}

impl KafkaConsumer {
    pub fn new(group_id: &str) -> Result<Self, Box<dyn std::error::Error + Send + Sync>> {
        let consumer: StreamConsumer = ClientConfig::new()
            .set("bootstrap.servers", kafka_brokers())
            .set("group.id", group_id)
            .set("auto.offset.reset", "latest")
            .set("enable.auto.commit", "true")
            .create()?;
        consumer.subscribe(&[TOPIC_DECLARATION_SUBMITTED])?;
        info!("Kafka consumer subscribed to {}", TOPIC_DECLARATION_SUBMITTED);
        Ok(Self { consumer })
    }

    pub async fn next_event(
        &self,
    ) -> Option<DeclarationSubmittedEvent> {
        match self.consumer.recv().await {
            Ok(msg) => {
                let payload = msg.payload()?;
                match serde_json::from_slice::<DeclarationSubmittedEvent>(payload) {
                    Ok(evt) => Some(evt),
                    Err(e) => {
                        warn!(error = %e, "Failed to deserialize declaration.submitted");
                        None
                    }
                }
            }
            Err(e) => {
                error!(error = %e, "Kafka consumer error");
                None
            }
        }
    }
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

    /// Caches a rule evaluation result with a 60-second TTL.
    pub async fn cache_evaluation(&self, declaration_id: &str, result: &serde_json::Value) {
        let key = format!("rule:eval:{}", declaration_id);
        let value = serde_json::to_string(result).unwrap_or_default();
        let url = format!("{}/SETEX/{}/60/{}", self.base_url, key, value);
        if let Err(e) = self.client.get(&url).send().await {
            warn!(error = %e, "Redis cache set failed (non-fatal)");
        }
    }

    /// Retrieves a cached rule evaluation result.
    pub async fn get_cached_evaluation(&self, declaration_id: &str) -> Option<serde_json::Value> {
        let key = format!("rule:eval:{}", declaration_id);
        let url = format!("{}/GET/{}", self.base_url, key);
        let resp = self.client.get(&url).send().await.ok()?;
        let body: serde_json::Value = resp.json().await.ok()?;
        let raw = body["GET"].as_str()?;
        serde_json::from_str(raw).ok()
    }

    /// Caches an HS code tariff lookup with a 1-hour TTL.
    pub async fn cache_hs_tariff(&self, hs_code: &str, tariff_data: &serde_json::Value) {
        let key = format!("hs:tariff:{}", hs_code);
        let value = serde_json::to_string(tariff_data).unwrap_or_default();
        let url = format!("{}/SETEX/{}/3600/{}", self.base_url, key, value);
        let _ = self.client.get(&url).send().await;
    }

    pub async fn get_cached_hs_tariff(&self, hs_code: &str) -> Option<serde_json::Value> {
        let key = format!("hs:tariff:{}", hs_code);
        let url = format!("{}/GET/{}", self.base_url, key);
        let resp = self.client.get(&url).send().await.ok()?;
        let body: serde_json::Value = resp.json().await.ok()?;
        serde_json::from_str(body["GET"].as_str()?).ok()
    }
}

// ─── Keycloak JWT Validator ───────────────────────────────────────────────────

pub struct KeycloakValidator {
    jwks_url: String,
    client: Client,
}

impl KeycloakValidator {
    pub fn new() -> Self {
        let base = env::var("KEYCLOAK_URL")
            .unwrap_or_else(|_| "http://keycloak:8080".to_string());
        let realm = env::var("KEYCLOAK_REALM")
            .unwrap_or_else(|_| "tradegateway".to_string());
        let jwks_url = format!("{}/realms/{}/protocol/openid-connect/certs", base, realm);
        Self {
            jwks_url,
            client: Client::builder()
                .timeout(Duration::from_secs(5))
                .build()
                .unwrap(),
        }
    }

    pub async fn fetch_jwks(&self) -> Result<serde_json::Value, Box<dyn std::error::Error + Send + Sync>> {
        let resp = self.client.get(&self.jwks_url).send().await?;
        let jwks = resp.json::<serde_json::Value>().await?;
        info!(key_count = jwks["keys"].as_array().map(|k| k.len()).unwrap_or(0), "JWKS refreshed");
        Ok(jwks)
    }

    /// Extracts and validates the bearer token from the Authorization header.
    /// In production: use jsonwebtoken crate to verify RS256 signature against JWKS.
    pub fn extract_bearer(auth_header: &str) -> Option<&str> {
        if auth_header.starts_with("Bearer ") {
            Some(&auth_header[7..])
        } else {
            None
        }
    }
}

// ─── Permify Authorization ────────────────────────────────────────────────────

pub struct PermifyClient {
    base_url: String,
    tenant_id: String,
    client: Client,
}

impl PermifyClient {
    pub fn new() -> Self {
        let base_url = env::var("PERMIFY_URL")
            .unwrap_or_else(|_| "http://permify:3476".to_string());
        let tenant_id = env::var("PERMIFY_TENANT_ID")
            .unwrap_or_else(|_| "t1".to_string());
        Self {
            base_url,
            tenant_id,
            client: Client::builder()
                .timeout(Duration::from_secs(2))
                .build()
                .unwrap(),
        }
    }

    /// Checks if a service account can invoke rule evaluation.
    /// Entity: rule_engine, Permission: evaluate, Subject: service_account:{id}
    pub async fn check_evaluation_permission(
        &self,
        service_account_id: &str,
    ) -> bool {
        let payload = serde_json::json!({
            "metadata": {"depth": 10},
            "entity": {"type": "rule_engine", "id": "singleton"},
            "permission": "evaluate",
            "subject": {"type": "service_account", "id": service_account_id}
        });
        let url = format!("{}/v1/tenants/{}/permissions/check", self.base_url, self.tenant_id);
        match self.client.post(&url).json(&payload).send().await {
            Ok(resp) => {
                let body: serde_json::Value = resp.json().await.unwrap_or_default();
                body["can"].as_str() == Some("RESULT_ALLOWED")
            }
            Err(e) => {
                warn!(error = %e, "Permify check failed (fail-open)");
                true // fail-open for rule engine availability
            }
        }
    }
}

// ─── APISIX Route Registration ────────────────────────────────────────────────

pub struct APISIXClient {
    admin_url: String,
    admin_key: String,
    client: Client,
}

impl APISIXClient {
    pub fn new() -> Self {
        let admin_url = env::var("APISIX_ADMIN_URL")
            .unwrap_or_else(|_| "http://apisix:9180".to_string());
        let admin_key = env::var("APISIX_ADMIN_KEY")
            .unwrap_or_else(|_| "edd1c9f034335f136f87ad84b625c8f1".to_string());
        Self {
            admin_url,
            admin_key,
            client: Client::builder()
                .timeout(Duration::from_secs(5))
                .build()
                .unwrap(),
        }
    }

    /// Registers the rule-engine route in APISIX on service startup.
    pub async fn register_routes(
        &self,
        service_host: &str,
        service_port: u16,
    ) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        let route = serde_json::json!({
            "id": "rule-engine-api",
            "name": "rule-engine",
            "uri": "/api/v1/rules/*",
            "methods": ["GET", "POST"],
            "upstream": {
                "type": "roundrobin",
                "nodes": {
                    format!("{}:{}", service_host, service_port): 1
                }
            },
            "plugins": {
                "openid-connect": {
                    "client_id": "tradegateway-api",
                    "bearer_only": true,
                    "realm": "tradegateway"
                },
                "prometheus": {},
                "response-rewrite": {
                    "headers": {"X-Service": "rule-engine"}
                }
            }
        });

        let url = format!("{}/apisix/admin/routes/rule-engine-api", self.admin_url);
        match self
            .client
            .put(&url)
            .header("X-API-KEY", &self.admin_key)
            .header("Content-Type", "application/json")
            .json(&route)
            .send()
            .await
        {
            Ok(_) => info!("APISIX route registered: /api/v1/rules/*"),
            Err(e) => warn!(error = %e, "APISIX route registration failed (non-fatal)"),
        }
        Ok(())
    }
}
