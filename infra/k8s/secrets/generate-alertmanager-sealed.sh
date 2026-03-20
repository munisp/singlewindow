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
# Optional flags:
#   --dry-run        Print the plain Secret YAML without sealing (for inspection)
#   --fetch-cert     Fetch and cache the cluster public key before sealing
#   --rotate         Force rotation even if sealed file already exists
#   --namespace NS   Override the target namespace (default: monitoring)
#
# Prerequisites:
#   - kubectl configured for the target cluster
#   - kubeseal installed (https://github.com/bitnami-labs/sealed-secrets/releases)
#   - Sealed Secrets controller running in kube-system namespace
#
# See ALERTMANAGER-CREDENTIALS-RUNBOOK.md for full documentation.
# ─────────────────────────────────────────────────────────────────────────────

set -euo pipefail

# ─── Defaults ─────────────────────────────────────────────────────────────────
NAMESPACE="monitoring"
SECRET_NAME="alertmanager-credentials"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OUTPUT_FILE="${SCRIPT_DIR}/alertmanager-credentials-sealed.yaml"
CERT_FILE="${SCRIPT_DIR}/.sealed-secrets-cert.pem"
DRY_RUN=false
FETCH_CERT=false
FORCE_ROTATE=false

# ─── Parse flags ──────────────────────────────────────────────────────────────
while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run)     DRY_RUN=true ;;
    --fetch-cert)  FETCH_CERT=true ;;
    --rotate)      FORCE_ROTATE=true ;;
    --namespace)   NAMESPACE="$2"; shift ;;
    -h|--help)
      sed -n '2,35p' "$0" | grep '^#' | sed 's/^# \?//'
      exit 0
      ;;
    *)
      echo "ERROR: Unknown flag: $1" >&2
      exit 1
      ;;
  esac
  shift
done

# ─── Validate required env vars ─────────────────────────────────────────────────────────────────
REQUIRED_VARS=(
  PAGERDUTY_CRITICAL_KEY
  PAGERDUTY_FINANCIAL_KEY
  PAGERDUTY_SECURITY_KEY
  SLACK_WEBHOOK_OPS
  SLACK_WEBHOOK_FINANCE
  SLACK_WEBHOOK_SECURITY
  SMTP_PASSWORD
)

MISSING=()
for var in "${REQUIRED_VARS[@]}"; do
  if [[ -z "${!var:-}" ]]; then
    MISSING+=("$var")
  fi
done

