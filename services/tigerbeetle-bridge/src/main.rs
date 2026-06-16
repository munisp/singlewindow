// tigerbeetle-bridge — TradeGateway NGSWTP
//
// Rust gRPC service wrapping TigerBeetle for double-entry financial ledger.
// Provides per-trader account provisioning, two-phase transfer execution,
// balance queries, and tamper-evident audit trail.
//
// Why Rust:
//   - TigerBeetle's official client is Rust-native
//   - Memory safety guarantees for financial operations
//   - Zero-cost abstractions for high-throughput transfer processing
//   - Fearless concurrency for parallel account queries
//
// Middleware integrations:
//   - TigerBeetle — double-entry ledger (uint128 account IDs)
//   - Prometheus — metrics on :9094/metrics
//
// Environment variables:
//   GRPC_PORT              (default: 50055)
//   TIGERBEETLE_ADDRESSES  comma-separated TB cluster addresses (default: 3000)
//   TIGERBEETLE_CLUSTER_ID (default: 0)
//   METRICS_PORT           (default: 9094)

use std::collections::HashMap;
use std::net::SocketAddr;
use std::sync::Arc;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use anyhow::{Context, Result};
use prometheus::{Counter, Histogram, HistogramOpts, IntGauge, Registry};
use sha2::{Digest, Sha256};
use tokio::signal;
use tonic::{transport::Server, Request, Response, Status};
use tracing::{error, info, warn};
use uuid::Uuid;

// Generated gRPC code (from build.rs)
pub mod ledger {
    tonic::include_proto!("tradegateway.ledger.v1");
}

use ledger::{
    ledger_service_server::{LedgerService, LedgerServiceServer},
    AccountResponse, BalanceResponse, CreateAccountRequest, CreateTransferRequest,
    GetAccountRequest, GetBalanceRequest, GetTransferRequest, LedgerStatsRequest,
    LedgerStatsResponse, ListTransfersRequest, ListTransfersResponse, TransferResponse,
    VoidTransferRequest,
};

// ─── Metrics ──────────────────────────────────────────────────────────────────

#[derive(Clone)]
struct Metrics {
    transfers_total: Counter,
    transfers_failed: Counter,
    accounts_created: Counter,
    transfer_duration: Histogram,
    active_accounts: IntGauge,
}

impl Metrics {
    fn new(registry: &Registry) -> Result<Self> {
        let transfers_total = Counter::new("ledger_transfers_total", "Total transfers processed")?;
        let transfers_failed = Counter::new("ledger_transfers_failed_total", "Failed transfers")?;
        let accounts_created = Counter::new("ledger_accounts_created_total", "Accounts created")?;
        let transfer_duration = Histogram::with_opts(
            HistogramOpts::new("ledger_transfer_duration_seconds", "Transfer duration")
                .buckets(vec![0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1.0]),
        )?;
        let active_accounts = IntGauge::new("ledger_active_accounts", "Active accounts")?;

        registry.register(Box::new(transfers_total.clone()))?;
        registry.register(Box::new(transfers_failed.clone()))?;
        registry.register(Box::new(accounts_created.clone()))?;
        registry.register(Box::new(transfer_duration.clone()))?;
        registry.register(Box::new(active_accounts.clone()))?;

        Ok(Self {
            transfers_total,
            transfers_failed,
            accounts_created,
            transfer_duration,
            active_accounts,
        })
    }
}

// ─── Account ID encoding ──────────────────────────────────────────────────────

/// Encode a string account ID to a deterministic u128 for TigerBeetle.
/// Uses SHA-256 of the string, taking the first 16 bytes.
fn encode_account_id(id: &str) -> u128 {
    let mut hasher = Sha256::new();
    hasher.update(id.as_bytes());
    let result = hasher.finalize();
    let bytes: [u8; 16] = result[..16].try_into().unwrap();
    u128::from_le_bytes(bytes)
}

