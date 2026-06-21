# TradeGateway™ NGSWTP — Fund Flow Audit & Atomicity Guarantee Report
## v61 Sprint | June 2026 | Confidential — Customs Authority Use Only

---

## Executive Summary

This document identifies the **top 20 fund-flow scenarios** on the TradeGateway National Single Window Trade Platform, audits each for completeness and atomicity, and specifies the middleware guarantees that prevent loss of funds, double-spending, or silent failures. Every scenario must satisfy the **ACID + Idempotency + Saga Compensation** triad before it can be considered production-safe.

---

## The 20 Fund-Flow Scenarios

| # | Scenario | Initiator | Ledger Accounts | Middleware Chain | Risk Level |
|---|----------|-----------|-----------------|-----------------|------------|
| 1 | Import Duty Collection | Trader | Trader → NCS Revenue | Temporal → Mojaloop → TigerBeetle → Kafka | CRITICAL |
| 2 | Export Levy Collection | Trader | Trader → NCS Export Levy | Temporal → Mojaloop → TigerBeetle → Kafka | CRITICAL |
| 3 | Duty Drawback Refund | Customs | NCS Revenue → Trader | Temporal → TigerBeetle → Mojaloop → Kafka | CRITICAL |
| 4 | Penalty Levy (Mis-declaration) | Customs | Trader → NCS Penalty | Temporal → TigerBeetle → Kafka | HIGH |
| 5 | Bond Guarantee Lodgement | Trader | Trader → Bond Escrow | TigerBeetle → Temporal → Kafka | HIGH |
| 6 | Bond Release on Clearance | Customs | Bond Escrow → Trader | Temporal → TigerBeetle → Kafka | HIGH |
| 7 | Bond Forfeiture (Breach) | Customs | Bond Escrow → NCS Revenue | Temporal → TigerBeetle → Kafka | HIGH |
| 8 | Transit Guarantee Lodgement | Trader | Trader → Transit Escrow | TigerBeetle → Temporal → Kafka | HIGH |
| 9 | Transit Guarantee Release | Customs | Transit Escrow → Trader | Temporal → TigerBeetle → Kafka | HIGH |
| 10 | AEO Application Fee | Trader | Trader → AEO Fee Account | Mojaloop → TigerBeetle → Kafka | MEDIUM |
| 11 | Free Zone Entry Fee | Trader | Trader → FZ Operator Account | Mojaloop → TigerBeetle → Kafka | MEDIUM |
| 12 | Bonded Warehouse Storage Fee | Trader | Trader → BW Operator Account | Mojaloop → TigerBeetle → Kafka | MEDIUM |
| 13 | Ex-Bond Duty Payment | Trader | Trader → NCS Revenue | Temporal → Mojaloop → TigerBeetle → Kafka | HIGH |
| 14 | Post-Clearance Audit Recovery | Customs | Trader → NCS Revenue (underpaid) | Temporal → TigerBeetle → Mojaloop → Kafka | HIGH |
| 15 | Overpayment Refund | Customs | NCS Revenue → Trader | Temporal → TigerBeetle → Mojaloop → Kafka | HIGH |
| 16 | OGA Permit Fee | Trader | Trader → OGA Revenue Account | Mojaloop → TigerBeetle → Kafka | MEDIUM |
| 17 | Sanctions-Blocked Payment Reversal | System | Trader → Trader (reversal) | Temporal (compensation) → TigerBeetle → Kafka | CRITICAL |
| 18 | Batch Payment Settlement | System | Multiple Traders → NCS Revenue | Kafka → TigerBeetle (batch atomic) → Fluvio | HIGH |
| 19 | Revenue Reconciliation & Sweep | System | NCS Revenue → Central Bank | Temporal (cron) → TigerBeetle → Kafka → Lakehouse | HIGH |
| 20 | Trader Account Provisioning | System | System → Trader Account (zero balance) | TigerBeetle → Kafka | MEDIUM |

---

## Atomicity Requirements Per Scenario

### Scenario 1 — Import Duty Collection

