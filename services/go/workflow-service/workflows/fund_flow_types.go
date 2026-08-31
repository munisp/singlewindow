// Fund Flow Shared Types — used across all 20 fund-flow workflows
// Defines activity input/output types, shared activity stubs, and helper types.
package workflows

import "time"

// ─── TIGERBEETLE TYPES ────────────────────────────────────────────────────────

type TigerBeetleAccountInput struct {
	AccountID   string `json:"account_id"`
	Ledger      uint32 `json:"ledger"`
	Label       string `json:"label"`
	AccountType string `json:"account_type"` // "debit_normal" | "credit_normal"
}

type TigerBeetleAccountResult struct {
	AccountID string `json:"account_id"`
	Created   bool   `json:"created"` // false if already existed (idempotent)
}

type TigerBeetleTransferInput struct {
	IdempotencyKey  string `json:"idempotency_key"`
	DebitAccountID  string `json:"debit_account_id"`
	CreditAccountID string `json:"credit_account_id"`
	AmountMinor     int64  `json:"amount_minor"`
	Ledger          uint32 `json:"ledger"`
	EntryType       string `json:"entry_type"`
	DeclarationRef  string `json:"declaration_ref,omitempty"`
	Memo            string `json:"memo,omitempty"`
}

type TigerBeetleTransferResult struct {
	TransferID string `json:"transfer_id"`
	Status     string `json:"status"` // "committed" | "reserved" | "voided"
}

type TigerBeetleCommitInput struct {
	ReservedTransferID string `json:"reserved_transfer_id"`
	MojaloopFulfilment string `json:"mojaloop_fulfilment"`
}

type TigerBeetleVoidInput struct {
	ReservedTransferID string `json:"reserved_transfer_id"`
	Reason             string `json:"reason"`
}

type TigerBeetleBatchInput struct {
	BatchID   string             `json:"batch_id"`
	Items     []BatchPaymentItem `json:"items"`
	Ledger    uint32             `json:"ledger"`
	EntryType string             `json:"entry_type"`
}

type TigerBeetleBatchResult struct {
	BatchID      string `json:"batch_id"`
	SuccessCount int    `json:"success_count"`
	TotalMinor   int64  `json:"total_minor"`
}

type BatchPaymentItem struct {
	TransferID      string `json:"transfer_id"`
	DebitAccountID  string `json:"debit_account_id"`
	CreditAccountID string `json:"credit_account_id"`
	AmountMinor     int64  `json:"amount_minor"`
	DeclarationRef  string `json:"declaration_ref"`
}

type QueryBalanceInput struct {
	AccountID string `json:"account_id"`
	Ledger    uint32 `json:"ledger"`
}

// ─── MOJALOOP TYPES ───────────────────────────────────────────────────────────

type MojaloopTransferInput struct {
	TransferID     string `json:"transfer_id"`
	PayerFSP       string `json:"payer_fsp"`
	PayeeFSP       string `json:"payee_fsp"`
	Amount         int64  `json:"amount"`
	Currency       string `json:"currency"`
	DeclarationRef string `json:"declaration_ref"`
}

type MojaloopTransferResult struct {
	TransferID string `json:"transfer_id"`
	Success    bool   `json:"success"`
	Fulfilment string `json:"fulfilment,omitempty"`
	ErrorCode  string `json:"error_code,omitempty"`
	ErrorDesc  string `json:"error_desc,omitempty"`
}

// ─── KAFKA TYPES ──────────────────────────────────────────────────────────────

type KafkaEventInput struct {
	Topic   string                 `json:"topic"`
	Key     string                 `json:"key"`
	Payload map[string]interface{} `json:"payload"`
}

type KafkaBatchEventInput struct {
	Topic       string   `json:"topic"`
	BatchID     string   `json:"batch_id"`
	TransferIDs []string `json:"transfer_ids"`
	TotalMinor  int64    `json:"total_minor"`
	Currency    string   `json:"currency"`
	TBBatchID   string   `json:"tb_batch_id"`
}

// ─── FLUVIO TYPES ─────────────────────────────────────────────────────────────

