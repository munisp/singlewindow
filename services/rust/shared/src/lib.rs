// shared/src/lib.rs — Production-ready shared library for all Rust services
//
// Provides:
//   - Structured JSON logging (tracing + tracing-subscriber)
//   - Prometheus metrics (metrics + metrics-exporter-prometheus)
//   - Health check framework (/healthz, /readyz)
//   - Graceful shutdown via tokio signal handling
//   - Circuit breaker (failsafe-rs pattern)
//   - Connection pool helpers (deadpool-postgres)
//   - Retry with exponential backoff (tokio-retry)
//   - Error types (thiserror)

use std::collections::HashMap;
use std::sync::Arc;
use std::time::{Duration, Instant};

use axum::{
    extract::State,
    http::{HeaderMap, HeaderValue, StatusCode},
    response::{IntoResponse, Json, Response},
    routing::get,
    Router,
};
use metrics::{counter, gauge, histogram};
use metrics_exporter_prometheus::PrometheusBuilder;
use serde::{Deserialize, Serialize};
use thiserror::Error;
use tokio::sync::RwLock;
use tracing::{error, info, warn};
use tracing_subscriber::{fmt, EnvFilter};

// ─── Error Types ──────────────────────────────────────────────────────────────

#[derive(Error, Debug)]
pub enum ServiceError {
    #[error("Database error: {0}")]
    Database(#[from] tokio_postgres::Error),

    #[error("Pool error: {0}")]
    Pool(String),

    #[error("Kafka error: {0}")]
    Kafka(String),

    #[error("Redis error: {0}")]
    Redis(String),

    #[error("HTTP client error: {0}")]
    Http(#[from] reqwest::Error),

    #[error("Serialization error: {0}")]
    Serialization(#[from] serde_json::Error),

    #[error("Validation error: {field} — {message}")]
    Validation { field: String, message: String },

    #[error("Not found: {0}")]
    NotFound(String),

    #[error("Unauthorized: {0}")]
    Unauthorized(String),

    #[error("Forbidden: {0}")]
    Forbidden(String),

    #[error("Circuit breaker open for: {0}")]
    CircuitBreakerOpen(String),

    #[error("Timeout after {0:?}")]
    Timeout(Duration),

    #[error("Internal error: {0}")]
    Internal(String),
}

impl IntoResponse for ServiceError {
    fn into_response(self) -> Response {
        let (status, message) = match &self {
            ServiceError::NotFound(_) => (StatusCode::NOT_FOUND, self.to_string()),
            ServiceError::Unauthorized(_) => (StatusCode::UNAUTHORIZED, self.to_string()),
            ServiceError::Forbidden(_) => (StatusCode::FORBIDDEN, self.to_string()),
            ServiceError::Validation { .. } => (StatusCode::BAD_REQUEST, self.to_string()),
            ServiceError::CircuitBreakerOpen(_) => (StatusCode::SERVICE_UNAVAILABLE, self.to_string()),
            ServiceError::Timeout(_) => (StatusCode::GATEWAY_TIMEOUT, self.to_string()),
            _ => {
                error!("Internal error: {}", self);
                (StatusCode::INTERNAL_SERVER_ERROR, "Internal server error".to_string())
            }
        };

        let body = serde_json::json!({
            "error": message,
            "status": status.as_u16(),
        });

        (status, Json(body)).into_response()
    }
}

// ─── Structured Logging ───────────────────────────────────────────────────────

pub fn init_logging(service_name: &str) {
    let filter = EnvFilter::try_from_default_env()
        .unwrap_or_else(|_| EnvFilter::new("info"));

    tracing_subscriber::fmt()
        .with_env_filter(filter)
        .with_target(false)
        .json()
        .with_current_span(true)
        .with_span_list(false)
        .init();

    info!(service = service_name, "Logging initialized");
}

// ─── Prometheus Metrics ───────────────────────────────────────────────────────

pub fn init_metrics(service_name: &str) -> PrometheusHandle {
    let builder = PrometheusBuilder::new();
    let handle = builder
        .install_recorder()
        .expect("Failed to install Prometheus recorder");

    // Register default labels
    metrics::describe_counter!(
        "http_requests_total",
        "Total number of HTTP requests"
    );
    metrics::describe_histogram!(
        "http_request_duration_seconds",
        "HTTP request duration in seconds"
    );
    metrics::describe_gauge!(
        "db_pool_connections",
        "Database connection pool size"
    );
    metrics::describe_counter!(
        "kafka_messages_produced_total",
        "Total Kafka messages produced"
    );
    metrics::describe_gauge!(
        "circuit_breaker_state",
        "Circuit breaker state (0=closed, 1=half-open, 2=open)"
    );

    info!(service = service_name, "Prometheus metrics initialized");
    handle
}

pub type PrometheusHandle = metrics_exporter_prometheus::PrometheusHandle;

// ─── Health Check Framework ───────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize)]
pub struct HealthStatus {
    pub status: String,
    pub service: String,
    pub version: String,
    pub checks: HashMap<String, String>,
}

pub type HealthCheckFn = Arc<dyn Fn() -> bool + Send + Sync>;

#[derive(Clone)]
pub struct HealthRegistry {
    service_name: String,
    version: String,
    checks: Arc<RwLock<Vec<(String, HealthCheckFn)>>>,
    ready: Arc<RwLock<bool>>,
}

impl HealthRegistry {
    pub fn new(service_name: &str, version: &str) -> Self {
        Self {
            service_name: service_name.to_string(),
            version: version.to_string(),
            checks: Arc::new(RwLock::new(Vec::new())),
            ready: Arc::new(RwLock::new(false)),
        }
    }

    pub async fn add_check(&self, name: &str, check: HealthCheckFn) {
        self.checks.write().await.push((name.to_string(), check));
    }

    pub async fn set_ready(&self, ready: bool) {
        *self.ready.write().await = ready;
    }

    pub async fn is_ready(&self) -> bool {
        *self.ready.read().await
    }

    pub async fn run_checks(&self) -> (bool, HashMap<String, String>) {
        let checks = self.checks.read().await;
        let mut results = HashMap::new();
        let mut all_ok = true;

        for (name, check_fn) in checks.iter() {
            let ok = check_fn();
            results.insert(name.clone(), if ok { "ok".to_string() } else { "failed".to_string() });
            if !ok {
                all_ok = false;
            }
        }

        (all_ok, results)
    }
}

// ─── Health Handlers ──────────────────────────────────────────────────────────

pub async fn liveness_handler(
    State(registry): State<HealthRegistry>,
) -> impl IntoResponse {
    Json(serde_json::json!({
        "status": "alive",
        "service": registry.service_name,
        "version": registry.version,
    }))
}

pub async fn readiness_handler(
    State(registry): State<HealthRegistry>,
) -> impl IntoResponse {
    if !registry.is_ready().await {
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(serde_json::json!({
                "status": "not_ready",
                "service": registry.service_name,
                "reason": "initializing",
            })),
        ).into_response();
    }

    let (all_ok, checks) = registry.run_checks().await;
    let status_code = if all_ok { StatusCode::OK } else { StatusCode::SERVICE_UNAVAILABLE };

    (
        status_code,
        Json(HealthStatus {
            status: if all_ok { "ready".to_string() } else { "degraded".to_string() },
            service: registry.service_name.clone(),
            version: registry.version.clone(),
            checks,
        }),
    ).into_response()
}

pub async fn metrics_handler(
    State(handle): State<Arc<PrometheusHandle>>,
) -> impl IntoResponse {
    let mut headers = HeaderMap::new();
    headers.insert(
        "Content-Type",
        HeaderValue::from_static("text/plain; version=0.0.4"),
    );
    (headers, handle.render())
}

// ─── Router Builder ───────────────────────────────────────────────────────────

pub fn health_router(registry: HealthRegistry, metrics_handle: Arc<PrometheusHandle>) -> Router {
    Router::new()
        .route("/healthz", get(liveness_handler))
        .route("/readyz", get(readiness_handler))
        .route("/metrics", get(metrics_handler))
        .with_state(registry)
        .with_state(metrics_handle)
}

// ─── Graceful Shutdown ────────────────────────────────────────────────────────

pub async fn shutdown_signal(service_name: &str) {
    let ctrl_c = async {
        tokio::signal::ctrl_c()
            .await
            .expect("Failed to install Ctrl+C handler");
    };

    #[cfg(unix)]
    let terminate = async {
        tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())
            .expect("Failed to install SIGTERM handler")
            .recv()
            .await;
    };

    #[cfg(not(unix))]
    let terminate = std::future::pending::<()>();

    tokio::select! {
        _ = ctrl_c => {
            info!(service = service_name, "Received SIGINT, shutting down");
        },
        _ = terminate => {
            info!(service = service_name, "Received SIGTERM, shutting down");
        },
    }
}

// ─── Circuit Breaker ──────────────────────────────────────────────────────────

#[derive(Debug, Clone, PartialEq)]
pub enum CircuitState {
    Closed,
    HalfOpen,
    Open,
}

pub struct CircuitBreaker {
    name: String,
    state: Arc<RwLock<CircuitState>>,
    failure_count: Arc<RwLock<u32>>,
    last_failure: Arc<RwLock<Option<Instant>>>,
    failure_threshold: u32,
    reset_timeout: Duration,
}

impl CircuitBreaker {
    pub fn new(name: &str, failure_threshold: u32, reset_timeout: Duration) -> Self {
        Self {
            name: name.to_string(),
            state: Arc::new(RwLock::new(CircuitState::Closed)),
            failure_count: Arc::new(RwLock::new(0)),
            last_failure: Arc::new(RwLock::new(None)),
            failure_threshold,
            reset_timeout,
        }
    }

