# Alertmanager Credentials Runbook

**TradeGateway™ NGSWTP — Production Alertmanager Credentials Setup**

This runbook documents the complete workflow for provisioning, rotating, and validating Alertmanager credentials in the production Kubernetes cluster. All secrets are managed via [Bitnami Sealed Secrets](https://github.com/bitnami-labs/sealed-secrets) so that encrypted manifests can be safely committed to Git.

---

## Architecture Overview

Alertmanager reads credentials from files mounted from a Kubernetes Secret (`alertmanager-credentials` in the `monitoring` namespace). The Secret is created from a `SealedSecret` resource that is encrypted with the cluster's public key. The plaintext values **never** appear in Git.

```
Git (encrypted SealedSecret YAML)
    │
    ▼ kubeseal controller decrypts
Kubernetes Secret: alertmanager-credentials
    │
    ▼ mounted as files at /etc/alertmanager/secrets/
Alertmanager Pod reads:
  - pagerduty_critical_key
  - pagerduty_financial_key
  - pagerduty_security_key
  - slack_webhook_ops
  - slack_webhook_finance
  - slack_webhook_security
  - smtp_password
```

---

## Prerequisites

| Tool | Version | Install |
|------|---------|---------|
| `kubectl` | ≥ 1.28 | [docs.k8s.io](https://kubernetes.io/docs/tasks/tools/) |
| `kubeseal` | ≥ 0.24 | `brew install kubeseal` or [GitHub releases](https://github.com/bitnami-labs/sealed-secrets/releases) |
| Sealed Secrets controller | ≥ 0.24 | `helm install sealed-secrets sealed-secrets/sealed-secrets -n kube-system` |

Verify the controller is running:

```bash
kubectl get pods -n kube-system -l app.kubernetes.io/name=sealed-secrets-controller
```

---

## Step 1 — Obtain Credentials

### PagerDuty Integration Keys

1. Log in to [PagerDuty](https://app.pagerduty.com)
2. Navigate to **Services → Service Directory**
3. Create or select three services:
   - **TradeGateway Critical** → copy the **Events API v2 Integration Key**
   - **TradeGateway Financial** → copy the **Events API v2 Integration Key**
   - **TradeGateway Security** → copy the **Events API v2 Integration Key**
4. Each key is a 32-character alphanumeric string (e.g., `abc123def456ghi789jkl012mno345pq`)

### Slack Incoming Webhooks

1. Go to [api.slack.com/apps](https://api.slack.com/apps) → **Create New App → From Scratch**
2. Enable **Incoming Webhooks** under **Features**
3. Create webhooks for three channels:
   - `#ops-alerts` (also used for `#ops-critical`, `#customs-ops`, `#devops-alerts`) → `SLACK_WEBHOOK_OPS`
   - `#finance-alerts` → `SLACK_WEBHOOK_FINANCE`
   - `#security-alerts` → `SLACK_WEBHOOK_SECURITY`
4. Each URL has the format: `https://hooks.slack.com/services/T.../B.../...`

### SMTP Password (Email Fallback)

Obtain the SMTP password for your email relay (e.g., SendGrid, AWS SES, or your corporate SMTP server). This is used for the `email-ops` receiver as a fallback channel.

---

## Step 2 — Set Environment Variables

Export credentials as environment variables before running the generation script. **Never commit these to Git.**

```bash
export PAGERDUTY_CRITICAL_KEY="<32-char-pd-key-for-critical-service>"
export PAGERDUTY_FINANCIAL_KEY="<32-char-pd-key-for-financial-service>"
export PAGERDUTY_SECURITY_KEY="<32-char-pd-key-for-security-service>"
export SLACK_WEBHOOK_OPS="https://hooks.slack.com/services/T.../B.../..."
export SLACK_WEBHOOK_FINANCE="https://hooks.slack.com/services/T.../B.../..."
export SLACK_WEBHOOK_SECURITY="https://hooks.slack.com/services/T.../B.../..."
export SMTP_PASSWORD="<your-smtp-password>"
```

---

## Step 3 — Generate the SealedSecret

Run the generation script from the repository root:

```bash
cd infra/k8s/secrets
./generate-alertmanager-sealed.sh
```

This script:
1. Validates all required environment variables are set
2. Creates the `monitoring` namespace if it does not exist
3. Generates a Kubernetes Secret manifest (dry-run, never applied directly)
4. Pipes it through `kubeseal` to produce an encrypted `SealedSecret`
5. Writes the output to `alertmanager-credentials-sealed.yaml`

The generated file is safe to commit to Git.

---

## Step 4 — Apply to Cluster

```bash
# Apply the SealedSecret (controller will decrypt and create the Secret)
kubectl apply -f infra/k8s/secrets/alertmanager-credentials-sealed.yaml

# Verify the Secret was created
kubectl get secret alertmanager-credentials -n monitoring

# Apply the Alertmanager deployment (if not already deployed)
kubectl apply -f infra/monitoring/alertmanager/alertmanager-config.yaml
kubectl apply -f infra/monitoring/alertmanager/alertmanager-deployment.yaml

# Check pod status
kubectl rollout status deployment/alertmanager -n monitoring
```

---

## Step 5 — Validate Alertmanager

```bash
# Port-forward to Alertmanager UI
kubectl port-forward svc/alertmanager 9093:9093 -n monitoring

# Open in browser
open http://localhost:9093

# Check configuration loaded correctly (no parse errors)
curl -s http://localhost:9093/api/v2/status | jq '.config.original' | head -20

# Send a test alert to verify routing
curl -X POST http://localhost:9093/api/v2/alerts \
  -H 'Content-Type: application/json' \
  -d '[{
    "labels": {
      "alertname": "TestAlert",
      "severity": "warning",
      "service": "declaration"
    },
    "annotations": {
      "summary": "Test alert from runbook validation",
      "description": "This is a test alert to verify Alertmanager routing is working."
    }
  }]'

# Verify the alert appears in the UI at http://localhost:9093/#/alerts
```

---

## Credential Rotation

To rotate credentials (e.g., after a security incident or scheduled rotation):

1. Obtain new credential values
2. Export the new values as environment variables (Step 2)
3. Re-run `generate-alertmanager-sealed.sh` (Step 3)
4. Commit the updated `alertmanager-credentials-sealed.yaml` to Git
5. Apply the updated SealedSecret: `kubectl apply -f alertmanager-credentials-sealed.yaml`
6. The Sealed Secrets controller will automatically update the underlying Secret
7. Restart Alertmanager to pick up the new credentials:
   ```bash
   kubectl rollout restart deployment/alertmanager -n monitoring
   ```

---

## Receiver Routing Summary

| Alert Condition | Receiver(s) |
|----------------|-------------|
| `severity=critical` | PagerDuty Critical + Slack `#ops-critical` |
| `service=~payment\|mojaloop\|tigerbeetle\|ledger` | PagerDuty Financial + Slack `#finance-alerts` |
| `service=~wazuh\|soc\|threat-intel\|cen\|sanctions` | PagerDuty Security + Slack `#security-alerts` |
| `service=~declaration\|oga\|clearance\|risk` | Slack `#customs-ops` |
| `service=~kafka\|temporal\|redis\|kubernetes\|node` | Slack `#devops-alerts` |
| `severity=warning` (catch-all) | Slack `#ops-alerts` |

---

## Troubleshooting

**Alertmanager pod fails to start:**
```bash
kubectl describe pod -l app=alertmanager -n monitoring
kubectl logs -l app=alertmanager -n monitoring --previous
```

**Secret not created after applying SealedSecret:**
```bash
# Check Sealed Secrets controller logs
kubectl logs -l app.kubernetes.io/name=sealed-secrets-controller -n kube-system

# Verify the SealedSecret was applied
kubectl get sealedsecret alertmanager-credentials -n monitoring -o yaml
```

**Alerts not routing to Slack/PagerDuty:**
```bash
# Check Alertmanager logs for delivery errors
kubectl logs -l app=alertmanager -n monitoring | grep -E "error|failed|webhook"

# Verify secret files are mounted correctly
kubectl exec -it $(kubectl get pod -l app=alertmanager -n monitoring -o name | head -1) \
  -n monitoring -- ls -la /etc/alertmanager/secrets/
```

**Wrong cluster public key (kubeseal error):**
```bash
# Fetch the correct public key from the cluster
kubeseal --fetch-cert \
  --controller-namespace=kube-system \
  --controller-name=sealed-secrets-controller > /tmp/pub-cert.pem

# Re-seal using the fetched certificate
kubectl create secret generic alertmanager-credentials \
  --namespace=monitoring \
  --from-literal=pagerduty_critical_key="${PAGERDUTY_CRITICAL_KEY}" \
  ... \
  --dry-run=client -o yaml | \
kubeseal --cert /tmp/pub-cert.pem --format yaml > alertmanager-credentials-sealed.yaml
```

---

## Security Notes

- The `alertmanager-credentials-sealed.yaml` file is cluster-specific. A SealedSecret encrypted for cluster A cannot be decrypted by cluster B.
- Store the plaintext credentials in your organization's secrets manager (HashiCorp Vault, AWS Secrets Manager, GCP Secret Manager) as the authoritative source.
- The `generate-alertmanager-sealed.sh` script uses `set -euo pipefail` and validates all required variables before execution.
- Alertmanager reads credentials from files (not environment variables), which is more secure as file contents are not exposed in `kubectl describe pod` output.
