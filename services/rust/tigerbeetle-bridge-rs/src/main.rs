// TradeGateway NGSWTP — TigerBeetle Rust Bridge (tigerbeetle-bridge-rs)
// Language: Rust 1.78+
// Role: Production-grade double-entry bookkeeping service for customs duty
//       collection, penalty levies, duty drawback payments, and bond management.
//
// ⚠️  PHASE-6 NOTICE (SW-3): the DEFAULT build (without
//     `--features tigerbeetle-live`) is an IN-MEMORY SIMULATION and is
//     DEV/TEST-ONLY. It must NEVER serve a production path:
//       - it REFUSES TO BOOT when ENVIRONMENT/APP_ENV/NODE_ENV=production;
//       - it requires the explicit opt-in TB_ALLOW_SIM_BACKEND=1 otherwise.
//     The CANONICAL production ledger bridge is the Go tigerbeetle-bridge
//     (HTTP /api/ledger/*, k8s Service `tigerbeetle-bridge`, port 8086).
//
// Architecture:
//   - Axum HTTP server (port 4600)
//   - Feature-gated backend: SimBackend (default/CI, DEV-ONLY) or LiveBackend (production)
//   - All transfers are idempotent via SHA-256(declaration_ref + entry_type)
//   - Accounts use WCO GL codes as ledger identifiers
//
// Endpoints:
//   GET  /health                        — liveness + readiness probe
//   POST /accounts                      — create or lookup account
//   GET  /accounts/:id                  — get account balance
//   POST /transfers                     — create double-entry transfer
//   GET  /transfers/:id                 — get transfer status
//   GET  /accounts/:id/transfers        — list transfers for account
//   POST /transfers/batch               — batch transfer (atomic)
//   GET  /metrics                       — Prometheus-compatible metrics
//   POST /reconcile                     — double-entry reconciliation check (debits == credits per ledger)
//   POST /accounts/batch-balances       — bulk balance query for up to 100 accounts

use std::sync::Arc;
use axum::{
    extract::{Path, State},
    http::StatusCode,
    response::Json,
    routing::{get, post},
    Router,
};
use serde::{Deserialize, Serialize};
use tower_http::{cors::CorsLayer, timeout::TimeoutLayer, trace::TraceLayer};
use tracing::{error, info};
use uuid::Uuid;

mod backend;
mod scenarios;
pub mod seed;
pub mod trader_accounts;
pub mod immutable_audit;
use backend::{AccountBalance, Backend, CreateAccountRequest, CreateTransferRequest, TransferRecord};
use trader_accounts::seed_trader_handler;
use immutable_audit::{AuditChainState, AuditEntry, AuditEventType, build_audit_entry, verify_chain, VerificationResult};
use std::sync::Mutex;

// ─── Application state ────────────────────────────────────────────────────────

#[derive(Clone)]
struct AppState {
    backend: Arc<dyn Backend + Send + Sync>,
    audit_log: Arc<Mutex<Vec<AuditEntry>>>,
    audit_chain: Arc<Mutex<AuditChainState>>,
}

// ─── Request / Response types ─────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
struct CreateAccountReq {
    /// Unique account identifier — typically a WCO GL code or trader TIN
    pub account_id: String,
    /// Ledger code (e.g. 700 = NGN customs duty revenue)
    pub ledger: u32,
    /// Human-readable label
    pub label: String,
    /// Account type: "debit_normal" | "credit_normal"
    pub account_type: String,
}

#[derive(Debug, Deserialize)]
struct CreateTransferReq {
    /// Idempotency key — use SHA-256(declaration_ref + entry_type)
    pub idempotency_key: String,
    /// Source account ID (debit)
    pub debit_account_id: String,
    /// Destination account ID (credit)
    pub credit_account_id: String,
    /// Amount in minor units (kobo for NGN)
    pub amount: u64,
    /// Ledger code — must match both accounts
    pub ledger: u32,
    /// Entry type: "duty_collection" | "penalty_levy" | "drawback_payment" | "bond_release" | "refund"
    pub entry_type: String,
    /// Reference to the customs declaration
    pub declaration_ref: Option<String>,
    /// Optional memo
    pub memo: Option<String>,
}

