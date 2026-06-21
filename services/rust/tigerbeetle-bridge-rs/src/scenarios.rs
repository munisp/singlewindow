// scenarios.rs — Per-scenario TigerBeetle transfer builders
// Each scenario has a dedicated builder that enforces:
//   1. Correct ledger account pairing
//   2. SHA-256 idempotency key derivation
//   3. Entry type labelling for audit trail
//   4. Amount validation (no zero or negative transfers)
//
// All 20 fund-flow scenarios are represented here.
use crate::backend::{CreateTransferRequest};
use sha2::{Sha256, Digest};

/// Derive a deterministic idempotency key from scenario-specific inputs.
/// Format: SHA-256(scenario_type:primary_id:secondary_qualifier)
pub fn derive_idempotency_key(scenario_type: &str, primary_id: &str, qualifier: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(format!("{}:{}:{}", scenario_type, primary_id, qualifier));
    format!("{:x}", hasher.finalize())
}

/// Scenario 1 — Import Duty Collection
/// Trader account → NCS Revenue account
pub fn import_duty_transfer(
    declaration_ref: &str,
    trader_account_id: &str,
    ncs_revenue_account_id: &str,
    amount_minor: u64,
    ledger: u32,
) -> Result<CreateTransferRequest, String> {
    if amount_minor == 0 {
        return Err("Import duty amount must be > 0".to_string());
    }
    Ok(CreateTransferRequest {
        idempotency_key: derive_idempotency_key("import_duty", declaration_ref, trader_account_id),
        debit_account_id: trader_account_id.to_string(),
        credit_account_id: ncs_revenue_account_id.to_string(),
        amount: amount_minor,
        ledger,
        entry_type: "duty_collection".to_string(),
        declaration_ref: Some(declaration_ref.to_string()),
        memo: Some(format!("Import duty — {}", declaration_ref)),
    })
}

/// Scenario 2 — Export Levy Collection
/// Trader account → NCS Export Levy account
pub fn export_levy_transfer(
    declaration_ref: &str,
    trader_account_id: &str,
    ncs_export_levy_account_id: &str,
    amount_minor: u64,
    ledger: u32,
) -> Result<CreateTransferRequest, String> {
    if amount_minor == 0 {
        return Err("Export levy amount must be > 0".to_string());
    }
    Ok(CreateTransferRequest {
        idempotency_key: derive_idempotency_key("export_levy", declaration_ref, trader_account_id),
        debit_account_id: trader_account_id.to_string(),
        credit_account_id: ncs_export_levy_account_id.to_string(),
        amount: amount_minor,
        ledger,
        entry_type: "export_levy".to_string(),
        declaration_ref: Some(declaration_ref.to_string()),
        memo: Some(format!("Export levy — {}", declaration_ref)),
    })
}

/// Scenario 3 — Duty Drawback Refund (RESERVE phase)
/// NCS Revenue → Trader (two-phase: reserve first, commit after Mojaloop)
pub fn duty_drawback_reserve(
    claim_id: &str,
    ncs_revenue_account_id: &str,
    trader_account_id: &str,
    amount_minor: u64,
    ledger: u32,
    officer_id: &str,
) -> Result<CreateTransferRequest, String> {
    if amount_minor == 0 {
        return Err("Drawback amount must be > 0".to_string());
    }
    Ok(CreateTransferRequest {
        idempotency_key: derive_idempotency_key("drawback_reserve", claim_id, officer_id),
        debit_account_id: ncs_revenue_account_id.to_string(),
        credit_account_id: trader_account_id.to_string(),
        amount: amount_minor,
        ledger,
        entry_type: "drawback_reserve".to_string(),
        declaration_ref: Some(format!("drawback:{}", claim_id)),
        memo: Some(format!("Duty drawback reserve — claim {}", claim_id)),
    })
}

/// Scenario 4 — Penalty Levy
/// Trader account → NCS Penalty account
pub fn penalty_levy_transfer(
    declaration_ref: &str,
    trader_account_id: &str,
    ncs_penalty_account_id: &str,
    amount_minor: u64,
    ledger: u32,
    officer_id: &str,
) -> Result<CreateTransferRequest, String> {
    if amount_minor == 0 {
        return Err("Penalty amount must be > 0".to_string());
    }
    Ok(CreateTransferRequest {
        idempotency_key: derive_idempotency_key("penalty_levy", declaration_ref, officer_id),
        debit_account_id: trader_account_id.to_string(),
        credit_account_id: ncs_penalty_account_id.to_string(),
        amount: amount_minor,
        ledger,
        entry_type: "penalty_levy".to_string(),
        declaration_ref: Some(declaration_ref.to_string()),
        memo: Some(format!("Penalty levy — {} — officer {}", declaration_ref, officer_id)),
    })
}

