// registration_test.go — Unit tests for DFSP registration logic.
package dfsp

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"go.uber.org/zap"
	"go.uber.org/zap/zaptest"
)

// ─── Test Helpers ─────────────────────────────────────────────────────────────

// mockHubServer creates a test HTTP server that simulates the Mojaloop Hub admin API.
// statusCode controls the response for all endpoints.
func mockHubServer(t *testing.T, statusCode int) *httptest.Server {
	t.Helper()
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(statusCode)
		json.NewEncoder(w).Encode(map[string]string{"status": "ok"})
	}))
}

// mockFSPIOPServer creates a test HTTP server that simulates the Mojaloop FSPIOP adapter.
func mockFSPIOPServer(t *testing.T, statusCode int) *httptest.Server {
	t.Helper()
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/vnd.interoperability.participants+json;version=1.1")
		w.WriteHeader(statusCode)
		json.NewEncoder(w).Encode(map[string]string{"status": "ok"})
	}))
}

func testConfig(hubURL, fspiopURL string) Config {
	return Config{
		HubURL:             hubURL,
		FSPIOP_URL:         fspiopURL,
		DFSP_ID:            "tradegateway-test",
		DFSP_Name:          "TradeGateway Test",
		CallbackBaseURL:    "http://localhost:8085",
		Currency:           "NGN",
		NetDebitCapMinor:   100_000_000_00,
		CustomsPartyMSISDN: "2348000000001",
	}
}

// ─── Tests ────────────────────────────────────────────────────────────────────

func TestDefaultConfig(t *testing.T) {
	cfg := DefaultConfig()
	if cfg.DFSP_ID == "" {
		t.Error("DFSP_ID must not be empty")
	}
	if cfg.Currency == "" {
		t.Error("Currency must not be empty")
	}
	if cfg.NetDebitCapMinor <= 0 {
		t.Error("NetDebitCapMinor must be positive")
	}
	if cfg.HubURL == "" {
		t.Error("HubURL must not be empty")
	}
	if cfg.CallbackBaseURL == "" {
		t.Error("CallbackBaseURL must not be empty")
	}
}

func TestRegisterParticipant_Success(t *testing.T) {
	hub := mockHubServer(t, 201)
	defer hub.Close()
	fspiop := mockFSPIOPServer(t, 201)
	defer fspiop.Close()

	cfg := testConfig(hub.URL, fspiop.URL)
	logger := zaptest.NewLogger(t)
	r := NewRegistrar(cfg, logger)

	result := r.registerParticipant(context.Background())
	if result.Status != "created" {
		t.Errorf("Expected 'created', got '%s': %s", result.Status, result.Message)
	}
}

func TestRegisterParticipant_AlreadyExists(t *testing.T) {
	hub := mockHubServer(t, 409)
	defer hub.Close()
	fspiop := mockFSPIOPServer(t, 409)
	defer fspiop.Close()

	cfg := testConfig(hub.URL, fspiop.URL)
	logger := zaptest.NewLogger(t)
	r := NewRegistrar(cfg, logger)

	result := r.registerParticipant(context.Background())
	if result.Status != "already_exists" {
		t.Errorf("Expected 'already_exists', got '%s': %s", result.Status, result.Message)
	}
}

func TestRegisterParticipant_Failure(t *testing.T) {
	hub := mockHubServer(t, 500)
	defer hub.Close()
	fspiop := mockFSPIOPServer(t, 500)
	defer fspiop.Close()

	cfg := testConfig(hub.URL, fspiop.URL)
	logger := zaptest.NewLogger(t)
	r := NewRegistrar(cfg, logger)

	result := r.registerParticipant(context.Background())
	if result.Status != "failed" {
		t.Errorf("Expected 'failed', got '%s'", result.Status)
	}
}

func TestSetNetDebitCap_Success(t *testing.T) {
	hub := mockHubServer(t, 201)
	defer hub.Close()
	fspiop := mockFSPIOPServer(t, 201)
	defer fspiop.Close()

	cfg := testConfig(hub.URL, fspiop.URL)
	logger := zaptest.NewLogger(t)
	r := NewRegistrar(cfg, logger)

	result := r.setNetDebitCap(context.Background())
	if result.Status != "created" {
		t.Errorf("Expected 'created', got '%s': %s", result.Status, result.Message)
	}
}

