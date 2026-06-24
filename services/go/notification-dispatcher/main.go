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

	kafkaBroker := getenv("KAFKA_BROKER", "kafka:9092")
	fcmProjectID := getenv("FCM_PROJECT_ID", "tradegateway-prod")
	apnsBundleID := getenv("APNS_BUNDLE_ID", "ng.gov.tradegateway")

	fcmClient := NewFCMClient(fcmProjectID)
	apnsClient := NewAPNsClient(apnsBundleID)
	d := NewDispatcher(kafkaBroker, fcmClient, apnsClient)

	go func() {
		if err := d.Run(ctx); err != nil && err != context.Canceled {
			log.Printf("[dispatcher] fatal: %v", err)
			cancel()
		}
	}()

	sig := make(chan os.Signal, 1)
	signal.Notify(sig, syscall.SIGTERM, syscall.SIGINT)
	<-sig
	log.Println("[dispatcher] shutting down")
	cancel()
}

func getenv(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}
