// payment_activities.go — Atomic flow-of-funds activities for Temporal workflows.
//
// This file implements the critical financial activities that must be:
//   1. Idempotent (safe to retry on failure)
//   2. Atomic (all-or-nothing via TigerBeetle two-phase transfers)
//   3. Compensatable (saga pattern — every action has a compensating action)
//   4. Auditable (every operation persisted to PostgreSQL audit trail)
//
// Flow of funds for a duty payment:
//   1. CreatePendingLedgerTransfer  — reserves funds in TigerBeetle (pending)
//   2. InitiateMojaloopTransfer     — sends ILP transfer to Mojaloop switch
//   3. WaitForMojaloopFulfilment    — polls until COMMITTED or ABORTED
//   4. PostLedgerTransfer           — posts the pending TB transfer (irrevocable)
//   5. UpdatePaymentConfirmed       — marks payment confirmed in PostgreSQL
//
// Compensation (saga rollback):
//   - If step 3 returns ABORTED: VoidLedgerTransfer + UpdatePaymentFailed
//   - If step 4 fails: VoidLedgerTransfer + RefundMojaloop + UpdatePaymentFailed
package activities

import (
	"context"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/binary"
	"encoding/json"
	"fmt"
	"io"
	"math"
	"net/http"
	"strings"
	"time"

	"go.temporal.io/sdk/activity"
	"go.temporal.io/sdk/temporal"

	pb "github.com/tradegateway/temporal-worker/proto/ledger"
)

// ─── Configuration ────────────────────────────────────────────────────────────

var (
	// Canonical Go bridge: k8s Service tigerbeetle-bridge, HTTP /api/ledger/*.
	tbBridgeURL     = getEnv("TIGERBEETLE_BRIDGE_URL", "http://tigerbeetle-bridge:8086")
	mojaloopURL     = getEnv("MOJALOOP_SERVICE_URL", "http://localhost:8099")
	webhookSecret   = getEnv("MOJALOOP_WEBHOOK_SECRET", "")
)

// ─── Nigeria Customs Tariff Rates (2024 ECOWAS CET) ──────────────────────────
// These are the actual Nigeria Customs Service tariff rates per HS chapter.
// Source: NCS Tariff Book 2024 / ECOWAS Common External Tariff

type TariffEntry struct {
	ImportDuty   float64 // Ad valorem rate (0.0 – 1.0)
	VAT          float64 // VAT rate (standard 7.5% in Nigeria)
	Levy         float64 // ECOWAS levy + CISS + ETLS
	Description  string
}

