# TradeGateway™ NGSWTP — Production Deployment Guide

**Version:** 1.0.0 | **Sprint:** 50 | **Classification:** Internal — Operations

---

## Table of Contents

1. [Architecture Overview](#1-architecture-overview)
2. [Prerequisites and Tooling](#2-prerequisites-and-tooling)
3. [Kubernetes Namespace Isolation per Tenant](#3-kubernetes-namespace-isolation-per-tenant)
4. [Helm Values Overrides for Multi-Tenant Deployment](#4-helm-values-overrides-for-multi-tenant-deployment)
5. [Secrets Management with Vault and External Secrets Operator](#5-secrets-management-with-vault-and-external-secrets-operator)
6. [TLS Termination at APISIX with cert-manager](#6-tls-termination-at-apisix-with-cert-manager)
7. [Disaster Recovery Procedures](#7-disaster-recovery-procedures)
8. [Tenant Onboarding Runbook](#8-tenant-onboarding-runbook)
9. [Monitoring and Alerting Setup](#9-monitoring-and-alerting-setup)
10. [Security Hardening Checklist](#10-security-hardening-checklist)
11. [Operational Runbooks](#11-operational-runbooks)

---

## 1. Architecture Overview

TradeGateway NGSWTP is deployed as a multi-tenant Kubernetes platform. Each tenant (national customs authority) occupies a dedicated namespace, ensuring hard isolation of workloads, network traffic, and storage. The control plane is shared across all tenants; the data plane is fully partitioned.

| Layer | Technology | Purpose |
|---|---|---|
| Container Orchestration | Kubernetes 1.31+ | Workload scheduling and lifecycle |
| API Gateway | Apache APISIX 3.x | Ingress, rate limiting, mTLS termination |
| Identity & Access | Keycloak 24.x | Per-tenant OIDC realms, SAML federation |
| Service Mesh | Dapr 1.14 | Sidecar-based service-to-service mTLS |
| Event Bus | Apache Kafka 3.8 | Cross-service event streaming |
| Workflow Engine | Temporal 1.24 | Durable clearance workflow orchestration |
| Primary Database | PostgreSQL 16 (TiDB-compatible) | Transactional data, per-tenant schemas |
| Financial Ledger | TigerBeetle 0.16 | Double-entry duty accounting |
| Payments | Mojaloop v15 | ISO 20022 interbank settlement |
| CEP Engine | Apache Flink 1.20 | Real-time trade pattern detection |
| Analytics | Delta Lake + Apache Spark 3.5 | Batch trade statistics |
| Cost Monitoring | Kubecost 2.x | Per-namespace chargeback |
| Security | Wazuh 4.9 + OpenCTI 6.x | SIEM/XDR and threat intelligence |
| Secrets | HashiCorp Vault 1.17 + ESO 0.10 | Secret lifecycle management |
| TLS | cert-manager 1.15 + Let's Encrypt | Automated certificate provisioning |

---

## 2. Prerequisites and Tooling

Before beginning a production deployment, ensure the following tools are installed and configured on the operator workstation.

```bash
# Required CLI versions
kubectl   >= 1.31
helm      >= 3.16
vault     >= 1.17
argocd    >= 2.12   # or flux >= 2.4 for GitOps
kubecost  >= 2.0    # kubectl cost plugin
k9s       >= 0.32   # optional but recommended
```

All Helm charts are maintained in the `deploy/helm/` directory of this repository. The GitOps source of truth is the `main` branch; ArgoCD/Flux watches `deploy/argocd/` for `Application` manifests.

---

## 3. Kubernetes Namespace Isolation per Tenant

### 3.1 Namespace Naming Convention

Each tenant receives three namespaces following the pattern `tradegateway-{tenant_id}-{tier}`:

| Namespace | Purpose |
|---|---|
| `tradegateway-{id}` | Primary application workloads |
| `tradegateway-{id}-data` | Databases, caches, and object storage |
| `tradegateway-{id}-monitoring` | Tenant-scoped Prometheus and Grafana |

The shared control-plane namespace `tradegateway-system` hosts APISIX, Keycloak, Kafka, Temporal, and Kubecost.

### 3.2 Creating a Tenant Namespace

```bash
# Replace GHA with the ISO 3166-1 alpha-3 country code
TENANT_ID="gha-001"
COUNTRY_CODE="gha"

kubectl create namespace tradegateway-${TENANT_ID}
kubectl create namespace tradegateway-${TENANT_ID}-data
kubectl create namespace tradegateway-${TENANT_ID}-monitoring

# Apply standard labels for Kubecost cost allocation
kubectl label namespace tradegateway-${TENANT_ID} \
  app.kubernetes.io/tenant=${TENANT_ID} \
  app.kubernetes.io/country=${COUNTRY_CODE} \
  app.kubernetes.io/managed-by=tradegateway

# Apply ResourceQuota per plan tier (see Section 4)
kubectl apply -f deploy/quotas/${PLAN_TIER}-quota.yaml \
  -n tradegateway-${TENANT_ID}
```

### 3.3 Network Policies

Every tenant namespace is isolated by default using a deny-all ingress/egress policy, with explicit allow rules for required cross-namespace communication.

```yaml
# deploy/network-policies/tenant-default-deny.yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: default-deny-all
spec:
  podSelector: {}
  policyTypes:
    - Ingress
    - Egress
---
# Allow ingress from APISIX gateway only
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: allow-apisix-ingress
spec:
  podSelector: {}
  policyTypes:
    - Ingress
  ingress:
    - from:
        - namespaceSelector:
            matchLabels:
              kubernetes.io/metadata.name: tradegateway-system
          podSelector:
            matchLabels:
              app.kubernetes.io/name: apisix
---
# Allow egress to Kafka, Temporal, and shared data services
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: allow-system-egress
spec:
  podSelector: {}
  policyTypes:
    - Egress
  egress:
    - to:
        - namespaceSelector:
            matchLabels:
              kubernetes.io/metadata.name: tradegateway-system
    - ports:
        - port: 53
          protocol: UDP
        - port: 443
          protocol: TCP
```

### 3.4 ResourceQuota by Plan Tier

| Resource | Starter | Standard | Enterprise |
|---|---|---|---|
| CPU Request | 2 cores | 8 cores | 32 cores |
| CPU Limit | 4 cores | 16 cores | 64 cores |
| Memory Request | 4 Gi | 16 Gi | 64 Gi |
| Memory Limit | 8 Gi | 32 Gi | 128 Gi |
| PVC Storage | 20 Gi | 100 Gi | 500 Gi |
| Max Pods | 20 | 80 | 300 |
| Max Services | 10 | 40 | 150 |

---

## 4. Helm Values Overrides for Multi-Tenant Deployment

### 4.1 Chart Structure

```
deploy/helm/
  tradegateway-core/        ← Shared control plane (APISIX, Keycloak, Kafka, Temporal)
  tradegateway-tenant/      ← Per-tenant application stack
  tradegateway-data/        ← Per-tenant database stack (PostgreSQL, Redis, TigerBeetle)
  tradegateway-monitoring/  ← Per-tenant observability stack
```

### 4.2 Tenant Values File

Create `deploy/helm/values/tenants/{tenant_id}.yaml` for each tenant:

```yaml
# deploy/helm/values/tenants/gha-001.yaml
global:
  tenantId: gha-001
  tenantName: "Ghana Revenue Authority"
  countryCode: GHA
  plan: enterprise
  namespace: tradegateway-gha-001

replicaCounts:
  declarationEngine: 3
  riskEngine: 2
  paymentGateway: 2
  ogaHub: 2
  cargoTracking: 2

keycloak:
  realm: tradegateway-gha
  clientId: tradegateway-gha-client
  adminEmail: admin@gra.gov.gh

apisix:
  routePrefix: /api/gha
  rateLimitRpm: 10000
  jwtIssuer: https://keycloak.tradegateway.example/realms/tradegateway-gha

postgresql:
  database: tradegateway_gha
  schema: gha_001
  maxConnections: 200

resources:
  requests:
    cpu: "4"
    memory: "16Gi"
  limits:
    cpu: "16"
    memory: "32Gi"

autoscaling:
  enabled: true
  minReplicas: 2
  maxReplicas: 10
  targetCPUUtilizationPercentage: 70

persistence:
  storageClass: fast-ssd
  size: 100Gi
```

### 4.3 Deploying a Tenant

```bash
TENANT_ID="gha-001"

# Deploy tenant application stack
helm upgrade --install tradegateway-${TENANT_ID} \
  deploy/helm/tradegateway-tenant \
  --namespace tradegateway-${TENANT_ID} \
  --values deploy/helm/values/tenants/${TENANT_ID}.yaml \
  --values deploy/helm/values/environments/production.yaml \
  --wait --timeout 10m

# Deploy tenant data stack
helm upgrade --install tradegateway-${TENANT_ID}-data \
  deploy/helm/tradegateway-data \
  --namespace tradegateway-${TENANT_ID}-data \
  --values deploy/helm/values/tenants/${TENANT_ID}.yaml \
  --wait --timeout 15m
```

---

## 5. Secrets Management with Vault and External Secrets Operator

### 5.1 Vault Namespace Structure

```
secret/
  tradegateway/
    system/                ← Shared infrastructure secrets
      kafka/
      temporal/
      apisix/
    tenants/
      gha-001/             ← Per-tenant secrets
        database/
        keycloak/
        mojaloop/
        tigerBeetle/
      rwa-001/
        ...
```

### 5.2 Seeding Tenant Secrets

```bash
TENANT_ID="gha-001"
VAULT_PATH="secret/tradegateway/tenants/${TENANT_ID}"

# Database credentials
vault kv put ${VAULT_PATH}/database \
  host="postgres-gha.tradegateway-gha-001-data.svc.cluster.local" \
  port="5432" \
  database="tradegateway_gha" \
  username="tradegateway_app" \
  password="$(openssl rand -base64 32)" \
  ssl_mode="verify-full"

# Keycloak client secret
vault kv put ${VAULT_PATH}/keycloak \
  realm="tradegateway-gha" \
  client_id="tradegateway-gha-client" \
  client_secret="$(openssl rand -hex 32)" \
  jwks_url="https://keycloak.tradegateway.example/realms/tradegateway-gha/protocol/openid-connect/certs"

# JWT signing key
vault kv put ${VAULT_PATH}/jwt \
  secret="$(openssl rand -base64 64)"
```

### 5.3 External Secrets Operator Configuration

```yaml
# deploy/secrets/tenant-external-secret.yaml
apiVersion: external-secrets.io/v1beta1
kind: ExternalSecret
metadata:
  name: tradegateway-secrets
  namespace: tradegateway-gha-001
spec:
  refreshInterval: 1h
  secretStoreRef:
    name: vault-backend
    kind: ClusterSecretStore
  target:
    name: tradegateway-secrets
    creationPolicy: Owner
  data:
    - secretKey: DATABASE_URL
      remoteRef:
        key: secret/tradegateway/tenants/gha-001/database
        property: url
    - secretKey: JWT_SECRET
      remoteRef:
        key: secret/tradegateway/tenants/gha-001/jwt
        property: secret
    - secretKey: KEYCLOAK_CLIENT_SECRET
      remoteRef:
        key: secret/tradegateway/tenants/gha-001/keycloak
        property: client_secret
```

### 5.4 Vault Audit Logging

Enable audit logging to capture all secret access events for compliance:

```bash
vault audit enable file file_path=/vault/logs/audit.log
vault audit enable syslog tag="vault" facility="AUTH"
```

---

## 6. TLS Termination at APISIX with cert-manager

### 6.1 cert-manager ClusterIssuer

```yaml
# deploy/cert-manager/cluster-issuer.yaml
apiVersion: cert-manager.io/v1
kind: ClusterIssuer
metadata:
  name: letsencrypt-prod
spec:
  acme:
    server: https://acme-v02.api.letsencrypt.org/directory
    email: ops@tradegateway.example
    privateKeySecretRef:
      name: letsencrypt-prod-key
    solvers:
      - http01:
          ingress:
            class: apisix
```

### 6.2 Per-Tenant Certificate

```yaml
# deploy/cert-manager/tenant-certificate.yaml
apiVersion: cert-manager.io/v1
kind: Certificate
metadata:
  name: tradegateway-gha-tls
  namespace: tradegateway-system
spec:
  secretName: tradegateway-gha-tls
  issuerRef:
    name: letsencrypt-prod
    kind: ClusterIssuer
  dnsNames:
    - gha.tradegateway.example
    - api.gha.tradegateway.example
```

### 6.3 APISIX Route with TLS

```yaml
# deploy/apisix/tenant-route.yaml
apiVersion: apisix.apache.org/v2
kind: ApisixRoute
metadata:
  name: tradegateway-gha-route
  namespace: tradegateway-system
spec:
  http:
    - name: gha-api
      match:
        hosts:
          - gha.tradegateway.example
        paths:
          - /api/*
      backends:
        - serviceName: tradegateway-api
          servicePort: 3000
          namespace: tradegateway-gha-001
      plugins:
        - name: jwt-auth
          config:
            key: tradegateway-gha-jwt
        - name: limit-req
          config:
            rate: 100
            burst: 200
            key: consumer_name
        - name: opentelemetry
          config:
            sampler:
              name: always_on
```

### 6.4 mTLS Between Services

All service-to-service communication uses Dapr mTLS. The Dapr control plane issues short-lived SPIFFE/X.509 certificates automatically. No manual certificate rotation is required for internal traffic.

```bash
# Verify mTLS is active for a tenant namespace
kubectl exec -n tradegateway-gha-001 deploy/declaration-engine \
  -- daprd --version

# Check Dapr sidecar certificate expiry
kubectl get secret dapr-trust-bundle -n dapr-system -o jsonpath='{.data.ca\.crt}' \
  | base64 -d | openssl x509 -noout -dates
```

---

## 7. Disaster Recovery Procedures

### 7.1 Recovery Objectives

| Scenario | RTO | RPO | Strategy |
|---|---|---|---|
| Single pod failure | < 30 s | 0 | Kubernetes self-healing |
| Node failure | < 5 min | < 1 min | Pod rescheduling + WAL replication |
| Availability zone failure | < 15 min | < 5 min | Multi-AZ pod anti-affinity |
| Database corruption | < 2 h | < 15 min | PITR from continuous WAL archive |
| Full region failure | < 4 h | < 1 h | Cross-region standby cluster |
| Ransomware / data loss | < 8 h | < 24 h | Immutable S3 backup restore |

### 7.2 Database Backup Schedule

PostgreSQL backups use `pgBackRest` with continuous WAL archiving to S3:

```bash
# Full backup — daily at 02:00 UTC
0 2 * * * pgbackrest --stanza=tradegateway-gha backup --type=full

# Incremental backup — every 6 hours
0 6,12,18 * * * pgbackrest --stanza=tradegateway-gha backup --type=incr

# Verify backup integrity — weekly
0 3 * * 0 pgbackrest --stanza=tradegateway-gha verify
```

### 7.3 Point-in-Time Recovery

```bash
# Restore to a specific timestamp
TENANT_ID="gha-001"
TARGET_TIME="2025-03-09 08:00:00+00"

pgbackrest --stanza=tradegateway-${TENANT_ID} restore \
  --target="${TARGET_TIME}" \
  --target-action=promote \
  --db-path=/var/lib/postgresql/data

# Verify data integrity after restore
psql -U tradegateway_app -d tradegateway_gha \
  -c "SELECT COUNT(*) FROM declarations WHERE submitted_at > NOW() - INTERVAL '1 hour';"
```

### 7.4 TigerBeetle Recovery

TigerBeetle uses a replicated state machine. Recovery requires a quorum of replicas:

```bash
# Check replica health
kubectl exec -n tradegateway-gha-001-data deploy/tigerBeetle \
  -- ./tigerbeetle inspect cluster

# Restore from snapshot (if quorum is lost)
kubectl exec -n tradegateway-gha-001-data deploy/tigerBeetle \
  -- ./tigerbeetle recover --snapshot=/backups/latest.snap
```

### 7.5 Cross-Region Failover Procedure

1. Confirm primary region is unreachable (automated health check fails for > 5 minutes).
2. Promote the standby PostgreSQL replica in the DR region: `pg_ctl promote`.
3. Update DNS records to point `gha.tradegateway.example` to the DR region load balancer (TTL should be pre-set to 60 seconds).
4. Verify APISIX routes are active in the DR cluster.
5. Notify the tenant operations team via PagerDuty.
6. Begin root cause analysis on the primary region.
7. Once primary is restored, perform a controlled failback during a maintenance window.

---

## 8. Tenant Onboarding Runbook

This runbook takes a new tenant from zero to their first processed declaration. Estimated time: 45–90 minutes.

### Step 1 — Gather Tenant Information

Collect the following before starting:

| Field | Example |
|---|---|
| Tenant ID | `gha-001` |
| Country Code (ISO 3166-1 alpha-3) | `GHA` |
| Organisation Name | Ghana Revenue Authority |
| Plan Tier | `enterprise` |
| Primary Admin Email | `admin@gra.gov.gh` |
| Keycloak Realm Name | `tradegateway-gha` |
| API Subdomain | `gha.tradegateway.example` |
| OGA Count | 12 |

### Step 2 — Create Tenant Record via API

```bash
curl -X POST https://admin.tradegateway.example/api/trpc/tenant.createTenant \
  -H "Authorization: Bearer ${ADMIN_JWT}" \
  -H "Content-Type: application/json" \
  -d '{
    "json": {
      "name": "Ghana Revenue Authority",
      "countryCode": "GHA",
      "plan": "enterprise",
      "adminEmail": "admin@gra.gov.gh",
      "keycloakRealm": "tradegateway-gha"
    }
  }'
```

### Step 3 — Provision Kubernetes Namespaces

```bash
TENANT_ID="gha-001"
./scripts/provision-tenant-namespaces.sh ${TENANT_ID} enterprise
```

### Step 4 — Seed Vault Secrets

```bash
./scripts/seed-tenant-secrets.sh ${TENANT_ID}
# Prompts for database password, JWT secret, and Keycloak client secret
```

### Step 5 — Deploy Tenant Helm Charts

```bash
helm upgrade --install tradegateway-${TENANT_ID} \
  deploy/helm/tradegateway-tenant \
  --namespace tradegateway-${TENANT_ID} \
  --values deploy/helm/values/tenants/${TENANT_ID}.yaml \
  --wait --timeout 15m
```

### Step 6 — Provision Keycloak Realm

```bash
curl -X POST https://admin.tradegateway.example/api/trpc/tenant.provisionKeycloakRealm \
  -H "Authorization: Bearer ${ADMIN_JWT}" \
  -H "Content-Type: application/json" \
  -d '{"json": {"tenantId": "gha-001"}}'
```

### Step 7 — Run Database Migrations

```bash
kubectl exec -n tradegateway-${TENANT_ID} deploy/tradegateway-api \
  -- pnpm db:push
```

### Step 8 — Configure APISIX Routes

```bash
kubectl apply -f deploy/apisix/tenants/${TENANT_ID}-route.yaml -n tradegateway-system
```

### Step 9 — Issue TLS Certificate

```bash
kubectl apply -f deploy/cert-manager/tenants/${TENANT_ID}-certificate.yaml
# Wait for certificate to be issued (typically 60–120 seconds)
kubectl wait --for=condition=Ready certificate/tradegateway-${TENANT_ID}-tls \
  -n tradegateway-system --timeout=5m
```

### Step 10 — Smoke Test

```bash
# Health check
curl https://gha.tradegateway.example/api/health

# Submit a test declaration
./scripts/smoke-test-declaration.sh ${TENANT_ID}
# Expected: declaration processed with URN, risk score assigned, status = GREEN
```

### Step 11 — Notify Tenant Admin

Send the following to the tenant's primary admin email:
- Portal URL: `https://gha.tradegateway.example`
- Initial admin credentials (temporary password, must be changed on first login)
- API documentation URL
- Support contact

---

## 9. Monitoring and Alerting Setup

### 9.1 Prometheus Scrape Configuration

Each tenant namespace runs a dedicated Prometheus instance that scrapes workloads within its namespace only. A central Thanos Querier aggregates metrics across all tenants for platform-level dashboards.

```yaml
# deploy/monitoring/tenant-prometheus.yaml
apiVersion: monitoring.coreos.com/v1
kind: Prometheus
metadata:
  name: tenant-prometheus
  namespace: tradegateway-gha-001-monitoring
spec:
  replicas: 2
  retention: 15d
  serviceMonitorNamespaceSelector:
    matchLabels:
      app.kubernetes.io/tenant: gha-001
  ruleNamespaceSelector:
    matchLabels:
      app.kubernetes.io/tenant: gha-001
  thanos:
    objectStorageConfig:
      key: thanos.yaml
      name: thanos-objstore-secret
```

### 9.2 Key Alerting Rules

```yaml
# deploy/monitoring/tradegateway-alerts.yaml
groups:
  - name: tradegateway.clearance
    rules:
      - alert: ClearanceLatencyHigh
        expr: histogram_quantile(0.95, rate(declaration_clearance_duration_seconds_bucket[5m])) > 14400
        for: 10m
        labels:
          severity: warning
        annotations:
          summary: "P95 clearance time exceeds 4-hour SLA"

      - alert: DeclarationQueueDepthHigh
        expr: declaration_queue_depth > 500
        for: 5m
        labels:
          severity: critical
        annotations:
          summary: "Declaration queue depth exceeds 500 — risk of SLA breach"

      - alert: RiskEngineDown
        expr: up{job="risk-engine"} == 0
        for: 2m
        labels:
          severity: critical
        annotations:
          summary: "Risk AI engine is unreachable — all declarations will be RED-laned"

  - name: tradegateway.security
    rules:
      - alert: CEPHighSeverityAlert
        expr: increase(cep_alerts_total{severity="high"}[5m]) > 0
        labels:
          severity: warning
        annotations:
          summary: "New high-severity trade fraud pattern detected"

      - alert: WazuhCriticalEvent
        expr: increase(wazuh_events_total{level="critical"}[5m]) > 0
        labels:
          severity: critical
        annotations:
          summary: "Critical security event detected by Wazuh SIEM"
```

### 9.3 Grafana Dashboard Inventory

| Dashboard | Purpose | Audience |
|---|---|---|
| Platform Overview | Cross-tenant declaration throughput, SLA compliance | Platform Ops |
| Tenant Operations | Per-tenant clearance metrics, queue depth, error rates | Tenant Admins |
| Risk Engine | ML model accuracy, feature drift, score distribution | Risk Analysts |
| Financial Ledger | Duty collection rates, payment success/failure | Finance |
| CEP Fraud Alerts | Pattern detection rates, alert resolution time | Compliance |
| Kubecost | Per-tenant cost allocation, idle resource waste | FinOps |
| Security (Wazuh) | SIEM events, threat level timeline, top rules fired | Security Ops |

### 9.4 PagerDuty Integration

```bash
# Configure Alertmanager to route critical alerts to PagerDuty
kubectl create secret generic pagerduty-key \
  --from-literal=serviceKey=${PAGERDUTY_SERVICE_KEY} \
  -n tradegateway-system

# Apply Alertmanager configuration
kubectl apply -f deploy/monitoring/alertmanager-config.yaml
```

---

## 10. Security Hardening Checklist

The following checklist is based on the CIS Kubernetes Benchmark v1.9 and NIST SP 800-190.

### 10.1 Cluster-Level Controls

| Control | Status | Notes |
|---|---|---|
| API server anonymous auth disabled | Required | `--anonymous-auth=false` |
| API server audit logging enabled | Required | Log all `write` and `delete` verbs |
| etcd encrypted at rest | Required | `--encryption-provider-config` with AES-GCM |
| etcd TLS peer communication | Required | Mutual TLS between etcd peers |
| RBAC enabled | Required | `--authorization-mode=RBAC` |
| Node restriction admission plugin | Required | Prevents node-to-node lateral movement |
| Pod Security Standards enforced | Required | `restricted` profile on all tenant namespaces |
| Network policies applied | Required | Default-deny-all per namespace |
| Secrets not in environment variables | Required | Use Vault + ESO only |
| Image pull policy `Always` | Required | Prevents stale image execution |
| Container registries allowlisted | Required | OPA/Gatekeeper policy |

### 10.2 Workload-Level Controls

```yaml
# Required security context for all tenant workloads
securityContext:
  runAsNonRoot: true
  runAsUser: 1000
  runAsGroup: 1000
  readOnlyRootFilesystem: true
  allowPrivilegeEscalation: false
  seccompProfile:
    type: RuntimeDefault
  capabilities:
    drop:
      - ALL
```

### 10.3 Network Security

All external traffic enters through APISIX, which enforces:
- TLS 1.3 minimum (TLS 1.2 for legacy OGA systems with documented exception)
- OWASP Top-10 WAF rules via OpenAppSec
- JWT validation on all `/api/trpc` routes
- Rate limiting per consumer key (configurable per plan tier)
- IP allowlisting for government agency integrations

### 10.4 Compliance Scanning Schedule

```bash
# CIS benchmark scan — weekly
kube-bench run --targets=master,node,etcd,policies

# Container image vulnerability scan — on every CI push
trivy image tradegateway/api:${VERSION} --exit-code 1 --severity CRITICAL,HIGH

# Kubernetes manifest security scan — on every PR
kubesec scan deploy/helm/tradegateway-tenant/templates/*.yaml

# Runtime threat detection — continuous
# Wazuh agent deployed as DaemonSet; alerts forwarded to OpenSearch
```

---

## 11. Operational Runbooks

### 11.1 Rolling Restart of a Tenant Service

```bash
TENANT_ID="gha-001"
SERVICE="declaration-engine"

kubectl rollout restart deployment/${SERVICE} -n tradegateway-${TENANT_ID}
kubectl rollout status deployment/${SERVICE} -n tradegateway-${TENANT_ID} --timeout=5m
```

### 11.2 Scaling a Tenant Service

```bash
# Manual scale (temporary)
kubectl scale deployment/risk-engine --replicas=5 -n tradegateway-${TENANT_ID}

# Permanent scale (update Helm values and re-deploy)
yq e '.replicaCounts.riskEngine = 5' -i deploy/helm/values/tenants/${TENANT_ID}.yaml
helm upgrade tradegateway-${TENANT_ID} deploy/helm/tradegateway-tenant \
  --namespace tradegateway-${TENANT_ID} \
  --values deploy/helm/values/tenants/${TENANT_ID}.yaml \
  --reuse-values
```

### 11.3 Suspending a Tenant

```bash
# Via API (preferred — updates DB status and triggers cleanup)
curl -X POST https://admin.tradegateway.example/api/trpc/tenant.suspendTenant \
  -H "Authorization: Bearer ${ADMIN_JWT}" \
  -d '{"json": {"tenantId": "gha-001", "reason": "Non-payment"}}'

# Manual fallback — scale all deployments to zero
kubectl scale deployment --all --replicas=0 -n tradegateway-${TENANT_ID}
```

### 11.4 Emergency Declaration Queue Drain

If the declaration queue exceeds 1,000 items and clearance latency is degrading:

```bash
# 1. Scale risk engine horizontally
kubectl scale deployment/risk-engine --replicas=8 -n tradegateway-${TENANT_ID}

# 2. Temporarily increase Temporal workflow concurrency
kubectl set env deployment/temporal-worker \
  MAX_CONCURRENT_WORKFLOW_TASK_POLLERS=20 \
  -n tradegateway-${TENANT_ID}

# 3. Monitor queue depth
watch -n 5 'kubectl exec -n tradegateway-${TENANT_ID} deploy/tradegateway-api \
  -- curl -s localhost:3000/api/metrics | grep declaration_queue_depth'
```

### 11.5 Certificate Renewal

cert-manager renews certificates automatically 30 days before expiry. To force immediate renewal:

```bash
kubectl annotate certificate tradegateway-${TENANT_ID}-tls \
  cert-manager.io/issue-temporary-certificate="true" \
  -n tradegateway-system

# Verify new certificate
kubectl get certificate tradegateway-${TENANT_ID}-tls -n tradegateway-system -o yaml \
  | grep -A5 "status:"
```

---

*This document is maintained by the TradeGateway Platform Engineering team. For corrections or additions, open a pull request against `docs/PRODUCTION-DEPLOY.md` in the main repository.*

*Last updated: 2026-03-09 | Author: Manus AI*