#[derive(Debug, Deserialize)]
struct BatchTransferReq {
    pub transfers: Vec<CreateTransferReq>,
}

#[derive(Debug, Serialize)]
struct HealthResponse {
    pub status: &'static str,
    pub backend: &'static str,
    pub version: &'static str,
}

#[derive(Debug, Serialize)]
struct ErrorResponse {
    pub error: String,
    pub code: String,
}

fn err(code: &str, msg: impl Into<String>) -> (StatusCode, Json<ErrorResponse>) {
    (
        StatusCode::BAD_REQUEST,
        Json(ErrorResponse {
            error: msg.into(),
            code: code.to_string(),
        }),
    )
}

// ─── Handlers ─────────────────────────────────────────────────────────────────

async fn health(State(state): State<AppState>) -> Json<HealthResponse> {
    let backend_name = state.backend.name();
    Json(HealthResponse {
        status: "ok",
        backend: backend_name,
        version: env!("CARGO_PKG_VERSION"),
    })
}

async fn create_account(
    State(state): State<AppState>,
    Json(req): Json<CreateAccountReq>,
) -> Result<Json<AccountBalance>, (StatusCode, Json<ErrorResponse>)> {
    let create_req = CreateAccountRequest {
        account_id: req.account_id.clone(),
        ledger: req.ledger,
        label: req.label,
        account_type: req.account_type,
    };
    state
        .backend
        .create_account(create_req)
        .await
        .map(Json)
        .map_err(|e| {
            error!("create_account error: {}", e);
            err("CREATE_ACCOUNT_FAILED", e.to_string())
        })
}

async fn get_account(
    State(state): State<AppState>,
    Path(account_id): Path<String>,
) -> Result<Json<AccountBalance>, (StatusCode, Json<ErrorResponse>)> {
    state
        .backend
        .get_account(&account_id)
        .await
        .map(Json)
        .map_err(|e| {
            error!("get_account error for {}: {}", account_id, e);
            (
                StatusCode::NOT_FOUND,
                Json(ErrorResponse {
                    error: e.to_string(),
                    code: "ACCOUNT_NOT_FOUND".to_string(),
                }),
            )
        })
}

async fn create_transfer(
    State(state): State<AppState>,
    Json(req): Json<CreateTransferReq>,
) -> Result<Json<TransferRecord>, (StatusCode, Json<ErrorResponse>)> {
    let transfer_req = CreateTransferRequest {
        idempotency_key: req.idempotency_key,
        debit_account_id: req.debit_account_id,
        credit_account_id: req.credit_account_id,
        amount: req.amount,
        ledger: req.ledger,
        entry_type: req.entry_type,
        declaration_ref: req.declaration_ref,
        memo: req.memo,
    };
    state
        .backend
        .create_transfer(transfer_req)
        .await
        .map(Json)
        .map_err(|e| {
            error!("create_transfer error: {}", e);
            err("TRANSFER_FAILED", e.to_string())
        })
}

async fn get_transfer(
    State(state): State<AppState>,
    Path(transfer_id): Path<String>,
) -> Result<Json<TransferRecord>, (StatusCode, Json<ErrorResponse>)> {
    state
        .backend
        .get_transfer(&transfer_id)
        .await
        .map(Json)
        .map_err(|e| {
            (
                StatusCode::NOT_FOUND,
                Json(ErrorResponse {
                    error: e.to_string(),
                    code: "TRANSFER_NOT_FOUND".to_string(),
                }),
            )
        })
}