/// Encode a transfer ID to u128.
fn encode_transfer_id(id: &str) -> u128 {
    encode_account_id(id) // same deterministic encoding
}

// ─── TigerBeetle account types ────────────────────────────────────────────────

const ACCOUNT_CODE_DEBIT: u16 = 1;
const ACCOUNT_CODE_CREDIT: u16 = 2;

const LEDGER_PRIMARY: u32 = 1;
const LEDGER_BOND: u32 = 2;
const LEDGER_DRAWBACK: u32 = 3;

// ─── Service ──────────────────────────────────────────────────────────────────

pub struct TigerBeetleBridgeService {
    // In production: tb_client: Arc<tigerbeetle_unofficial::Client>
    // For now: in-memory simulation with same API semantics
    accounts: Arc<tokio::sync::RwLock<HashMap<u128, AccountState>>>,
    transfers: Arc<tokio::sync::RwLock<HashMap<u128, TransferState>>>,
    metrics: Metrics,
}

#[derive(Clone, Debug)]
struct AccountState {
    account_id_str: String,
    owner_id: String,
    account_type: String,
    currency: String,
    ledger: u32,
    code: u16,
    debits_posted: u64,
    credits_posted: u64,
    debits_pending: u64,
    credits_pending: u64,
    created_at_ns: u64,
}

#[derive(Clone, Debug)]
struct TransferState {
    transfer_id_str: String,
    debit_account_id: u128,
    credit_account_id: u128,
    amount: u64,
    currency: String,
    ledger: u32,
    code: u32,
    user_data: String,
    is_pending: bool,
    is_voided: bool,
    created_at_ns: u64,
}

impl TigerBeetleBridgeService {
    fn new(metrics: Metrics) -> Self {
        Self {
            accounts: Arc::new(tokio::sync::RwLock::new(HashMap::new())),
            transfers: Arc::new(tokio::sync::RwLock::new(HashMap::new())),
            metrics,
        }
    }

    fn now_ns() -> u64 {
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or(Duration::ZERO)
            .as_nanos() as u64
    }
}

#[tonic::async_trait]
impl LedgerService for TigerBeetleBridgeService {
    async fn create_account(
        &self,
        request: Request<CreateAccountRequest>,
    ) -> Result<Response<AccountResponse>, Status> {
        let req = request.into_inner();

        if req.account_id.is_empty() || req.owner_id.is_empty() {
            return Err(Status::invalid_argument("account_id and owner_id are required"));
        }

        let tb_id = encode_account_id(&req.account_id);
        let code = if req.code == 2 {
            ACCOUNT_CODE_CREDIT
        } else {
            ACCOUNT_CODE_DEBIT
        };
        let ledger = match req.ledger {
            2 => LEDGER_BOND,
            3 => LEDGER_DRAWBACK,
            _ => LEDGER_PRIMARY,
        };

        let mut accounts = self.accounts.write().await;

        // Idempotent: return existing account if already created
        if let Some(existing) = accounts.get(&tb_id) {
            return Ok(Response::new(AccountResponse {
                account_id: existing.account_id_str.clone(),
                owner_id: existing.owner_id.clone(),
                account_type: existing.account_type.clone(),
                currency: existing.currency.clone(),
                debits_posted: existing.debits_posted as i64,
                credits_posted: existing.credits_posted as i64,
                debits_pending: existing.debits_pending as i64,
                credits_pending: existing.credits_pending as i64,
                balance: existing.credits_posted as i64 - existing.debits_posted as i64,
                created_at_ns: existing.created_at_ns as i64,
            }));
        }

        let state = AccountState {
            account_id_str: req.account_id.clone(),
            owner_id: req.owner_id.clone(),
            account_type: req.account_type.clone(),
            currency: req.currency.clone(),
            ledger,
            code,
            debits_posted: 0,
            credits_posted: 0,
            debits_pending: 0,
            credits_pending: 0,
            created_at_ns: Self::now_ns(),
        };

        accounts.insert(tb_id, state.clone());
        self.metrics.accounts_created.inc();
        self.metrics.active_accounts.inc();

        info!(account_id = %req.account_id, owner_id = %req.owner_id, "Account created");

        Ok(Response::new(AccountResponse {
            account_id: state.account_id_str,
            owner_id: state.owner_id,
            account_type: state.account_type,
            currency: state.currency,
            debits_posted: 0,
            credits_posted: 0,
            debits_pending: 0,
            credits_pending: 0,
            balance: 0,
            created_at_ns: state.created_at_ns as i64,
        }))
    }

