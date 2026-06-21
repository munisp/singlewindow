// cmd/register-dfsp/main.go — Mojaloop DFSP registration bootstrap binary.
//
// Usage:
//   go run ./cmd/register-dfsp
//   # or with env overrides:
//   MOJALOOP_HUB_URL=http://hub:3001 MOJALOOP_DFSP_ID=tradegateway go run ./cmd/register-dfsp
//
// This binary:
//   1. Registers TradeGateway as a DFSP with the Mojaloop Hub
//   2. Sets the net debit cap (1 billion NGN by default)
//   3. Creates settlement and position accounts
//   4. Registers the customs authority party in the Account Lookup Service (ALS)
//   5. Registers all 7 FSPIOP callback endpoints
//   6. Advertises quote and transfer capabilities
//
// All steps are idempotent — safe to re-run after restarts or data resets.
// Exit code 0 = all steps succeeded or were already done.
// Exit code 1 = one or more steps failed (check logs).
package main

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"time"

	"github.com/tradegateway/mojaloop-gateway/internal/dfsp"
	"go.uber.org/zap"
	"go.uber.org/zap/zapcore"
)

func main() {
	// ── Structured logger ─────────────────────────────────────────────────────
	logCfg := zap.NewProductionConfig()
	logCfg.EncoderConfig.TimeKey = "ts"
	logCfg.EncoderConfig.EncodeTime = zapcore.ISO8601TimeEncoder
	logger, err := logCfg.Build()
	if err != nil {
		fmt.Fprintf(os.Stderr, "Failed to initialize logger: %v\n", err)
		os.Exit(1)
	}
	defer logger.Sync() //nolint:errcheck

	logger.Info("TradeGateway NGSWTP — Mojaloop DFSP Registration Bootstrap")

	// ── Config ────────────────────────────────────────────────────────────────
	cfg := dfsp.DefaultConfig()
	logger.Info("Registration config",
		zap.String("hub_url", cfg.HubURL),
		zap.String("fspiop_url", cfg.FSPIOP_URL),
		zap.String("dfsp_id", cfg.DFSP_ID),
		zap.String("dfsp_name", cfg.DFSP_Name),
		zap.String("currency", cfg.Currency),
		zap.String("callback_base_url", cfg.CallbackBaseURL),
		zap.Int64("net_debit_cap_minor", cfg.NetDebitCapMinor),
		zap.String("customs_msisdn", cfg.CustomsPartyMSISDN),
	)

	// ── Context with timeout ──────────────────────────────────────────────────
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
	defer cancel()

	// ── JWS Signer ──────────────────────────────────────────────────
	// Load the DFSP private key for FSPIOP-Signature signing.
	// If MOJALOOP_JWS_KEY_PATH is not set, fall back to an ephemeral Ed25519 key
	// (suitable for development; production MUST set the env var).
	var signer *dfsp.Signer
	keyPath := os.Getenv("MOJALOOP_JWS_KEY_PATH")
	if keyPath != "" {
		signer, err = dfsp.NewSignerFromFile(keyPath, cfg.DFSP_ID)
		if err != nil {
			logger.Warn("Failed to load JWS key from file — falling back to ephemeral key",
				zap.String("path", keyPath), zap.Error(err))
			signer, err = dfsp.NewEphemeralSigner(cfg.DFSP_ID)
			if err != nil {
				logger.Fatal("Failed to create ephemeral JWS signer", zap.Error(err))
			}
		} else {
			logger.Info("JWS signer loaded from file", zap.String("path", keyPath))
		}
	} else {
		logger.Warn("MOJALOOP_JWS_KEY_PATH not set — using ephemeral Ed25519 key (not suitable for production)")
		signer, err = dfsp.NewEphemeralSigner(cfg.DFSP_ID)
		if err != nil {
			logger.Fatal("Failed to create ephemeral JWS signer", zap.Error(err))
		}
	}

	// ── Execute registration ──────────────────────────────────────────────────
	registrar := dfsp.NewRegistrar(cfg, logger, signer)
	report, err := registrar.Register(ctx)
	if err != nil {
		logger.Fatal("Registration failed with fatal error", zap.Error(err))
	}

	// ── Print report ──────────────────────────────────────────────────────────
	printReport(report)

	if !report.Success {
		logger.Error("DFSP registration completed with failures — review steps above")
		os.Exit(1)
	}

	logger.Info("DFSP registration completed successfully",
		zap.String("dfsp_id", report.DFSP_ID),
		zap.Int("steps_completed", len(report.Steps)),
	)
}

func printReport(report *dfsp.RegistrationReport) {
	fmt.Println()
	fmt.Println("╔══════════════════════════════════════════════════════════════════╗")
	fmt.Printf( "║   Mojaloop DFSP Registration Report — %s%s║\n",
		report.DFSP_ID, padding(report.DFSP_ID, 26))
	fmt.Println("╠══════════════════════════════════════════════════════════════════╣")

	for _, step := range report.Steps {
		icon := "✓"
		if step.Status == "already_exists" {
			icon = "↩"
		} else if step.Status == "failed" {
			icon = "✗"
		}
		line := fmt.Sprintf("  %s  %-35s [%s]", icon, step.Step, step.Status)
		fmt.Printf("║ %-66s ║\n", line)
		if step.Message != "" {
			msg := step.Message
			if len(msg) > 62 {
				msg = msg[:59] + "..."
			}
			fmt.Printf("║     %-63s ║\n", msg)
		}
	}

	fmt.Println("╠══════════════════════════════════════════════════════════════════╣")
	if report.Success {
		fmt.Println("║  Status: ✓ SUCCESS — TradeGateway DFSP is registered             ║")
	} else {
		fmt.Println("║  Status: ✗ FAILED — Check error messages above                   ║")
	}
	fmt.Println("╚══════════════════════════════════════════════════════════════════╝")
	fmt.Println()

	// Also emit JSON for log aggregation
	if jsonBytes, err := json.MarshalIndent(report, "", "  "); err == nil {
		fmt.Println("JSON Report:")
		fmt.Println(string(jsonBytes))
	}
}

func padding(s string, targetLen int) string {
	pad := targetLen - len(s)
	if pad <= 0 {
		return ""
	}
	result := make([]byte, pad)
	for i := range result {
		result[i] = ' '
	}
	return string(result)
}
