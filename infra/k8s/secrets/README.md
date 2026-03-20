# TradeGateway™ NGSWTP — Sealed Secrets

All production secrets are managed via [Sealed Secrets](https://github.com/bitnami-labs/sealed-secrets).
Plaintext secrets are **never** committed to the repository.

## Setup

```bash
# Install kubeseal CLI
brew install kubeseal

# Get the public key from the cluster
kubeseal --fetch-cert \
  --controller-name=sealed-secrets-controller \
  --controller-namespace=kube-system \
  > pub-cert.pem
```

## Creating a Sealed Secret

```bash
# 1. Create a plain Secret manifest (DO NOT COMMIT)
kubectl create secret generic tradegateway-db-credentials \
  --from-literal=DATABASE_URL="mysql://user:pass@host:3306/db" \
  --dry-run=client -o yaml > /tmp/db-secret.yaml

# 2. Seal it
kubeseal --cert pub-cert.pem \
  --format yaml \
  < /tmp/db-secret.yaml \
  > infra/k8s/secrets/db-credentials.sealed.yaml

# 3. Commit the sealed secret (safe to commit)
git add infra/k8s/secrets/db-credentials.sealed.yaml
```

## Secret Inventory

| Secret Name | Keys | Used By |
|---|---|---|
| `tradegateway-db-credentials` | `DATABASE_URL` | web-api, declaration-service, all routers |
| `tradegateway-jwt` | `JWT_SECRET` | web-api auth |
| `tradegateway-redis` | `REDIS_URL`, `REDIS_PASSWORD` | web-api, all caching services |
| `tradegateway-kafka` | `KAFKA_BROKERS`, `KAFKA_SASL_USERNAME`, `KAFKA_SASL_PASSWORD` | all event-driven services |
| `tradegateway-temporal` | `TEMPORAL_ADDRESS`, `TEMPORAL_NAMESPACE` | workflow-service, declaration-service |
| `tradegateway-keycloak` | `KEYCLOAK_URL`, `KEYCLOAK_CLIENT_SECRET` | keycloak-svc, all auth flows |
| `tradegateway-mojaloop` | `MOJALOOP_API_URL`, `MOJALOOP_CLIENT_ID`, `MOJALOOP_CLIENT_SECRET` | mojaloop-gateway |
| `tradegateway-tigerbeetle` | `TIGERBEETLE_ADDRESS`, `TIGERBEETLE_CLUSTER_ID` | tigerbeetle-bridge |
| `tradegateway-pagerduty` | `PAGERDUTY_CRITICAL_KEY`, `PAGERDUTY_FINANCIAL_KEY`, `PAGERDUTY_SECURITY_KEY` | alertmanager |
| `tradegateway-slack` | `SLACK_WEBHOOK_OPS`, `SLACK_WEBHOOK_FINANCE`, `SLACK_WEBHOOK_SECURITY` | alertmanager |
| `tradegateway-registry` | `.dockerconfigjson` | all pods (image pull) |
| `tradegateway-tls` | `tls.crt`, `tls.key` | ingress TLS termination |
| `tradegateway-smtp` | `SMTP_PASSWORD` | alertmanager email |
| `tradegateway-permify` | `PERMIFY_ENDPOINT`, `PERMIFY_TOKEN` | keycloak-svc, all auth flows |
| `tradegateway-opencti` | `OPENCTI_URL`, `OPENCTI_TOKEN` | opencti-svc, threat-intel router |
| `tradegateway-wazuh` | `WAZUH_API_URL`, `WAZUH_API_USER`, `WAZUH_API_PASS` | wazuh-svc |
| `tradegateway-apisix` | `APISIX_ADMIN_KEY` | apisix configuration |
| `tradegateway-s3` | `S3_BUCKET`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`, `S3_ENDPOINT` | storage.ts, all file uploads |

## Applying Secrets

```bash
# Apply all sealed secrets to the cluster
kubectl apply -f infra/k8s/secrets/ -n tradegateway

# Verify they were decrypted
kubectl get secrets -n tradegateway
```

## Rotation

To rotate a secret:
1. Update the plaintext value
2. Re-seal: `kubeseal --cert pub-cert.pem < /tmp/new-secret.yaml > infra/k8s/secrets/name.sealed.yaml`
3. Apply: `kubectl apply -f infra/k8s/secrets/name.sealed.yaml`
4. Restart affected pods: `kubectl rollout restart deployment/<name> -n tradegateway`