**Flow:** Trader submits declaration → AI risk scoring → duty calculation → Mojaloop ILP two-phase transfer (RESERVE → COMMIT) → TigerBeetle double-entry debit/credit → Kafka event → declaration status update.

**Atomicity Guarantee:** The Temporal workflow `DeclarationClearanceWorkflow` orchestrates all steps. If Mojaloop RESERVE succeeds but COMMIT fails, the Temporal activity retries with `criticalRetryPolicy` (10 attempts, exponential backoff). If all retries fail, the saga compensation activity calls `POST /transfers/{id}/error` to release the reservation. TigerBeetle only records the transfer after Mojaloop COMMIT succeeds — never before.

**Gap Found (pre-v61):** TigerBeetle write was happening optimistically before Mojaloop COMMIT confirmation. **Fixed in v61.**

---

### Scenario 2 — Export Levy Collection

**Flow:** Same as Scenario 1 but uses the `NCS_EXPORT_LEVY` ledger account and triggers on export declarations.

**Gap Found:** Export declarations were not routed through the Temporal workflow — they used a direct DB write. **Fixed in v61:** export declarations now use the same `DeclarationClearanceWorkflow` with `declarationType: "export"`.

---

### Scenario 3 — Duty Drawback Refund

**Flow:** Trader submits drawback claim → Customs officer approves → Temporal `DutyDrawbackWorkflow` → TigerBeetle debit NCS Revenue, credit Trader → Mojaloop reverse transfer → Kafka event.

**Atomicity Guarantee:** Two-phase saga: (1) TigerBeetle RESERVE debit from NCS Revenue, (2) Mojaloop transfer to trader DFSP, (3) TigerBeetle COMMIT on Mojaloop success. Compensation: if Mojaloop fails after TigerBeetle RESERVE, a compensating TigerBeetle credit restores NCS Revenue balance.

**Gap Found:** Drawback router had no Temporal workflow — it was a direct DB update. **Fixed in v61.**

---

### Scenario 4 — Penalty Levy

**Flow:** Customs officer raises penalty → Temporal `PenaltyWorkflow` → TigerBeetle debit Trader, credit NCS Penalty Account → Kafka event → notification to trader.

**Atomicity Guarantee:** Idempotency key = SHA-256(`declaration_ref:penalty:officer_id:amount`). TigerBeetle rejects duplicate transfers with the same idempotency key. Redis caches the result for 24 hours.

**Gap Found:** No idempotency key on penalty creation — double-click could create duplicate penalties. **Fixed in v61.**

---

### Scenario 5 — Bond Guarantee Lodgement

**Flow:** Trader lodges bond → TigerBeetle creates escrow account → debit Trader, credit Bond Escrow → Temporal `BondWorkflow` monitors expiry → Kafka event.

**Atomicity Guarantee:** Bond account creation and initial transfer are atomic in TigerBeetle (batch transfer). Temporal workflow monitors bond expiry and triggers renewal or forfeiture.

**Gap Found:** Bond creation was not linked to a Temporal workflow — expiry monitoring was a cron job that could miss bonds created after the last cron run. **Fixed in v61.**

---

### Scenario 6 — Bond Release on Clearance

**Flow:** Declaration cleared → Temporal `BondReleaseActivity` → TigerBeetle debit Bond Escrow, credit Trader → Kafka event.

**Atomicity Guarantee:** Bond release is an activity within `DeclarationClearanceWorkflow` — it only executes after `IssueClearancePermitActivity` succeeds. Cannot release bond without a valid clearance permit.

**Status:** Already implemented. No gap.

---

### Scenario 7 — Bond Forfeiture

**Flow:** Bond breach detected (goods not re-exported within deadline) → Temporal `BondForfeitureWorkflow` → TigerBeetle debit Bond Escrow, credit NCS Revenue → Kafka event → legal notification.

**Gap Found:** Forfeiture was a manual process with no Temporal workflow. **Fixed in v61.**

---

### Scenario 8 — Transit Guarantee Lodgement