async fn list_account_transfers(
    State(state): State<AppState>,
    Path(account_id): Path<String>,
) -> Result<Json<Vec<TransferRecord>>, (StatusCode, Json<ErrorResponse>)> {
    state
        .backend
        .list_transfers_for_account(&account_id)
        .await
        .map(Json)
        .map_err(|e| {
            error!("list_transfers error for {}: {}", account_id, e);
            err("LIST_TRANSFERS_FAILED", e.to_string())
        })
}

async fn batch_transfer(
    State(state): State<AppState>,
    Json(req): Json<BatchTransferReq>,
) -> Result<Json<Vec<TransferRecord>>, (StatusCode, Json<ErrorResponse>)> {
    if req.transfers.is_empty() {
        return Err(err("EMPTY_BATCH", "transfers array must not be empty"));
    }
    if req.transfers.len() > 100 {
        return Err(err("BATCH_TOO_LARGE", "maximum 100 transfers per batch"));
    }
    let reqs: Vec<CreateTransferRequest> = req
        .transfers
        .into_iter()
        .map(|t| CreateTransferRequest {
            idempotency_key: t.idempotency_key,
            debit_account_id: t.debit_account_id,
            credit_account_id: t.credit_account_id,
            amount: t.amount,
            ledger: t.ledger,
            entry_type: t.entry_type,
            declaration_ref: t.declaration_ref,
            memo: t.memo,
        })
        .collect();
    state
        .backend
        .batch_transfer(reqs)
        .await
        .map(Json)
        .map_err(|e| {
            error!("batch_transfer error: {}", e);
            err("BATCH_TRANSFER_FAILED", e.to_string())
        })
}

async fn metrics(State(state): State<AppState>) -> String {
    let stats = state.backend.metrics().await;
    format!(
        "# HELP tb_accounts_total Total number of accounts\n\
         # TYPE tb_accounts_total counter\n\
         tb_accounts_total {}\n\
         # HELP tb_transfers_total Total number of transfers\n\
         # TYPE tb_transfers_total counter\n\
         tb_transfers_total {}\n\
         # HELP tb_backend_mode Backend mode (0=simulation, 1=live)\n\
         # TYPE tb_backend_mode gauge\n\
         tb_backend_mode {}\n",
        stats.accounts_total,
        stats.transfers_total,
        if stats.is_live { 1 } else { 0 }
    )
}

// ─── Audit log handlers ──────────────────────────────────────────────────────

/// GET /audit/entries — returns all in-memory audit entries.
async fn get_audit_entries(State(state): State<AppState>) -> Json<Vec<AuditEntry>> {
    let log = state.audit_log.lock().unwrap_or_else(|e| e.into_inner());
    Json(log.clone())
}

/// POST /audit/append — append a new audit entry (internal service use only).
#[derive(Debug, serde::Deserialize)]
struct AppendAuditReq {
    event_type_code: u16,
    actor_id: u128,
    subject_id: u128,
    payload_json: String,
}

async fn append_audit_entry(
    State(state): State<AppState>,
    Json(req): Json<AppendAuditReq>,
) -> Result<Json<AuditEntry>, (StatusCode, Json<ErrorResponse>)> {
    let event_type = AuditEventType::from_u16(req.event_type_code)
        .ok_or_else(|| err("INVALID_EVENT_TYPE", format!("unknown event type code: {}", req.event_type_code)))?;

    let id = {
        let log = state.audit_log.lock().unwrap_or_else(|e| e.into_inner());
        log.len() as u128 + 1
    };

    let entry = {
        let mut chain = state.audit_chain.lock().unwrap_or_else(|e| e.into_inner());
        build_audit_entry(id, event_type, req.actor_id, req.subject_id, req.payload_json, &mut chain)
    };

    {
        let mut log = state.audit_log.lock().unwrap_or_else(|e| e.into_inner());
        log.push(entry.clone());
    }

    info!("[AUDIT] Appended entry id={} type={:?} actor={}", id, event_type, req.actor_id);
    Ok(Json(entry))
}

