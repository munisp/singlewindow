#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# TradeGateway™ NGSWTP — Generate Alertmanager SealedSecret
# ─────────────────────────────────────────────────────────────────────────────
# Usage:
#   export PAGERDUTY_CRITICAL_KEY="<your-pd-key>"
#   export PAGERDUTY_FINANCIAL_KEY="<your-pd-key>"
#   export PAGERDUTY_SECURITY_KEY="<your-pd-key>"
#   export SLACK_WEBHOOK_OPS="https://hooks.slack.com/services/..."
#   export SLACK_WEBHOOK_FINANCE="https://hooks.slack.com/services/..."
#   export SLACK_WEBHOOK_SECURITY="https://hooks.slack.com/services/..."
#   export SMTP_PASSWORD="<your-smtp-password>"
#   ./generate-alertmanager-sealed.sh
#
# Prerequisites:
#   - kubectl configured for the target cluster
#   - kubeseal installed (https://github.com/bitnami-labs/sealed-secrets)
#   - Sealed Secrets controller running in kube-system namespace
# ─────────────────────────────────────────────────────────────────────────────

set -euo pipefail

NAMESPACE="monitoring"
SECRET_NAME="alertmanager-credentials"
OUTPUT_FILE="$(dirname "$0")/alertmanager-credentials-sealed.yaml"

# Validate required env vars
REQUIRED_VARS=(
  PAGERDUTY_CRITICAL_KEY
  PAGERDUTY_FINANCIAL_KEY
  PAGERDUTY_SECURITY_KEY
  SLACK_WEBHOOK_OPS
  SLACK_WEBHOOK_FINANCE
  SLACK_WEBHOOK_SECURITY
  SMTP_PASSWORD
)

for var in "${REQUIRED_VARS[@]}"; do
  if [[ -z "${!var:-}" ]]; then
    echo "ERROR: Required environment variable $var is not set" >&2
    exit 1
  fi
done

echo "Creating namespace $NAMESPACE if it doesn't exist..."
kubectl create namespace "$NAMESPACE" --dry-run=client -o yaml | kubectl apply -f -

echo "Generating SealedSecret for $SECRET_NAME..."
kubectl create secret generic "$SECRET_NAME" \
  --namespace="$NAMESPACE" \
  --from-literal=pagerduty_critical_key="${PAGERDUTY_CRITICAL_KEY}" \
  --from-literal=pagerduty_financial_key="${PAGERDUTY_FINANCIAL_KEY}" \
  --from-literal=pagerduty_security_key="${PAGERDUTY_SECURITY_KEY}" \
  --from-literal=slack_webhook_ops="${SLACK_WEBHOOK_OPS}" \
  --from-literal=slack_webhook_finance="${SLACK_WEBHOOK_FINANCE}" \
  --from-literal=slack_webhook_security="${SLACK_WEBHOOK_SECURITY}" \
  --from-literal=smtp_password="${SMTP_PASSWORD}" \
  --dry-run=client -o yaml | \
kubeseal \
  --controller-namespace=kube-system \
  --controller-name=sealed-secrets-controller \
  --format yaml > "$OUTPUT_FILE"

echo "✅ SealedSecret written to: $OUTPUT_FILE"
echo ""
echo "Apply with:"
echo "  kubectl apply -f $OUTPUT_FILE"
echo "  kubectl apply -f $(dirname "$0")/../monitoring/alertmanager/alertmanager-deployment.yaml"