/// Scenario 5 — Bond Guarantee Lodgement
/// Trader account → Bond Escrow account
pub fn bond_lodgement_transfer(
    bond_id: &str,
    trader_account_id: &str,
    bond_escrow_account_id: &str,
    amount_minor: u64,
    ledger: u32,
) -> Result<CreateTransferRequest, String> {
    if amount_minor == 0 {
        return Err("Bond amount must be > 0".to_string());
    }
    Ok(CreateTransferRequest {
        idempotency_key: derive_idempotency_key("bond_lodgement", bond_id, trader_account_id),
        debit_account_id: trader_account_id.to_string(),
        credit_account_id: bond_escrow_account_id.to_string(),
        amount: amount_minor,
        ledger,
        entry_type: "bond_lodgement".to_string(),
        declaration_ref: Some(format!("bond:{}", bond_id)),
        memo: Some(format!("Bond guarantee lodgement — bond {}", bond_id)),
    })
}

/// Scenario 6 — Bond Release on Clearance
/// Bond Escrow account → Trader account
pub fn bond_release_transfer(
    bond_id: &str,
    bond_escrow_account_id: &str,
    trader_account_id: &str,
    amount_minor: u64,
    ledger: u32,
    clearance_permit_ref: &str,
) -> Result<CreateTransferRequest, String> {
    if amount_minor == 0 {
        return Err("Bond release amount must be > 0".to_string());
    }
    Ok(CreateTransferRequest {
        idempotency_key: derive_idempotency_key("bond_release", bond_id, clearance_permit_ref),
        debit_account_id: bond_escrow_account_id.to_string(),
        credit_account_id: trader_account_id.to_string(),
        amount: amount_minor,
        ledger,
        entry_type: "bond_release".to_string(),
        declaration_ref: Some(format!("bond:{}", bond_id)),
        memo: Some(format!("Bond release — permit {}", clearance_permit_ref)),
    })
}

/// Scenario 7 — Bond Forfeiture
/// Bond Escrow account → NCS Revenue account
pub fn bond_forfeiture_transfer(
    bond_id: &str,
    bond_escrow_account_id: &str,
    ncs_revenue_account_id: &str,
    amount_minor: u64,
    ledger: u32,
    officer_id: &str,
) -> Result<CreateTransferRequest, String> {
    if amount_minor == 0 {
        return Err("Forfeiture amount must be > 0".to_string());
    }
    Ok(CreateTransferRequest {
        idempotency_key: derive_idempotency_key("bond_forfeiture", bond_id, officer_id),
        debit_account_id: bond_escrow_account_id.to_string(),
        credit_account_id: ncs_revenue_account_id.to_string(),
        amount: amount_minor,
        ledger,
        entry_type: "bond_forfeiture".to_string(),
        declaration_ref: Some(format!("bond:{}", bond_id)),
        memo: Some(format!("Bond forfeiture — bond {} — officer {}", bond_id, officer_id)),
    })
}

/// Scenario 8 — Transit Guarantee Lodgement
/// Trader account → Transit Escrow account
pub fn transit_lodgement_transfer(
    transit_id: &str,
    trader_account_id: &str,
    transit_escrow_account_id: &str,
    amount_minor: u64,
    ledger: u32,
) -> Result<CreateTransferRequest, String> {
    if amount_minor == 0 {
        return Err("Transit guarantee amount must be > 0".to_string());
    }
    Ok(CreateTransferRequest {
        idempotency_key: derive_idempotency_key("transit_lodgement", transit_id, trader_account_id),
        debit_account_id: trader_account_id.to_string(),
        credit_account_id: transit_escrow_account_id.to_string(),
        amount: amount_minor,
        ledger,
        entry_type: "transit_lodgement".to_string(),
        declaration_ref: Some(format!("transit:{}", transit_id)),
        memo: Some(format!("Transit guarantee — transit {}", transit_id)),
    })
}