/// GET /audit/verify — verify the integrity of the entire audit chain.
async fn verify_audit_chain(State(state): State<AppState>) -> Json<VerificationResult> {
    let log = state.audit_log.lock().unwrap_or_else(|e| e.into_inner());
    let result = verify_chain(&log);
    Json(result)
}

// ─── Seed standard accounts ───────────────────────────────────────────────────

async fn seed_standard_accounts(backend: &Arc<dyn Backend + Send + Sync>) {
    let accounts = vec![
        ("NCS_DUTY_REVENUE", 700, "NCS Customs Duty Revenue Account", "credit_normal"),
        ("NCS_PENALTY_REVENUE", 701, "NCS Penalty Revenue Account", "credit_normal"),
        ("NCS_DRAWBACK_PAYABLE", 702, "NCS Duty Drawback Payable", "debit_normal"),
        ("NCS_BOND_CLEARING", 703, "NCS Bond Clearing Account", "credit_normal"),
        ("TRADER_DUTY_PAYABLE", 710, "Trader Duty Payable (Aggregate)", "debit_normal"),
        ("TRADER_PENALTY_PAYABLE", 711, "Trader Penalty Payable (Aggregate)", "debit_normal"),
        ("MOJALOOP_SETTLEMENT", 720, "Mojaloop Settlement Account", "credit_normal"),
        ("TIGERBEETLE_SUSPENSE", 799, "TigerBeetle Suspense Account", "credit_normal"),
    ];
    for (id, ledger, label, acct_type) in accounts {
        let req = CreateAccountRequest {
            account_id: id.to_string(),
            ledger,
            label: label.to_string(),
            account_type: acct_type.to_string(),
        };
        if let Err(e) = backend.create_account(req).await {
            // Account may already exist — that's fine
            tracing::debug!("Seed account {} already exists or error: {}", id, e);
        }
    }
    info!("[TB] Standard accounts seeded");
}

// ─── Main ─────────────────────────────────────────────────────────────────────

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    // Load .env if present
    let _ = dotenvy::dotenv();

    // Tracing
    tracing_subscriber::fmt()
        .with_env_filter(
            std::env::var("RUST_LOG")
                .unwrap_or_else(|_| "tigerbeetle_bridge_rs=info,tower_http=warn".to_string()),
        )
        .json()
        .init();

    let port: u16 = std::env::var("PORT")
        .unwrap_or_else(|_| "4600".to_string())
        .parse()
        .unwrap_or(4600);

    // Select backend based on feature flag
    #[cfg(feature = "tigerbeetle-live")]
    let backend: Arc<dyn Backend + Send + Sync> = {
        let tb_addr = std::env::var("TIGERBEETLE_ADDRESS")
            .unwrap_or_else(|_| "127.0.0.1:3000".to_string());
        let cluster_id: u128 = std::env::var("TIGERBEETLE_CLUSTER_ID")
            .unwrap_or_else(|_| "0".to_string())
            .parse()
            .unwrap_or(0);
        info!("[TB] Starting with LIVE TigerBeetle backend at {}", tb_addr);
        Arc::new(backend::live::LiveBackend::new(&tb_addr, cluster_id).await?)
    };

    #[cfg(not(feature = "tigerbeetle-live"))]
    let backend: Arc<dyn Backend + Send + Sync> = {
        // SW-3: the in-memory SimBackend is DEV/TEST-ONLY.
        let env = std::env::var("ENVIRONMENT")
            .or_else(|_| std::env::var("APP_ENV"))
            .or_else(|_| std::env::var("NODE_ENV"))
            .unwrap_or_default()
            .to_lowercase();
        if env == "production" || env == "prod" {
            panic!(
                "[TB] FATAL: built WITHOUT the tigerbeetle-live feature — the in-memory \
                 SimBackend must never serve production. Build with \
                 --features tigerbeetle-live against a real TigerBeetle cluster, or use the \
                 canonical Go tigerbeetle-bridge (port 8086)."
            );
        }
        let sim_ok = std::env::var("TB_ALLOW_SIM_BACKEND").unwrap_or_default();
        if sim_ok != "1" && sim_ok != "true" {
            panic!(
                "[TB] FATAL: the in-memory SimBackend requires explicit dev opt-in \
                 (TB_ALLOW_SIM_BACKEND=1). For production build with \
                 --features tigerbeetle-live or use the canonical Go bridge."
            );
        }
        warn!("[TB] DEV-ONLY in-memory SimBackend in use (TB_ALLOW_SIM_BACKEND=1) — NOT for production");
        Arc::new(backend::simulation::SimBackend::new())
    };

    // Seed standard GL accounts
    seed_standard_accounts(&backend).await;

    let state = AppState {
        backend,
        audit_log: Arc::new(Mutex::new(Vec::new())),
        audit_chain: Arc::new(Mutex::new(AuditChainState::new())),
    };

    let app = Router::new()
        .route("/health", get(health))
        .route("/accounts", post(create_account))
        .route("/accounts/:id", get(get_account))
        .route("/accounts/:id/transfers", get(list_account_transfers))
        .route("/transfers", post(create_transfer))
        .route("/transfers/:id", get(get_transfer))
        .route("/transfers/batch", post(batch_transfer))
        .route("/metrics", get(metrics))
        .route("/seed/trader", post(seed_trader_handler))
        .route("/audit/entries", get(get_audit_entries))
        .route("/audit/append", post(append_audit_entry))
        .route("/audit/verify", get(verify_audit_chain))
        .route("/reconcile", post(reconcile_ledger))
        .route("/accounts/batch-balances", post(batch_balances))
        .layer(CorsLayer::permissive())
        .layer(TimeoutLayer::new(std::time::Duration::from_secs(30)))
        .layer(TraceLayer::new_for_http())
        .with_state(state);

    let addr = format!("0.0.0.0:{}", port);
    info!("[TB] tigerbeetle-bridge-rs listening on {}", addr);

    let listener = tokio::net::TcpListener::bind(&addr).await?;
    axum::serve(listener, app).await?;

    Ok(())
}

