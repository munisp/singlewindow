// tigerbeetle — TigerBeetle double-entry ledger client for payment-service
// TigerBeetle uses uint128 account/transfer IDs and a binary protocol.
// This package wraps the HTTP admin API for account and transfer operations,
// with a mock fallback for environments where TigerBeetle is not deployed.
package tigerbeetle

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"math/rand"
	"net/http"
	"time"
)

// ── Account ledger codes ──────────────────────────────────────────────────────
const (
	LedgerUSD = 840 // ISO 4217 numeric code
	LedgerGHS = 936 // Ghana Cedi
	LedgerKES = 404 // Kenya Shilling
	LedgerNGN = 566 // Nigerian Naira

	// Account codes (business meaning)
	CodeTraderDeposit  = 1000 // Trader deposit/escrow account
	CodeDutyRevenue    = 2000 // Customs duty revenue account
	CodeVATRevenue     = 2001 // VAT revenue account
	CodeLevyRevenue    = 2002 // Levy/fee revenue account
	CodeRefundLiability = 3000 // Refund liability account
)

// Account represents a TigerBeetle account
type Account struct {
	ID             string `json:"id"`
	UserData128    string `json:"user_data_128,omitempty"`
	UserData64     uint64 `json:"user_data_64,omitempty"`
	UserData32     uint32 `json:"user_data_32,omitempty"`
	Ledger         uint32 `json:"ledger"`
	Code           uint16 `json:"code"`
	Flags          uint16 `json:"flags"`
	DebitsPending  uint64 `json:"debits_pending"`
	DebitsPosted   uint64 `json:"debits_posted"`
	CreditsPending uint64 `json:"credits_pending"`
	CreditsPosted  uint64 `json:"credits_posted"`
}

// Transfer represents a TigerBeetle transfer
type Transfer struct {
	ID              string `json:"id"`
	DebitAccountID  string `json:"debit_account_id"`
	CreditAccountID string `json:"credit_account_id"`
	Amount          uint64 `json:"amount"`
	UserData128     string `json:"user_data_128,omitempty"`
	UserData64      uint64 `json:"user_data_64,omitempty"`
	UserData32      uint32 `json:"user_data_32,omitempty"`
	PendingID       string `json:"pending_id,omitempty"`
	Ledger          uint32 `json:"ledger"`
	Code            uint16 `json:"code"`
	Flags           uint16 `json:"flags"`
	Timestamp       uint64 `json:"timestamp,omitempty"`
}

// Client interface for TigerBeetle operations
type Client interface {
	CreateAccounts(ctx context.Context, accounts []Account) error
	CreateTransfers(ctx context.Context, transfers []Transfer) error
	LookupAccounts(ctx context.Context, ids []string) ([]Account, error)
	LookupTransfers(ctx context.Context, ids []string) ([]Transfer, error)
}

// httpClient implements Client using TigerBeetle's HTTP API
type httpClient struct {
	baseURL string
	http    *http.Client
}

// New creates a new TigerBeetle HTTP client
func New(addr string) (Client, error) {
	c := &httpClient{
		baseURL: fmt.Sprintf("http://%s", addr),
		http:    &http.Client{Timeout: 10 * time.Second},
	}
	// Test connectivity
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	req, _ := http.NewRequestWithContext(ctx, "GET", c.baseURL+"/health", nil)
	resp, err := c.http.Do(req)
	if err != nil {
		return nil, fmt.Errorf("tigerbeetle unreachable: %w", err)
	}
	resp.Body.Close()
	return c, nil
}

func (c *httpClient) CreateAccounts(ctx context.Context, accounts []Account) error {
	return c.post(ctx, "/accounts", accounts)
}

func (c *httpClient) CreateTransfers(ctx context.Context, transfers []Transfer) error {
	return c.post(ctx, "/transfers", transfers)
}

func (c *httpClient) LookupAccounts(ctx context.Context, ids []string) ([]Account, error) {
	var result []Account
	err := c.postAndDecode(ctx, "/accounts/lookup", ids, &result)
	return result, err
}

func (c *httpClient) LookupTransfers(ctx context.Context, ids []string) ([]Transfer, error) {
	var result []Transfer
	err := c.postAndDecode(ctx, "/transfers/lookup", ids, &result)
	return result, err
}

func (c *httpClient) post(ctx context.Context, path string, body interface{}) error {
	data, err := json.Marshal(body)
	if err != nil {
		return err
	}
	req, err := http.NewRequestWithContext(ctx, "POST", c.baseURL+path, bytes.NewReader(data))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := c.http.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 400 {
		return fmt.Errorf("tigerbeetle %s returned %d", path, resp.StatusCode)
	}
	return nil
}

func (c *httpClient) postAndDecode(ctx context.Context, path string, body, result interface{}) error {
	data, err := json.Marshal(body)
	if err != nil {
		return err
	}
	req, err := http.NewRequestWithContext(ctx, "POST", c.baseURL+path, bytes.NewReader(data))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := c.http.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 400 {
		return fmt.Errorf("tigerbeetle %s returned %d", path, resp.StatusCode)
	}
	return json.NewDecoder(resp.Body).Decode(result)
}

// ── Mock client for graceful degradation ──────────────────────────────────────

type mockClient struct {
	accounts  map[string]Account
	transfers map[string]Transfer
}

// NewMock creates a mock TigerBeetle client for testing/graceful degradation
func NewMock() Client {
	return &mockClient{
		accounts:  make(map[string]Account),
		transfers: make(map[string]Transfer),
	}
}

func (m *mockClient) CreateAccounts(ctx context.Context, accounts []Account) error {
	for _, a := range accounts {
		m.accounts[a.ID] = a
	}
	return nil
}

func (m *mockClient) CreateTransfers(ctx context.Context, transfers []Transfer) error {
	for _, t := range transfers {
		if t.ID == "" {
			t.ID = fmt.Sprintf("mock-%d", rand.Int63())
		}
		t.Timestamp = uint64(time.Now().UnixNano())
		m.transfers[t.ID] = t
	}
	return nil
}

func (m *mockClient) LookupAccounts(ctx context.Context, ids []string) ([]Account, error) {
	var result []Account
	for _, id := range ids {
		if a, ok := m.accounts[id]; ok {
			result = append(result, a)
		}
	}
	return result, nil
}

func (m *mockClient) LookupTransfers(ctx context.Context, ids []string) ([]Transfer, error) {
	var result []Transfer
	for _, id := range ids {
		if t, ok := m.transfers[id]; ok {
			result = append(result, t)
		}
	}
	return result, nil
}