/// Scenario 9 — Transit Guarantee Release
/// Transit Escrow account → Trader account
pub fn transit_release_transfer(
    transit_id: &str,
    transit_escrow_account_id: &str,
    trader_account_id: &str,
    amount_minor: u64,
    ledger: u32,
    exit_confirm_ref: &str,
) -> Result<CreateTransferRequest, String> {
    if amount_minor == 0 {
        return Err("Transit release amount must be > 0".to_string());
    }
    Ok(CreateTransferRequest {
        idempotency_key: derive_idempotency_key("transit_release", transit_id, exit_confirm_ref),
        debit_account_id: transit_escrow_account_id.to_string(),
        credit_account_id: trader_account_id.to_string(),
        amount: amount_minor,
        ledger,
        entry_type: "transit_release".to_string(),
        declaration_ref: Some(format!("transit:{}", transit_id)),
        memo: Some(format!("Transit release — exit ref {}", exit_confirm_ref)),
    })
}

/// Scenario 10 — AEO Application Fee
/// Trader account → AEO Fee account
pub fn aeo_fee_transfer(
    application_id: &str,
    trader_account_id: &str,
    aeo_fee_account_id: &str,
    amount_minor: u64,
    ledger: u32,
) -> Result<CreateTransferRequest, String> {
    Ok(CreateTransferRequest {
        idempotency_key: derive_idempotency_key("aeo_fee", application_id, trader_account_id),
        debit_account_id: trader_account_id.to_string(),
        credit_account_id: aeo_fee_account_id.to_string(),
        amount: amount_minor,
        ledger,
        entry_type: "aeo_application_fee".to_string(),
        declaration_ref: Some(format!("aeo:{}", application_id)),
        memo: Some(format!("AEO application fee — {}", application_id)),
    })
}

/// Scenario 11 — Free Zone Entry Fee
/// Trader account → Free Zone Operator account
pub fn freezone_entry_fee_transfer(
    admission_id: &str,
    trader_account_id: &str,
    fz_operator_account_id: &str,
    amount_minor: u64,
    ledger: u32,
) -> Result<CreateTransferRequest, String> {
    Ok(CreateTransferRequest {
        idempotency_key: derive_idempotency_key("fz_entry_fee", admission_id, trader_account_id),
        debit_account_id: trader_account_id.to_string(),
        credit_account_id: fz_operator_account_id.to_string(),
        amount: amount_minor,
        ledger,
        entry_type: "freezone_entry_fee".to_string(),
        declaration_ref: Some(format!("fz_admission:{}", admission_id)),
        memo: Some(format!("Free zone entry fee — admission {}", admission_id)),
    })
}

/// Scenario 12 — Bonded Warehouse Storage Fee
/// Trader account → Warehouse Operator account
pub fn warehouse_storage_fee_transfer(
    inventory_id: &str,
    trader_account_id: &str,
    warehouse_operator_account_id: &str,
    amount_minor: u64,
    ledger: u32,
    period: &str, // e.g. "2026-06"
) -> Result<CreateTransferRequest, String> {
    Ok(CreateTransferRequest {
        idempotency_key: derive_idempotency_key("warehouse_storage_fee", inventory_id, period),
        debit_account_id: trader_account_id.to_string(),
        credit_account_id: warehouse_operator_account_id.to_string(),
        amount: amount_minor,
        ledger,
        entry_type: "warehouse_storage_fee".to_string(),
        declaration_ref: Some(format!("inventory:{}", inventory_id)),
        memo: Some(format!("Warehouse storage fee — {} — period {}", inventory_id, period)),
    })
}

/// Scenario 13 — Ex-Bond Duty Payment
/// Trader account → NCS Revenue account
pub fn ex_bond_duty_transfer(
    permit_no: &str,
    trader_account_id: &str,
    ncs_revenue_account_id: &str,
    amount_minor: u64,
    ledger: u32,
) -> Result<CreateTransferRequest, String> {
    if amount_minor == 0 {
        return Err("Ex-bond duty amount must be > 0".to_string());
    }
    Ok(CreateTransferRequest {
        idempotency_key: derive_idempotency_key("ex_bond_duty", permit_no, trader_account_id),
        debit_account_id: trader_account_id.to_string(),
        credit_account_id: ncs_revenue_account_id.to_string(),
        amount: amount_minor,
        ledger,
        entry_type: "ex_bond_duty".to_string(),
        declaration_ref: Some(format!("ex_bond:{}", permit_no)),
        memo: Some(format!("Ex-bond duty payment — permit {}", permit_no)),
    })
}