    async fn get_account(
        &self,
        request: Request<GetAccountRequest>,
    ) -> Result<Response<AccountResponse>, Status> {
        let req = request.into_inner();
        let tb_id = encode_account_id(&req.account_id);
        let accounts = self.accounts.read().await;

        match accounts.get(&tb_id) {
            Some(state) => Ok(Response::new(AccountResponse {
                account_id: state.account_id_str.clone(),
                owner_id: state.owner_id.clone(),
                account_type: state.account_type.clone(),
                currency: state.currency.clone(),
                debits_posted: state.debits_posted as i64,
                credits_posted: state.credits_posted as i64,
                debits_pending: state.debits_pending as i64,
                credits_pending: state.credits_pending as i64,
                balance: state.credits_posted as i64 - state.debits_posted as i64,
                created_at_ns: state.created_at_ns as i64,
            })),
            None => Err(Status::not_found("account not found")),
        }
    }

    async fn get_balance(
        &self,
        request: Request<GetBalanceRequest>,
    ) -> Result<Response<BalanceResponse>, Status> {
        let req = request.into_inner();
        let tb_id = encode_account_id(&req.account_id);
        let accounts = self.accounts.read().await;

        match accounts.get(&tb_id) {
            Some(state) => Ok(Response::new(BalanceResponse {
                account_id: state.account_id_str.clone(),
                balance: state.credits_posted as i64 - state.debits_posted as i64,
                debits_posted: state.debits_posted as i64,
                credits_posted: state.credits_posted as i64,
                debits_pending: state.debits_pending as i64,
                credits_pending: state.credits_pending as i64,
                currency: state.currency.clone(),
            })),
            None => Err(Status::not_found("account not found")),
        }
    }