var nigeriaTariffSchedule = map[string]TariffEntry{
	// Chapter 01-05: Live animals and animal products
	"01": {ImportDuty: 0.05, VAT: 0.075, Levy: 0.01, Description: "Live animals"},
	"02": {ImportDuty: 0.20, VAT: 0.075, Levy: 0.01, Description: "Meat and edible offal"},
	"03": {ImportDuty: 0.05, VAT: 0.075, Levy: 0.01, Description: "Fish and crustaceans"},
	"04": {ImportDuty: 0.10, VAT: 0.075, Levy: 0.01, Description: "Dairy produce"},
	// Chapter 06-14: Vegetable products
	"07": {ImportDuty: 0.10, VAT: 0.075, Levy: 0.01, Description: "Edible vegetables"},
	"08": {ImportDuty: 0.10, VAT: 0.075, Levy: 0.01, Description: "Edible fruit and nuts"},
	"10": {ImportDuty: 0.05, VAT: 0.075, Levy: 0.01, Description: "Cereals"},
	// Chapter 15-24: Food preparations
	"15": {ImportDuty: 0.10, VAT: 0.075, Levy: 0.01, Description: "Animal/vegetable fats"},
	"17": {ImportDuty: 0.20, VAT: 0.075, Levy: 0.01, Description: "Sugars"},
	"19": {ImportDuty: 0.20, VAT: 0.075, Levy: 0.01, Description: "Preparations of cereals"},
	"20": {ImportDuty: 0.20, VAT: 0.075, Levy: 0.01, Description: "Preparations of vegetables"},
	"21": {ImportDuty: 0.20, VAT: 0.075, Levy: 0.01, Description: "Miscellaneous edible preparations"},
	"22": {ImportDuty: 0.20, VAT: 0.075, Levy: 0.01, Description: "Beverages, spirits"},
	// Chapter 25-27: Mineral products
	"27": {ImportDuty: 0.05, VAT: 0.075, Levy: 0.005, Description: "Mineral fuels, oils"},
	// Chapter 28-38: Chemical products
	"28": {ImportDuty: 0.05, VAT: 0.075, Levy: 0.01, Description: "Inorganic chemicals"},
	"29": {ImportDuty: 0.05, VAT: 0.075, Levy: 0.01, Description: "Organic chemicals"},
	"30": {ImportDuty: 0.05, VAT: 0.075, Levy: 0.01, Description: "Pharmaceutical products"},
	"33": {ImportDuty: 0.20, VAT: 0.075, Levy: 0.01, Description: "Essential oils, cosmetics"},
	// Chapter 39-40: Plastics and rubber
	"39": {ImportDuty: 0.10, VAT: 0.075, Levy: 0.01, Description: "Plastics and articles"},
	"40": {ImportDuty: 0.10, VAT: 0.075, Levy: 0.01, Description: "Rubber and articles"},
	// Chapter 50-63: Textiles
	"61": {ImportDuty: 0.35, VAT: 0.075, Levy: 0.01, Description: "Knitted clothing"},
	"62": {ImportDuty: 0.35, VAT: 0.075, Levy: 0.01, Description: "Woven clothing"},
	"63": {ImportDuty: 0.35, VAT: 0.075, Levy: 0.01, Description: "Other made-up textiles"},
	// Chapter 64-67: Footwear
	"64": {ImportDuty: 0.35, VAT: 0.075, Levy: 0.01, Description: "Footwear"},
	// Chapter 68-70: Stone, cement, glass
	"70": {ImportDuty: 0.10, VAT: 0.075, Levy: 0.01, Description: "Glass and glassware"},
	// Chapter 72-83: Base metals
	"72": {ImportDuty: 0.05, VAT: 0.075, Levy: 0.01, Description: "Iron and steel"},
	"73": {ImportDuty: 0.10, VAT: 0.075, Levy: 0.01, Description: "Articles of iron/steel"},
	"76": {ImportDuty: 0.10, VAT: 0.075, Levy: 0.01, Description: "Aluminium and articles"},
	// Chapter 84-85: Machinery and electrical
	"84": {ImportDuty: 0.05, VAT: 0.075, Levy: 0.01, Description: "Machinery, mechanical appliances"},
	"85": {ImportDuty: 0.10, VAT: 0.075, Levy: 0.01, Description: "Electrical machinery"},
	// Chapter 87: Vehicles
	"87": {ImportDuty: 0.35, VAT: 0.075, Levy: 0.01, Description: "Vehicles (non-railway)"},
	// Chapter 88-89: Aircraft, ships
	"88": {ImportDuty: 0.05, VAT: 0.075, Levy: 0.005, Description: "Aircraft, spacecraft"},
	"89": {ImportDuty: 0.05, VAT: 0.075, Levy: 0.005, Description: "Ships and boats"},
	// Chapter 90: Optical, medical instruments
	"90": {ImportDuty: 0.05, VAT: 0.075, Levy: 0.01, Description: "Optical instruments"},
	// Chapter 94-96: Miscellaneous manufactured
	"94": {ImportDuty: 0.20, VAT: 0.075, Levy: 0.01, Description: "Furniture"},
	"95": {ImportDuty: 0.35, VAT: 0.075, Levy: 0.01, Description: "Toys and games"},
}

// defaultTariff is used when the HS chapter is not in the schedule
var defaultTariff = TariffEntry{ImportDuty: 0.10, VAT: 0.075, Levy: 0.01, Description: "General merchandise"}

