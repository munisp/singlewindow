// seed.rs — TigerBeetle system account seeding for TradeGateway NGSWTP.
//
// This module defines and creates all system-level accounts in TigerBeetle
// that must exist before any fund-flow workflow can execute.
//
// System Accounts (WCO GL Code Ledger 700 = NGN Customs Duty Revenue):
//
//   REVENUE_AUTHORITY      — Debit-normal: receives all duty payments
//   CENTRAL_BANK_SETTLEMENT— Credit-normal: final settlement destination
//   CUSTOMS_ESCROW         — Credit-normal: holds reserved duties pending clearance
//   PENALTY_FUND           — Debit-normal: receives forfeited bonds and penalties
//   BOND_ESCROW            — Credit-normal: holds lodged bond amounts
//   DRAWBACK_RESERVE       — Debit-normal: source for duty drawback refunds
//   FREE_ZONE_FUND         — Debit-normal: free zone duty suspension account
//   G2G_SETTLEMENT         — Credit-normal: government-to-government settlement
//
// Per-Trader Accounts (created at trader onboarding):
//   DUTY_RECEIVABLE        — Debit-normal: amount owed by trader
//   DUTY_PAYABLE           — Credit-normal: amount paid by trader
//   BOND_ESCROW_TRADER     — Credit-normal: trader's bond holdings
//   REFUND_PAYABLE         — Debit-normal: drawback refunds owed to trader

use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::fmt;
use tracing::{error, info, warn};

// ─── Constants ────────────────────────────────────────────────────────────────

/// WCO GL Code ledger for NGN customs duty revenue.
pub const LEDGER_CUSTOMS_DUTY: u32 = 700;

/// WCO GL Code ledger for bond and guarantee instruments.
pub const LEDGER_BONDS: u32 = 710;

/// WCO GL Code ledger for transit guarantee instruments.
pub const LEDGER_TRANSIT: u32 = 720;

/// WCO GL Code ledger for drawback and refund instruments.
pub const LEDGER_DRAWBACK: u32 = 730;

/// WCO GL Code ledger for free zone operations.
pub const LEDGER_FREE_ZONE: u32 = 740;

/// WCO GL Code ledger for G2G settlement.
pub const LEDGER_G2G: u32 = 750;

// ─── Account Types ────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum AccountType {
    /// Assets and expenses — increases with debits
    DebitNormal,
    /// Liabilities, equity, revenue — increases with credits
    CreditNormal,
}

impl fmt::Display for AccountType {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            AccountType::DebitNormal => write!(f, "debit_normal"),
            AccountType::CreditNormal => write!(f, "credit_normal"),
        }
    }
}

// ─── Account Definition ───────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AccountDefinition {
    /// Stable deterministic account ID (SHA-256 of label)
    pub account_id: String,
    /// WCO GL code ledger
    pub ledger: u32,
    /// Human-readable label
    pub label: String,
    /// Account type
    pub account_type: AccountType,
    /// Whether this is a system account (vs per-trader)
    pub is_system: bool,
}

impl AccountDefinition {
    /// Derive a deterministic account ID from the label.
    /// This ensures the same account is never created twice.
    pub fn derive_id(label: &str) -> String {
        let mut hasher = Sha256::new();
        hasher.update(label.as_bytes());
        let result = hasher.finalize();
        hex::encode(&result[..16]) // 32-char hex from first 16 bytes
    }

    pub fn new_system(label: &str, ledger: u32, account_type: AccountType) -> Self {
        Self {
            account_id: Self::derive_id(label),
            ledger,
            label: label.to_string(),
            account_type,
            is_system: true,
        }
    }

    pub fn new_trader(trader_id: &str, account_role: &str, ledger: u32, account_type: AccountType) -> Self {
        let label = format!("trader:{}:{}", trader_id, account_role);
        Self {
            account_id: Self::derive_id(&label),
            ledger,
            label,
            account_type,
            is_system: false,
        }
    }
}