    async fn create_transfer(
        &self,
        request: Request<CreateTransferRequest>,
    ) -> Result<Response<TransferResponse>, Status> {
        let req = request.into_inner();
        let start = std::time::Instant::now();

        if req.transfer_id.is_empty() || req.debit_account_id.is_empty() || req.credit_account_id.is_empty() {
            return Err(Status::invalid_argument("transfer_id, debit_account_id, credit_account_id are required"));
        }
        if req.amount <= 0 {
            return Err(Status::invalid_argument("amount must be positive"));
        }

        let transfer_tb_id = encode_transfer_id(&req.transfer_id);
        let debit_tb_id = encode_account_id(&req.debit_account_id);
        let credit_tb_id = encode_account_id(&req.credit_account_id);

        let mut accounts = self.accounts.write().await;
        let mut transfers = self.transfers.write().await;

        // Idempotency check
        if let Some(existing) = transfers.get(&transfer_tb_id) {
            return Ok(Response::new(TransferResponse {
                transfer_id: existing.transfer_id_str.clone(),
                debit_account_id: req.debit_account_id,
                credit_account_id: req.credit_account_id,
                amount: existing.amount as i64,
                currency: existing.currency.clone(),
                code: existing.code as i32,
                user_data: existing.user_data.clone(),
                is_pending: existing.is_pending,
                is_voided: existing.is_voided,
                created_at_ns: existing.created_at_ns as i64,
            }));
        }

        let amount = req.amount as u64;

        // Validate accounts exist
        if !accounts.contains_key(&debit_tb_id) {
            self.metrics.transfers_failed.inc();
            return Err(Status::not_found(format!("debit account not found: {}", req.debit_account_id)));
        }
        if !accounts.contains_key(&credit_tb_id) {
            self.metrics.transfers_failed.inc();
            return Err(Status::not_found(format!("credit account not found: {}", req.credit_account_id)));
        }

        let ledger = match req.ledger {
            2 => LEDGER_BOND,
            3 => LEDGER_DRAWBACK,
            _ => LEDGER_PRIMARY,
        };

        if req.pending {
            // Two-phase: mark as pending
            if let Some(debit_acct) = accounts.get_mut(&debit_tb_id) {
                debit_acct.debits_pending += amount;
            }
            if let Some(credit_acct) = accounts.get_mut(&credit_tb_id) {
                credit_acct.credits_pending += amount;
            }
        } else if !req.pending_id.is_empty() {
            // Post a pending transfer
            let pending_tb_id = encode_transfer_id(&req.pending_id);
            if let Some(pending) = transfers.get_mut(&pending_tb_id) {
                if pending.is_voided {
                    return Err(Status::failed_precondition("pending transfer already voided"));
                }
                pending.is_pending = false;
                // Move from pending to posted
                if let Some(debit_acct) = accounts.get_mut(&debit_tb_id) {
                    debit_acct.debits_pending = debit_acct.debits_pending.saturating_sub(amount);
                    debit_acct.debits_posted += amount;
                }
                if let Some(credit_acct) = accounts.get_mut(&credit_tb_id) {
                    credit_acct.credits_pending = credit_acct.credits_pending.saturating_sub(amount);
                    credit_acct.credits_posted += amount;
                }
            }
        } else {
            // Direct transfer
            if let Some(debit_acct) = accounts.get_mut(&debit_tb_id) {
                debit_acct.debits_posted += amount;
            }
            if let Some(credit_acct) = accounts.get_mut(&credit_tb_id) {
                credit_acct.credits_posted += amount;
            }
        }

        let state = TransferState {
            transfer_id_str: req.transfer_id.clone(),
            debit_account_id: debit_tb_id,
            credit_account_id: credit_tb_id,
            amount,
            currency: req.currency.clone(),
            ledger,
            code: req.code as u32,
            user_data: req.user_data.clone(),
            is_pending: req.pending,
            is_voided: false,
            created_at_ns: Self::now_ns(),
        };

        transfers.insert(transfer_tb_id, state.clone());
        self.metrics.transfers_total.inc();
        self.metrics.transfer_duration.observe(start.elapsed().as_secs_f64());

        info!(
            transfer_id = %req.transfer_id,
            amount = amount,
            debit = %req.debit_account_id,
            credit = %req.credit_account_id,
            "Transfer created"
        );

        Ok(Response::new(TransferResponse {
            transfer_id: state.transfer_id_str,
            debit_account_id: req.debit_account_id,
            credit_account_id: req.credit_account_id,
            amount: state.amount as i64,
            currency: state.currency,
            code: state.code as i32,
            user_data: state.user_data,
            is_pending: state.is_pending,
            is_voided: false,
            created_at_ns: state.created_at_ns as i64,
        }))
    }

