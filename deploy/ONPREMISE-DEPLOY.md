# TradeGateway™ NGSWTP — RustFS On-Premise Deployment Guide

**Version:** Sprint 28 | **Last Updated:** March 2026

---

## Overview

This guide covers deploying RustFS — the S3-compatible object storage backend for the TradeGateway Document Vault — on an on-premise Kubernetes cluster with optional OpenStack Swift as the durable storage layer. Two deployment paths are supported:

| Path | When to Use | Scalability |
|---|---|---|
| **Local PVC** | Single-node or small clusters with direct-attached storage | Single replica (RWO PVC) |
| **OpenStack Swift** | Multi-node HA clusters with existing OpenStack infrastructure | Horizontal scale (stateless pods) |

---

## Prerequisites

The following tools and infrastructure components must be available before proceeding.

**Tooling required on the operator workstation:**

- `kubectl` ≥ 1.28 configured against the target cluster
- `helm` ≥ 3.14 (for Helm-based deployment)
- `docker` or `podman` (to build the `rustfs-svc` container image)

**Cluster requirements:**

- Kubernetes ≥ 1.26
- NGINX Ingress Controller (or equivalent)
- `cert-manager` for TLS certificate issuance (optional but recommended)
- A default `StorageClass` that supports `ReadWriteOnce` (for local PVC path)
- Network access from the `tradegateway-app` namespace to `tradegateway-storage` namespace

**OpenStack requirements (Swift path only):**

- OpenStack Yoga or later with Swift object storage enabled
- Keystone v3 identity service reachable from the Kubernetes cluster
- A dedicated OpenStack project (`tradegateway-prod`) and service user (`rustfs-svc`)

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│  Kubernetes Cluster                                                  │
│                                                                      │
│  ┌─────────────────────────┐    ┌──────────────────────────────┐    │
│  │  tradegateway-app ns    │    │  tradegateway-storage ns     │    │
│  │                         │    │                              │    │
│  │  ┌─────────────────┐    │    │  ┌──────────────────────┐   │    │
│  │  │  Express/tRPC   │───HTTP──▶  │  rustfs-svc (Go)     │   │    │
│  │  │  Backend        │    │    │  │  :4500               │   │    │
│  │  └─────────────────┘    │    │  └──────────┬───────────┘   │    │
│  └─────────────────────────┘    │             │ S3 API         │    │
│                                 │  ┌──────────▼───────────┐   │    │
│                                 │  │  RustFS              │   │    │
│                                 │  │  :9000 (S3 API)      │   │    │
│                                 │  │  :9001 (Console)     │   │    │
│                                 │  └──────────┬───────────┘   │    │
│                                 │             │                │    │
│                                 │  ┌──────────▼───────────┐   │    │
│                                 │  │  Local PVC  OR        │   │    │
│                                 │  │  OpenStack Swift      │   │    │
│                                 │  └──────────────────────┘   │    │
│                                 └──────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Option A — Helm Deployment (Recommended)

### Step 1: Create the namespace

```bash
kubectl apply -f deploy/k8s/rustfs-namespace.yaml
```

### Step 2: Create credential secrets

Never commit plaintext credentials. Use `kubectl create secret` or a secrets manager (Vault, Sealed Secrets, External Secrets Operator).

```bash
# S3 API credentials
kubectl create secret generic rustfs-s3-creds \
  --namespace tradegateway-storage \
  --from-literal=access-key='<your-access-key>' \
  --from-literal=secret-key='<your-secret-key>'

# OpenStack credentials (Swift path only)
kubectl create secret generic rustfs-openstack-creds \
  --namespace tradegateway-storage \
  --from-literal=os-password='<openstack-service-user-password>'
```

### Step 3: Install with Helm

**Local PVC backend (default):**

```bash
helm install rustfs ./deploy/helm/rustfs \
  --namespace tradegateway-storage \
  --set credentials.existingSecret=rustfs-s3-creds \
  --set storage.local.storageClass=<your-storageclass>
```

**OpenStack Swift backend:**

```bash
helm install rustfs ./deploy/helm/rustfs \
  --namespace tradegateway-storage \
  -f ./deploy/helm/rustfs/values-openstack.yaml \
  --set storage.openstack.authUrl=https://keystone.your-openstack.example.com:5000/v3 \
  --set storage.openstack.projectName=tradegateway-prod \
  --set storage.openstack.username=rustfs-svc
```

### Step 4: Verify

```bash
# Check pod status
kubectl get pods -n tradegateway-storage -l app.kubernetes.io/name=rustfs

# Check bucket init job completed
kubectl get jobs -n tradegateway-storage

# Test S3 API health
kubectl port-forward svc/rustfs 9000:9000 -n tradegateway-storage &
curl http://localhost:9000/minio/health/ready
```

---

## Option B — Raw kubectl Deployment

For teams that prefer not to use Helm:

```bash
# Create namespace
kubectl apply -f deploy/k8s/rustfs-namespace.yaml

# Create credentials secret (edit base64 values first)
kubectl apply -f deploy/k8s/rustfs-all-in-one.yaml

# Verify
kubectl rollout status deployment/rustfs -n tradegateway-storage
```

---