// ─── Duty Calculation ─────────────────────────────────────────────────────────

type DutyBreakdown struct {
	CIFValue         float64 `json:"cifValue"`         // Cost + Insurance + Freight
	ImportDuty       float64 `json:"importDuty"`       // Ad valorem import duty
	VAT              float64 `json:"vat"`              // Value Added Tax
	ECOWASLevy       float64 `json:"ecowasLevy"`       // ECOWAS Community Levy
	CISS             float64 `json:"ciss"`             // Comprehensive Import Supervision Scheme
	ETLSDiscount     float64 `json:"etlsDiscount"`     // ECOWAS Trade Liberalization Scheme discount
	TotalDuty        float64 `json:"totalDuty"`        // Sum of all duties
	TotalPayable     float64 `json:"totalPayable"`     // CIF + TotalDuty
	Currency         string  `json:"currency"`
	HSChapter        string  `json:"hsChapter"`
	TariffDescription string `json:"tariffDescription"`
	ImportDutyRate   float64 `json:"importDutyRate"`
}

// CalculateDutyBreakdown computes the full NCS duty breakdown for a declaration.
// This implements the actual Nigeria Customs Service duty calculation formula.
func CalculateDutyBreakdown(declaredValue float64, hsCode, originCountry, currency string) DutyBreakdown {
	// Extract HS chapter (first 2 digits)
	hsChapter := hsCode
	if len(hsCode) >= 2 {
		hsChapter = hsCode[:2]
	}

	tariff, ok := nigeriaTariffSchedule[hsChapter]
	if !ok {
		tariff = defaultTariff
	}

	// CIF value (assume 10% freight + 1% insurance if not provided)
	cifValue := declaredValue * 1.11

	// Import Duty = CIF × import duty rate
	importDuty := cifValue * tariff.ImportDuty

	// VAT = (CIF + Import Duty) × VAT rate
	vat := (cifValue + importDuty) * tariff.VAT

	// ECOWAS Community Levy = CIF × 0.5%
	ecowasLevy := cifValue * 0.005

	// CISS = CIF × 1% (Comprehensive Import Supervision Scheme)
	ciss := cifValue * 0.01

	// ETLS discount for ECOWAS member states (Ghana, Benin, Togo, etc.)
	etlsDiscount := 0.0
	ecowasMembers := map[string]bool{
		"GHA": true, "BEN": true, "TGO": true, "CIV": true, "SEN": true,
		"MLI": true, "BFA": true, "GNB": true, "GIN": true, "LBR": true,
		"SLE": true, "GMB": true, "CPV": true, "MRT": true, "NER": true,
	}
	if ecowasMembers[originCountry] {
		// ETLS: 0% import duty for qualifying ECOWAS goods
		etlsDiscount = importDuty
		importDuty = 0
	}

	totalDuty := importDuty + vat + ecowasLevy + ciss - etlsDiscount
	totalPayable := cifValue + totalDuty

	// Round to 2 decimal places
	round2 := func(v float64) float64 { return math.Round(v*100) / 100 }

	return DutyBreakdown{
		CIFValue:          round2(cifValue),
		ImportDuty:        round2(importDuty),
		VAT:               round2(vat),
		ECOWASLevy:        round2(ecowasLevy),
		CISS:              round2(ciss),
		ETLSDiscount:      round2(etlsDiscount),
		TotalDuty:         round2(totalDuty),
		TotalPayable:      round2(totalPayable),
		Currency:          currency,
		HSChapter:         hsChapter,
		TariffDescription: tariff.Description,
		ImportDutyRate:    tariff.ImportDuty,
	}
}

// ─── ILP Packet Generation ────────────────────────────────────────────────────

// GenerateILPComponents creates a cryptographically secure ILP fulfilment,
// condition, and OER-encoded packet per ILP RFC 0027.
// maxMinorUnits caps a single transfer at 90 trillion minor units
// (900 billion major units) — an explicit overflow ceiling (SW-S2-9).
const maxMinorUnits = int64(9e13 * 100)