if [[ ${#MISSING[@]} -gt 0 ]]; then
  echo "ERROR: The following required environment variables are not set:" >&2
  for v in "${MISSING[@]}"; do
    echo "  - $v" >&2
  done
  echo "" >&2
  echo "See ALERTMANAGER-CREDENTIALS-RUNBOOK.md for instructions on obtaining these values." >&2
  exit 1
fi

# Validate credential formats
for pd_var in PAGERDUTY_CRITICAL_KEY PAGERDUTY_FINANCIAL_KEY PAGERDUTY_SECURITY_KEY; do
  val="${!pd_var}"
  if [[ ${#val} -lt 20 ]]; then
    echo "WARNING: $pd_var looks too short (${#val} chars). PagerDuty keys are typically 32 chars." >&2
  fi
done

for slack_var in SLACK_WEBHOOK_OPS SLACK_WEBHOOK_FINANCE SLACK_WEBHOOK_SECURITY; do
  val="${!slack_var}"
  if [[ "$val" != https://hooks.slack.com/services/* ]]; then
    echo "WARNING: $slack_var does not look like a valid Slack webhook URL." >&2
    echo "  Expected: https://hooks.slack.com/services/T.../B.../..." >&2
  fi
done

# ─── Check if output already exists ───────────────────────────────────────────────────────────────
if [[ -f "$OUTPUT_FILE" ]] && [[ "$FORCE_ROTATE" == "false" ]] && [[ "$DRY_RUN" == "false" ]]; then
  echo "INFO: SealedSecret already exists at: $OUTPUT_FILE"
  echo "      Use --rotate to force regeneration."
  echo "      Use --dry-run to inspect the plain Secret without sealing."
  exit 0
fi

# ─── Dry-run mode ───────────────────────────────────────────────────────────────────────
if [[ "$DRY_RUN" == "true" ]]; then
  echo "=== DRY RUN: Plain Secret YAML (NOT for production use) ==="
  kubectl create secret generic "$SECRET_NAME" \
    --namespace="$NAMESPACE" \
    --from-literal=pagerduty_critical_key="${PAGERDUTY_CRITICAL_KEY}" \
    --from-literal=pagerduty_financial_key="${PAGERDUTY_FINANCIAL_KEY}" \
    --from-literal=pagerduty_security_key="${PAGERDUTY_SECURITY_KEY}" \
    --from-literal=slack_webhook_ops="${SLACK_WEBHOOK_OPS}" \
    --from-literal=slack_webhook_finance="${SLACK_WEBHOOK_FINANCE}" \
    --from-literal=slack_webhook_security="${SLACK_WEBHOOK_SECURITY}" \
    --from-literal=smtp_password="${SMTP_PASSWORD}" \
    --dry-run=client -o yaml
  echo ""
  echo "=== DRY RUN complete. No files written. ==="
  exit 0
fi

# ─── Check prerequisites ──────────────────────────────────────────────────────────────────────
if ! command -v kubectl &>/dev/null; then
  echo "ERROR: kubectl is not installed or not in PATH" >&2
  exit 1
fi

if ! command -v kubeseal &>/dev/null; then
  echo "ERROR: kubeseal is not installed or not in PATH" >&2
  echo "Install: https://github.com/bitnami-labs/sealed-secrets/releases" >&2
  exit 1
fi

if ! kubectl cluster-info &>/dev/null; then
  echo "ERROR: kubectl cannot connect to the cluster. Check your KUBECONFIG." >&2
  exit 1
fi

# ─── Fetch cluster certificate ────────────────────────────────────────────────────────────────────
if [[ "$FETCH_CERT" == "true" ]] || [[ ! -f "$CERT_FILE" ]]; then
  echo "Fetching Sealed Secrets controller public key..."
  kubeseal \
    --controller-namespace=kube-system \
    --controller-name=sealed-secrets-controller \
    --fetch-cert > "$CERT_FILE"
  echo "  Certificate cached at: $CERT_FILE"
fi

echo "Creating namespace $NAMESPACE if it doesn't exist..."
kubectl create namespace "$NAMESPACE" --dry-run=client -o yaml | kubectl apply -f -

# ─── Generate SealedSecret ────────────────────────────────────────────────────────────────────────
echo "Generating SealedSecret for $SECRET_NAME in namespace $NAMESPACE..."

SEAL_ARGS=(
  --controller-namespace=kube-system
  --controller-name=sealed-secrets-controller
  --format yaml
)

if [[ -f "$CERT_FILE" ]]; then
  SEAL_ARGS+=(--cert "$CERT_FILE")
fi

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
kubeseal "${SEAL_ARGS[@]}" > "$OUTPUT_FILE"

echo ""
echo "✅ SealedSecret written to: $OUTPUT_FILE"
echo ""
echo "This file is safe to commit to Git."
echo ""
echo "─── Next steps ─────────────────────────────────────────────────────────────────"
echo ""
echo "1. Apply the SealedSecret:"
echo "   kubectl apply -f $OUTPUT_FILE"
echo ""
echo "2. Verify the Secret was created:"
echo "   kubectl get secret $SECRET_NAME -n $NAMESPACE"
echo ""
echo "3. Apply the Alertmanager deployment (if not already deployed):"
echo "   kubectl apply -f ${SCRIPT_DIR}/../monitoring/alertmanager/alertmanager-config.yaml"
echo "   kubectl apply -f ${SCRIPT_DIR}/../monitoring/alertmanager/alertmanager-deployment.yaml"
echo ""
echo "4. Check rollout status:"
echo "   kubectl rollout status deployment/alertmanager -n $NAMESPACE"
echo ""
echo "See ALERTMANAGER-CREDENTIALS-RUNBOOK.md for full documentation."