**Flow:** Transit declaration submitted → TigerBeetle creates transit escrow → debit Trader, credit Transit Escrow → Temporal `TransitWorkflow` monitors exit confirmation.

**Gap Found:** Transit escrow was stored in PostgreSQL only — not in TigerBeetle. **Fixed in v61.**

---

### Scenario 9 — Transit Guarantee Release

**Flow:** Exit confirmation received from destination customs → Temporal `TransitWorkflow` completes → TigerBeetle debit Transit Escrow, credit Trader → Kafka event.

**Gap Found:** No Temporal workflow for transit — release was manual. **Fixed in v61.**

---

### Scenario 10 — AEO Application Fee

**Flow:** Trader submits AEO application → Mojaloop payment → TigerBeetle debit Trader, credit AEO Fee Account → Kafka event → application status update.

**Status:** Implemented via `paymentsRouter.initiate` with `paymentMethod: "bank_transfer"`. No gap.

---

### Scenario 11 — Free Zone Entry Fee

**Flow:** Goods admitted to free zone → Mojaloop payment → TigerBeetle → Kafka.

**Gap Found:** Free zone service (Go) did not call TigerBeetle — it only updated PostgreSQL. **Fixed in v61.**

---

### Scenario 12 — Bonded Warehouse Storage Fee

**Flow:** Monthly storage fee calculated → Mojaloop recurring payment → TigerBeetle → Kafka.

**Gap Found:** Storage fee was a manual invoice — no automated payment flow. **Fixed in v61.**

---

### Scenario 13 — Ex-Bond Duty Payment

**Flow:** Goods removed from bonded warehouse → duty calculated → Temporal `ExBondDutyWorkflow` → Mojaloop → TigerBeetle → Kafka → warehouse inventory update.

**Atomicity Guarantee:** Ex-bond duty payment and inventory update are in the same Temporal workflow. If payment fails, goods remain in bond (inventory not updated).

**Gap Found:** Ex-bond duty payment was not in a Temporal workflow — inventory could be updated before payment confirmed. **Fixed in v61.**

---

### Scenario 14 — Post-Clearance Audit Recovery

**Flow:** Audit finds underpayment → Customs issues demand notice → Trader pays → Temporal `AuditRecoveryWorkflow` → TigerBeetle → Mojaloop → Kafka.

**Gap Found:** No Temporal workflow — audit recovery was a direct DB update. **Fixed in v61.**

---

### Scenario 15 — Overpayment Refund

**Flow:** Audit finds overpayment → Customs approves refund → Temporal `OverpaymentRefundWorkflow` → TigerBeetle RESERVE debit NCS Revenue → Mojaloop transfer → TigerBeetle COMMIT → Kafka.

**Gap Found:** Overpayment refund used the same code path as duty drawback but without the two-phase TigerBeetle pattern. **Fixed in v61.**

---

### Scenario 16 — OGA Permit Fee

**Flow:** OGA permit application → Mojaloop payment → TigerBeetle debit Trader, credit OGA Revenue → Kafka event → permit status update.

**Status:** Implemented. No gap.

---

### Scenario 17 — Sanctions-Blocked Payment Reversal

**Flow:** Payment initiated → Sanctions screening triggers after Mojaloop RESERVE → Temporal compensation activity → Mojaloop `PUT /transfers/{id}/error` → TigerBeetle void transfer → Kafka event → trader notification.

**Gap Found:** Sanctions check was happening before Mojaloop RESERVE, but if the OFAC list was updated between RESERVE and COMMIT, the payment could go through. **Fixed in v61:** sanctions check now runs as a Temporal activity immediately before COMMIT.

---

### Scenario 18 — Batch Payment Settlement

**Flow:** End-of-day batch → Kafka consumer reads `payment.queued` events → TigerBeetle batch transfer (atomic) → Fluvio real-time stream → PostgreSQL balance mirror update → Lakehouse delta write.

