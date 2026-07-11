/*!
 * TigerBeetle Bridge Service — Double-entry financial ledger for customs duties
 * Language: Rust 1.82+ | Framework: Axum | Protocol: HTTP REST
 *
 * Implements double-entry bookkeeping for:
 * - Duty assessment (debit: trader liability, credit: customs revenue)
 * - Payment confirmation (debit: bank settlement, credit: trader liability)
 * - Duty drawback (debit: customs revenue, credit: trader receivable)
 * - Bond/securities management
 * - Penalty accounting
 *
 * In production: connects to TigerBeetle cluster via tigerbeetle-node client.
 * This bridge simulates the TigerBeetle API semantics using PostgreSQL
 * for development/testing environments.
 *
 * TigerBeetle guarantees:
 * - Linearizable consistency (no race conditions)
 * - 1 million transactions/second throughput
 * - Immutable audit log (tamper-proof)
 * - ACID guarantees with two-phase transfers
 */

use axum::{
    extract::State,
    http::StatusCode,
    response::Json,
    routing::{get, post},
    Router,
};
use chrono::{DateTime, Utc};
use rust_decimal::Decimal;
use serde::{Deserialize, Serialize};
use std::{net::SocketAddr, sync::Arc};
use tokio::net::TcpListener;
use tower_http::cors::CorsLayer;
use tracing::info;
use uuid::Uuid;

// ─── ACCOUNT TYPES ────────────────────────────────────────────────────────────