## Building and Deploying rustfs-svc (Go Microservice)

The `rustfs-svc` Go microservice acts as the HTTP bridge between the tRPC backend and RustFS. It must be containerised and pushed to your internal container registry.

```bash
# Build the image
docker build -t registry.tradegateway.gov/rustfs-svc:latest ./rustfs-svc

# Push to your internal registry
docker push registry.tradegateway.gov/rustfs-svc:latest

# Deploy to Kubernetes
kubectl apply -f deploy/k8s/rustfs-svc-deployment.yaml
```

Update the `RUSTFS_ENDPOINT` in `deploy/k8s/rustfs-svc-deployment.yaml` to point to the RustFS service DNS name:

```
http://rustfs.tradegateway-storage.svc.cluster.local:9000
```

---

## OpenStack Swift Integration Details

When `storage.backend = "openstack-swift"`, RustFS uses the OpenStack Swift object storage as its durable backend via the S3-Swift gateway protocol. The following environment variables are injected into the RustFS pod:

| Variable | Purpose |
|---|---|
| `OS_AUTH_URL` | Keystone v3 identity endpoint |
| `OS_PROJECT_NAME` | OpenStack project / tenant |
| `OS_PROJECT_DOMAIN_NAME` | Project domain (usually `Default`) |
| `OS_USERNAME` | Service user for RustFS |
| `OS_PASSWORD` | Service user password (from Kubernetes Secret) |
| `OS_USER_DOMAIN_NAME` | User domain (usually `Default`) |
| `OS_CONTAINER_PREFIX` | Swift container prefix for bucket namespacing |
| `OS_REGION_NAME` | OpenStack region (e.g., `RegionOne`) |

**OpenStack prerequisites:**

```bash
# Create the service project and user in OpenStack
openstack project create tradegateway-prod --domain Default
openstack user create rustfs-svc --password <password> --domain Default
openstack role add --project tradegateway-prod --user rustfs-svc _member_
openstack role add --project tradegateway-prod --user rustfs-svc swiftoperator

# Verify Swift is accessible
swift --os-auth-url https://keystone.example.com:5000/v3 \
      --os-username rustfs-svc \
      --os-password <password> \
      --os-project-name tradegateway-prod \
      --os-identity-api-version 3 \
      stat
```

---

## TLS Configuration

For production deployments, TLS should be terminated at the Ingress layer using `cert-manager`:

```bash
# Install cert-manager (if not already installed)
kubectl apply -f https://github.com/cert-manager/cert-manager/releases/latest/download/cert-manager.yaml

# Create a ClusterIssuer for Let's Encrypt (or your internal CA)
kubectl apply -f - <<EOF
apiVersion: cert-manager.io/v1
kind: ClusterIssuer
metadata:
  name: letsencrypt-prod
spec:
  acme:
    server: https://acme-v02.api.letsencrypt.org/directory
    email: platform@tradegateway.gov
    privateKeySecretRef:
      name: letsencrypt-prod
    solvers:
      - http01:
          ingress:
            class: nginx
EOF
```

For air-gapped or internal deployments, replace the ACME issuer with your organisation's internal CA using `cert-manager`'s `CA` issuer type.

---

## Monitoring and Observability

RustFS exposes Prometheus metrics at `/minio/v2/metrics/cluster`. Add the following `ServiceMonitor` if you have the Prometheus Operator installed:

```yaml
apiVersion: monitoring.coreos.com/v1
kind: ServiceMonitor
metadata:
  name: rustfs
  namespace: tradegateway-storage
spec:
  selector:
    matchLabels:
      app.kubernetes.io/name: rustfs
  endpoints:
    - port: s3-api
      path: /minio/v2/metrics/cluster
      interval: 30s
```

---

## Upgrading

```bash
# Upgrade via Helm
helm upgrade rustfs ./deploy/helm/rustfs \
  --namespace tradegateway-storage \
  --reuse-values \
  --set image.tag=<new-version>

# Monitor rollout
kubectl rollout status deployment/rustfs -n tradegateway-storage
```

> **Note:** When using the local PVC backend, the `Recreate` deployment strategy means there will be a brief downtime during upgrades. For zero-downtime upgrades, migrate to the OpenStack Swift backend and switch to `RollingUpdate` strategy.

---

## Troubleshooting

| Symptom | Likely Cause | Resolution |
|---|---|---|
| Pod stuck in `Pending` | PVC not bound | Check `kubectl get pvc -n tradegateway-storage` and StorageClass availability |
| `ECONNREFUSED` from tRPC backend | `rustfs-svc` cannot reach RustFS | Verify `RUSTFS_ENDPOINT` DNS resolves within the cluster |
| `403 Forbidden` on S3 API | Wrong access key / secret key | Re-check the `rustfs-credentials` secret values |
| OpenStack auth failure | Keystone unreachable or wrong credentials | Run `openstack token issue` from within the cluster to verify connectivity |
| Bucket init job fails | RustFS not ready when job runs | Job has a `wait-for-rustfs` init container; check its logs |
| Presigned URLs not working | Ingress hostname mismatch | Ensure `RUSTFS_ENDPOINT` in `rustfs-svc-config` matches the external hostname |