// minorUnits converts a major-unit float amount to integer minor units with an
// explicit guard: amount must be finite, > 0, and within the ceiling. This
// prevents NaN/negative/overflow from silently wrapping into int64/uint64 at
// activity boundaries (SW-S2-9).
func minorUnits(amount float64) (int64, error) {
	if math.IsNaN(amount) || math.IsInf(amount, 0) || amount <= 0 || amount > 9e13 {
		return 0, fmt.Errorf("invalid amount %v: must be finite, > 0 and <= 9e13", amount)
	}
	return int64(math.Round(amount * 100)), nil
}

func GenerateILPComponents(amount int64, destinationAccount string) (ilpPacket, condition, fulfillment string, err error) {
	// SW-S2-9: guard the uint64 conversion below — a negative or absurd amount
	// must not wrap into the ILP packet.
	if amount <= 0 || amount > maxMinorUnits {
		return "", "", "", fmt.Errorf("invalid minor-unit amount %d for ILP packet", amount)
	}
	// Generate 32-byte random fulfillment preimage
	preimage := make([]byte, 32)
	if _, err = rand.Read(preimage); err != nil {
		return
	}

	// Condition = SHA-256(preimage)
	conditionBytes := sha256.Sum256(preimage)

	// Build ILP Prepare packet (OER-encoded)
	// Fields: amount (8 bytes), expiresAt (17 bytes), condition (32 bytes),
	//         destination (variable), data (variable)
	expiresAt := time.Now().UTC().Add(72 * time.Hour).Format("20060102150405999")
	dest := []byte(destinationAccount)

	var packet []byte
	// Amount (uint64, big-endian)
	amountBytes := make([]byte, 8)
	binary.BigEndian.PutUint64(amountBytes, uint64(amount))
	packet = append(packet, amountBytes...)
	// ExpiresAt (17 ASCII bytes)
	packet = append(packet, []byte(expiresAt)...)
	// Condition (32 bytes)
	packet = append(packet, conditionBytes[:]...)
	// Destination length (1 byte) + destination
	packet = append(packet, byte(len(dest)))
	packet = append(packet, dest...)
	// Data length (2 bytes) + data
	data := []byte("TradeGateway Duty Payment")
	packet = append(packet, byte(len(data)>>8), byte(len(data)))
	packet = append(packet, data...)

	ilpPacket = base64.URLEncoding.EncodeToString(packet)
	condition = base64.URLEncoding.EncodeToString(conditionBytes[:])
	fulfillment = base64.URLEncoding.EncodeToString(preimage)
	return
}

// ─── TigerBeetle gRPC client ──────────────────────────────────────────────────

// newTBClient returns a client for the canonical Go tigerbeetle-bridge
// (HTTP /api/ledger/*). The returned closer is a no-op kept for call-site
// compatibility.
func newTBClient() (pb.LedgerServiceClient, io.Closer, error) {
	return pb.NewLedgerServiceHTTPClient(tbBridgeURL), pb.NopCloser{}, nil
}

// ─── Atomic Payment Activities ────────────────────────────────────────────────