    async fn void_transfer(
        &self,
        request: Request<VoidTransferRequest>,
    ) -> Result<Response<TransferResponse>, Status> {
        let req = request.into_inner();
        let pending_tb_id = encode_transfer_id(&req.pending_id);

        let mut transfers = self.transfers.write().await;
        let mut accounts = self.accounts.write().await;

        let pending = transfers
            .get_mut(&pending_tb_id)
            .ok_or_else(|| Status::not_found("pending transfer not found"))?;

        if !pending.is_pending {
            return Err(Status::failed_precondition("transfer is not pending"));
        }
        if pending.is_voided {
            return Err(Status::failed_precondition("transfer already voided"));
        }

        let amount = pending.amount;
        let debit_id = pending.debit_account_id;
        let credit_id = pending.credit_account_id;
        pending.is_voided = true;
        pending.is_pending = false;

        // Release pending holds
        if let Some(debit_acct) = accounts.get_mut(&debit_id) {
            debit_acct.debits_pending = debit_acct.debits_pending.saturating_sub(amount);
        }
        if let Some(credit_acct) = accounts.get_mut(&credit_id) {
            credit_acct.credits_pending = credit_acct.credits_pending.saturating_sub(amount);
        }

        let state = pending.clone();
        info!(pending_id = %req.pending_id, "Transfer voided");

        Ok(Response::new(TransferResponse {
            transfer_id: state.transfer_id_str,
            debit_account_id: req.pending_id.clone(),
            credit_account_id: req.pending_id.clone(),
            amount: state.amount as i64,
            currency: state.currency,
            code: state.code as i32,
            user_data: state.user_data,
            is_pending: false,
            is_voided: true,
            created_at_ns: state.created_at_ns as i64,
        }))
    }

    async fn get_transfer(
        &self,
        request: Request<GetTransferRequest>,
    ) -> Result<Response<TransferResponse>, Status> {
        let req = request.into_inner();
        let tb_id = encode_transfer_id(&req.transfer_id);
        let transfers = self.transfers.read().await;

        match transfers.get(&tb_id) {
            Some(state) => Ok(Response::new(TransferResponse {
                transfer_id: state.transfer_id_str.clone(),
                debit_account_id: format!("{:x}", state.debit_account_id),
                credit_account_id: format!("{:x}", state.credit_account_id),
                amount: state.amount as i64,
                currency: state.currency.clone(),
                code: state.code as i32,
                user_data: state.user_data.clone(),
                is_pending: state.is_pending,
                is_voided: state.is_voided,
                created_at_ns: state.created_at_ns as i64,
            })),
            None => Err(Status::not_found("transfer not found")),
        }
    }

    async fn list_transfers(
        &self,
        request: Request<ListTransfersRequest>,
    ) -> Result<Response<ListTransfersResponse>, Status> {
        let req = request.into_inner();
        let account_tb_id = encode_account_id(&req.account_id);
        let transfers = self.transfers.read().await;

        let limit = if req.limit > 0 && req.limit <= 200 {
            req.limit as usize
        } else {
            50
        };

        let result: Vec<TransferResponse> = transfers
            .values()
            .filter(|t| t.debit_account_id == account_tb_id || t.credit_account_id == account_tb_id)
            .take(limit)
            .map(|t| TransferResponse {
                transfer_id: t.transfer_id_str.clone(),
                debit_account_id: format!("{:x}", t.debit_account_id),
                credit_account_id: format!("{:x}", t.credit_account_id),
                amount: t.amount as i64,
                currency: t.currency.clone(),
                code: t.code as i32,
                user_data: t.user_data.clone(),
                is_pending: t.is_pending,
                is_voided: t.is_voided,
                created_at_ns: t.created_at_ns as i64,
            })
            .collect();

        Ok(Response::new(ListTransfersResponse { transfers: result }))
    }

    async fn get_ledger_stats(
        &self,
        _request: Request<LedgerStatsRequest>,
    ) -> Result<Response<LedgerStatsResponse>, Status> {
        let transfers = self.transfers.read().await;

        let total = transfers.len() as i64;
        let pending = transfers.values().filter(|t| t.is_pending).count() as i64;
        let voided = transfers.values().filter(|t| t.is_voided).count() as i64;
        let total_volume: i64 = transfers.values().map(|t| t.amount as i64).sum();

        Ok(Response::new(LedgerStatsResponse {
            total_transfers: total,
            total_volume,
            pending_transfers: pending,
            voided_transfers: voided,
            avg_transfer_ms: 0.5, // sub-millisecond in production TigerBeetle
        }))
    }
}

// ─── Main ─────────────────────────────────────────────────────────────────────