type FluvioEventInput struct {
	Topic   string                 `json:"topic"`
	Payload map[string]interface{} `json:"payload"`
}

// ─── PERMIFY TYPES ────────────────────────────────────────────────────────────

type PermifyAuthInput struct {
	SubjectType string `json:"subject_type"`
	SubjectID   string `json:"subject_id"`
	Resource    string `json:"resource"`
	Action      string `json:"action"`
}

// ─── BOND TYPES ───────────────────────────────────────────────────────────────

type UpdateBondStatusInput struct {
	BondID int64  `json:"bond_id"`
	Status string `json:"status"`
}

// ─── TRANSIT TYPES ────────────────────────────────────────────────────────────

type UpdateTransitStatusInput struct {
	TransitID int64  `json:"transit_id"`
	Status    string `json:"status"`
}

type VerifyTransitInput struct {
	TransitID      int64  `json:"transit_id"`
	UCR            string `json:"ucr"`
	ExitConfirmRef string `json:"exit_confirm_ref"`
}

// ─── DRAWBACK TYPES ───────────────────────────────────────────────────────────

type UpdateDrawbackStatusInput struct {
	ClaimID int64  `json:"claim_id"`
	Status  string `json:"status"`
	Reason  string `json:"reason,omitempty"`
}

// ─── AUDIT RECOVERY TYPES ─────────────────────────────────────────────────────

type DemandNoticeInput struct {
	TraderID        string `json:"trader_id"`
	AuditID         int64  `json:"audit_id"`
	DeclarationID   int64  `json:"declaration_id"`
	AmountMinor     int64  `json:"amount_minor"`
	Currency        string `json:"currency"`
	DemandNoticeRef string `json:"demand_notice_ref"`
	Deadline        string `json:"deadline"`
}

type EnforcementInput struct {
	AuditID       int64  `json:"audit_id"`
	TraderID      string `json:"trader_id"`
	DeclarationID int64  `json:"declaration_id"`
	AmountMinor   int64  `json:"amount_minor"`
	Reason        string `json:"reason"`
}

// ─── RECONCILIATION TYPES ─────────────────────────────────────────────────────

type DiscrepancyAlertInput struct {
	AccountID          string `json:"account_id"`
	TigerBeetleBalance int64  `json:"tigerbeetle_balance"`
	PostgresBalance    int64  `json:"postgres_balance"`
	DiscrepancyMinor   int64  `json:"discrepancy_minor"`
	Date               string `json:"date"`
}

type ReconciliationAlertInput struct {
	ClaimID      int64  `json:"claim_id"`
	FlowType     string `json:"flow_type"`
	TBTxID       string `json:"tb_tx_id"`
	MojaloopTxID string `json:"mojaloop_tx_id"`
}

// ─── DELTA LAKE TYPES ─────────────────────────────────────────────────────────

type DeltaLakeWriteInput struct {
	Table     string                 `json:"table"`
	Partition string                 `json:"partition"`
	Record    map[string]interface{} `json:"record"`
}

// ─── BATCH PAYMENT TYPES ──────────────────────────────────────────────────────

type FetchBatchInput struct {
	BatchID     string   `json:"batch_id"`
	TransferIDs []string `json:"transfer_ids"`
}

type ClaimBatchInput struct {
	BatchID     string   `json:"batch_id"`
	TransferIDs []string `json:"transfer_ids"`
}

type ReleaseBatchInput struct {
	TransferIDs []string `json:"transfer_ids"`
	Reason      string   `json:"reason"`
}

type MarkCommittedInput struct {
	TransferIDs    []string `json:"transfer_ids"`
	TBBatchID      string   `json:"tb_batch_id"`
	SettlementDate string   `json:"settlement_date"`
}

// ─── ACTIVITY STUBS ───────────────────────────────────────────────────────────
// These are registered in main.go. Defined here as function signatures for
// workflow.ExecuteActivity type safety.

func TigerBeetleCreateAccountActivity(input TigerBeetleAccountInput) (TigerBeetleAccountResult, error) {
	panic("activity not registered — must be called via workflow.ExecuteActivity")
}