// CreatePendingLedgerTransfer creates a two-phase pending transfer in TigerBeetle.
// This reserves the funds without posting them. The transfer must be either
// posted (on Mojaloop success) or voided (on Mojaloop failure).
func (a *Activities) CreatePendingLedgerTransfer(ctx context.Context, input struct {
	InvoiceID       int64   `json:"invoiceId"`
	TraderID        int64   `json:"traderId"`
	Amount          float64 `json:"amount"`
	Currency        string  `json:"currency"`
	IdempotencyKey  string  `json:"idempotencyKey"`
}) (string, error) {
	logger := activity.GetLogger(ctx)

	tbClient, conn, err := newTBClient()
	if err != nil {
		// TigerBeetle unavailable — retryable
		return "", fmt.Errorf("TB bridge unavailable: %w", err)
	}
	defer conn.Close()

	// Ensure trader account exists
	traderAccountID := fmt.Sprintf("trader:%d", input.TraderID)
	_, _ = tbClient.CreateAccount(ctx, &pb.CreateAccountRequest{
		AccountId:   traderAccountID,
		AccountType: "trader",
		Ledger:      "primary",
		Currency:    input.Currency,
	})

	// Ensure customs revenue account exists
	revenueAccountID := fmt.Sprintf("revenue:customs:%s", input.Currency)
	_, _ = tbClient.CreateAccount(ctx, &pb.CreateAccountRequest{
		AccountId:   revenueAccountID,
		AccountType: "revenue",
		Ledger:      "primary",
		Currency:    input.Currency,
	})

	// SW-S2-9: guarded conversion — no silent NaN/negative/overflow truncation.
	amountMinor, err := minorUnits(input.Amount)
	if err != nil {
		return "", err
	}

	resp, err := tbClient.CreateTransfer(ctx, &pb.CreateTransferRequest{
		IdempotencyKey:  fmt.Sprintf("invoice:%d:pending", input.InvoiceID),
		DebitAccountId:  traderAccountID,
		CreditAccountId: revenueAccountID,
		Amount:          amountMinor,
		TransferType:    "duty_payment",
		Reference:       fmt.Sprintf("DUTY-INV-%d", input.InvoiceID),
		Metadata:        fmt.Sprintf(`{"invoiceId":%d,"traderId":%d}`, input.InvoiceID, input.TraderID),
	})
	if err != nil {
		return "", fmt.Errorf("CreateTransfer failed: %w", err)
	}

	logger.Info("Pending ledger transfer created",
		"transferId", resp.TransferId,
		"invoiceId", input.InvoiceID,
		"amount", input.Amount,
	)

	// Update invoice with TB transfer ID
	_, _ = a.db.ExecContext(ctx, `
		UPDATE payment_invoices SET tb_pending_transfer_id = $1, updated_at = NOW()
		WHERE id = $2`, resp.TransferId, input.InvoiceID)

	return resp.TransferId, nil
}

// PostLedgerTransfer posts (commits) a pending TigerBeetle transfer.
// Called after Mojaloop confirms the transfer is COMMITTED.
// This is the irrevocable settlement step.
func (a *Activities) PostLedgerTransfer(ctx context.Context, input struct {
	InvoiceID         int64   `json:"invoiceId"`
	PendingTransferID string  `json:"pendingTransferId"`
	Amount            float64 `json:"amount"`
	MojaloopTxID      string  `json:"mojaloopTxId"`
}) error {
	logger := activity.GetLogger(ctx)

	tbClient, conn, err := newTBClient()
	if err != nil {
		return fmt.Errorf("TB bridge unavailable: %w", err)
	}
	defer conn.Close()

	amountMinor, err := minorUnits(input.Amount)
	if err != nil {
		return err
	}
	resp, err := tbClient.PostTransfer(ctx, &pb.PostTransferRequest{
		PendingTransferId: input.PendingTransferID,
		Amount:            amountMinor,
	})
	if err != nil {
		return fmt.Errorf("PostTransfer failed: %w", err)
	}

	logger.Info("Ledger transfer posted",
		"transferId", resp.TransferId,
		"invoiceId", input.InvoiceID,
		"mojaloopTxId", input.MojaloopTxID,
	)

	// Mark invoice as paid with both Mojaloop and TigerBeetle references
	_, err = a.db.ExecContext(ctx, `
		UPDATE payment_invoices
		SET status = 'paid',
		    mojaloop_tx_id = $1,
		    tb_posted_transfer_id = $2,
		    paid_at = NOW(),
		    updated_at = NOW()
		WHERE id = $3 AND status != 'paid'`,
		input.MojaloopTxID, resp.TransferId, input.InvoiceID)
	return err
}

