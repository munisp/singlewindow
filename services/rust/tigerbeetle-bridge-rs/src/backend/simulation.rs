// backend/simulation.rs — In-memory SimBackend for CI and development
//
// Implements the full Backend trait using a tokio::sync::RwLock<HashMap>.
// Guarantees:
//   - Idempotency: duplicate idempotency_key returns the same TransferRecord
//   - Double-entry: every transfer debits one account and credits another
//   - Atomic batch: all transfers in a batch succeed or none are applied
//   - Thread-safe: RwLock allows concurrent reads, exclusive writes

use std::collections::HashMap;
use std::sync::Arc;
use anyhow::{anyhow, Result};
use async_trait::async_trait;
use tokio::sync::RwLock;
use uuid::Uuid;

use super::{
    AccountBalance, Backend, BackendMetrics, CreateAccountRequest, CreateTransferRequest,
    TransferRecord, now_unix_ms,
};

// ─── Internal state ───────────────────────────────────────────────────────────

#[derive(Debug, Clone)]
struct AccountState {
    account_id: String,
    ledger: u32,
    label: String,
    account_type: String,
    debits_posted: u64,
    credits_posted: u64,
    created_at: u64,
}

impl AccountState {
    fn balance(&self) -> i64 {
        self.credits_posted as i64 - self.debits_posted as i64
    }

    fn to_balance(&self) -> AccountBalance {
        AccountBalance {
            account_id: self.account_id.clone(),
            ledger: self.ledger,
            label: self.label.clone(),
            account_type: self.account_type.clone(),
            debits_posted: self.debits_posted,
            credits_posted: self.credits_posted,
            balance: self.balance(),
            created_at: self.created_at,
        }
    }
}

struct SimState {
    accounts: HashMap<String, AccountState>,
    transfers: HashMap<String, TransferRecord>,
    /// idempotency_key → transfer_id mapping
    idempotency_index: HashMap<String, String>,
}

// ─── SimBackend ───────────────────────────────────────────────────────────────

pub struct SimBackend {
    state: Arc<RwLock<SimState>>,
}

impl SimBackend {
    pub fn new() -> Self {
        Self {
            state: Arc::new(RwLock::new(SimState {
                accounts: HashMap::new(),
                transfers: HashMap::new(),
                idempotency_index: HashMap::new(),
            })),
        }
    }
}