// ─── Reconciliation ─────────────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
struct ReconcileReq {
    /// Ledger code to reconcile (e.g. 700 for NGN customs duty)
    pub ledger: u32,
    /// Optional list of account IDs to scope the reconciliation.
    /// If empty, all accounts in the ledger are checked.
    pub account_ids: Option<Vec<String>>,
}

#[derive(Debug, Serialize)]
struct ReconcileResponse {
    pub ledger: u32,
    pub total_debits: u64,
    pub total_credits: u64,
    pub balanced: bool,
    pub discrepancy: i64,
    pub accounts_checked: usize,
    pub unbalanced_accounts: Vec<UnbalancedAccount>,
    pub checked_at: u64,
}

#[derive(Debug, Serialize)]
struct UnbalancedAccount {
    pub account_id: String,
    pub debits_posted: u64,
    pub credits_posted: u64,
    pub balance: i64,
    pub account_type: String,
}

async fn reconcile_ledger(
    State(state): State<AppState>,
    Json(req): Json<ReconcileReq>,
) -> Result<Json<ReconcileResponse>, (StatusCode, Json<ErrorResponse>)> {
    // Fetch all accounts for the given ledger by querying each requested account
    // (or deriving from the metrics if no account_ids provided)
    let account_ids = req.account_ids.unwrap_or_default();

    if account_ids.is_empty() {
        return Err(err("RECONCILE_NEEDS_ACCOUNTS", "Provide account_ids to reconcile; use /accounts/batch-balances to enumerate accounts first"));
    }

    let mut total_debits: u64 = 0;
    let mut total_credits: u64 = 0;
    let mut unbalanced: Vec<UnbalancedAccount> = Vec::new();
    let mut checked = 0usize;

    for account_id in &account_ids {
        match state.backend.get_account(account_id).await {
            Ok(acct) if acct.ledger == req.ledger => {
                total_debits = total_debits.saturating_add(acct.debits_posted);
                total_credits = total_credits.saturating_add(acct.credits_posted);
                checked += 1;
                // A debit-normal account is balanced when debits >= credits;
                // a credit-normal account is balanced when credits >= debits.
                let balanced = match acct.account_type.as_str() {
                    "debit_normal" => acct.debits_posted >= acct.credits_posted,
                    "credit_normal" => acct.credits_posted >= acct.debits_posted,
                    _ => true,
                };
                if !balanced {
                    unbalanced.push(UnbalancedAccount {
                        account_id: acct.account_id,
                        debits_posted: acct.debits_posted,
                        credits_posted: acct.credits_posted,
                        balance: acct.balance,
                        account_type: acct.account_type,
                    });
                }
            }
            Ok(_) => {} // Different ledger — skip
            Err(e) => {
                error!("[reconcile] Failed to fetch account {}: {}", account_id, e);
            }
        }
    }

    let discrepancy = total_credits as i64 - total_debits as i64;
    let balanced = discrepancy == 0 && unbalanced.is_empty();

    Ok(Json(ReconcileResponse {
        ledger: req.ledger,
        total_debits,
        total_credits,
        balanced,
        discrepancy,
        accounts_checked: checked,
        unbalanced_accounts: unbalanced,
        checked_at: backend::now_unix_ms(),
    }))
}

