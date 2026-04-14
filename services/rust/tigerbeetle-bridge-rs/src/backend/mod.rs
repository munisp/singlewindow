// backend/mod.rs — Backend trait and shared types for tigerbeetle-bridge-rs
//
// The Backend trait abstracts over:
//   - SimBackend: in-memory HashMap (default, CI-safe, zero dependencies)
//   - LiveBackend: real TigerBeetle client (feature = "tigerbeetle-live")
//
// This allows the same HTTP API surface to be tested without TigerBeetle installed.

use anyhow::Result;
use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use std::time::SystemTime;

pub mod simulation;

#[cfg(feature = "tigerbeetle-live")]
pub mod live;

// ─── Shared domain types ──────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AccountBalance {
    pub account_id: String,
    pub ledger: u32,
    pub label: String,
    pub account_type: String,
    /// Sum of all debits posted to this account (minor units)
    pub debits_posted: u64,
    /// Sum of all credits posted to this account (minor units)
    pub credits_posted: u64,
    /// Net balance = credits_posted - debits_posted (signed)
    pub balance: i64,
    pub created_at: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TransferRecord {
    pub transfer_id: String,
    pub idempotency_key: String,
    pub debit_account_id: String,
    pub credit_account_id: String,
    pub amount: u64,
    pub ledger: u32,
    pub entry_type: String,
    pub declaration_ref: Option<String>,
    pub memo: Option<String>,
    /// "pending" | "posted" | "voided"
    pub status: String,
    pub created_at: u64,
}

#[derive(Debug, Clone)]
pub struct CreateAccountRequest {
    pub account_id: String,
    pub ledger: u32,
    pub label: String,
    pub account_type: String,
}

#[derive(Debug, Clone)]
pub struct CreateTransferRequest {
    pub idempotency_key: String,
    pub debit_account_id: String,
    pub credit_account_id: String,
    pub amount: u64,
    pub ledger: u32,
    pub entry_type: String,
    pub declaration_ref: Option<String>,
    pub memo: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct BackendMetrics {
    pub accounts_total: usize,
    pub transfers_total: usize,
    pub is_live: bool,
}

// ─── Backend trait ────────────────────────────────────────────────────────────

#[async_trait]
pub trait Backend {
    /// Human-readable backend name for health checks
    fn name(&self) -> &'static str;

    /// Create or upsert an account. Returns the current balance.
    async fn create_account(&self, req: CreateAccountRequest) -> Result<AccountBalance>;

    /// Get account balance by ID.
    async fn get_account(&self, account_id: &str) -> Result<AccountBalance>;

    /// Create a double-entry transfer. Idempotent on idempotency_key.
    async fn create_transfer(&self, req: CreateTransferRequest) -> Result<TransferRecord>;

    /// Get transfer by ID.
    async fn get_transfer(&self, transfer_id: &str) -> Result<TransferRecord>;

    /// List all transfers involving a given account.
    async fn list_transfers_for_account(&self, account_id: &str) -> Result<Vec<TransferRecord>>;

    /// Atomic batch transfer — all succeed or all fail.
    async fn batch_transfer(&self, reqs: Vec<CreateTransferRequest>) -> Result<Vec<TransferRecord>>;

    /// Prometheus-compatible metrics snapshot.
    async fn metrics(&self) -> BackendMetrics;
}

// ─── Utility ──────────────────────────────────────────────────────────────────

pub fn now_unix_ms() -> u64 {
    SystemTime::now()
        .duration_since(SystemTime::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}
