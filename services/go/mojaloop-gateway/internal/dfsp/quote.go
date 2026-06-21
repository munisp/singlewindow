// TradeGateway NGSWTP — Mojaloop FSPIOP Quote Request Builder
// Language: Go 1.23
// Implements POST /quotes per Mojaloop API v1.1 spec.
// Signs every outbound request with FSPIOP-Signature (JWS).
// Stores quoteId → ILP condition correlation in pendingILP map.
package dfsp

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"sync"
	"time"

	"github.com/google/uuid"
	"go.uber.org/zap"
)

// ─── Quote domain types ───────────────────────────────────────────────────────

// Money represents a Mojaloop monetary amount.
type Money struct {
	Amount   string `json:"amount"`
	Currency string `json:"currency"`
}

// Party represents a Mojaloop party (payer or payee).
type Party struct {
	PartyIdInfo PartyIdInfo `json:"partyIdInfo"`
	Name        string      `json:"name,omitempty"`
}

// PartyIdInfo holds the party identifier.
type PartyIdInfo struct {
	PartyIdType     string `json:"partyIdType"`
	PartyIdentifier string `json:"partyIdentifier"`
	FspId           string `json:"fspId"`
}

// QuoteRequest is the FSPIOP POST /quotes request body.
type QuoteRequest struct {
	QuoteId           string    `json:"quoteId"`
	TransactionId     string    `json:"transactionId"`
	TransactionType   TxType    `json:"transactionType"`
	Payer             Party     `json:"payer"`
	Payee             Party     `json:"payee"`
	AmountType        string    `json:"amountType"` // SEND | RECEIVE
	Amount            Money     `json:"amount"`
	Note              string    `json:"note,omitempty"`
	Expiration        string    `json:"expiration,omitempty"`
}

// TxType describes the Mojaloop transaction type.
type TxType struct {
	Scenario    string `json:"scenario"`    // TRANSFER | PAYMENT | DEPOSIT | WITHDRAWAL | REFUND
	SubScenario string `json:"subScenario,omitempty"`
	Initiator   string `json:"initiator"`   // PAYER | PAYEE
	InitiatorType string `json:"initiatorType"` // CONSUMER | AGENT | BUSINESS | DEVICE
}

// QuoteResult stores the outcome of a quote request for correlation.
type QuoteResult struct {
	QuoteId       string
	TransactionId string
	SentAt        time.Time
}

// ─── QuoteBuilder ─────────────────────────────────────────────────────────────

// QuoteBuilder sends FSPIOP quote requests and tracks pending correlations.
type QuoteBuilder struct {
	logger        *zap.Logger
	signer        *Signer
	hubBaseURL    string
	dfspID        string
	httpClient    *http.Client

	mu            sync.Mutex
	pendingQuotes map[string]*QuoteResult // quoteId → result
}

// NewQuoteBuilder creates a new QuoteBuilder.
func NewQuoteBuilder(hubBaseURL, dfspID string, signer *Signer, logger *zap.Logger) *QuoteBuilder {
	return &QuoteBuilder{
		logger:        logger,
		signer:        signer,
		hubBaseURL:    hubBaseURL,
		dfspID:        dfspID,
		httpClient:    &http.Client{Timeout: 30 * time.Second},
		pendingQuotes: make(map[string]*QuoteResult),
	}
}