func TestCreateSettlementAccounts_Success(t *testing.T) {
	hub := mockHubServer(t, 201)
	defer hub.Close()
	fspiop := mockFSPIOPServer(t, 201)
	defer fspiop.Close()

	cfg := testConfig(hub.URL, fspiop.URL)
	logger := zaptest.NewLogger(t)
	r := NewRegistrar(cfg, logger)

	result := r.createSettlementAccounts(context.Background())
	if result.Status != "created" {
		t.Errorf("Expected 'created', got '%s': %s", result.Status, result.Message)
	}
}

func TestRegisterPartyInALS_Success(t *testing.T) {
	hub := mockHubServer(t, 201)
	defer hub.Close()
	fspiop := mockFSPIOPServer(t, 202)
	defer fspiop.Close()

	cfg := testConfig(hub.URL, fspiop.URL)
	logger := zaptest.NewLogger(t)
	r := NewRegistrar(cfg, logger)

	result := r.registerPartyInALS(context.Background())
	if result.Status != "created" {
		t.Errorf("Expected 'created', got '%s': %s", result.Status, result.Message)
	}
}

func TestRegisterEndpoints_Success(t *testing.T) {
	hub := mockHubServer(t, 201)
	defer hub.Close()
	fspiop := mockFSPIOPServer(t, 201)
	defer fspiop.Close()

	cfg := testConfig(hub.URL, fspiop.URL)
	logger := zaptest.NewLogger(t)
	r := NewRegistrar(cfg, logger)

	result := r.registerEndpoints(context.Background())
	if result.Status != "created" {
		t.Errorf("Expected 'created', got '%s': %s", result.Status, result.Message)
	}
}

func TestFullRegistration_AllSuccess(t *testing.T) {
	hub := mockHubServer(t, 201)
	defer hub.Close()
	fspiop := mockFSPIOPServer(t, 202)
	defer fspiop.Close()

	cfg := testConfig(hub.URL, fspiop.URL)
	logger := zaptest.NewLogger(t)
	r := NewRegistrar(cfg, logger)

	report, err := r.Register(context.Background())
	if err != nil {
		t.Fatalf("Register returned error: %v", err)
	}
	if !report.Success {
		for _, step := range report.Steps {
			if step.Status == "failed" {
				t.Errorf("Step %s failed: %s", step.Step, step.Message)
			}
		}
	}
	if len(report.Steps) != 7 {
		t.Errorf("Expected 7 registration steps, got %d", len(report.Steps))
	}
}

func TestFullRegistration_AllAlreadyExist(t *testing.T) {
	hub := mockHubServer(t, 409)
	defer hub.Close()
	fspiop := mockFSPIOPServer(t, 409)
	defer fspiop.Close()

	cfg := testConfig(hub.URL, fspiop.URL)
	logger := zaptest.NewLogger(t)
	r := NewRegistrar(cfg, logger)

	report, err := r.Register(context.Background())
	if err != nil {
		t.Fatalf("Register returned error: %v", err)
	}
	// 409 responses are treated as success (idempotent)
	if !report.Success {
		t.Error("Expected success when all resources already exist (idempotent)")
	}
}

func TestRegistrationReport_JSON(t *testing.T) {
	report := &RegistrationReport{
		DFSP_ID: "tradegateway",
		Steps: []RegistrationResult{
			{Step: "register_participant", Status: "created", Message: "OK"},
		},
		Success: true,
	}
	data, err := json.Marshal(report)
	if err != nil {
		t.Fatalf("Failed to marshal report: %v", err)
	}
	var decoded RegistrationReport
	if err := json.Unmarshal(data, &decoded); err != nil {
		t.Fatalf("Failed to unmarshal report: %v", err)
	}
	if decoded.DFSP_ID != "tradegateway" {
		t.Errorf("Expected DFSP_ID 'tradegateway', got '%s'", decoded.DFSP_ID)
	}
	if len(decoded.Steps) != 1 {
		t.Errorf("Expected 1 step, got %d", len(decoded.Steps))
	}
}

func TestNewRegistrar(t *testing.T) {
	cfg := DefaultConfig()
	logger := zap.NewNop()
	r := NewRegistrar(cfg, logger)
	if r == nil {
		t.Error("NewRegistrar must not return nil")
	}
}