**Atomicity Guarantee:** TigerBeetle batch transfer is atomic — all transfers in the batch succeed or all fail. Kafka consumer uses exactly-once semantics (Kafka transactions). Fluvio consumer updates the real-time dashboard.

**Gap Found:** Batch was not using Kafka transactions — could process the same batch twice on restart. **Fixed in v61.**

---

### Scenario 19 — Revenue Reconciliation & Sweep

**Flow:** Daily Temporal cron → query TigerBeetle NCS Revenue balance → compare with PostgreSQL mirror → if discrepancy > threshold, alert → sweep to Central Bank account → write to Delta Lake.

**Gap Found:** Reconciliation cron was comparing PostgreSQL-to-PostgreSQL, not TigerBeetle-to-PostgreSQL. **Fixed in v61.**

---

### Scenario 20 — Trader Account Provisioning

**Flow:** New trader registers → TigerBeetle creates trader account (zero balance) → Kafka event → Permify sets account ownership → Redis caches account ID.

**Gap Found:** Account provisioning had no Kafka event — other services could not react to new account creation. **Fixed in v61.**

---

## Middleware Atomicity Matrix

| Middleware | Role in Fund Flows | Atomicity Mechanism |
|------------|-------------------|---------------------|
| **TigerBeetle** | Double-entry ledger — source of truth for all balances | Atomic batch transfers; idempotency via transfer ID; no partial commits |
| **Temporal** | Saga orchestrator — durable workflow state | Activity retry with compensation; workflow history is append-only |
| **Mojaloop** | Interbank payment switch | ILP two-phase (RESERVE → COMMIT/ABORT); FSPIOP headers enforce ordering |
| **Kafka** | Event bus — audit trail and downstream fan-out | Exactly-once semantics via Kafka transactions; consumer group offsets |
| **Fluvio** | Real-time stream — dashboard and CEP | At-least-once with deduplication via Redis; sub-100ms latency |
| **Redis** | Idempotency cache and distributed lock | SETNX with TTL for payment idempotency keys; Lua scripts for atomic check-and-set |
| **Dapr** | Service mesh pub/sub — cross-service events | At-least-once delivery with outbox pattern; state store for saga state |
| **PostgreSQL** | Balance mirror and audit log | ACID transactions; row-level locking for concurrent payment claims |
| **Permify** | Authorization — who can initiate/approve payments | Relationship tuples checked before every payment mutation |
| **OpenSearch** | Audit trail search | Dual-write from Kafka consumer; immutable index |

---

## v61 Implementation Plan

The following files are created or updated in v61 to close all identified gaps:

### Go Services
- `services/go/workflow-service/workflows/duty_drawback.go` — DutyDrawbackWorkflow
- `services/go/workflow-service/workflows/bond_management.go` — BondWorkflow, BondForfeitureWorkflow
- `services/go/workflow-service/workflows/transit_guarantee.go` — TransitWorkflow
- `services/go/workflow-service/workflows/ex_bond_duty.go` — ExBondDutyWorkflow
- `services/go/workflow-service/workflows/audit_recovery.go` — AuditRecoveryWorkflow, OverpaymentRefundWorkflow
- `services/go/workflow-service/workflows/batch_settlement.go` — BatchSettlementWorkflow
- `services/go/workflow-service/workflows/revenue_reconciliation.go` — RevenueReconciliationWorkflow
- `services/go/workflow-service/activities/payment_activities.go` — TigerBeetle + Mojaloop activities

### Rust Services
- `services/rust/tigerbeetle-bridge-rs/src/scenarios.rs` — Scenario-specific transfer builders
- `services/rust/tigerbeetle-bridge-rs/src/idempotency.rs` — SHA-256 idempotency key generation

### Python Services
- `services/python/payment-risk-scorer/scenarios.py` — Per-scenario risk scoring
- `services/python/sanctions-screener/pre_commit_check.py` — Pre-COMMIT sanctions check

### TypeScript (tRPC)
- `server/routers/fundFlows.ts` — Unified fund-flow router for all 20 scenarios
- `server/v61.test.ts` — 80+ tests covering all 20 scenarios
