package main

import (
	"context"
	"log"
	"os"
	"os/signal"
	"syscall"
)

func main() {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	// Phase-7 OTel: guarded by OTEL_EXPORTER_OTLP_ENDPOINT — unset = telemetry
	// disabled, boot unaffected (sanctioned fail-open, OTEL_DESIGN.md §1).
	otelShutdown, otelEnabled := InitTelemetry(ctx)
	if otelEnabled {
		defer otelShutdown(context.Background())
	}

	kafkaBroker := getenv("KAFKA_BROKER", "kafka:9092")
	fcmProjectID := getenv("FCM_PROJECT_ID", "tradegateway-prod")
	apnsBundleID := getenv("APNS_BUNDLE_ID", "ng.gov.tradegateway")
	pushTokensSvcURL := getenv("PUSH_TOKENS_SVC_URL", "http://push-tokens-svc:8080")
	adminAddr := getenv("ADMIN_ADDR", ":8081")

	fcmClient := NewFCMClient(fcmProjectID)
	apnsClient := NewAPNsClient(apnsBundleID)

	// ── Main notification dispatcher ────────────────────────────────────────
	d := NewDispatcher(kafkaBroker, fcmClient, apnsClient)
	go func() {
		if err := d.Run(ctx); err != nil && err != context.Canceled {
			log.Printf("[dispatcher] fatal: %v", err)
			cancel()
		}
	}()

	// ── FCM token refresher ─────────────────────────────────────────────────
	// Validates all stored push tokens every 6 hours and purges stale ones
	// via the insider.push.purge Kafka topic, preventing silent delivery failures.
	tokenRefresher := NewTokenRefresher(
		fcmClient,
		NewHTTPTokenProvider(pushTokensSvcURL),
		NewKafkaPurgePublisher(kafkaBroker),
		DefaultRefreshInterval,
		DefaultBatchSize,
	)
	go tokenRefresher.Run(ctx)
	log.Printf("[token-refresher] started (interval=%s, batchSize=%d)", DefaultRefreshInterval, DefaultBatchSize)

	// ── Admin HTTP server ───────────────────────────────────────────────────
	// Exposes /healthz and /admin/refresh-tokens for the nightly K8s CronJob.
	adminSrv := NewAdminServer(adminAddr, tokenRefresher)
	go func() {
		if err := adminSrv.Start(); err != nil {
			log.Printf("[admin] server stopped: %v", err)
		}
	}()

	sig := make(chan os.Signal, 1)
	signal.Notify(sig, syscall.SIGTERM, syscall.SIGINT)
	<-sig
	log.Println("[dispatcher] shutting down")
	cancel()
	_ = adminSrv.Shutdown(ctx)
}

func getenv(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}