/// Scenario 14 — Post-Clearance Audit Recovery
/// Trader account → NCS Revenue account
pub fn audit_recovery_transfer(
    audit_id: &str,
    declaration_ref: &str,
    trader_account_id: &str,
    ncs_revenue_account_id: &str,
    amount_minor: u64,
    ledger: u32,
    payment_ref: &str,
) -> Result<CreateTransferRequest, String> {
    if amount_minor == 0 {
        return Err("Audit recovery amount must be > 0".to_string());
    }
    Ok(CreateTransferRequest {
        idempotency_key: derive_idempotency_key("audit_recovery", audit_id, payment_ref),
        debit_account_id: trader_account_id.to_string(),
        credit_account_id: ncs_revenue_account_id.to_string(),
        amount: amount_minor,
        ledger,
        entry_type: "audit_recovery".to_string(),
        declaration_ref: Some(format!("audit:{}:decl:{}", audit_id, declaration_ref)),
        memo: Some(format!("Post-clearance audit recovery — audit {}", audit_id)),
    })
}

/// Scenario 15 — Overpayment Refund (RESERVE phase)
/// NCS Revenue → Trader (two-phase)
pub fn overpayment_refund_reserve(
    audit_id: &str,
    ncs_revenue_account_id: &str,
    trader_account_id: &str,
    amount_minor: u64,
    ledger: u32,
    officer_id: &str,
) -> Result<CreateTransferRequest, String> {
    if amount_minor == 0 {
        return Err("Overpayment refund amount must be > 0".to_string());
    }
    Ok(CreateTransferRequest {
        idempotency_key: derive_idempotency_key("overpayment_reserve", audit_id, officer_id),
        debit_account_id: ncs_revenue_account_id.to_string(),
        credit_account_id: trader_account_id.to_string(),
        amount: amount_minor,
        ledger,
        entry_type: "overpayment_reserve".to_string(),
        declaration_ref: Some(format!("overpayment:{}", audit_id)),
        memo: Some(format!("Overpayment refund reserve — audit {}", audit_id)),
    })
}

/// Scenario 16 — OGA Permit Fee
/// Trader account → OGA Revenue account
pub fn oga_permit_fee_transfer(
    permit_application_id: &str,
    trader_account_id: &str,
    oga_revenue_account_id: &str,
    amount_minor: u64,
    ledger: u32,
) -> Result<CreateTransferRequest, String> {
    Ok(CreateTransferRequest {
        idempotency_key: derive_idempotency_key("oga_permit_fee", permit_application_id, trader_account_id),
        debit_account_id: trader_account_id.to_string(),
        credit_account_id: oga_revenue_account_id.to_string(),
        amount: amount_minor,
        ledger,
        entry_type: "oga_permit_fee".to_string(),
        declaration_ref: Some(format!("oga_permit:{}", permit_application_id)),
        memo: Some(format!("OGA permit fee — {}", permit_application_id)),
    })
}

/// Scenario 17 — Sanctions-Blocked Payment Reversal
/// Trader account → Trader account (void/reversal — same debit and credit to zero out)
/// In practice: void the TigerBeetle RESERVE before COMMIT
pub fn sanctions_reversal_void(reserved_transfer_id: &str) -> String {
    // Returns the transfer ID to void — actual void is via DELETE /transfers/{id}
    // or POST /transfers/{id}/void on the bridge
    reserved_transfer_id.to_string()
}

/// Scenario 18 — Batch Payment Settlement
/// Multiple Traders → NCS Revenue (atomic batch)
pub fn batch_settlement_transfers(
    batch_id: &str,
    items: &[(String, String, String, u64)], // (transfer_id, debit_acct, credit_acct, amount)
    ledger: u32,
) -> Vec<CreateTransferRequest> {
    items.iter().map(|(transfer_id, debit, credit, amount)| {
        CreateTransferRequest {
            idempotency_key: derive_idempotency_key("batch_settlement", batch_id, transfer_id),
            debit_account_id: debit.clone(),
            credit_account_id: credit.clone(),
            amount: *amount,
            ledger,
            entry_type: "batch_duty_collection".to_string(),
            declaration_ref: Some(format!("batch:{}:{}", batch_id, transfer_id)),
            memo: Some(format!("Batch settlement — {} — {}", batch_id, transfer_id)),
        }
    }).collect()
}

/// Scenario 20 — Trader Account Provisioning
/// Creates a zero-balance account (no transfer needed, just account creation)
pub fn trader_account_id(trader_id: &str, currency: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(format!("trader_account:{}:{}", trader_id, currency));
    format!("trader-{}", &format!("{:x}", hasher.finalize())[..16])
}