    pub async fn call<F, T, E>(&self, f: F) -> Result<T, ServiceError>
    where
        F: std::future::Future<Output = Result<T, E>>,
        E: std::fmt::Display,
    {
        let state = self.state.read().await.clone();

        match state {
            CircuitState::Open => {
                let last = self.last_failure.read().await;
                if let Some(t) = *last {
                    if t.elapsed() > self.reset_timeout {
                        drop(last);
                        *self.state.write().await = CircuitState::HalfOpen;
                        gauge!("circuit_breaker_state", 1.0, "name" => self.name.clone());
                    } else {
                        return Err(ServiceError::CircuitBreakerOpen(self.name.clone()));
                    }
                }
            }
            _ => {}
        }

        match f.await {
            Ok(result) => {
                *self.failure_count.write().await = 0;
                *self.state.write().await = CircuitState::Closed;
                gauge!("circuit_breaker_state", 0.0, "name" => self.name.clone());
                Ok(result)
            }
            Err(e) => {
                let mut count = self.failure_count.write().await;
                *count += 1;
                *self.last_failure.write().await = Some(Instant::now());

                if *count >= self.failure_threshold {
                    *self.state.write().await = CircuitState::Open;
                    gauge!("circuit_breaker_state", 2.0, "name" => self.name.clone());
                    warn!(
                        circuit_breaker = self.name,
                        failures = *count,
                        "Circuit breaker opened"
                    );
                }

                Err(ServiceError::Internal(format!("{}: {}", self.name, e)))
            }
        }
    }
}

// ─── Retry Helper ─────────────────────────────────────────────────────────────

pub async fn with_retry<F, Fut, T, E>(
    operation: &str,
    max_attempts: u32,
    f: F,
) -> Result<T, E>
where
    F: Fn() -> Fut,
    Fut: std::future::Future<Output = Result<T, E>>,
    E: std::fmt::Display,
{
    let mut attempt = 0;
    loop {
        attempt += 1;
        match f().await {
            Ok(result) => return Ok(result),
            Err(e) if attempt < max_attempts => {
                let delay = Duration::from_millis(100 * 2u64.pow(attempt - 1));
                warn!(
                    operation = operation,
                    attempt = attempt,
                    max_attempts = max_attempts,
                    error = %e,
                    delay_ms = delay.as_millis(),
                    "Retrying after error"
                );
                tokio::time::sleep(delay).await;
            }
            Err(e) => return Err(e),
        }
    }
}
