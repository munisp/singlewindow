# TradeGateway™ NGSWTP — Dapr Kubernetes Components

This directory contains Kubernetes-scoped Dapr component manifests for production deployment.
These complement the `infra/dapr/components/` directory (which is used for local development).

## Deployment Order

```bash
# 1. Ensure Dapr is installed in the cluster
dapr init --kubernetes --wait

# 2. Apply Sealed Secrets first (components reference them)
kubectl apply -f infra/k8s/secrets/sealed-secrets-templates.yaml

# 3. Apply Dapr components
kubectl apply -f infra/k8s/dapr/secretstore.yaml

# 4. Verify components are healthy
dapr components -k -n tradegateway
```

## Components in secretstore.yaml

| Component | Type | Purpose |
|---|---|---|
| `kubernetes-secrets` | `secretstores.kubernetes` | Read K8s Secrets via Dapr API |
| `pubsub` | `pubsub.kafka` | Event bus for all inter-service events |
| `statestore` | `state.redis` | Distributed state for workflows |

## Subscriptions

| Subscription | Topic | Consumers |
|---|---|---|
| `declaration-submitted-sub` | `declaration.submitted` | declaration-service, risk-engine |
| `payment-initiated-sub` | `payment.initiated` | payment-service, mojaloop-gateway |
| `payment-confirmed-sub` | `payment.confirmed` | declaration-service, oga-service, cargo-tracking-service |
| `risk-scored-sub` | `risk.scored` | declaration-service, oga-service |
| `oga-decision-sub` | `oga.decision` | declaration-service, cargo-tracking-service |
| `cargo-status-sub` | `cargo.status.updated` | cargo-tracking-service, analytics-service |
| `security-alert-sub` | `security.alert` | risk-engine, analytics-service |

## Relationship to infra/dapr/components/

The `infra/dapr/components/` directory is used for:
- Local development (`dapr run --components-path infra/dapr/components/`)
- Additional bindings (Fluvio, TigerBeetle, Lakehouse, Keycloak)

The `infra/k8s/dapr/` directory is used for:
- Production Kubernetes deployment
- Components that reference Kubernetes Secrets via `secretKeyRef`
- Dapr Subscription CRDs (only available in Kubernetes mode)