// PostQuoteRequest sends a POST /quotes request to the Mojaloop Hub.
// It generates a new quoteId (UUID v4), signs the request with FSPIOP-Signature,
// and stores the quoteId → transactionId correlation for callback matching.
//
// Returns the generated QuoteRequest so the caller can track the quoteId.
func (qb *QuoteBuilder) PostQuoteRequest(ctx context.Context, input PostQuoteInput) (*QuoteRequest, error) {
	quoteID := uuid.New().String()
	expiration := time.Now().UTC().Add(30 * time.Minute).Format(time.RFC3339Nano)

	req := &QuoteRequest{
		QuoteId:       quoteID,
		TransactionId: input.TransactionId,
		TransactionType: TxType{
			Scenario:      input.Scenario,
			SubScenario:   input.SubScenario,
			Initiator:     "PAYER",
			InitiatorType: "BUSINESS",
		},
		Payer: Party{
			PartyIdInfo: PartyIdInfo{
				PartyIdType:     "BUSINESS",
				PartyIdentifier: input.PayerIdentifier,
				FspId:           qb.dfspID,
			},
			Name: input.PayerName,
		},
		Payee: Party{
			PartyIdInfo: PartyIdInfo{
				PartyIdType:     input.PayeeIdType,
				PartyIdentifier: input.PayeeIdentifier,
				FspId:           input.PayeeFspId,
			},
			Name: input.PayeeName,
		},
		AmountType: "SEND",
		Amount: Money{
			Amount:   input.Amount,
			Currency: input.Currency,
		},
		Note:       input.Note,
		Expiration: expiration,
	}

	body, err := json.Marshal(req)
	if err != nil {
		return nil, fmt.Errorf("marshal quote request: %w", err)
	}

	httpReq, err := http.NewRequestWithContext(ctx, http.MethodPost, qb.hubBaseURL+"/quotes", bytes.NewReader(body))
	if err != nil {
		return nil, fmt.Errorf("build http request: %w", err)
	}

	// Set FSPIOP headers
	now := time.Now().UTC().Format(http.TimeFormat)
	httpReq.Header.Set("Content-Type", "application/vnd.interoperability.quotes+json;version=1.0")
	httpReq.Header.Set("Accept", "application/vnd.interoperability.quotes+json;version=1.0")
	httpReq.Header.Set("FSPIOP-Source", qb.dfspID)
	httpReq.Header.Set("FSPIOP-Destination", input.PayeeFspId)
	httpReq.Header.Set("Date", now)

	// Sign with JWS
	if qb.signer != nil {
		if err := qb.signer.SignRequest(httpReq, body); err != nil {
			return nil, fmt.Errorf("sign quote request: %w", err)
		}
	}

	resp, err := qb.httpClient.Do(httpReq)
	if err != nil {
		return nil, fmt.Errorf("post quote request: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusAccepted && resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("hub rejected quote: HTTP %d", resp.StatusCode)
	}

	// Store correlation: quoteId → transactionId
	qb.mu.Lock()
	qb.pendingQuotes[quoteID] = &QuoteResult{
		QuoteId:       quoteID,
		TransactionId: input.TransactionId,
		SentAt:        time.Now().UTC(),
	}
	qb.mu.Unlock()

	qb.logger.Info("quote request sent",
		zap.String("quoteId", quoteID),
		zap.String("transactionId", input.TransactionId),
		zap.String("amount", input.Amount),
		zap.String("currency", input.Currency),
	)

	return req, nil
}

// GetPendingQuote retrieves the pending quote result for a given quoteId.
// Returns nil if not found (already resolved or expired).
func (qb *QuoteBuilder) GetPendingQuote(quoteID string) *QuoteResult {
	qb.mu.Lock()
	defer qb.mu.Unlock()
	return qb.pendingQuotes[quoteID]
}

// ResolvePendingQuote removes a quoteId from the pending map after callback.
func (qb *QuoteBuilder) ResolvePendingQuote(quoteID string) {
	qb.mu.Lock()
	defer qb.mu.Unlock()
	delete(qb.pendingQuotes, quoteID)
}

// PendingCount returns the number of unresolved pending quotes.
func (qb *QuoteBuilder) PendingCount() int {
	qb.mu.Lock()
	defer qb.mu.Unlock()
	return len(qb.pendingQuotes)
}

// ─── Input type ───────────────────────────────────────────────────────────────

// PostQuoteInput is the caller-facing input for PostQuoteRequest.
type PostQuoteInput struct {
	TransactionId   string
	Scenario        string // TRANSFER | PAYMENT | DEPOSIT | WITHDRAWAL | REFUND
	SubScenario     string
	PayerIdentifier string
	PayerName       string
	PayeeIdType     string // MSISDN | ACCOUNT_ID | BUSINESS | IBAN | ALIAS
	PayeeIdentifier string
	PayeeFspId      string
	PayeeName       string
	Amount          string // decimal string e.g. "1500.00"
	Currency        string // ISO 4217 e.g. "NGN"
	Note            string
}
