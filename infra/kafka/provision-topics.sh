#!/usr/bin/env bash
# provision-topics.sh — Create all Kafka topics for TradeGateway NGSWTP
# Usage: ./provision-topics.sh [BOOTSTRAP_SERVER]
# Default bootstrap server: localhost:9092

set -euo pipefail

BOOTSTRAP="${1:-localhost:9092}"
KAFKA_CMD="kafka-topics.sh"

# Check if kafka-topics.sh is available
if ! command -v "$KAFKA_CMD" &>/dev/null; then
  # Try Kafka bin directory
  KAFKA_CMD="/opt/kafka/bin/kafka-topics.sh"
  if ! command -v "$KAFKA_CMD" &>/dev/null; then
    echo "ERROR: kafka-topics.sh not found. Set PATH or provide full path."
    exit 1
  fi
fi

create_topic() {
  local name="$1"
  local partitions="${2:-3}"
  local replication="${3:-1}"  # Use 1 for local dev, 3 for production
  local retention_ms="${4:-604800000}"  # 7 days default

  echo "Creating topic: $name (partitions=$partitions, replication=$replication)"
  "$KAFKA_CMD" --bootstrap-server "$BOOTSTRAP" \
    --create --if-not-exists \
    --topic "$name" \
    --partitions "$partitions" \
    --replication-factor "$replication" \
    --config retention.ms="$retention_ms" \
    --config compression.type=lz4 \
    2>&1 || echo "  WARNING: Topic $name may already exist"
}

echo "=== TradeGateway NGSWTP — Kafka Topic Provisioning ==="
echo "Bootstrap: $BOOTSTRAP"
echo ""

# Declaration lifecycle
create_topic "declaration.submitted"       6 1 604800000
create_topic "declaration.risk-scored"     6 1 604800000
create_topic "declaration.under-review"    3 1 604800000
create_topic "declaration.cleared"         6 1 7776000000
create_topic "declaration.rejected"        3 1 7776000000

# Payment lifecycle
create_topic "payment.invoice.created"     3 1 7776000000
create_topic "payment.initiated"           3 1 604800000
create_topic "payment.confirmed"           6 1 7776000000
create_topic "payment.failed"              3 1 604800000
create_topic "payment.refunded"            3 1 7776000000

# OGA permit lifecycle
create_topic "oga.permit.requested"        6 1 604800000
create_topic "oga.permit.approved"         6 1 7776000000
create_topic "oga.permit.rejected"         3 1 7776000000
create_topic "oga.sla.breach"              3 1 604800000

# Risk & compliance
create_topic "risk.score.computed"         6 1 604800000
create_topic "sanctions.hit"               3 1 7776000000
create_topic "sanctions.clear"             3 1 604800000

# Cargo tracking
create_topic "cargo.vessel.position"       12 1 86400000
create_topic "cargo.arrived"               3 1 604800000
create_topic "cargo.released"              3 1 7776000000

# Profile & KYC
create_topic "profile.kyc.verified"        3 1 7776000000
create_topic "profile.aeo.applied"         3 1 7776000000
create_topic "profile.aeo.granted"         3 1 7776000000

# Security & audit
create_topic "audit.event"                 6 1 31536000000
create_topic "security.alert"              3 1 7776000000

# ASEAN Single Window
create_topic "asean.sw.outbound"           3 1 604800000
create_topic "asean.sw.inbound"            3 1 604800000

echo ""
echo "=== Topic provisioning complete ==="
"$KAFKA_CMD" --bootstrap-server "$BOOTSTRAP" --list | grep -E "^(declaration|payment|oga|risk|sanctions|cargo|profile|audit|security|asean)" | sort