// ─── System Account Catalog ───────────────────────────────────────────────────

/// Returns the complete list of system accounts that must exist before any
/// fund-flow workflow can execute. These are created once at platform bootstrap.
pub fn system_accounts() -> Vec<AccountDefinition> {
    vec![
        // ── Customs Duty Revenue (Ledger 700) ─────────────────────────────────
        AccountDefinition::new_system(
            "NGSWTP:SYSTEM:REVENUE_AUTHORITY",
            LEDGER_CUSTOMS_DUTY,
            AccountType::DebitNormal,
        ),
        AccountDefinition::new_system(
            "NGSWTP:SYSTEM:CENTRAL_BANK_SETTLEMENT",
            LEDGER_CUSTOMS_DUTY,
            AccountType::CreditNormal,
        ),
        AccountDefinition::new_system(
            "NGSWTP:SYSTEM:CUSTOMS_ESCROW",
            LEDGER_CUSTOMS_DUTY,
            AccountType::CreditNormal,
        ),
        AccountDefinition::new_system(
            "NGSWTP:SYSTEM:PENALTY_FUND",
            LEDGER_CUSTOMS_DUTY,
            AccountType::DebitNormal,
        ),
        AccountDefinition::new_system(
            "NGSWTP:SYSTEM:DRAWBACK_RESERVE",
            LEDGER_DRAWBACK,
            AccountType::DebitNormal,
        ),
        // ── Bond & Guarantee (Ledger 710) ─────────────────────────────────────
        AccountDefinition::new_system(
            "NGSWTP:SYSTEM:BOND_ESCROW",
            LEDGER_BONDS,
            AccountType::CreditNormal,
        ),
        AccountDefinition::new_system(
            "NGSWTP:SYSTEM:BOND_FORFEITURE_FUND",
            LEDGER_BONDS,
            AccountType::DebitNormal,
        ),
        // ── Transit Guarantee (Ledger 720) ────────────────────────────────────
        AccountDefinition::new_system(
            "NGSWTP:SYSTEM:TRANSIT_GUARANTEE_ESCROW",
            LEDGER_TRANSIT,
            AccountType::CreditNormal,
        ),
        AccountDefinition::new_system(
            "NGSWTP:SYSTEM:TRANSIT_FORFEITURE_FUND",
            LEDGER_TRANSIT,
            AccountType::DebitNormal,
        ),
        // ── Free Zone (Ledger 740) ────────────────────────────────────────────
        AccountDefinition::new_system(
            "NGSWTP:SYSTEM:FREE_ZONE_DUTY_SUSPENSION",
            LEDGER_FREE_ZONE,
            AccountType::DebitNormal,
        ),
        AccountDefinition::new_system(
            "NGSWTP:SYSTEM:FREE_ZONE_ADMISSION_ESCROW",
            LEDGER_FREE_ZONE,
            AccountType::CreditNormal,
        ),
        // ── G2G Settlement (Ledger 750) ───────────────────────────────────────
        AccountDefinition::new_system(
            "NGSWTP:SYSTEM:G2G_SETTLEMENT_ACCOUNT",
            LEDGER_G2G,
            AccountType::CreditNormal,
        ),
        AccountDefinition::new_system(
            "NGSWTP:SYSTEM:G2G_RECEIVABLE",
            LEDGER_G2G,
            AccountType::DebitNormal,
        ),
    ]
}

/// Returns the 4 per-trader account definitions for a given trader ID.
/// These are created at trader onboarding via the tRPC `fundFlow.seedTraderAccounts` procedure.
pub fn trader_accounts(trader_id: &str) -> Vec<AccountDefinition> {
    vec![
        AccountDefinition::new_trader(trader_id, "DUTY_RECEIVABLE", LEDGER_CUSTOMS_DUTY, AccountType::DebitNormal),
        AccountDefinition::new_trader(trader_id, "DUTY_PAYABLE", LEDGER_CUSTOMS_DUTY, AccountType::CreditNormal),
        AccountDefinition::new_trader(trader_id, "BOND_ESCROW", LEDGER_BONDS, AccountType::CreditNormal),
        AccountDefinition::new_trader(trader_id, "REFUND_PAYABLE", LEDGER_DRAWBACK, AccountType::DebitNormal),
    ]
}