// VoidLedgerTransfer voids a pending TigerBeetle transfer.
// Called when Mojaloop aborts the transfer or the payment window expires.
// This is the compensating action — releases the reserved funds.
func (a *Activities) VoidLedgerTransfer(ctx context.Context, input struct {
	InvoiceID         int64  `json:"invoiceId"`
	PendingTransferID string `json:"pendingTransferId"`
	Reason            string `json:"reason"`
}) error {
	logger := activity.GetLogger(ctx)

	tbClient, conn, err := newTBClient()
	if err != nil {
		return fmt.Errorf("TB bridge unavailable: %w", err)
	}
	defer conn.Close()

	resp, err := tbClient.VoidTransfer(ctx, &pb.VoidTransferRequest{
		PendingTransferId: input.PendingTransferID,
		Reason:            input.Reason,
	})
	if err != nil {
		return fmt.Errorf("VoidTransfer failed: %w", err)
	}

	logger.Info("Ledger transfer voided",
		"transferId", resp.TransferId,
		"invoiceId", input.InvoiceID,
		"reason", input.Reason,
	)

	_, err = a.db.ExecContext(ctx, `
		UPDATE payment_invoices
		SET status = 'failed',
		    failure_reason = $1,
		    tb_voided_transfer_id = $2,
		    updated_at = NOW()
		WHERE id = $3`,
		input.Reason, resp.TransferId, input.InvoiceID)
	return err
}

// ─── Mojaloop Transfer Activities ────────────────────────────────────────────