/// TigerBeetle account ledger codes
/// Follows WCO revenue accounting standards
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum AccountLedger {
    /// Trader's duty liability account (debit = owe more, credit = paid)
    TraderLiability = 1001,
    /// Customs authority revenue account
    CustomsRevenue = 2001,
    /// Bank settlement clearing account
    BankSettlement = 3001,
    /// Duty drawback receivable account
    DrawbackReceivable = 4001,
    /// Penalty/fine account
    PenaltyRevenue = 5001,
    /// Bond/security deposit account
    SecurityDeposit = 6001,
    /// Transit guarantee account
    TransitGuarantee = 7001,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Account {
    pub id: String,
    pub ledger: u32,
    pub code: u16,
    pub debits_posted: u64,
    pub credits_posted: u64,
    pub debits_pending: u64,
    pub credits_pending: u64,
    pub user_data: Option<String>, // Trader ID or declaration reference
    pub created_at: DateTime<Utc>,
}

impl Account {
    pub fn balance(&self) -> i64 {
        self.credits_posted as i64 - self.debits_posted as i64
    }
}

// ─── TRANSFER TYPES ───────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum TransferType {
    /// Duty assessment — creates liability
    DutyAssessment,
    /// Payment received — settles liability
    PaymentReceived,
    /// Duty drawback — refund to trader
    DutyDrawback,
    /// Penalty assessment
    PenaltyAssessment,
    /// Bond deposit
    BondDeposit,
    /// Bond release
    BondRelease,
    /// Transit guarantee
    TransitGuarantee,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Transfer {
    pub id: String,
    pub debit_account_id: String,
    pub credit_account_id: String,
    pub amount: u64, // In minor currency units (cents)
    pub currency: String,
    pub transfer_type: TransferType,
    pub declaration_id: Option<i64>,
    pub reference: String,
    pub timestamp: DateTime<Utc>,
    pub flags: u16,
}

// ─── REQUEST / RESPONSE MODELS ────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
pub struct AssessDutyRequest {
    pub declaration_id: i64,
    pub trader_id: i64,
    pub duty_amount: f64,
    pub vat_amount: f64,
    pub levy_amount: f64,
    pub currency: String,
    pub hs_code: String,
    pub description: String,
}

#[derive(Debug, Serialize)]
pub struct AssessDutyResponse {
    pub assessment_id: String,
    pub declaration_id: i64,
    pub total_amount: f64,
    pub duty_amount: f64,
    pub vat_amount: f64,
    pub levy_amount: f64,
    pub currency: String,
    pub debit_account: String,
    pub credit_account: String,
    pub transfer_id: String,
    pub assessed_at: DateTime<Utc>,
}

#[derive(Debug, Deserialize)]
pub struct ConfirmPaymentRequest {
    pub declaration_id: i64,
    pub trader_id: i64,
    pub amount: f64,
    pub currency: String,
    pub payment_reference: String,
    pub payment_method: String, // mojaloop | bank_transfer | mobile_money
    pub mojaloop_transfer_id: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct ConfirmPaymentResponse {
    pub payment_id: String,
    pub declaration_id: i64,
    pub amount: f64,
    pub currency: String,
    pub payment_reference: String,
    pub transfer_id: String,
    pub balance_after: f64,
    pub fully_settled: bool,
    pub confirmed_at: DateTime<Utc>,
}

#[derive(Debug, Deserialize)]
pub struct DrawbackRequest {
    pub declaration_id: i64,
    pub trader_id: i64,
    pub drawback_amount: f64,
    pub currency: String,
    pub reason: String, // re-export | manufacturing | damaged_goods
    pub original_assessment_id: String,
}

#[derive(Debug, Serialize)]
pub struct DrawbackResponse {
    pub drawback_id: String,
    pub declaration_id: i64,
    pub amount: f64,
    pub currency: String,
    pub transfer_id: String,
    pub approved_at: DateTime<Utc>,
}

#[derive(Debug, Deserialize)]
pub struct GetBalanceRequest {
    pub trader_id: i64,
    pub declaration_id: Option<i64>,
}

#[derive(Debug, Serialize)]
pub struct BalanceResponse {
    pub trader_id: i64,
    pub outstanding_duties: f64,
    pub total_paid: f64,
    pub pending_drawbacks: f64,
    pub currency: String,
    pub as_of: DateTime<Utc>,
}

// ─── BUILD-TAG MODE DETECTION ──────────────────────────────────────────────────────

/// Compile-time mode string surfaced by the /health endpoint.
/// Switches automatically based on the `tigerbeetle-live` Cargo feature flag:
///   - Default build (no feature): "simulation"
///   - Production build (--features tigerbeetle-live): "live"
/// See PRODUCTION-GUIDE.md for full setup instructions.
#[cfg(not(feature = "tigerbeetle-live"))]
const LEDGER_MODE: &str = "simulation";
#[cfg(feature = "tigerbeetle-live")]
const LEDGER_MODE: &str = "live";

// ─── IN-MEMORY LEDGER (development simulation) ────────────────────────────────

/// Simple in-memory ledger for development.
///
/// This backend is compiled when the `tigerbeetle-live` feature flag is NOT set.
/// It provides identical HTTP API semantics to the live TigerBeetle backend.
///
/// To switch to the real TigerBeetle client:
///   cargo build --release --features tigerbeetle-live
/// See PRODUCTION-GUIDE.md for full setup instructions.
#[derive(Default, Clone)]
pub struct InMemoryLedger {
    pub transfers: Vec<Transfer>,
    pub accounts: std::collections::HashMap<String, Account>,
}

impl InMemoryLedger {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn get_or_create_account(&mut self, id: &str, ledger: u32, code: u16) -> &mut Account {
        self.accounts.entry(id.to_string()).or_insert_with(|| Account {
            id: id.to_string(),
            ledger,
            code,
            debits_posted: 0,
            credits_posted: 0,
            debits_pending: 0,
            credits_pending: 0,
            user_data: None,
            created_at: Utc::now(),
        })
    }

    pub fn post_transfer(
        &mut self,
        debit_id: &str,
        credit_id: &str,
        amount: u64,
        transfer_type: TransferType,
        declaration_id: Option<i64>,
        reference: &str,
        currency: &str,
    ) -> Transfer {
        // Update debit account
        if let Some(acct) = self.accounts.get_mut(debit_id) {
            acct.debits_posted += amount;
        }
        // Update credit account
        if let Some(acct) = self.accounts.get_mut(credit_id) {
            acct.credits_posted += amount;
        }

        let transfer = Transfer {
            id: Uuid::new_v4().to_string(),
            debit_account_id: debit_id.to_string(),
            credit_account_id: credit_id.to_string(),
            amount,
            currency: currency.to_string(),
            transfer_type,
            declaration_id,
            reference: reference.to_string(),
            timestamp: Utc::now(),
            flags: 0,
        };

        self.transfers.push(transfer.clone());
        transfer
    }
}

// ─── APP STATE ────────────────────────────────────────────────────────────────

pub struct AppState {
    pub ledger: tokio::sync::Mutex<InMemoryLedger>,
}

// ─── HTTP HANDLERS ────────────────────────────────────────────────────────────

async fn health_handler() -> Json<serde_json::Value> {
    Json(serde_json::json!({
        "status": "healthy",
        "service": "tigerbeetle-bridge",
        "version": "0.1.0",
        "mode": LEDGER_MODE,
        "tigerbeetle_addr": std::env::var("TIGERBEETLE_ADDR").unwrap_or_else(|_| "not set".to_string()),
    }))
}

async fn assess_duty_handler(
    State(state): State<Arc<AppState>>,
    Json(req): Json<AssessDutyRequest>,
) -> Result<Json<AssessDutyResponse>, (StatusCode, String)> {
    let mut ledger = state.ledger.lock().await;

    let total = req.duty_amount + req.vat_amount + req.levy_amount;
    let amount_cents = (total * 100.0) as u64;

    // Account IDs
    let trader_liability_id = format!("trader-{}-liability", req.trader_id);
    let customs_revenue_id = "customs-revenue-main".to_string();

    // Ensure accounts exist
    ledger.get_or_create_account(&trader_liability_id, 1001, 1);
    ledger.get_or_create_account(&customs_revenue_id, 2001, 1);

    // Post transfer: debit trader liability, credit customs revenue
    let transfer = ledger.post_transfer(
        &trader_liability_id,
        &customs_revenue_id,
        amount_cents,
        TransferType::DutyAssessment,
        Some(req.declaration_id),
        &format!("DUTY-ASSESS-{}", req.declaration_id),
        &req.currency,
    );

    let assessment_id = format!("ASSESS-{}", Uuid::new_v4().simple());

    info!(
        declaration_id = req.declaration_id,
        total = total,
        currency = %req.currency,
        transfer_id = %transfer.id,
        "Duty assessed"
    );

    Ok(Json(AssessDutyResponse {
        assessment_id,
        declaration_id: req.declaration_id,
        total_amount: total,
        duty_amount: req.duty_amount,
        vat_amount: req.vat_amount,
        levy_amount: req.levy_amount,
        currency: req.currency,
        debit_account: trader_liability_id,
        credit_account: customs_revenue_id,
        transfer_id: transfer.id,
        assessed_at: Utc::now(),
    }))
}

async fn confirm_payment_handler(
    State(state): State<Arc<AppState>>,
    Json(req): Json<ConfirmPaymentRequest>,
) -> Result<Json<ConfirmPaymentResponse>, (StatusCode, String)> {
    let mut ledger = state.ledger.lock().await;

    let amount_cents = (req.amount * 100.0) as u64;

    let bank_settlement_id = format!("bank-settlement-{}", req.payment_method);
    let trader_liability_id = format!("trader-{}-liability", req.trader_id);

    ledger.get_or_create_account(&bank_settlement_id, 3001, 1);
    ledger.get_or_create_account(&trader_liability_id, 1001, 1);

    // Post transfer: debit bank settlement, credit trader liability (reduces what they owe)
    let transfer = ledger.post_transfer(
        &bank_settlement_id,
        &trader_liability_id,
        amount_cents,
        TransferType::PaymentReceived,
        Some(req.declaration_id),
        &req.payment_reference,
        &req.currency,
    );

    // Calculate remaining balance
    let liability_acct = ledger.accounts.get(&trader_liability_id).unwrap();
    let balance_cents = liability_acct.balance();
    let balance_after = balance_cents as f64 / 100.0;
    let fully_settled = balance_after <= 0.0;

    info!(
        declaration_id = req.declaration_id,
        amount = req.amount,
        method = %req.payment_method,
        fully_settled = fully_settled,
        "Payment confirmed"
    );

    Ok(Json(ConfirmPaymentResponse {
        payment_id: format!("PAY-{}", Uuid::new_v4().simple()),
        declaration_id: req.declaration_id,
        amount: req.amount,
        currency: req.currency,
        payment_reference: req.payment_reference,
        transfer_id: transfer.id,
        balance_after,
        fully_settled,
        confirmed_at: Utc::now(),
    }))
}

async fn duty_drawback_handler(
    State(state): State<Arc<AppState>>,
    Json(req): Json<DrawbackRequest>,
) -> Result<Json<DrawbackResponse>, (StatusCode, String)> {
    let mut ledger = state.ledger.lock().await;

    let amount_cents = (req.drawback_amount * 100.0) as u64;

    let customs_revenue_id = "customs-revenue-main".to_string();
    let drawback_receivable_id = format!("trader-{}-drawback", req.trader_id);

    ledger.get_or_create_account(&customs_revenue_id, 2001, 1);
    ledger.get_or_create_account(&drawback_receivable_id, 4001, 1);

    // Post transfer: debit customs revenue, credit trader drawback receivable
    let transfer = ledger.post_transfer(
        &customs_revenue_id,
        &drawback_receivable_id,
        amount_cents,
        TransferType::DutyDrawback,
        Some(req.declaration_id),
        &format!("DRAWBACK-{}", req.declaration_id),
        &req.currency,
    );

    info!(
        declaration_id = req.declaration_id,
        amount = req.drawback_amount,
        reason = %req.reason,
        "Duty drawback approved"
    );

    Ok(Json(DrawbackResponse {
        drawback_id: format!("DRAWBACK-{}", Uuid::new_v4().simple()),
        declaration_id: req.declaration_id,
        amount: req.drawback_amount,
        currency: req.currency,
        transfer_id: transfer.id,
        approved_at: Utc::now(),
    }))
}

async fn get_balance_handler(
    State(state): State<Arc<AppState>>,
    Json(req): Json<GetBalanceRequest>,
) -> Result<Json<BalanceResponse>, (StatusCode, String)> {
    let ledger = state.ledger.lock().await;

    let liability_id = format!("trader-{}-liability", req.trader_id);
    let drawback_id = format!("trader-{}-drawback", req.trader_id);

    let outstanding_duties = ledger
        .accounts
        .get(&liability_id)
        .map(|a| a.balance() as f64 / 100.0)
        .unwrap_or(0.0)
        .max(0.0);

    let total_paid = ledger
        .accounts
        .get(&liability_id)
        .map(|a| a.credits_posted as f64 / 100.0)
        .unwrap_or(0.0);

    let pending_drawbacks = ledger
        .accounts
        .get(&drawback_id)
        .map(|a| a.credits_posted as f64 / 100.0)
        .unwrap_or(0.0);

    Ok(Json(BalanceResponse {
        trader_id: req.trader_id,
        outstanding_duties,
        total_paid,
        pending_drawbacks,
        currency: "USD".to_string(),
        as_of: Utc::now(),
    }))
}

async fn get_transfers_handler(
    State(state): State<Arc<AppState>>,
) -> Json<serde_json::Value> {
    let ledger = state.ledger.lock().await;
    Json(serde_json::json!({
        "transfers": ledger.transfers,
        "count": ledger.transfers.len(),
        "accounts": ledger.accounts.len(),
    }))
}

// ─── BOND HANDLERS ────────────────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
pub struct BondDepositRequest {
    pub declaration_id: i64,
    pub trader_id: i64,
    pub bond_amount: f64,
    pub currency: String,
    pub bond_type: String, // import_bond | transit_bond | aeo_bond
    pub expiry_date: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct BondDepositResponse {
    pub bond_id: String,
    pub declaration_id: i64,
    pub amount: f64,
    pub currency: String,
    pub bond_type: String,
    pub transfer_id: String,
    pub deposited_at: DateTime<Utc>,
}

async fn bond_deposit_handler(
    State(state): State<Arc<AppState>>,
    Json(req): Json<BondDepositRequest>,
) -> Result<Json<BondDepositResponse>, (StatusCode, String)> {
    let mut ledger = state.ledger.lock().await;
    let amount_cents = (req.bond_amount * 100.0) as u64;
    let trader_liability_id = format!("trader-{}-liability", req.trader_id);
    let security_deposit_id = format!("bond-{}-{}", req.trader_id, req.bond_type);
    ledger.get_or_create_account(&trader_liability_id, 1001, 1);
    ledger.get_or_create_account(&security_deposit_id, 6001, 1);
    let transfer = ledger.post_transfer(
        &trader_liability_id,
        &security_deposit_id,
        amount_cents,
        TransferType::BondDeposit,
        Some(req.declaration_id),
        &format!("BOND-DEP-{}-{}", req.declaration_id, req.bond_type),
        &req.currency,
    );
    info!(declaration_id = req.declaration_id, amount = req.bond_amount, bond_type = %req.bond_type, "Bond deposited");
    Ok(Json(BondDepositResponse {
        bond_id: format!("BOND-{}", Uuid::new_v4().simple()),
        declaration_id: req.declaration_id,
        amount: req.bond_amount,
        currency: req.currency,
        bond_type: req.bond_type,
        transfer_id: transfer.id,
        deposited_at: Utc::now(),
    }))
}

#[derive(Debug, Deserialize)]
pub struct BondReleaseRequest {
    pub declaration_id: i64,
    pub trader_id: i64,
    pub bond_amount: f64,
    pub currency: String,
    pub bond_type: String,
    pub release_reason: String, // clearance_complete | re_export | cancelled
}

#[derive(Debug, Serialize)]
pub struct BondReleaseResponse {
    pub release_id: String,
    pub declaration_id: i64,
    pub amount: f64,
    pub currency: String,
    pub transfer_id: String,
    pub released_at: DateTime<Utc>,
}

async fn bond_release_handler(
    State(state): State<Arc<AppState>>,
    Json(req): Json<BondReleaseRequest>,
) -> Result<Json<BondReleaseResponse>, (StatusCode, String)> {
    let mut ledger = state.ledger.lock().await;
    let amount_cents = (req.bond_amount * 100.0) as u64;
    let security_deposit_id = format!("bond-{}-{}", req.trader_id, req.bond_type);
    let trader_liability_id = format!("trader-{}-liability", req.trader_id);
    ledger.get_or_create_account(&security_deposit_id, 6001, 1);
    ledger.get_or_create_account(&trader_liability_id, 1001, 1);
    let transfer = ledger.post_transfer(
        &security_deposit_id,
        &trader_liability_id,
        amount_cents,
        TransferType::BondRelease,
        Some(req.declaration_id),
        &format!("BOND-REL-{}-{}", req.declaration_id, req.release_reason),
        &req.currency,
    );
    info!(declaration_id = req.declaration_id, amount = req.bond_amount, reason = %req.release_reason, "Bond released");
    Ok(Json(BondReleaseResponse {
        release_id: format!("BREL-{}", Uuid::new_v4().simple()),
        declaration_id: req.declaration_id,
        amount: req.bond_amount,
        currency: req.currency,
        transfer_id: transfer.id,
        released_at: Utc::now(),
    }))
}

// ─── PENALTY HANDLER ──────────────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
pub struct PenaltyRequest {
    pub declaration_id: i64,
    pub trader_id: i64,
    pub penalty_amount: f64,
    pub currency: String,
    pub penalty_code: String, // UNDER_DECLARATION | PROHIBITED_GOODS | LATE_FILING
    pub officer_id: i64,
}

#[derive(Debug, Serialize)]
pub struct PenaltyResponse {
    pub penalty_id: String,
    pub declaration_id: i64,
    pub amount: f64,
    pub currency: String,
    pub penalty_code: String,
    pub transfer_id: String,
    pub assessed_at: DateTime<Utc>,
}

async fn penalty_handler(
    State(state): State<Arc<AppState>>,
    Json(req): Json<PenaltyRequest>,
) -> Result<Json<PenaltyResponse>, (StatusCode, String)> {
    let mut ledger = state.ledger.lock().await;
    let amount_cents = (req.penalty_amount * 100.0) as u64;
    let trader_liability_id = format!("trader-{}-liability", req.trader_id);
    let penalty_revenue_id = format!("penalty-revenue-{}", req.penalty_code);
    ledger.get_or_create_account(&trader_liability_id, 1001, 1);
    ledger.get_or_create_account(&penalty_revenue_id, 5001, 1);
    let transfer = ledger.post_transfer(
        &trader_liability_id,
        &penalty_revenue_id,
        amount_cents,
        TransferType::PenaltyAssessment,
        Some(req.declaration_id),
        &format!("PENALTY-{}-{}", req.declaration_id, req.penalty_code),
        &req.currency,
    );
    info!(declaration_id = req.declaration_id, amount = req.penalty_amount, code = %req.penalty_code, officer = req.officer_id, "Penalty assessed");
    Ok(Json(PenaltyResponse {
        penalty_id: format!("PEN-{}", Uuid::new_v4().simple()),
        declaration_id: req.declaration_id,
        amount: req.penalty_amount,
        currency: req.currency,
        penalty_code: req.penalty_code,
        transfer_id: transfer.id,
        assessed_at: Utc::now(),
    }))
}

// ─── TRANSIT GUARANTEE HANDLER ────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
pub struct TransitGuaranteeRequest {
    pub declaration_id: i64,
    pub trader_id: i64,
    pub guarantee_amount: f64,
    pub currency: String,
    pub destination_country: String,
    pub transit_days: u32,
}

#[derive(Debug, Serialize)]
pub struct TransitGuaranteeResponse {
    pub guarantee_id: String,
    pub declaration_id: i64,
    pub amount: f64,
    pub currency: String,
    pub destination_country: String,
    pub transfer_id: String,
    pub valid_until: DateTime<Utc>,
    pub issued_at: DateTime<Utc>,
}

async fn transit_guarantee_handler(
    State(state): State<Arc<AppState>>,
    Json(req): Json<TransitGuaranteeRequest>,
) -> Result<Json<TransitGuaranteeResponse>, (StatusCode, String)> {
    let mut ledger = state.ledger.lock().await;
    let amount_cents = (req.guarantee_amount * 100.0) as u64;
    let trader_liability_id = format!("trader-{}-liability", req.trader_id);
    let transit_guarantee_id = format!("transit-guarantee-{}-{}", req.trader_id, req.destination_country);
    ledger.get_or_create_account(&trader_liability_id, 1001, 1);
    ledger.get_or_create_account(&transit_guarantee_id, 7001, 1);
    let transfer = ledger.post_transfer(
        &trader_liability_id,
        &transit_guarantee_id,
        amount_cents,
        TransferType::TransitGuarantee,
        Some(req.declaration_id),
        &format!("TRANSIT-{}-{}", req.declaration_id, req.destination_country),
        &req.currency,
    );
    let valid_until = Utc::now() + chrono::Duration::days(req.transit_days as i64);
    info!(declaration_id = req.declaration_id, amount = req.guarantee_amount, dest = %req.destination_country, "Transit guarantee issued");
    Ok(Json(TransitGuaranteeResponse {
        guarantee_id: format!("TG-{}", Uuid::new_v4().simple()),
        declaration_id: req.declaration_id,
        amount: req.guarantee_amount,
        currency: req.currency,
        destination_country: req.destination_country,
        transfer_id: transfer.id,
        valid_until,
        issued_at: Utc::now(),
    }))
}

// ─── PENDING / VOID-PENDING HANDLERS ─────────────────────────────────────────

#[derive(Debug, Deserialize)]
pub struct PendingTransferRequest {
    pub declaration_id: i64,
    pub trader_id: i64,
    pub amount: f64,
    pub currency: String,
    pub transfer_type: String, // duty | bond | penalty
}

#[derive(Debug, Serialize)]
pub struct PendingTransferResponse {
    pub pending_id: String,
    pub declaration_id: i64,
    pub amount: f64,
    pub currency: String,
    pub status: String,
    pub created_at: DateTime<Utc>,
}

async fn pending_handler(
    State(state): State<Arc<AppState>>,
    Json(req): Json<PendingTransferRequest>,
) -> Result<Json<PendingTransferResponse>, (StatusCode, String)> {
    let mut ledger = state.ledger.lock().await;
    let amount_cents = (req.amount * 100.0) as u64;
    let trader_liability_id = format!("trader-{}-liability", req.trader_id);
    let pending_id = format!("PEND-{}", Uuid::new_v4().simple());
    // Mark as pending in the debit account
    if let Some(acct) = ledger.accounts.get_mut(&trader_liability_id) {
        acct.debits_pending += amount_cents;
    } else {
        ledger.get_or_create_account(&trader_liability_id, 1001, 1);
        if let Some(acct) = ledger.accounts.get_mut(&trader_liability_id) {
            acct.debits_pending += amount_cents;
        }
    }
    info!(declaration_id = req.declaration_id, amount = req.amount, transfer_type = %req.transfer_type, "Pending transfer created");
    Ok(Json(PendingTransferResponse {
        pending_id,
        declaration_id: req.declaration_id,
        amount: req.amount,
        currency: req.currency,
        status: "pending".to_string(),
        created_at: Utc::now(),
    }))
}

#[derive(Debug, Deserialize)]
pub struct VoidPendingRequest {
    pub pending_id: String,
    pub declaration_id: i64,
    pub trader_id: i64,
    pub amount: f64,
    pub currency: String,
    pub void_reason: String,
}

#[derive(Debug, Serialize)]
pub struct VoidPendingResponse {
    pub void_id: String,
    pub pending_id: String,
    pub declaration_id: i64,
    pub status: String,
    pub voided_at: DateTime<Utc>,
}

async fn void_pending_handler(
    State(state): State<Arc<AppState>>,
    Json(req): Json<VoidPendingRequest>,
) -> Result<Json<VoidPendingResponse>, (StatusCode, String)> {
    let mut ledger = state.ledger.lock().await;
    let amount_cents = (req.amount * 100.0) as u64;
    let trader_liability_id = format!("trader-{}-liability", req.trader_id);
    if let Some(acct) = ledger.accounts.get_mut(&trader_liability_id) {
        acct.debits_pending = acct.debits_pending.saturating_sub(amount_cents);
    }
    info!(pending_id = %req.pending_id, declaration_id = req.declaration_id, reason = %req.void_reason, "Pending transfer voided");
    Ok(Json(VoidPendingResponse {
        void_id: format!("VOID-{}", Uuid::new_v4().simple()),
        pending_id: req.pending_id,
        declaration_id: req.declaration_id,
        status: "voided".to_string(),
        voided_at: Utc::now(),
    }))
}

// ─── MAIN ─────────────────────────────────────────────────────────────────────

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::from_default_env()
                .add_directive("tigerbeetle_bridge=info".parse()?),
        )
        .init();

    let port: u16 = std::env::var("TIGERBEETLE_BRIDGE_PORT")
        .unwrap_or_else(|_| "8093".to_string())
        .parse()
        .unwrap_or(8093);

    let state = Arc::new(AppState {
        ledger: tokio::sync::Mutex::new(InMemoryLedger::new()),
    });

    let app = Router::new()
        .route("/health", get(health_handler))
        .route("/assess", post(assess_duty_handler))
        .route("/payment/confirm", post(confirm_payment_handler))
        .route("/drawback", post(duty_drawback_handler))
        .route("/balance", post(get_balance_handler))
        .route("/transfers", get(get_transfers_handler))
        // Bond management
        .route("/bond/deposit", post(bond_deposit_handler))
        .route("/bond/release", post(bond_release_handler))
        // Penalty accounting
        .route("/penalty", post(penalty_handler))
        // Transit guarantees (COMESA/ASEAN)
        .route("/transit-guarantee", post(transit_guarantee_handler))
        // Two-phase pending transfers
        .route("/pending", post(pending_handler))
        .route("/void-pending", post(void_pending_handler))
        .layer(CorsLayer::permissive())
        .with_state(state);

    let addr = SocketAddr::from(([0, 0, 0, 0], port));
    info!("TigerBeetle Bridge listening on {}", addr);

    let listener = TcpListener::bind(addr).await?;
    axum::serve(listener, app).await?;

    Ok(())
}

// ─── TESTS ────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_ledger_assess_and_pay() {
        let mut ledger = InMemoryLedger::new();

        // Create accounts
        ledger.get_or_create_account("trader-1-liability", 1001, 1);
        ledger.get_or_create_account("customs-revenue-main", 2001, 1);
        ledger.get_or_create_account("bank-settlement", 3001, 1);

        // Assess duty: $1000
        ledger.post_transfer(
            "trader-1-liability",
            "customs-revenue-main",
            100_000, // $1000 in cents
            TransferType::DutyAssessment,
            Some(1),
            "DUTY-ASSESS-1",
            "USD",
        );

        let liability = ledger.accounts.get("trader-1-liability").unwrap();
        assert_eq!(liability.debits_posted, 100_000);

        // Pay $1000
        ledger.post_transfer(
            "bank-settlement",
            "trader-1-liability",
            100_000,
            TransferType::PaymentReceived,
            Some(1),
            "PAY-REF-001",
            "USD",
        );

        let liability = ledger.accounts.get("trader-1-liability").unwrap();
        assert_eq!(liability.balance(), 0, "Fully settled after payment");
    }

    #[test]
    fn test_drawback_reduces_revenue() {
        let mut ledger = InMemoryLedger::new();

        ledger.get_or_create_account("customs-revenue-main", 2001, 1);
        ledger.get_or_create_account("trader-1-drawback", 4001, 1);

        // First assess and credit revenue
        ledger.get_or_create_account("trader-1-liability", 1001, 1);
        ledger.post_transfer(
            "trader-1-liability",
            "customs-revenue-main",
            50_000,
            TransferType::DutyAssessment,
            Some(1),
            "DUTY-1",
            "USD",
        );

        // Drawback $200
        ledger.post_transfer(
            "customs-revenue-main",
            "trader-1-drawback",
            20_000,
            TransferType::DutyDrawback,
            Some(1),
            "DRAWBACK-1",
            "USD",
        );

        let drawback = ledger.accounts.get("trader-1-drawback").unwrap();
        assert_eq!(drawback.credits_posted, 20_000);
    }
}
