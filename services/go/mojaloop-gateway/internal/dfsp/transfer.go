// TradeGateway NGSWTP — Mojaloop FSPIOP Transfer Request Builder
// Language: Go 1.25
// Implements POST /transfers per Mojaloop API v1.1 spec (the "prepare" leg).
// Signs every outbound request with FSPIOP-Signature (JWS) — an unsigned
// money-movement request is NEVER sent (fail-closed on signing failure).
package dfsp

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"time"

	"github.com/google/uuid"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/trace"
	"go.uber.org/zap"

	"github.com/tradegateway/mojaloop-gateway/internal/telemetry"
)

// TransferRequest is the FSPIOP POST /transfers request body (prepare leg).
type TransferRequest struct {
	TransferID string `json:"transferId"`
	PayerFsp   string `json:"payerFsp"`
	PayeeFsp   string `json:"payeeFsp"`
	Amount     Money  `json:"amount"`
	ILPPacket  string `json:"ilpPacket"`
	Condition  string `json:"condition"`
	Expiration string `json:"expiration"`
}

// TransferBuilder sends FSPIOP transfer prepare requests.
type TransferBuilder struct {
	logger     *zap.Logger
	signer     *Signer
	hubBaseURL string
	dfspID     string
	httpClient *http.Client
}

// NewTransferBuilder creates a new TransferBuilder. signer must be non-nil:
// money-movement requests are never sent unsigned.
func NewTransferBuilder(hubBaseURL, dfspID string, signer *Signer, logger *zap.Logger) (*TransferBuilder, error) {
	if signer == nil {
		return nil, fmt.Errorf("transfer builder requires an FSPIOP signer")
	}
	return &TransferBuilder{
		logger:     logger,
		signer:     signer,
		hubBaseURL: hubBaseURL,
		dfspID:     dfspID,
		httpClient: &http.Client{Timeout: 30 * time.Second, Transport: telemetry.Transport(nil)},
	}, nil
}

// PostTransferInput is the caller-facing input for PostTransfer.
type PostTransferInput struct {
	// TransferID optionally pre-assigns the payer-DFSP transfer id (a UUID).
	// Callers that must register a callback waiter before the request goes on
	// the wire generate the id themselves and pass it here.
	TransferID string
	PayeeFspId string
	Amount     string // decimal string e.g. "1500.00"
	Currency   string
	ILPPacket  string
	Condition  string
	Expiration time.Time
}

// PostTransfer sends POST /transfers to the Mojaloop Hub. Returns the real
// payer-DFSP-assigned transferId (a UUID v4 generated here unless
// input.TransferID is set).
func (tb *TransferBuilder) PostTransfer(ctx context.Context, input PostTransferInput) (string, error) {
	tracer := otel.Tracer("mojaloop-gateway")
	ctx, span := tracer.Start(ctx, "mojaloop.transfers.prepare",
		trace.WithSpanKind(trace.SpanKindClient),
	)
	defer span.End()

	transferID := input.TransferID
	if transferID == "" {
		transferID = uuid.New().String()
	}
	span.SetAttributes(
		attribute.String("mojaloop.correlation_id", transferID),
		attribute.String("fspiop.source", tb.dfspID),
		attribute.String("fspiop.destination", input.PayeeFspId),
		attribute.String("payment.amount", input.Amount),
		attribute.String("payment.currency", input.Currency),
	)

	req := &TransferRequest{
		TransferID: transferID,
		PayerFsp:   tb.dfspID,
		PayeeFsp:   input.PayeeFspId,
		Amount:     Money{Amount: input.Amount, Currency: input.Currency},
		ILPPacket:  input.ILPPacket,
		Condition:  input.Condition,
		Expiration: input.Expiration.UTC().Format(time.RFC3339Nano),
	}
	body, err := json.Marshal(req)
	if err != nil {
		return "", fmt.Errorf("marshal transfer request: %w", err)
	}

	httpReq, err := http.NewRequestWithContext(ctx, http.MethodPost, tb.hubBaseURL+"/transfers", bytes.NewReader(body))
	if err != nil {
		return "", fmt.Errorf("build http request: %w", err)
	}
	httpReq.Header.Set("Content-Type", "application/vnd.interoperability.transfers+json;version=1.0")
	httpReq.Header.Set("Accept", "application/vnd.interoperability.transfers+json;version=1.0")
	httpReq.Header.Set("FSPIOP-Source", tb.dfspID)
	httpReq.Header.Set("FSPIOP-Destination", input.PayeeFspId)
	httpReq.Header.Set("Date", time.Now().UTC().Format(http.TimeFormat))

	// Fail-closed: a signing failure means the transfer is NOT sent.
	_, signSpan := tracer.Start(ctx, "fspiop.jws.sign")
	if err := tb.signer.SignRequest(httpReq, input.PayeeFspId, body); err != nil {
		signSpan.RecordError(err)
		signSpan.End()
		span.RecordError(err)
		return "", fmt.Errorf("sign transfer request (fail-closed, transfer NOT sent): %w", err)
	}
	signSpan.End()

	resp, err := tb.httpClient.Do(httpReq)
	if err != nil {
		span.RecordError(err)
		return "", fmt.Errorf("post transfer request: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusAccepted && resp.StatusCode != http.StatusOK {
		err := fmt.Errorf("hub rejected transfer: HTTP %d", resp.StatusCode)
		span.RecordError(err)
		return "", err
	}

	tb.logger.Info("transfer prepare sent",
		zap.String("transferId", transferID),
		zap.String("amount", input.Amount),
		zap.String("currency", input.Currency),
	)
	return transferID, nil
}