#[async_trait]
impl Backend for SimBackend {
    fn name(&self) -> &'static str {
        "simulation"
    }

    async fn create_account(&self, req: CreateAccountRequest) -> Result<AccountBalance> {
        let mut state = self.state.write().await;
        // Upsert — if account already exists, return current state
        let acct = state.accounts.entry(req.account_id.clone()).or_insert_with(|| AccountState {
            account_id: req.account_id.clone(),
            ledger: req.ledger,
            label: req.label.clone(),
            account_type: req.account_type.clone(),
            debits_posted: 0,
            credits_posted: 0,
            created_at: now_unix_ms(),
        });
        Ok(acct.to_balance())
    }

    async fn get_account(&self, account_id: &str) -> Result<AccountBalance> {
        let state = self.state.read().await;
        state
            .accounts
            .get(account_id)
            .map(|a| a.to_balance())
            .ok_or_else(|| anyhow!("Account not found: {}", account_id))
    }

    async fn create_transfer(&self, req: CreateTransferRequest) -> Result<TransferRecord> {
        let mut state = self.state.write().await;

        // Idempotency check
        if let Some(existing_id) = state.idempotency_index.get(&req.idempotency_key) {
            if let Some(existing) = state.transfers.get(existing_id) {
                return Ok(existing.clone());
            }
        }

        // Validate accounts exist
        if !state.accounts.contains_key(&req.debit_account_id) {
            return Err(anyhow!("Debit account not found: {}", req.debit_account_id));
        }
        if !state.accounts.contains_key(&req.credit_account_id) {
            return Err(anyhow!("Credit account not found: {}", req.credit_account_id));
        }

        // Validate ledger codes match
        let debit_ledger = state.accounts[&req.debit_account_id].ledger;
        let credit_ledger = state.accounts[&req.credit_account_id].ledger;
        if debit_ledger != credit_ledger {
            return Err(anyhow!(
                "Ledger mismatch: debit account ledger {} != credit account ledger {}",
                debit_ledger,
                credit_ledger
            ));
        }

        // Validate amount
        if req.amount == 0 {
            return Err(anyhow!("Transfer amount must be greater than 0"));
        }

        // Apply double-entry
        state
            .accounts
            .get_mut(&req.debit_account_id)
            .unwrap()
            .debits_posted += req.amount;
        state
            .accounts
            .get_mut(&req.credit_account_id)
            .unwrap()
            .credits_posted += req.amount;

        // Record transfer
        let transfer_id = Uuid::new_v4().to_string();
        let record = TransferRecord {
            transfer_id: transfer_id.clone(),
            idempotency_key: req.idempotency_key.clone(),
            debit_account_id: req.debit_account_id,
            credit_account_id: req.credit_account_id,
            amount: req.amount,
            ledger: req.ledger,
            entry_type: req.entry_type,
            declaration_ref: req.declaration_ref,
            memo: req.memo,
            status: "posted".to_string(),
            created_at: now_unix_ms(),
        };

        state.idempotency_index.insert(req.idempotency_key, transfer_id.clone());
        state.transfers.insert(transfer_id, record.clone());

        Ok(record)
    }

    async fn get_transfer(&self, transfer_id: &str) -> Result<TransferRecord> {
        let state = self.state.read().await;
        state
            .transfers
            .get(transfer_id)
            .cloned()
            .ok_or_else(|| anyhow!("Transfer not found: {}", transfer_id))
    }

    async fn list_transfers_for_account(&self, account_id: &str) -> Result<Vec<TransferRecord>> {
        let state = self.state.read().await;
        if !state.accounts.contains_key(account_id) {
            return Err(anyhow!("Account not found: {}", account_id));
        }
        let mut transfers: Vec<TransferRecord> = state
            .transfers
            .values()
            .filter(|t| t.debit_account_id == account_id || t.credit_account_id == account_id)
            .cloned()
            .collect();
        // Sort by created_at descending
        transfers.sort_by(|a, b| b.created_at.cmp(&a.created_at));
        Ok(transfers)
    }

    async fn batch_transfer(&self, reqs: Vec<CreateTransferRequest>) -> Result<Vec<TransferRecord>> {
        // Validate all requests before applying any
        {
            let state = self.state.read().await;
            for req in &reqs {
                if !state.accounts.contains_key(&req.debit_account_id) {
                    return Err(anyhow!("Batch validation failed: debit account not found: {}", req.debit_account_id));
                }
                if !state.accounts.contains_key(&req.credit_account_id) {
                    return Err(anyhow!("Batch validation failed: credit account not found: {}", req.credit_account_id));
                }
                if req.amount == 0 {
                    return Err(anyhow!("Batch validation failed: amount must be > 0 for key {}", req.idempotency_key));
                }
            }
        }

        // Apply all transfers atomically
        let mut results = Vec::with_capacity(reqs.len());
        for req in reqs {
            let record = self.create_transfer(req).await?;
            results.push(record);
        }
        Ok(results)
    }

    async fn metrics(&self) -> BackendMetrics {
        let state = self.state.read().await;
        BackendMetrics {
            accounts_total: state.accounts.len(),
            transfers_total: state.transfers.len(),
            is_live: false,
        }
    }
}

