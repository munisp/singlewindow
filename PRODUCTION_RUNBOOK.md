# TradeGateway™ NGSWTP — Production Runbook

**Version:** v23 | **Last Updated:** 2026-04-14 | **Audience:** SRE / DevOps / Platform Engineers

---

## Table of Contents

1. [Architecture Overview](#1-architecture-overview)
2. [Pre-Deployment Checklist](#2-pre-deployment-checklist)
3. [Environment Variables Reference](#3-environment-variables-reference)
4. [Kubernetes Deployment](#4-kubernetes-deployment)
5. [Database Operations](#5-database-operations)
6. [Seed Data](#6-seed-data)
7. [Middleware Configuration](#7-middleware-configuration)
8. [Health Checks & Monitoring](#8-health-checks--monitoring)
9. [Security Hardening](#9-security-hardening)
10. [Incident Response Playbooks](#10-incident-response-playbooks)
11. [Backup & Disaster Recovery](#11-backup--disaster-recovery)
12. [Scaling Guide](#12-scaling-guide)
13. [Go-Live Checklist](#13-go-live-checklist)

---

## 1. Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                    PRESENTATION LAYER                           │
│  React PWA  │  React Native  │  Flutter  │  REST/GraphQL API   │
└──────────────────────────┬──────────────────────────────────────┘
                           │ HTTPS / WSS
┌──────────────────────────▼──────────────────────────────────────┐
│                    API GATEWAY LAYER                            │
│  Apache APISIX (API Gateway)  │  OpenAppSec (AI WAF)           │
│  Keycloak (IAM/OIDC/SAML)     │  Rate Limiting (Redis)         │
└──────────────────────────┬──────────────────────────────────────┘
                           │ tRPC / gRPC
┌──────────────────────────▼──────────────────────────────────────┐
│                    MICROSERVICES LAYER (Go)                     │
│  declaration-engine  │  risk-engine  │  cargo-tracking         │
│  payment-gateway     │  document-mgmt│  oga-integration-hub    │
│  aeo-service         │  post-clearance│  mojaloop-gateway      │
│  temporal-query-svc  │  fluvio-consumer│  workflow-service     │
└──────────────────────────┬──────────────────────────────────────┘
                           │ Kafka / Dapr / Fluvio
┌──────────────────────────▼──────────────────────────────────────┐
│                    DATA LAYER                                   │
│  MySQL/TiDB (primary)  │  Redis (cache/rate-limit/sessions)    │
│  TigerBeetle (ledger)  │  Delta Lake + Flink (analytics)       │
│  OpenSearch (logs)     │  S3 (documents)                       │
└─────────────────────────────────────────────────────────────────┘
```

---

## 2. Pre-Deployment Checklist

### Infrastructure
- [ ] Kubernetes cluster ≥ 1.28 provisioned (3 master, 5+ worker nodes)
- [ ] TiDB Cloud or MySQL 8.0+ cluster ready with connection string
- [ ] Redis 7.x cluster (3 nodes minimum for HA)
- [ ] S3-compatible object storage (AWS S3, MinIO, or GCS)
- [ ] Kafka cluster (Strimzi on K8s or Confluent Cloud)
- [ ] TigerBeetle 0.15+ instance (or use simulation mode)
- [ ] Temporal Cloud or self-hosted Temporal cluster
- [ ] Keycloak 23+ instance with realm configured

### DNS & TLS
- [ ] Domain registered and DNS A records pointing to load balancer
- [ ] TLS certificate issued (Let's Encrypt or commercial CA)
- [ ] HSTS preload submitted at https://hstspreload.org
- [ ] CDN configured for static assets

### Secrets
- [ ] All environment variables in Section 3 populated in K8s secrets
- [ ] Keycloak client secret rotated from default
- [ ] JWT_SECRET is 256-bit random value (not default)
- [ ] Database credentials are service-account credentials (not root)

---

## 3. Environment Variables Reference

### Core Application
```bash
# Database
DATABASE_URL=mysql://tradegateway:PASSWORD@tidb-host:4000/tradegateway_prod

# Authentication
JWT_SECRET=<256-bit-random-hex>                    # REQUIRED — rotate every 90 days
VITE_APP_ID=<manus-oauth-app-id>                   # REQUIRED — from Manus OAuth portal
OAUTH_SERVER_URL=https://api.manus.im              # REQUIRED
VITE_OAUTH_PORTAL_URL=https://auth.manus.im        # REQUIRED

# Owner info
OWNER_OPEN_ID=<your-manus-open-id>
OWNER_NAME=<your-name>
```

### Middleware
```bash
# Redis
REDIS_URL=redis://:PASSWORD@redis-host:6379/0      # REQUIRED for rate limiting & sessions

# Permify (Fine-grained RBAC)
PERMIFY_ENDPOINT=http://permify:3476               # REQUIRED for production RBAC
PERMIFY_API_KEY=<permify-api-key>                  # Optional if using open Permify

# Kafka
KAFKA_BROKERS=kafka-0:9092,kafka-1:9092,kafka-2:9092
KAFKA_SASL_USERNAME=tradegateway
KAFKA_SASL_PASSWORD=<kafka-password>

# TigerBeetle
TIGERBEETLE_ADDRESS=tigerbeetle:3000
TIGERBEETLE_CLUSTER_ID=0                           # Use 0 for single-cluster

# Temporal
TEMPORAL_HOST=temporal-frontend:7233
TEMPORAL_NAMESPACE=tradegateway-prod

# Keycloak
KEYCLOAK_URL=https://keycloak.yourdomain.com
KEYCLOAK_REALM=tradegateway
KEYCLOAK_CLIENT_ID=tradegateway-api
KEYCLOAK_CLIENT_SECRET=<keycloak-client-secret>
```

### Storage & AI
```bash
# S3 Object Storage
AWS_ACCESS_KEY_ID=<access-key>
AWS_SECRET_ACCESS_KEY=<secret-key>
AWS_REGION=af-south-1                              # Africa (Cape Town) recommended
S3_BUCKET_NAME=tradegateway-documents-prod
S3_ENDPOINT=https://s3.amazonaws.com               # Override for MinIO/GCS

# Manus Built-in APIs (LLM, Image Gen, etc.)
BUILT_IN_FORGE_API_URL=https://api.manus.im
BUILT_IN_FORGE_API_KEY=<forge-api-key>
VITE_FRONTEND_FORGE_API_KEY=<frontend-forge-key>
VITE_FRONTEND_FORGE_API_URL=https://api.manus.im

# Email (SendGrid)
SENDGRID_API_KEY=SG.<your-sendgrid-key>
SENDGRID_FROM_EMAIL=noreply@tradegateway.gov
SENDGRID_FROM_NAME=TradeGateway NGSWTP
```

### Observability
```bash
# Analytics
VITE_ANALYTICS_ENDPOINT=https://analytics.yourdomain.com
VITE_ANALYTICS_WEBSITE_ID=<website-id>

# DEMO_MODE (disable for production!)
DEMO_MODE=false                                    # CRITICAL: must be false in production
```

---

## 4. Kubernetes Deployment

### Quick Deploy
```bash
# 1. Clone the repository
git clone https://github.com/your-org/tradegateway-ngswtp.git
cd tradegateway-ngswtp

# 2. Create namespace
kubectl create namespace tradegateway

# 3. Create secrets from .env file
kubectl create secret generic tradegateway-secrets \
  --from-env-file=.env.production \
  --namespace=tradegateway

# 4. Deploy with Helm
helm upgrade --install tradegateway ./infra/helm/tradegateway \
  --namespace=tradegateway \
  --values=infra/helm/tradegateway/values.production.yaml \
  --wait --timeout=10m

# 5. Verify deployment
kubectl get pods -n tradegateway
kubectl rollout status deployment/tradegateway-web -n tradegateway
```

### Helm Values (Production)
Key overrides in `infra/helm/tradegateway/values.production.yaml`:
```yaml
replicaCount: 3
image:
  repository: your-registry/tradegateway
  tag: "v23.0.0"
resources:
  requests:
    cpu: "500m"
    memory: "512Mi"
  limits:
    cpu: "2000m"
    memory: "2Gi"
autoscaling:
  enabled: true
  minReplicas: 3
  maxReplicas: 20
  targetCPUUtilizationPercentage: 70
```

### Rolling Update
```bash
# Update image tag
kubectl set image deployment/tradegateway-web \
  web=your-registry/tradegateway:v23.1.0 \
  -n tradegateway

# Monitor rollout
kubectl rollout status deployment/tradegateway-web -n tradegateway

# Rollback if needed
kubectl rollout undo deployment/tradegateway-web -n tradegateway
```

---

## 5. Database Operations

### Initial Schema Migration
```bash
# Push schema to production database
DATABASE_URL="mysql://..." pnpm db:push

# Verify tables created
mysql -h tidb-host -u tradegateway -p tradegateway_prod -e "SHOW TABLES;"
```

### Seed Production Data
```bash
# Seed all tables with realistic demo data
DATABASE_URL="mysql://..." pnpm db:seed:all

# Or seed individual scripts:
DATABASE_URL="mysql://..." node scripts/seed-declarations.mjs
DATABASE_URL="mysql://..." node scripts/seed-payments.mjs
DATABASE_URL="mysql://..." node scripts/seed-comprehensive.mjs
```

### Backup
```bash
# Daily backup (add to cron)
mysqldump -h tidb-host -u tradegateway -p tradegateway_prod \
  --single-transaction --routines --triggers \
  | gzip > backup-$(date +%Y%m%d).sql.gz

# Upload to S3
aws s3 cp backup-$(date +%Y%m%d).sql.gz \
  s3://tradegateway-backups/db/backup-$(date +%Y%m%d).sql.gz
```

### Common Queries
```sql
-- Check declaration queue by status
SELECT status, COUNT(*) as count FROM declarations GROUP BY status;

-- Find SLA-breached declarations (>4 hours in assessment)
SELECT declaration_number, created_at, status
FROM declarations
WHERE status IN ('under_assessment', 'pending_payment')
  AND TIMESTAMPDIFF(HOUR, created_at, NOW()) > 4;

-- Promote user to admin
UPDATE users SET role = 'admin' WHERE email = 'admin@customs.gov';

-- Check payment reconciliation
SELECT p.declaration_id, p.amount, p.status, p.payment_reference
FROM payments p
JOIN declarations d ON p.declaration_id = d.id
WHERE p.status = 'pending' AND p.created_at < NOW() - INTERVAL 24 HOUR;
```

---

## 6. Seed Data

The platform ships with comprehensive seed scripts:

| Script | Tables Seeded | Records |
|--------|--------------|---------|
| `seed-declarations.mjs` | declarations, declaration_documents | 50 declarations |
| `seed-payments.mjs` | payments, payment_transactions | 50 payments |
| `seed-comprehensive.mjs` | All 50+ remaining tables | 500+ records |

### Default Admin Credentials
After seeding, the following demo accounts are available:
- **Admin:** `admin@customs.gov` (role: admin)
- **Officer:** `officer@customs.gov` (role: customs_officer)
- **Trader:** `trader@company.com` (role: trader)

> **IMPORTANT:** Change all default passwords before go-live.

---

## 7. Middleware Configuration

### Keycloak Realm Setup
```bash
# Import realm configuration
/opt/keycloak/bin/kc.sh import \
  --file infra/keycloak/realm-production.json \
  --override true

# Create initial admin user
/opt/keycloak/bin/kcadm.sh create users \
  -r tradegateway \
  -s username=admin \
  -s email=admin@customs.gov \
  -s enabled=true
```

### Permify Schema Migration
```bash
# Apply RBAC schema
curl -X POST http://permify:3476/v1/schemas/write \
  -H "Content-Type: application/json" \
  -d @infra/permify/schema.perm

# Verify schema
curl http://permify:3476/v1/schemas/read
```

### Kafka Topic Provisioning
```bash
# Create all required topics
bash infra/kafka/provision-topics.sh

# Verify topics
kafka-topics.sh --bootstrap-server kafka:9092 --list | grep tradegateway
```

### APISIX Routes
```bash
# Apply APISIX configuration
apisix start -c infra/apisix/apisix.yaml

# Apply route definitions
curl -X PUT http://apisix:9080/apisix/admin/routes \
  -H "X-API-KEY: $APISIX_ADMIN_KEY" \
  -d @infra/apisix/routes.yaml
```

### TigerBeetle Initialization
```bash
# Format TigerBeetle data file (first time only)
./tigerbeetle format --cluster=0 --replica=0 --replica-count=1 0_0.tigerbeetle

# Start TigerBeetle
./tigerbeetle start --addresses=0.0.0.0:3000 0_0.tigerbeetle
```

---

## 8. Health Checks & Monitoring

### Liveness Probe
```
GET /api/trpc/system.health?input={"timestamp":0}
```
Expected response: `{ "ok": true, "db": "healthy", "redis": "healthy", "uptime": N }`

### Readiness Probe
```
GET /api/trpc/system.serviceHealth
```
Expected: all services `true`

### Prometheus Metrics
```
GET /metrics
```
Key metrics to monitor:
- `tradegateway_declarations_total` — total declarations processed
- `tradegateway_clearance_time_seconds` — P50/P95/P99 clearance times
- `tradegateway_risk_lane_distribution` — green/yellow/red/blue counts
- `tradegateway_payment_success_rate` — payment gateway success rate
- `http_request_duration_seconds` — API latency

### Grafana Dashboards
Import dashboards from `infra/grafana/dashboards/`:
- `tradegateway-overview.json` — Platform KPIs
- `tradegateway-declarations.json` — Declaration pipeline metrics
- `tradegateway-security.json` — Security events and alerts

### Alertmanager Rules
Alert rules are in `infra/alertmanager/rules.yaml`:
- **SLA breach** — >5% declarations over 4-hour SLA
- **Error rate** — >1% 5xx responses in 5 minutes
- **DB latency** — P99 query time >500ms
- **Redis down** — Redis connectivity lost

---

## 9. Security Hardening

### Security Headers (already configured)
```
Strict-Transport-Security: max-age=31536000; includeSubDomains; preload
X-Content-Type-Options: nosniff
X-Frame-Options: DENY
Content-Security-Policy: default-src 'self'; ...
Referrer-Policy: strict-origin-when-cross-origin
Permissions-Policy: camera=(), microphone=(), geolocation=()
```

### Rate Limiting (Redis-backed)
- **General API:** 100 req/min per IP
- **Auth endpoints:** 10 req/min per IP
- **Declaration submit:** 20 req/min per user
- **File upload:** 5 req/min per user

### RBAC (Permify)
The platform uses 30 permission journeys across 8 roles:
- `admin` — Full platform access
- `customs_officer` — Declaration processing, risk assessment
- `inspector` — Physical inspection workflows
- `finance` — Payment processing, duty management
- `oga_officer` — OGA-specific permit workflows
- `trader` — Own declarations only
- `aeo_trader` — AEO fast-track privileges
- `auditor` — Read-only audit access

### Fail-Closed Security
The `can()` function in Permify integration returns `false` on network errors — access is denied when the RBAC service is unreachable (fail-closed, not fail-open).

### Dependency Audit
```bash
# Run security audit
pnpm audit --audit-level=high

# Fix vulnerabilities
pnpm audit --fix
```

---

## 10. Incident Response Playbooks

### P0: Platform Completely Down
1. Check Kubernetes pod status: `kubectl get pods -n tradegateway`
2. Check recent deployments: `kubectl rollout history deployment/tradegateway-web -n tradegateway`
3. If recent deployment caused issue: `kubectl rollout undo deployment/tradegateway-web -n tradegateway`
4. Check database connectivity: `kubectl exec -it <pod> -- node -e "require('./server/db').getDb().then(db => db.execute('SELECT 1')).then(() => console.log('DB OK'))"`
5. Check Redis: `kubectl exec -it <redis-pod> -- redis-cli ping`
6. Escalate to on-call DBA if database issue

### P1: High Declaration Processing Latency
1. Check SLA breach alerts in Grafana
2. Check risk engine queue depth: `kubectl logs -l app=risk-engine -n tradegateway | tail -100`
3. Check Temporal workflow backlog: Access Temporal UI at `http://temporal-ui:8080`
4. Scale up declaration-engine replicas: `kubectl scale deployment declaration-engine --replicas=5 -n tradegateway`
5. If Kafka lag: `kafka-consumer-groups.sh --bootstrap-server kafka:9092 --describe --group tradegateway-consumers`

### P1: Payment Gateway Failure
1. Check Mojaloop connectivity: `curl http://mojaloop-gateway:8080/health`
2. Check TigerBeetle: `curl http://tigerbeetle-bridge:8080/health`
3. Check payment queue in DB: `SELECT COUNT(*) FROM payments WHERE status='pending' AND created_at < NOW() - INTERVAL 1 HOUR`
4. If Mojaloop down, enable fallback payment mode in APISIX config
5. Notify affected traders via notification system

### P2: Permify RBAC Service Down
1. The platform automatically fails-closed (all protected operations return 403)
2. Check Permify pod: `kubectl get pods -l app=permify -n tradegateway`
3. Restart Permify: `kubectl rollout restart deployment/permify -n tradegateway`
4. Verify schema after restart: `curl http://permify:3476/v1/schemas/read`

### P2: Redis Down
1. Rate limiting falls back to in-memory (less accurate but functional)
2. Sessions may be lost — users will need to re-authenticate
3. Check Redis cluster: `kubectl get pods -l app=redis -n tradegateway`
4. Check Redis Sentinel: `redis-cli -h redis-sentinel sentinel masters`

---

## 11. Backup & Disaster Recovery

### RPO/RTO Targets
- **RPO (Recovery Point Objective):** 1 hour (hourly DB snapshots)
- **RTO (Recovery Time Objective):** 4 hours (full platform restore)

### Backup Schedule
| Component | Frequency | Retention | Storage |
|-----------|-----------|-----------|---------|
| MySQL/TiDB | Every 1 hour | 30 days | S3 |
| TigerBeetle | Every 15 min | 7 days | S3 |
| Keycloak realm | Daily | 90 days | S3 |
| Permify schema | On change | 90 days | Git |
| S3 documents | Continuous replication | Indefinite | S3 cross-region |

### Disaster Recovery Steps
```bash
# 1. Restore database from backup
aws s3 cp s3://tradegateway-backups/db/backup-YYYYMMDD.sql.gz .
gunzip backup-YYYYMMDD.sql.gz
mysql -h new-tidb-host -u tradegateway -p tradegateway_prod < backup-YYYYMMDD.sql

# 2. Update DATABASE_URL secret in Kubernetes
kubectl create secret generic tradegateway-secrets \
  --from-literal=DATABASE_URL="mysql://tradegateway:PASSWORD@new-tidb-host:4000/tradegateway_prod" \
  --dry-run=client -o yaml | kubectl apply -f -

# 3. Restart application pods
kubectl rollout restart deployment/tradegateway-web -n tradegateway

# 4. Verify health
curl https://tradegateway.gov/api/trpc/system.health?input=%7B%22timestamp%22%3A0%7D
```

---

## 12. Scaling Guide

### Horizontal Pod Autoscaling
The platform is configured with HPA for all critical services:
```yaml
# Already configured in infra/k8s/hpa.yaml
minReplicas: 3
maxReplicas: 20
targetCPUUtilizationPercentage: 70
```

### Database Scaling
- **Read replicas:** Add TiDB read replicas for analytics queries
- **Connection pooling:** PgBouncer/ProxySQL configured in `infra/k8s/proxysql.yaml`
- **Sharding:** TiDB auto-shards; no manual intervention needed

### Kafka Scaling
```bash
# Add partitions to high-throughput topics
kafka-topics.sh --bootstrap-server kafka:9092 \
  --alter --topic tradegateway.declarations.submitted \
  --partitions 12
```

### Redis Scaling
- Use Redis Cluster mode for >10k req/sec
- Configure in `infra/k8s/redis-cluster.yaml`

---

## 13. Go-Live Checklist

### T-7 Days
- [ ] Load testing completed (target: 1000 concurrent users, 500 declarations/hour)
- [ ] Security penetration test completed and critical findings fixed
- [ ] All P0/P1 incident response playbooks rehearsed
- [ ] Backup and restore procedures tested end-to-end
- [ ] All OGA integrations tested in staging

### T-1 Day
- [ ] `DEMO_MODE=false` set in production environment
- [ ] All default passwords changed
- [ ] JWT_SECRET rotated to production value
- [ ] DNS TTL reduced to 60 seconds for quick failover
- [ ] Monitoring alerts configured and tested
- [ ] On-call schedule confirmed

### T-0 (Go-Live)
- [ ] Final database migration: `pnpm db:push`
- [ ] Seed production reference data: `pnpm db:seed:all`
- [ ] Smoke test all critical paths (declaration submit, payment, clearance)
- [ ] Enable HSTS preload
- [ ] Announce to stakeholders

### Post Go-Live (T+24h)
- [ ] Review error rates in Grafana
- [ ] Review SLA compliance dashboard
- [ ] Check Wazuh SIEM for any security events
- [ ] Confirm all cron jobs running (SLA breach, port congestion, cert expiry)
- [ ] Confirm WebSocket connections stable

---

*For support, contact the TradeGateway platform team. This runbook is maintained in the repository at `PRODUCTION_RUNBOOK.md`.*
