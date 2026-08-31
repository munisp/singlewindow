// Package ledger provides the TigerBeetle ledger client used by the Temporal
// payment activities.
//
// Phase-6 remediation: the original code imported a generated
// github.com/tradegateway/temporal-worker/proto/ledger gRPC package that was
// NEVER generated or committed — the worker did not compile at all. Per the
// platform's canonical ledger contract, the TigerBeetle bridge is the Go
// bridge serving HTTP /api/ledger/* behind the k8s Service
// `tigerbeetle-bridge` (port 8086). This package therefore implements the
// client surface the activities need over that canonical HTTP dialect.
//
// Amounts are integer minor units end-to-end.
package ledger

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

// ─── Request/response types (surface preserved from the original design) ────

type CreateAccountRequest struct {
	AccountId   string
	AccountType string
	Ledger      string
	Currency    string
}

type CreateAccountResponse struct {
	AccountId string
}

type CreateTransferRequest struct {
	IdempotencyKey  string
	DebitAccountId  string
	CreditAccountId string
	Amount          int64 // integer minor units
	TransferType    string
	Reference       string
	Metadata        string
}

type CreateTransferResponse struct {
	TransferId string
}

type PostTransferRequest struct {
	PendingTransferId string
	Amount            int64 // integer minor units
}

type PostTransferResponse struct {
	TransferId string
}

type VoidTransferRequest struct {
	PendingTransferId string
	Reason            string
}

type VoidTransferResponse struct {
	TransferId string
}

// ─── Client ─────────────────────────────────────────────────────────────────

type LedgerServiceClient interface {
	CreateAccount(ctx context.Context, req *CreateAccountRequest) (*CreateAccountResponse, error)
	CreateTransfer(ctx context.Context, req *CreateTransferRequest) (*CreateTransferResponse, error)
	PostTransfer(ctx context.Context, req *PostTransferRequest) (*PostTransferResponse, error)
	VoidTransfer(ctx context.Context, req *VoidTransferRequest) (*VoidTransferResponse, error)
}

type httpClient struct {
	baseURL string
	http    *http.Client
}

// NewLedgerServiceHTTPClient returns a client for the canonical Go
// tigerbeetle-bridge HTTP service (/api/ledger/*).
func NewLedgerServiceHTTPClient(baseURL string) LedgerServiceClient {
	baseURL = strings.TrimSuffix(baseURL, "/")
	if !strings.HasPrefix(baseURL, "http://") && !strings.HasPrefix(baseURL, "https://") {
		baseURL = "http://" + baseURL
	}
	return &httpClient{
		baseURL: baseURL,
		http:    &http.Client{Timeout: 15 * time.Second},
	}
}

// NopCloser lets callers keep their `defer conn.Close()` pattern without a
// real connection.
type NopCloser struct{}

func (NopCloser) Close() error { return nil }

type bridgeAccountReq struct {
	ID          string `json:"id"`
	Ledger      uint32 `json:"ledger"`
	Code        uint16 `json:"code"`
	AccountType string `json:"accountType"`
	Description string `json:"description"`
	Currency    string `json:"currency"`
}

type bridgeTransferReq struct {
	DebitAccountID  string `json:"debitAccountId"`
	CreditAccountID string `json:"creditAccountId"`
	Amount          string `json:"amount"` // decimal major units, exact
	Currency        string `json:"currency"`
	Reference       string `json:"reference,omitempty"`
	Description     string `json:"description,omitempty"`
}

type bridgeTransferResp struct {
	ID     string `json:"id"`
	Status string `json:"status"`
}

// minorToDecimal renders integer minor units as an exact decimal string.
func minorToDecimal(minor int64) string {
	sign := ""
	if minor < 0 {
		sign = "-"
		minor = -minor
	}
	return fmt.Sprintf("%s%d.%02d", sign, minor/100, minor%100)
}

func (c *httpClient) do(ctx context.Context, method, path string, body interface{}, out interface{}) error {
	var reader io.Reader
	if body != nil {
		data, err := json.Marshal(body)
		if err != nil {
			return err
		}
		reader = bytes.NewReader(data)
	}
	req, err := http.NewRequestWithContext(ctx, method, c.baseURL+path, reader)
	if err != nil {
		return err
	}
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	resp, err := c.http.Do(req)
	if err != nil {
		return fmt.Errorf("ledger bridge unreachable: %w", err)
	}
	defer resp.Body.Close()
	respBody, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if resp.StatusCode >= 300 {
		return fmt.Errorf("ledger bridge returned %d: %s", resp.StatusCode, string(respBody))
	}
	if out != nil && len(respBody) > 0 {
		if err := json.Unmarshal(respBody, out); err != nil {
			return fmt.Errorf("invalid bridge response: %w", err)
		}
	}
	return nil
}

func (c *httpClient) CreateAccount(ctx context.Context, req *CreateAccountRequest) (*CreateAccountResponse, error) {
	// The canonical bridge auto-creates accounts on first transfer; creation
	// is also idempotent server-side (409 = exists).
	var out bridgeTransferResp
	err := c.do(ctx, http.MethodPost, "/api/ledger/accounts", &bridgeAccountReq{
		ID:          req.AccountId,
		Ledger:      1,
		Code:        1,
		AccountType: "TRADER_LIABILITY",
		Description: fmt.Sprintf("%s (%s)", req.AccountId, req.AccountType),
		Currency:    req.Currency,
	}, &out)
	if err != nil {
		// 409 (already exists) is surfaced as an error string — treat as OK.
		if strings.Contains(err.Error(), "returned 409") {
			return &CreateAccountResponse{AccountId: req.AccountId}, nil
		}
		return nil, err
	}
	return &CreateAccountResponse{AccountId: req.AccountId}, nil
}

func (c *httpClient) CreateTransfer(ctx context.Context, req *CreateTransferRequest) (*CreateTransferResponse, error) {
	if req.Amount <= 0 {
		return nil, fmt.Errorf("invalid transfer amount %d minor units", req.Amount)
	}
	var out bridgeTransferResp
	err := c.do(ctx, http.MethodPost, "/api/ledger/transfers/pending", &bridgeTransferReq{
		DebitAccountID:  req.DebitAccountId,
		CreditAccountID: req.CreditAccountId,
		Amount:          minorToDecimal(req.Amount),
		Currency:        "NGN",
		Reference:       req.Reference,
		Description:     req.Metadata,
	}, &out)
	if err != nil {
		return nil, err
	}
	return &CreateTransferResponse{TransferId: out.ID}, nil
}

func (c *httpClient) PostTransfer(ctx context.Context, req *PostTransferRequest) (*PostTransferResponse, error) {
	var out bridgeTransferResp
	err := c.do(ctx, http.MethodPost, "/api/ledger/transfers/post/"+req.PendingTransferId, nil, &out)
	if err != nil {
		return nil, err
	}
	return &PostTransferResponse{TransferId: out.ID}, nil
}

func (c *httpClient) VoidTransfer(ctx context.Context, req *VoidTransferRequest) (*VoidTransferResponse, error) {
	var out bridgeTransferResp
	err := c.do(ctx, http.MethodPost, "/api/ledger/transfers/void/"+req.PendingTransferId, nil, &out)
	if err != nil {
		return nil, err
	}
	return &VoidTransferResponse{TransferId: out.ID}, nil
}