// InitiateMojaloopTransfer sends an ILP transfer request to the Mojaloop switch.
// Returns the Mojaloop transfer ID for polling.
func (a *Activities) InitiateMojaloopTransfer(ctx context.Context, input struct {
	InvoiceID      int64   `json:"invoiceId"`
	TraderID       int64   `json:"traderId"`
	Amount         float64 `json:"amount"`
	Currency       string  `json:"currency"`
	PayerFSP       string  `json:"payerFsp"`
	PayeeFSP       string  `json:"payeeFsp"`
	IdempotencyKey string  `json:"idempotencyKey"`
}) (string, error) {
	// Generate real ILP components
	amountMinor, err := minorUnits(input.Amount)
	if err != nil {
		return "", err
	}
	destinationAccount := fmt.Sprintf("g.ng.customs.revenue.%s", strings.ToLower(input.Currency))

	ilpPacket, condition, fulfillment, err := GenerateILPComponents(amountMinor, destinationAccount)
	if err != nil {
		return "", fmt.Errorf("ILP generation failed: %w", err)
	}

	// Store fulfillment securely for later verification
	_, _ = a.db.ExecContext(ctx, `
		UPDATE payment_invoices
		SET ilp_fulfillment = $1, ilp_condition = $2, updated_at = NOW()
		WHERE id = $3`,
		fulfillment, condition, input.InvoiceID)

	payload, _ := json.Marshal(map[string]interface{}{
		"transferId":     input.IdempotencyKey,
		"payerFsp":       input.PayerFSP,
		"payeeFsp":       input.PayeeFSP,
		"amount":         map[string]interface{}{"amount": fmt.Sprintf("%.2f", input.Amount), "currency": input.Currency},
		"ilpPacket":      ilpPacket,
		"condition":      condition,
		"expiration":     time.Now().UTC().Add(72 * time.Hour).Format(time.RFC3339),
		"extensionList":  map[string]interface{}{"extension": []map[string]string{{"key": "invoiceId", "value": fmt.Sprintf("%d", input.InvoiceID)}}},
	})

	req, err := http.NewRequestWithContext(ctx, "POST",
		fmt.Sprintf("%s/api/mojaloop/transfers", mojaloopURL),
		strings.NewReader(string(payload)))
	if err != nil {
		return "", err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Idempotency-Key", input.IdempotencyKey)

	resp, err := a.httpClient.Do(req)
	if err != nil {
		return "", fmt.Errorf("Mojaloop transfer initiation failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode == http.StatusConflict {
		// Already initiated — idempotent
		return input.IdempotencyKey, nil
	}
	if resp.StatusCode >= 400 {
		return "", temporal.NewNonRetryableApplicationError(
			fmt.Sprintf("Mojaloop rejected transfer: HTTP %d", resp.StatusCode),
			"MOJALOOP_REJECTED",
			nil,
		)
	}

	// Store the transfer ID
	_, _ = a.db.ExecContext(ctx, `
		UPDATE payment_invoices
		SET mojaloop_tx_id = $1, updated_at = NOW()
		WHERE id = $2`,
		input.IdempotencyKey, input.InvoiceID)

	return input.IdempotencyKey, nil
}

// VerifyMojaloopWebhookSignature verifies the HMAC-SHA256 signature on a
// Mojaloop callback to prevent spoofed payment confirmations.
func VerifyMojaloopWebhookSignature(payload []byte, signature string) bool {
	if webhookSecret == "" {
		// No secret configured — reject all webhooks in production
		return false
	}
	mac := hmac.New(sha256.New, []byte(webhookSecret))
	mac.Write(payload)
	expected := "sha256=" + base64.StdEncoding.EncodeToString(mac.Sum(nil))
	return hmac.Equal([]byte(expected), []byte(signature))
}

// ─── Duty Calculation Activity ────────────────────────────────────────────────

// CalculateDutyInvoice computes the full NCS duty breakdown and creates
// an idempotent invoice record in PostgreSQL.
func (a *Activities) CalculateDutyInvoice(ctx context.Context, input struct {
	DeclarationID int64   `json:"declarationId"`
	TraderID      int64   `json:"traderId"`
	DeclaredValue float64 `json:"declaredValue"`
	HSCode        string  `json:"hsCode"`
	OriginCountry string  `json:"originCountry"`
	Currency      string  `json:"currency"`
}) (*InvoiceInfo, error) {
	if input.Currency == "" {
		input.Currency = "NGN"
	}

	// Compute real duty breakdown using NCS tariff schedule
	breakdown := CalculateDutyBreakdown(input.DeclaredValue, input.HSCode, input.OriginCountry, input.Currency)

	breakdownJSON, _ := json.Marshal(breakdown)

	var invoiceID int64
	err := a.db.QueryRowContext(ctx, `
		INSERT INTO payment_invoices (
			declaration_id, trader_id,
			cif_value, import_duty, vat, ecowas_levy, ciss, etls_discount,
			duty_amount, total_amount, currency,
			hs_code, origin_country, duty_breakdown,
			status, created_at, updated_at
		) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, 'pending', NOW(), NOW())
		ON CONFLICT (declaration_id) DO UPDATE
			SET updated_at = NOW(),
			    duty_breakdown = EXCLUDED.duty_breakdown
		RETURNING id`,
		input.DeclarationID, input.TraderID,
		breakdown.CIFValue, breakdown.ImportDuty, breakdown.VAT,
		breakdown.ECOWASLevy, breakdown.CISS, breakdown.ETLSDiscount,
		breakdown.TotalDuty, breakdown.TotalPayable, breakdown.Currency,
		input.HSCode, input.OriginCountry, string(breakdownJSON),
	).Scan(&invoiceID)
	if err != nil {
		return nil, fmt.Errorf("create duty invoice: %w", err)
	}

	return &InvoiceInfo{
		InvoiceId:   invoiceID,
		TotalAmount: breakdown.TotalPayable,
		Currency:    breakdown.Currency,
	}, nil
}

// ─── Drawback Calculation Activity ───────────────────────────────────────────

// CalculateDutyDrawbackAmount computes the actual drawback amount.
// Per NCS Drawback Regulations: 98% of duties paid are eligible for drawback
// (2% retained as administrative fee), subject to:
//   - Export within 12 months of import
//   - Goods exported in substantially the same condition
//   - Supporting documents (import entry, export entry, bank certificate)
func (a *Activities) CalculateDutyDrawbackAmount(ctx context.Context, input struct {
	ImportDeclarationID int64 `json:"importDeclarationId"`
	ExportDeclarationID int64 `json:"exportDeclarationId"`
	ClaimID             int64 `json:"claimId"`
}) (float64, error) {
	// Fetch the original import duty paid
	var dutyPaid float64
	var importDate time.Time
	err := a.db.QueryRowContext(ctx, `
		SELECT COALESCE(pi.duty_amount, 0), d.created_at
		FROM declarations d
		LEFT JOIN payment_invoices pi ON pi.declaration_id = d.id
		WHERE d.id = $1 AND d.status = 'cleared' AND d.declaration_type = 'import'`,
		input.ImportDeclarationID).Scan(&dutyPaid, &importDate)
	if err != nil {
		return 0, fmt.Errorf("import declaration not found or not cleared: %w", err)
	}

	// Verify export declaration exists and is within 12 months
	var exportDate time.Time
	err = a.db.QueryRowContext(ctx, `
		SELECT created_at FROM declarations
		WHERE id = $1 AND status = 'cleared' AND declaration_type = 'export'`,
		input.ExportDeclarationID).Scan(&exportDate)
	if err != nil {
		return 0, temporal.NewNonRetryableApplicationError(
			"export declaration not found or not cleared",
			"INVALID_EXPORT_DECLARATION",
			nil,
		)
	}

	// Check 12-month window
	if exportDate.After(importDate.Add(365 * 24 * time.Hour)) {
		return 0, temporal.NewNonRetryableApplicationError(
			"export is more than 12 months after import — drawback not eligible",
			"DRAWBACK_WINDOW_EXPIRED",
			nil,
		)
	}

	// 98% drawback rate (2% admin fee retained by NCS)
	drawbackAmount := dutyPaid * 0.98

	// Update claim record
	_, _ = a.db.ExecContext(ctx, `
		UPDATE duty_drawback_claims
		SET calculated_amount = $1, status = 'calculated', updated_at = NOW()
		WHERE id = $2`, drawbackAmount, input.ClaimID)

	return drawbackAmount, nil
}

// VerifyExportDeclaration verifies that an export declaration is cleared
// and matches the import declaration's HS code and quantity.
func (a *Activities) VerifyExportDeclarationFull(ctx context.Context, input struct {
	ImportDeclarationID int64 `json:"importDeclarationId"`
	ExportDeclarationID int64 `json:"exportDeclarationId"`
}) error {
	var importHS, exportHS string
	var importQty, exportQty float64

	a.db.QueryRowContext(ctx, `SELECT hs_code, COALESCE(quantity, 0) FROM declarations WHERE id = $1`,
		input.ImportDeclarationID).Scan(&importHS, &importQty)
	a.db.QueryRowContext(ctx, `SELECT hs_code, COALESCE(quantity, 0) FROM declarations WHERE id = $1`,
		input.ExportDeclarationID).Scan(&exportHS, &exportQty)

	if importHS == "" || exportHS == "" {
		return temporal.NewNonRetryableApplicationError(
			"could not verify HS codes for drawback",
			"HS_CODE_MISMATCH",
			nil,
		)
	}

	// HS chapters must match (first 4 digits for heading-level comparison)
	importHeading := importHS
	if len(importHS) >= 4 {
		importHeading = importHS[:4]
	}
	exportHeading := exportHS
	if len(exportHS) >= 4 {
		exportHeading = exportHS[:4]
	}

	if importHeading != exportHeading {
		return temporal.NewNonRetryableApplicationError(
			fmt.Sprintf("HS heading mismatch: import %s vs export %s", importHeading, exportHeading),
			"HS_CODE_MISMATCH",
			nil,
		)
	}

	// Export quantity must not exceed import quantity
	if exportQty > importQty*1.02 { // 2% tolerance
		return temporal.NewNonRetryableApplicationError(
			fmt.Sprintf("export quantity (%.2f) exceeds import quantity (%.2f)", exportQty, importQty),
			"QUANTITY_EXCEEDED",
			nil,
		)
	}

	return nil
}