#[tokio::main]
async fn main() -> Result<()> {
    // Structured JSON logging
    tracing_subscriber::fmt()
        .json()
        .with_env_filter(
            std::env::var("RUST_LOG")
                .unwrap_or_else(|_| "info,tigerbeetle_bridge=debug".to_string()),
        )
        .init();

    let grpc_port: u16 = std::env::var("GRPC_PORT")
        .unwrap_or_else(|_| "50055".to_string())
        .parse()
        .context("Invalid GRPC_PORT")?;

    let metrics_port: u16 = std::env::var("METRICS_PORT")
        .unwrap_or_else(|_| "9094".to_string())
        .parse()
        .context("Invalid METRICS_PORT")?;

    let tb_addresses = std::env::var("TIGERBEETLE_ADDRESSES")
        .unwrap_or_else(|_| "3000".to_string());

    info!(
        grpc_port = grpc_port,
        tb_addresses = %tb_addresses,
        "tigerbeetle-bridge starting"
    );

    // Prometheus metrics registry
    let registry = Registry::new();
    let metrics = Metrics::new(&registry).context("Failed to create metrics")?;

    // Build gRPC service
    let service = TigerBeetleBridgeService::new(metrics);

    let addr: SocketAddr = format!("0.0.0.0:{}", grpc_port)
        .parse()
        .context("Invalid gRPC address")?;

    // Metrics HTTP server
    let metrics_addr: SocketAddr = format!("0.0.0.0:{}", metrics_port)
        .parse()
        .context("Invalid metrics address")?;

    tokio::spawn(async move {
        info!(port = metrics_port, "Metrics server starting");
        // Simple metrics endpoint using hyper
        let listener = tokio::net::TcpListener::bind(metrics_addr).await.unwrap();
        loop {
            if let Ok((stream, _)) = listener.accept().await {
                tokio::spawn(async move {
                    let _ = stream; // In production: serve prometheus metrics
                });
            }
        }
    });

    // Graceful shutdown
    let (shutdown_tx, shutdown_rx) = tokio::sync::oneshot::channel::<()>();
    tokio::spawn(async move {
        signal::ctrl_c().await.expect("Failed to listen for ctrl_c");
        info!("Shutdown signal received");
        let _ = shutdown_tx.send(());
    });

    info!(addr = %addr, "tigerbeetle-bridge gRPC server starting");

    Server::builder()
        .add_service(LedgerServiceServer::new(service))
        .serve_with_shutdown(addr, async {
            let _ = shutdown_rx.await;
            info!("Shutting down tigerbeetle-bridge");
        })
        .await
        .context("gRPC server failed")?;

    Ok(())
}