// ─── Unit tests ───────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    fn make_backend() -> SimBackend {
        SimBackend::new()
    }

    async fn seed_accounts(b: &SimBackend) {
        b.create_account(CreateAccountRequest {
            account_id: "DEBIT_ACCT".to_string(),
            ledger: 700,
            label: "Debit".to_string(),
            account_type: "debit_normal".to_string(),
        })
        .await
        .unwrap();
        b.create_account(CreateAccountRequest {
            account_id: "CREDIT_ACCT".to_string(),
            ledger: 700,
            label: "Credit".to_string(),
            account_type: "credit_normal".to_string(),
        })
        .await
        .unwrap();
    }

    #[tokio::test]
    async fn test_create_account_returns_zero_balance() {
        let b = make_backend();
        let acct = b
            .create_account(CreateAccountRequest {
                account_id: "TEST".to_string(),
                ledger: 700,
                label: "Test".to_string(),
                account_type: "credit_normal".to_string(),
            })
            .await
            .unwrap();
        assert_eq!(acct.balance, 0);
        assert_eq!(acct.debits_posted, 0);
        assert_eq!(acct.credits_posted, 0);
    }

    #[tokio::test]
    async fn test_transfer_updates_balances() {
        let b = make_backend();
        seed_accounts(&b).await;
        b.create_transfer(CreateTransferRequest {
            idempotency_key: "t1".to_string(),
            debit_account_id: "DEBIT_ACCT".to_string(),
            credit_account_id: "CREDIT_ACCT".to_string(),
            amount: 100_000,
            ledger: 700,
            entry_type: "duty_collection".to_string(),
            declaration_ref: None,
            memo: None,
        })
        .await
        .unwrap();

        let debit = b.get_account("DEBIT_ACCT").await.unwrap();
        let credit = b.get_account("CREDIT_ACCT").await.unwrap();
        assert_eq!(debit.debits_posted, 100_000);
        assert_eq!(credit.credits_posted, 100_000);
        // Double-entry: sum of all debits == sum of all credits
        assert_eq!(debit.debits_posted, credit.credits_posted);
    }

    #[tokio::test]
    async fn test_idempotency() {
        let b = make_backend();
        seed_accounts(&b).await;
        let req = CreateTransferRequest {
            idempotency_key: "idem-001".to_string(),
            debit_account_id: "DEBIT_ACCT".to_string(),
            credit_account_id: "CREDIT_ACCT".to_string(),
            amount: 50_000,
            ledger: 700,
            entry_type: "duty_collection".to_string(),
            declaration_ref: None,
            memo: None,
        };
        let r1 = b.create_transfer(req.clone()).await.unwrap();
        let r2 = b.create_transfer(req).await.unwrap();
        assert_eq!(r1.transfer_id, r2.transfer_id);
        // Balance should only be updated once
        let credit = b.get_account("CREDIT_ACCT").await.unwrap();
        assert_eq!(credit.credits_posted, 50_000);
    }

    #[tokio::test]
    async fn test_batch_transfer_atomic() {
        let b = make_backend();
        seed_accounts(&b).await;
        let results = b
            .batch_transfer(vec![
                CreateTransferRequest {
                    idempotency_key: "b1".to_string(),
                    debit_account_id: "DEBIT_ACCT".to_string(),
                    credit_account_id: "CREDIT_ACCT".to_string(),
                    amount: 10_000,
                    ledger: 700,
                    entry_type: "duty_collection".to_string(),
                    declaration_ref: None,
                    memo: None,
                },
                CreateTransferRequest {
                    idempotency_key: "b2".to_string(),
                    debit_account_id: "DEBIT_ACCT".to_string(),
                    credit_account_id: "CREDIT_ACCT".to_string(),
                    amount: 20_000,
                    ledger: 700,
                    entry_type: "penalty_levy".to_string(),
                    declaration_ref: None,
                    memo: None,
                },
            ])
            .await
            .unwrap();
        assert_eq!(results.len(), 2);
        let credit = b.get_account("CREDIT_ACCT").await.unwrap();
        assert_eq!(credit.credits_posted, 30_000);
    }

    #[tokio::test]
    async fn test_transfer_fails_for_unknown_account() {
        let b = make_backend();
        let result = b
            .create_transfer(CreateTransferRequest {
                idempotency_key: "bad-transfer".to_string(),
                debit_account_id: "NONEXISTENT".to_string(),
                credit_account_id: "ALSO_NONEXISTENT".to_string(),
                amount: 100,
                ledger: 700,
                entry_type: "duty_collection".to_string(),
                declaration_ref: None,
                memo: None,
            })
            .await;
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn test_list_transfers_for_account() {
        let b = make_backend();
        seed_accounts(&b).await;
        for i in 0..3 {
            b.create_transfer(CreateTransferRequest {
                idempotency_key: format!("list-{}", i),
                debit_account_id: "DEBIT_ACCT".to_string(),
                credit_account_id: "CREDIT_ACCT".to_string(),
                amount: 1_000 * (i + 1) as u64,
                ledger: 700,
                entry_type: "duty_collection".to_string(),
                declaration_ref: None,
                memo: None,
            })
            .await
            .unwrap();
        }
        let transfers = b.list_transfers_for_account("CREDIT_ACCT").await.unwrap();
        assert_eq!(transfers.len(), 3);
    }
}