// ─── Seeder ───────────────────────────────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize)]
struct CreateAccountRequest {
    account_id: String,
    ledger: u32,
    label: String,
    account_type: String,
}

#[derive(Debug, Deserialize)]
struct CreateAccountResponse {
    account_id: Option<String>,
    status: Option<String>,
    error: Option<String>,
}

/// Seed all system accounts by calling the TigerBeetle bridge HTTP API.
/// This function is idempotent — existing accounts (HTTP 409) are silently skipped.
pub async fn seed_system_accounts(bridge_url: &str) -> Result<SeedResult> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .context("Failed to build HTTP client")?;

    let accounts = system_accounts();
    let total = accounts.len();
    let mut created = 0usize;
    let mut skipped = 0usize;
    let mut failed = 0usize;

    info!("Seeding {} system accounts to TigerBeetle bridge at {}", total, bridge_url);

    for account in &accounts {
        let req = CreateAccountRequest {
            account_id: account.account_id.clone(),
            ledger: account.ledger,
            label: account.label.clone(),
            account_type: account.account_type.to_string(),
        };

        match client
            .post(format!("{}/accounts", bridge_url))
            .json(&req)
            .send()
            .await
        {
            Ok(resp) => {
                let status = resp.status();
                if status.is_success() {
                    info!("Created account: {} (ledger={})", account.label, account.ledger);
                    created += 1;
                } else if status.as_u16() == 409 {
                    // Already exists — idempotent skip
                    skipped += 1;
                } else {
                    let body = resp.text().await.unwrap_or_default();
                    error!(
                        "Failed to create account {} [{}]: {}",
                        account.label, status, body
                    );
                    failed += 1;
                }
            }
            Err(e) => {
                error!("HTTP error creating account {}: {}", account.label, e);
                failed += 1;
            }
        }
    }

    info!(
        "System account seeding complete: created={}, skipped={}, failed={}",
        created, skipped, failed
    );

    if failed > 0 {
        warn!("{} accounts failed to seed — check TigerBeetle bridge logs", failed);
    }

    Ok(SeedResult { total, created, skipped, failed })
}

/// Seed per-trader accounts for a given trader ID.
/// Called from the tRPC `fundFlow.seedTraderAccounts` procedure at onboarding.
pub async fn seed_trader_accounts(bridge_url: &str, trader_id: &str) -> Result<SeedResult> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .context("Failed to build HTTP client")?;

    let accounts = trader_accounts(trader_id);
    let total = accounts.len();
    let mut created = 0usize;
    let mut skipped = 0usize;
    let mut failed = 0usize;

    info!("Seeding {} trader accounts for trader_id={}", total, trader_id);

    for account in &accounts {
        let req = CreateAccountRequest {
            account_id: account.account_id.clone(),
            ledger: account.ledger,
            label: account.label.clone(),
            account_type: account.account_type.to_string(),
        };

        match client
            .post(format!("{}/accounts", bridge_url))
            .json(&req)
            .send()
            .await
        {
            Ok(resp) => {
                let status = resp.status();
                if status.is_success() {
                    created += 1;
                } else if status.as_u16() == 409 {
                    skipped += 1;
                } else {
                    let body = resp.text().await.unwrap_or_default();
                    error!(
                        "Failed to create trader account {} [{}]: {}",
                        account.label, status, body
                    );
                    failed += 1;
                }
            }
            Err(e) => {
                error!("HTTP error creating trader account {}: {}", account.label, e);
                failed += 1;
            }
        }
    }

    Ok(SeedResult { total, created, skipped, failed })
}

// ─── Result Type ──────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SeedResult {
    pub total: usize,
    pub created: usize,
    pub skipped: usize,
    pub failed: usize,
}

