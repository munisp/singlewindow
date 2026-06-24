package kafka_test

import (
	"testing"
)

func TestTopicNames(t *testing.T) {
	names := []string{
		TopicNames.DeclarationSubmitted,
		TopicNames.PaymentConfirmed,
		TopicNames.InsiderThreatDetected,
		TopicNames.AuditEventCreated,
	}
	for _, n := range names {
		if n == "" {
			t.Errorf("expected non-empty topic name")
		}
	}
}

func TestTopicPartitionCount(t *testing.T) {
	cases := []struct {
		topic    string
		expected int
	}{
		{"declaration.submitted", 12},
		{"payment.confirmed", 24},
		{"risk.score.computed", 6},
		{"audit.event.created", 6},
		{"insider.threat.detected", 3},
		{"unknown.topic", 3},
	}
	for _, c := range cases {
		got := TopicPartitionCount(c.topic)
		if got != c.expected {
			t.Errorf("TopicPartitionCount(%q) = %d, want %d", c.topic, got, c.expected)
		}
	}
}

func TestRetentionMS(t *testing.T) {
	cases := []struct {
		topic    string
		minDays  int64
	}{
		{"payment.confirmed", 7},
		{"audit.event.created", 90},
		{"payment.confirmed.dlq", 30},
		{"declaration.submitted", 3},
	}
	const msPerDay = int64(24 * 60 * 60 * 1000)
	for _, c := range cases {
		got := RetentionMS(c.topic)
		if got < c.minDays*msPerDay {
			t.Errorf("RetentionMS(%q) = %d ms, want >= %d days", c.topic, got, c.minDays)
		}
	}
}

func TestConfigFromEnv_Defaults(t *testing.T) {
	cfg := ConfigFromEnv()
	if len(cfg.Brokers) == 0 {
		t.Error("expected at least one broker")
	}
	if cfg.DLQTopicSuffix == "" {
		t.Error("expected non-empty DLQ suffix")
	}
}

func TestServiceName(t *testing.T) {
	// serviceName() returns "unknown" when SERVICE_NAME is not set
	t.Setenv("SERVICE_NAME", "test-service")
	cfg := ConfigFromEnv()
	_ = cfg // just ensure no panic
}