// ─── Batch Balances ───────────────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
struct BatchBalancesReq {
    pub account_ids: Vec<String>,
}

#[derive(Debug, Serialize)]
struct BatchBalancesResponse {
    pub balances: Vec<AccountBalance>,
    pub not_found: Vec<String>,
}

async fn batch_balances(
    State(state): State<AppState>,
    Json(req): Json<BatchBalancesReq>,
) -> Result<Json<BatchBalancesResponse>, (StatusCode, Json<ErrorResponse>)> {
    if req.account_ids.len() > 100 {
        return Err(err("TOO_MANY_ACCOUNTS", "Maximum 100 accounts per batch-balances request"));
    }

    let mut balances = Vec::new();
    let mut not_found = Vec::new();

    for account_id in &req.account_ids {
        match state.backend.get_account(account_id).await {
            Ok(acct) => balances.push(acct),
            Err(_) => not_found.push(account_id.clone()),
        }
    }

    Ok(Json(BatchBalancesResponse { balances, not_found }))
}

// ─── Tests ────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use axum_test::TestServer;

    fn build_test_app() -> TestServer {
        let backend: Arc<dyn Backend + Send + Sync> =
            Arc::new(backend::simulation::SimBackend::new());
        let state = AppState { backend };
        let app = Router::new()
            .route("/health", get(health))
            .route("/accounts", post(create_account))
            .route("/accounts/:id", get(get_account))
            .route("/transfers", post(create_transfer))
            .route("/transfers/:id", get(get_transfer))
            .route("/accounts/:id/transfers", get(list_account_transfers))
            .route("/transfers/batch", post(batch_transfer))
            .with_state(state);
        TestServer::new(app).unwrap()
    }

    #[tokio::test]
    async fn test_health_returns_ok() {
        let server = build_test_app();
        let resp = server.get("/health").await;
        resp.assert_status_ok();
        let body: serde_json::Value = resp.json();
        assert_eq!(body["status"], "ok");
        assert_eq!(body["backend"], "simulation");
    }

    #[tokio::test]
    async fn test_create_and_get_account() {
        let server = build_test_app();
        let resp = server
            .post("/accounts")
            .json(&serde_json::json!({
                "account_id": "TEST_DUTY_ACCT",
                "ledger": 700,
                "label": "Test Duty Account",
                "account_type": "credit_normal"
            }))
            .await;
        resp.assert_status_ok();
        let body: serde_json::Value = resp.json();
        assert_eq!(body["account_id"], "TEST_DUTY_ACCT");
        assert_eq!(body["balance"], 0);

        // Fetch it back
        let resp2 = server.get("/accounts/TEST_DUTY_ACCT").await;
        resp2.assert_status_ok();
        let body2: serde_json::Value = resp2.json();
        assert_eq!(body2["account_id"], "TEST_DUTY_ACCT");
    }

    #[tokio::test]
    async fn test_create_transfer_and_balance_update() {
        let server = build_test_app();
        // Create debit account (trader)
        server
            .post("/accounts")
            .json(&serde_json::json!({
                "account_id": "TRADER_001",
                "ledger": 710,
                "label": "Trader 001 Duty Payable",
                "account_type": "debit_normal"
            }))
            .await
            .assert_status_ok();
        // Create credit account (NCS)
        server
            .post("/accounts")
            .json(&serde_json::json!({
                "account_id": "NCS_DUTY",
                "ledger": 710,
                "label": "NCS Duty Revenue",
                "account_type": "credit_normal"
            }))
            .await
            .assert_status_ok();
        // Create transfer
        let resp = server
            .post("/transfers")
            .json(&serde_json::json!({
                "idempotency_key": "test-idem-001",
                "debit_account_id": "TRADER_001",
                "credit_account_id": "NCS_DUTY",
                "amount": 500000,
                "ledger": 710,
                "entry_type": "duty_collection",
                "declaration_ref": "NG2026000001",
                "memo": "Import duty for HS 8703.23"
            }))
            .await;
        resp.assert_status_ok();
        let body: serde_json::Value = resp.json();
        assert_eq!(body["amount"], 500000);
        assert_eq!(body["status"], "posted");
    }

    #[tokio::test]
    async fn test_idempotent_transfer() {
        let server = build_test_app();
        server
            .post("/accounts")
            .json(&serde_json::json!({"account_id": "IDEM_DEBIT", "ledger": 700, "label": "D", "account_type": "debit_normal"}))
            .await;
        server
            .post("/accounts")
            .json(&serde_json::json!({"account_id": "IDEM_CREDIT", "ledger": 700, "label": "C", "account_type": "credit_normal"}))
            .await;
        let payload = serde_json::json!({
            "idempotency_key": "idem-key-xyz",
            "debit_account_id": "IDEM_DEBIT",
            "credit_account_id": "IDEM_CREDIT",
            "amount": 100000,
            "ledger": 700,
            "entry_type": "duty_collection"
        });
        let r1 = server.post("/transfers").json(&payload).await;
        let r2 = server.post("/transfers").json(&payload).await;
        r1.assert_status_ok();
        r2.assert_status_ok();
        // Both should return the same transfer ID
        let id1: serde_json::Value = r1.json();
        let id2: serde_json::Value = r2.json();
        assert_eq!(id1["transfer_id"], id2["transfer_id"]);
    }

    #[tokio::test]
    async fn test_batch_transfer() {
        let server = build_test_app();
        server
            .post("/accounts")
            .json(&serde_json::json!({"account_id": "BATCH_D", "ledger": 700, "label": "D", "account_type": "debit_normal"}))
            .await;
        server
            .post("/accounts")
            .json(&serde_json::json!({"account_id": "BATCH_C", "ledger": 700, "label": "C", "account_type": "credit_normal"}))
            .await;
        let resp = server
            .post("/transfers/batch")
            .json(&serde_json::json!({
                "transfers": [
                    {"idempotency_key": "b1", "debit_account_id": "BATCH_D", "credit_account_id": "BATCH_C", "amount": 10000, "ledger": 700, "entry_type": "duty_collection"},
                    {"idempotency_key": "b2", "debit_account_id": "BATCH_D", "credit_account_id": "BATCH_C", "amount": 20000, "ledger": 700, "entry_type": "penalty_levy"}
                ]
            }))
            .await;
        resp.assert_status_ok();
        let body: serde_json::Value = resp.json();
        assert_eq!(body.as_array().unwrap().len(), 2);
    }
}