func TigerBeetleTransferActivity(input TigerBeetleTransferInput) (TigerBeetleTransferResult, error) {
	panic("activity not registered")
}

func TigerBeetleReserveActivity(input TigerBeetleTransferInput) (TigerBeetleTransferResult, error) {
	panic("activity not registered")
}

func TigerBeetleCommitActivity(input TigerBeetleCommitInput) error {
	panic("activity not registered")
}

func TigerBeetleVoidReserveActivity(input TigerBeetleVoidInput) error {
	panic("activity not registered")
}

func TigerBeetleBatchTransferActivity(input TigerBeetleBatchInput) (TigerBeetleBatchResult, error) {
	panic("activity not registered")
}

func QueryTigerBeetleBalanceActivity(input QueryBalanceInput) (int64, error) {
	panic("activity not registered")
}

func QueryPostgresBalanceMirrorActivity(input QueryBalanceInput) (int64, error) {
	panic("activity not registered")
}

func MojaloopTransferActivity(input MojaloopTransferInput) (MojaloopTransferResult, error) {
	panic("activity not registered")
}

func PublishKafkaEventActivity(input KafkaEventInput) error {
	panic("activity not registered")
}

func PublishKafkaBatchEventActivity(input KafkaBatchEventInput) (int64, error) {
	panic("activity not registered")
}

func PublishFluvioStreamEventActivity(input FluvioEventInput) error {
	panic("activity not registered")
}

func CheckPermifyAuthorizationActivity(input PermifyAuthInput) (bool, error) {
	panic("activity not registered")
}

func UpdateBondStatusActivity(input UpdateBondStatusInput) error {
	panic("activity not registered")
}

func UpdateTransitStatusActivity(input UpdateTransitStatusInput) error {
	panic("activity not registered")
}

func VerifyTransitExitConfirmationActivity(input VerifyTransitInput) (bool, error) {
	panic("activity not registered")
}

func UpdateDrawbackStatusActivity(input UpdateDrawbackStatusInput) error {
	panic("activity not registered")
}

func SendDemandNoticeActivity(input DemandNoticeInput) error {
	panic("activity not registered")
}

func EscalateToEnforcementActivity(input EnforcementInput) error {
	panic("activity not registered")
}

func RaiseReconciliationAlertActivity(input ReconciliationAlertInput) error {
	panic("activity not registered")
}

func RaiseBalanceDiscrepancyAlertActivity(input DiscrepancyAlertInput) error {
	panic("activity not registered")
}

func WriteToDeltaLakeActivity(input DeltaLakeWriteInput) (string, error) {
	panic("activity not registered")
}

func FetchBatchPaymentItemsActivity(input FetchBatchInput) ([]BatchPaymentItem, error) {
	panic("activity not registered")
}

func ClaimBatchPaymentItemsActivity(input ClaimBatchInput) ([]string, error) {
	panic("activity not registered")
}

func ReleaseBatchPaymentItemsActivity(input ReleaseBatchInput) error {
	panic("activity not registered")
}

func MarkBatchPaymentItemsCommittedActivity(input MarkCommittedInput) error {
	panic("activity not registered")
}

// ─── EXISTING ACTIVITY STUBS (from clearance_activities.go) ──────────────────
// Re-declared here for reference — actual implementations are in activities package.

// SanctionsResult is defined in declaration_clearance.go
// RiskScoringResult is defined in declaration_clearance.go

// UpdateDeclarationStatusActivityInput is used in the clearance workflow
type UpdateDeclarationStatusActivityInput struct {
	DeclarationID int64     `json:"declaration_id"`
	Status        string    `json:"status"`
	Reason        string    `json:"reason,omitempty"`
	UpdatedAt     time.Time `json:"updated_at"`
}

// NOTE (PRA-129): the bogus updateDeclarationStatus stub that shadowed the
// real helper in declaration_clearance.go was removed. The real helper lives
// in declaration_clearance.go and executes UpdateDeclarationStatusActivity.