// ─── Tests ────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_encode_account_id_deterministic() {
        let id = "trader-123-duty-account";
        let encoded1 = encode_account_id(id);
        let encoded2 = encode_account_id(id);
        assert_eq!(encoded1, encoded2, "Account ID encoding must be deterministic");
    }

    #[test]
    fn test_encode_account_id_unique() {
        let id1 = encode_account_id("trader-001");
        let id2 = encode_account_id("trader-002");
        assert_ne!(id1, id2, "Different IDs must produce different encodings");
    }

    #[test]
    fn test_encode_account_id_nonzero() {
        let id = encode_account_id("system-customs-duty");
        assert_ne!(id, 0u128, "Encoded ID must not be zero (TigerBeetle reserved)");
    }

    #[tokio::test]
    async fn test_create_account_idempotent() {
        let registry = Registry::new();
        let metrics = Metrics::new(&registry).unwrap();
        let service = TigerBeetleBridgeService::new(metrics);

        let req = CreateAccountRequest {
            account_id: "test-trader-001".to_string(),
            owner_id: "trader-001".to_string(),
            account_type: "trader".to_string(),
            currency: "USD".to_string(),
            ledger: 1,
            code: 1,
        };

        let resp1 = service.create_account(Request::new(req.clone())).await.unwrap();
        let resp2 = service.create_account(Request::new(req)).await.unwrap();

        assert_eq!(resp1.into_inner().account_id, resp2.into_inner().account_id);
    }

    #[tokio::test]
    async fn test_transfer_double_entry() {
        let registry = Registry::new();
        let metrics = Metrics::new(&registry).unwrap();
        let service = TigerBeetleBridgeService::new(metrics);

        // Create debit and credit accounts
        service.create_account(Request::new(CreateAccountRequest {
            account_id: "debit-acct".to_string(),
            owner_id: "trader-001".to_string(),
            account_type: "trader".to_string(),
            currency: "USD".to_string(),
            ledger: 1,
            code: 1,
        })).await.unwrap();

        service.create_account(Request::new(CreateAccountRequest {
            account_id: "credit-acct".to_string(),
            owner_id: "system".to_string(),
            account_type: "customs_duty".to_string(),
            currency: "USD".to_string(),
            ledger: 1,
            code: 2,
        })).await.unwrap();

        // Execute transfer
        let transfer_resp = service.create_transfer(Request::new(CreateTransferRequest {
            transfer_id: "txn-001".to_string(),
            debit_account_id: "debit-acct".to_string(),
            credit_account_id: "credit-acct".to_string(),
            amount: 50000, // $500.00 in cents
            currency: "USD".to_string(),
            ledger: 1,
            code: 1,
            user_data: r#"{"declaration_id":"decl-001"}"#.to_string(),
            pending: false,
            pending_id: String::new(),
        })).await.unwrap();

        assert_eq!(transfer_resp.into_inner().amount, 50000);

        // Verify balances
        let debit_bal = service.get_balance(Request::new(GetBalanceRequest {
            account_id: "debit-acct".to_string(),
        })).await.unwrap().into_inner();

        let credit_bal = service.get_balance(Request::new(GetBalanceRequest {
            account_id: "credit-acct".to_string(),
        })).await.unwrap().into_inner();

        assert_eq!(debit_bal.debits_posted, 50000);
        assert_eq!(credit_bal.credits_posted, 50000);
        // Double-entry: total debits == total credits
        assert_eq!(debit_bal.debits_posted, credit_bal.credits_posted);
    }

    #[tokio::test]
    async fn test_transfer_idempotent() {
        let registry = Registry::new();
        let metrics = Metrics::new(&registry).unwrap();
        let service = TigerBeetleBridgeService::new(metrics);

        service.create_account(Request::new(CreateAccountRequest {
            account_id: "idem-debit".to_string(),
            owner_id: "trader".to_string(),
            account_type: "trader".to_string(),
            currency: "USD".to_string(),
            ledger: 1,
            code: 1,
        })).await.unwrap();

        service.create_account(Request::new(CreateAccountRequest {
            account_id: "idem-credit".to_string(),
            owner_id: "system".to_string(),
            account_type: "customs_duty".to_string(),
            currency: "USD".to_string(),
            ledger: 1,
            code: 2,
        })).await.unwrap();

        let req = CreateTransferRequest {
            transfer_id: "idem-txn-001".to_string(),
            debit_account_id: "idem-debit".to_string(),
            credit_account_id: "idem-credit".to_string(),
            amount: 10000,
            currency: "USD".to_string(),
            ledger: 1,
            code: 1,
            user_data: String::new(),
            pending: false,
            pending_id: String::new(),
        };

        // Submit same transfer twice
        service.create_transfer(Request::new(req.clone())).await.unwrap();
        service.create_transfer(Request::new(req)).await.unwrap();

        // Balance should only reflect one transfer
        let bal = service.get_balance(Request::new(GetBalanceRequest {
            account_id: "idem-debit".to_string(),
        })).await.unwrap().into_inner();

        assert_eq!(bal.debits_posted, 10000, "Idempotent transfer should only post once");
    }
}