impl SeedResult {
    pub fn is_success(&self) -> bool {
        self.failed == 0
    }
}

// ─── Tests ────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_system_accounts_count() {
        let accounts = system_accounts();
        // Must have exactly 13 system accounts covering all ledgers
        assert_eq!(accounts.len(), 13, "Expected 13 system accounts, got {}", accounts.len());
    }

    #[test]
    fn test_system_accounts_all_have_unique_ids() {
        let accounts = system_accounts();
        let mut ids: std::collections::HashSet<String> = std::collections::HashSet::new();
        for account in &accounts {
            assert!(
                ids.insert(account.account_id.clone()),
                "Duplicate account ID: {}",
                account.account_id
            );
        }
    }

    #[test]
    fn test_system_accounts_all_have_labels() {
        for account in system_accounts() {
            assert!(!account.label.is_empty(), "Account has empty label");
            assert!(account.label.starts_with("NGSWTP:SYSTEM:"), 
                "System account label must start with NGSWTP:SYSTEM: — got: {}", account.label);
        }
    }

    #[test]
    fn test_trader_accounts_count() {
        let accounts = trader_accounts("TIN-12345678");
        assert_eq!(accounts.len(), 4, "Expected 4 trader accounts, got {}", accounts.len());
    }

    #[test]
    fn test_trader_accounts_unique_ids() {
        let accounts = trader_accounts("TIN-12345678");
        let mut ids: std::collections::HashSet<String> = std::collections::HashSet::new();
        for account in &accounts {
            assert!(
                ids.insert(account.account_id.clone()),
                "Duplicate trader account ID: {}",
                account.account_id
            );
        }
    }

    #[test]
    fn test_different_traders_have_different_account_ids() {
        let trader1 = trader_accounts("TIN-11111111");
        let trader2 = trader_accounts("TIN-22222222");
        // Same role but different traders must have different IDs
        assert_ne!(
            trader1[0].account_id, trader2[0].account_id,
            "Different traders must have different account IDs"
        );
    }

    #[test]
    fn test_account_id_derivation_is_deterministic() {
        let id1 = AccountDefinition::derive_id("NGSWTP:SYSTEM:REVENUE_AUTHORITY");
        let id2 = AccountDefinition::derive_id("NGSWTP:SYSTEM:REVENUE_AUTHORITY");
        assert_eq!(id1, id2, "Account ID derivation must be deterministic");
    }

    #[test]
    fn test_account_id_length() {
        let id = AccountDefinition::derive_id("NGSWTP:SYSTEM:REVENUE_AUTHORITY");
        assert_eq!(id.len(), 32, "Account ID must be 32 hex chars (16 bytes)");
    }

    #[test]
    fn test_ledger_coverage() {
        let accounts = system_accounts();
        let ledgers: std::collections::HashSet<u32> = accounts.iter().map(|a| a.ledger).collect();
        // Must cover all 6 ledgers
        assert!(ledgers.contains(&LEDGER_CUSTOMS_DUTY), "Missing LEDGER_CUSTOMS_DUTY");
        assert!(ledgers.contains(&LEDGER_BONDS), "Missing LEDGER_BONDS");
        assert!(ledgers.contains(&LEDGER_TRANSIT), "Missing LEDGER_TRANSIT");
        assert!(ledgers.contains(&LEDGER_DRAWBACK), "Missing LEDGER_DRAWBACK");
        assert!(ledgers.contains(&LEDGER_FREE_ZONE), "Missing LEDGER_FREE_ZONE");
        assert!(ledgers.contains(&LEDGER_G2G), "Missing LEDGER_G2G");
    }

    #[test]
    fn test_seed_result_is_success() {
        let result = SeedResult { total: 13, created: 13, skipped: 0, failed: 0 };
        assert!(result.is_success());
        let result_with_failures = SeedResult { total: 13, created: 12, skipped: 0, failed: 1 };
        assert!(!result_with_failures.is_success());
    }
}
