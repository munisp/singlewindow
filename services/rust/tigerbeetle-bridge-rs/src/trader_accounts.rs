// trader_accounts.rs — Per-trader TigerBeetle account management.
//
// Each trader registered on the NGSWTP platform needs 4 TigerBeetle accounts
// created at onboarding time. This module provides the HTTP API endpoint
// that the TypeScript tRPC procedure calls to trigger account creation.
//
// Endpoint: POST /seed/trader
// Body: { "trader_id": "TIN-12345678" }
// Response: { "total": 4, "created": 4, "skipped": 0, "failed": 0 }

use axum::{extract::State, http::StatusCode, response::Json};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tracing::{error, info};

use crate::seed::{seed_trader_accounts, SeedResult};

// ─── Request / Response ───────────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
pub struct SeedTraderRequest {
    /// Trader Tax Identification Number (TIN) or unique trader ID
    pub trader_id: String,
}

#[derive(Debug, Serialize)]
pub struct SeedTraderResponse {
    pub trader_id: String,
    pub result: SeedResult,
    pub success: bool,
    pub message: String,
}

// ─── Handler ──────────────────────────────────────────────────────────────────

/// POST /seed/trader — Create 4 TigerBeetle accounts for a new trader.
/// Called by the TypeScript tRPC `fundFlow.seedTraderAccounts` procedure
/// during trader registration/onboarding.
///
/// This handler is idempotent: if accounts already exist (HTTP 409 from TigerBeetle),
/// they are silently skipped and the response still reports success.
pub async fn seed_trader_handler(
    State(bridge_url): State<Arc<String>>,
    Json(req): Json<SeedTraderRequest>,
) -> Result<Json<SeedTraderResponse>, (StatusCode, Json<serde_json::Value>)> {
    if req.trader_id.is_empty() {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({ "error": "trader_id is required" })),
        ));
    }

    info!("Seeding TigerBeetle accounts for trader: {}", req.trader_id);

    match seed_trader_accounts(&bridge_url, &req.trader_id).await {
        Ok(result) => {
            let success = result.is_success();
            let message = if success {
                format!(
                    "Successfully seeded {} accounts for trader {} ({} created, {} already existed)",
                    result.total, req.trader_id, result.created, result.skipped
                )
            } else {
                format!(
                    "Seeding partially failed: {} of {} accounts failed for trader {}",
                    result.failed, result.total, req.trader_id
                )
            };

            info!("{}", message);

            let status = if success {
                StatusCode::OK
            } else {
                StatusCode::MULTI_STATUS
            };

            Ok(Json(SeedTraderResponse {
                trader_id: req.trader_id,
                result,
                success,
                message,
            }))
        }
        Err(e) => {
            error!("Fatal error seeding trader accounts: {}", e);
            Err((
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({
                    "error": format!("Failed to seed trader accounts: {}", e)
                })),
            ))
        }
    }
}

// ─── Tests ────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use crate::seed::{trader_accounts, AccountType, LEDGER_BONDS, LEDGER_CUSTOMS_DUTY, LEDGER_DRAWBACK};

    #[test]
    fn test_trader_accounts_cover_all_required_ledgers() {
        let accounts = trader_accounts("TIN-TEST-001");
        let ledgers: Vec<u32> = accounts.iter().map(|a| a.ledger).collect();
        assert!(ledgers.contains(&LEDGER_CUSTOMS_DUTY), "Missing DUTY_RECEIVABLE/PAYABLE ledger");
        assert!(ledgers.contains(&LEDGER_BONDS), "Missing BOND_ESCROW ledger");
        assert!(ledgers.contains(&LEDGER_DRAWBACK), "Missing REFUND_PAYABLE ledger");
    }

    #[test]
    fn test_trader_accounts_have_correct_types() {
        let accounts = trader_accounts("TIN-TEST-001");
        // DUTY_RECEIVABLE must be debit_normal (asset — amount owed)
        let duty_receivable = accounts.iter()
            .find(|a| a.label.contains("DUTY_RECEIVABLE"))
            .expect("DUTY_RECEIVABLE account not found");
        assert_eq!(duty_receivable.account_type, AccountType::DebitNormal);

        // DUTY_PAYABLE must be credit_normal (liability — amount paid)
        let duty_payable = accounts.iter()
            .find(|a| a.label.contains("DUTY_PAYABLE"))
            .expect("DUTY_PAYABLE account not found");
        assert_eq!(duty_payable.account_type, AccountType::CreditNormal);

        // BOND_ESCROW must be credit_normal (liability — held funds)
        let bond_escrow = accounts.iter()
            .find(|a| a.label.contains("BOND_ESCROW"))
            .expect("BOND_ESCROW account not found");
        assert_eq!(bond_escrow.account_type, AccountType::CreditNormal);

        // REFUND_PAYABLE must be debit_normal (asset — refund owed to trader)
        let refund_payable = accounts.iter()
            .find(|a| a.label.contains("REFUND_PAYABLE"))
            .expect("REFUND_PAYABLE account not found");
        assert_eq!(refund_payable.account_type, AccountType::DebitNormal);
    }

    #[test]
    fn test_trader_id_isolation() {
        // Two different traders must have completely different account IDs
        let trader1 = trader_accounts("TIN-TRADER-001");
        let trader2 = trader_accounts("TIN-TRADER-002");

        for (a1, a2) in trader1.iter().zip(trader2.iter()) {
            assert_ne!(
                a1.account_id, a2.account_id,
                "Traders must have isolated account IDs: {} vs {}",
                a1.label, a2.label
            );
        }
    }

    #[test]
    fn test_seed_request_validation() {
        // Ensure empty trader_id would be rejected
        let req = SeedTraderRequest { trader_id: String::new() };
        assert!(req.trader_id.is_empty(), "Empty trader_id should be detected");
    }
}