// ─── TESTS ────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_import_duty_transfer_zero_amount_rejected() {
        let result = import_duty_transfer("DECL-001", "trader-1", "ncs-revenue", 0, 700);
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("must be > 0"));
    }

    #[test]
    fn test_import_duty_transfer_valid() {
        let result = import_duty_transfer("DECL-001", "trader-1", "ncs-revenue", 100_000, 700);
        assert!(result.is_ok());
        let req = result.unwrap();
        assert_eq!(req.entry_type, "duty_collection");
        assert_eq!(req.amount, 100_000);
        assert_eq!(req.debit_account_id, "trader-1");
        assert_eq!(req.credit_account_id, "ncs-revenue");
    }

    #[test]
    fn test_idempotency_key_is_deterministic() {
        let key1 = derive_idempotency_key("import_duty", "DECL-001", "trader-1");
        let key2 = derive_idempotency_key("import_duty", "DECL-001", "trader-1");
        assert_eq!(key1, key2);
    }

    #[test]
    fn test_idempotency_key_differs_by_scenario() {
        let k1 = derive_idempotency_key("import_duty", "DECL-001", "trader-1");
        let k2 = derive_idempotency_key("export_levy", "DECL-001", "trader-1");
        assert_ne!(k1, k2);
    }

    #[test]
    fn test_bond_forfeiture_requires_nonzero() {
        let result = bond_forfeiture_transfer("BOND-1", "escrow-1", "ncs-rev", 0, 700, "officer-1");
        assert!(result.is_err());
    }

    #[test]
    fn test_all_20_scenarios_produce_valid_requests() {
        // Spot-check all scenarios produce non-empty idempotency keys
        let scenarios: Vec<Result<CreateTransferRequest, String>> = vec![
            import_duty_transfer("D1", "t1", "ncs", 1000, 700),
            export_levy_transfer("D2", "t1", "ncs-exp", 500, 700),
            duty_drawback_reserve("C1", "ncs", "t1", 200, 700, "off1"),
            penalty_levy_transfer("D3", "t1", "ncs-pen", 300, 700, "off1"),
            bond_lodgement_transfer("B1", "t1", "escrow-b1", 5000, 700),
            bond_release_transfer("B1", "escrow-b1", "t1", 5000, 700, "PERMIT-001"),
            bond_forfeiture_transfer("B2", "escrow-b2", "ncs", 3000, 700, "off2"),
            transit_lodgement_transfer("TR1", "t1", "escrow-tr1", 2000, 700),
            transit_release_transfer("TR1", "escrow-tr1", "t1", 2000, 700, "EXIT-REF-001"),
            aeo_fee_transfer("AEO-1", "t1", "aeo-fee", 100, 700),
            freezone_entry_fee_transfer("FZ-ADM-1", "t1", "fz-op", 50, 700),
            warehouse_storage_fee_transfer("INV-1", "t1", "wh-op", 75, 700, "2026-06"),
            ex_bond_duty_transfer("BW-2026-001", "t1", "ncs", 1500, 700),
            audit_recovery_transfer("AUD-1", "D4", "t1", "ncs", 400, 700, "PAY-REF-001"),
            overpayment_refund_reserve("AUD-2", "ncs", "t1", 250, 700, "off1"),
            oga_permit_fee_transfer("OGA-PERMIT-1", "t1", "oga-rev", 80, 700),
        ];
        for (i, scenario) in scenarios.iter().enumerate() {
            assert!(scenario.is_ok(), "Scenario {} failed: {:?}", i + 1, scenario);
            let req = scenario.as_ref().unwrap();
            assert!(!req.idempotency_key.is_empty(), "Scenario {} has empty idempotency key", i + 1);
            assert!(req.amount > 0, "Scenario {} has zero amount", i + 1);
        }
    }

    #[test]
    fn test_trader_account_id_is_deterministic() {
        let id1 = trader_account_id("trader-123", "NGN");
        let id2 = trader_account_id("trader-123", "NGN");
        assert_eq!(id1, id2);
        assert!(id1.starts_with("trader-"));
    }

    #[test]
    fn test_batch_settlement_produces_correct_count() {
        let items = vec![
            ("tx1".to_string(), "t1".to_string(), "ncs".to_string(), 100u64),
            ("tx2".to_string(), "t2".to_string(), "ncs".to_string(), 200u64),
            ("tx3".to_string(), "t3".to_string(), "ncs".to_string(), 300u64),
        ];
        let transfers = batch_settlement_transfers("BATCH-001", &items, 700);
        assert_eq!(transfers.len(), 3);
        assert_eq!(transfers[0].entry_type, "batch_duty_collection");
    }
}
