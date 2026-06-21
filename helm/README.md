# TradeGateway™ NGSWTP — Helm Chart

Production-grade Helm chart for deploying the TradeGateway National Single Window Trade Platform on Kubernetes.

## Architecture

The chart deploys 8 core services:

| Service | Type | Purpose |
|---------|------|---------|
| `tradegateway-app` | Deployment | Node.js/Express + React application |
| `postgresql` | StatefulSet (Bitnami) | Primary relational database |
| `redis` | StatefulSet (Bitnami) | Session cache and job queues |
| `keycloak` | Deployment | Identity and access management (OIDC/SAML) |
| `permify` | Deployment | Fine-grained RBAC authorization |
| `opensearch` | StatefulSet | Full-text search and log analytics |
| `kafka` | StatefulSet | Event streaming and async workflows |
| `zookeeper` | StatefulSet | Kafka coordination |

Additionally, `apisix` (API Gateway) is included as an optional component.

## Prerequisites

- Kubernetes 1.27+
- Helm 3.12+
- `kubectl` configured for your cluster
- cert-manager (for TLS in production)
- NGINX Ingress Controller (or adjust `ingress.className`)

## Quick Start (Development)

```bash
# Add Bitnami chart repository (for PostgreSQL and Redis dependencies)
helm repo add bitnami https://charts.bitnami.com/bitnami
helm repo update

# Create namespace
kubectl create namespace tradegateway-dev

# Create required secrets
kubectl create secret generic tradegateway-secrets \
  --namespace tradegateway-dev \
  --from-literal=JWT_SECRET="$(openssl rand -hex 32)" \
  --from-literal=VITE_APP_ID="" \
  --from-literal=OAUTH_SERVER_URL="" \
  --from-literal=BUILT_IN_FORGE_API_KEY=""

kubectl create secret generic tradegateway-postgres-secret \
  --namespace tradegateway-dev \
  --from-literal=postgres-password="$(openssl rand -hex 16)" \
  --from-literal=password="$(openssl rand -hex 16)"

kubectl create secret generic tradegateway-redis-secret \
  --namespace tradegateway-dev \
  --from-literal=redis-password="$(openssl rand -hex 16)"

kubectl create secret generic tradegateway-keycloak-secret \
  --namespace tradegateway-dev \
  --from-literal=KEYCLOAK_ADMIN=admin \
  --from-literal=KEYCLOAK_ADMIN_PASSWORD="$(openssl rand -hex 16)"

kubectl create secret generic tradegateway-permify-secret \
  --namespace tradegateway-dev \
  --from-literal=PERMIFY_AUTHN_PRESHARED_KEY="$(openssl rand -hex 32)"

# Update Helm dependencies
helm dependency update ./helm/tradegateway

# Install the chart
helm upgrade --install tradegateway ./helm/tradegateway \
  --namespace tradegateway-dev \
  --create-namespace \
  --wait \
  --timeout 10m
```

## Production Deployment

```bash
# Create production namespace
kubectl create namespace tradegateway-prod

# Create all production secrets (use a secrets manager in production)
# ... (see Quick Start above for secret templates)

# Install with production values overlay
helm upgrade --install tradegateway ./helm/tradegateway \
  --namespace tradegateway-prod \
  --create-namespace \
  -f helm/tradegateway/values.yaml \
  -f helm/tradegateway/values.prod.yaml \
  --set app.image.tag=v60 \
  --wait \
  --timeout 15m
```

## Configuration Reference

### Key Values

| Parameter | Default | Description |
|-----------|---------|-------------|
| `app.replicaCount` | `2` | Number of app replicas |
| `app.image.tag` | `v60` | Docker image tag |
| `app.autoscaling.enabled` | `true` | Enable HPA |
| `app.autoscaling.maxReplicas` | `10` | Maximum replicas |
| `postgresql.enabled` | `true` | Deploy PostgreSQL |
| `redis.enabled` | `true` | Deploy Redis |
| `keycloak.enabled` | `true` | Deploy Keycloak |
| `permify.enabled` | `true` | Deploy Permify |
| `opensearch.enabled` | `true` | Deploy OpenSearch |
| `kafka.enabled` | `true` | Deploy Kafka |
| `zookeeper.enabled` | `true` | Deploy Zookeeper |
| `apisix.enabled` | `true` | Deploy APISIX |
| `ingress.enabled` | `true` | Create Ingress resource |
| `networkPolicy.enabled` | `false` | Enable NetworkPolicy |
| `podDisruptionBudget.enabled` | `false` | Enable PDB |

### Required Kubernetes Secrets

Create these secrets before deploying:

| Secret Name | Keys | Description |
|-------------|------|-------------|
| `tradegateway-secrets` | `JWT_SECRET`, `VITE_APP_ID`, `OAUTH_SERVER_URL`, `BUILT_IN_FORGE_API_KEY` | Application secrets |
| `tradegateway-postgres-secret` | `postgres-password`, `password` | PostgreSQL credentials |
| `tradegateway-redis-secret` | `redis-password` | Redis password |
| `tradegateway-keycloak-secret` | `KEYCLOAK_ADMIN`, `KEYCLOAK_ADMIN_PASSWORD` | Keycloak admin credentials |
| `tradegateway-permify-secret` | `PERMIFY_AUTHN_PRESHARED_KEY` | Permify auth key |

## Upgrading

```bash
# Upgrade to a new version
helm upgrade tradegateway ./helm/tradegateway \
  --namespace tradegateway-prod \
  -f helm/tradegateway/values.yaml \
  -f helm/tradegateway/values.prod.yaml \
  --set app.image.tag=v61 \
  --wait

# Check rollout status
kubectl rollout status deployment/tradegateway-app -n tradegateway-prod
```

## Rollback

```bash
# View release history
helm history tradegateway -n tradegateway-prod

# Rollback to previous release
helm rollback tradegateway -n tradegateway-prod

# Rollback to specific revision
helm rollback tradegateway 3 -n tradegateway-prod
```

## Uninstalling

```bash
# Remove the release (preserves PVCs)
helm uninstall tradegateway -n tradegateway-prod

# Delete PVCs (WARNING: destroys all data)
kubectl delete pvc -n tradegateway-prod -l app.kubernetes.io/instance=tradegateway
```

## Monitoring

The application exposes Prometheus metrics at `/api/metrics`. Add these annotations to enable scraping:

```yaml
app:
  podAnnotations:
    prometheus.io/scrape: "true"
    prometheus.io/port: "9000"
    prometheus.io/path: "/api/metrics"
```

## Troubleshooting

**App pods in CrashLoopBackOff**: Check that all required secrets exist and have the correct keys.

**Keycloak fails to start**: Ensure the PostgreSQL `keycloak` schema exists. The `initdb.scripts` in `values.yaml` creates it automatically on first install.

**OpenSearch OOMKilled**: Increase `opensearch.resources.limits.memory` and adjust `OPENSEARCH_JAVA_OPTS` accordingly (heap should be ~50% of container memory limit).

**Kafka not connecting**: Verify Zookeeper is healthy first (`kubectl logs -n <ns> <zookeeper-pod>`), then check Kafka logs.
