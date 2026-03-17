# TradeGateway™ NGSWTP — Production Runbook

**Version:** 1.0 | **Last Updated:** March 2026 | **Owner:** Platform Engineering Team

This runbook is the authoritative operational reference for the TradeGateway™ Next-Generation Single Window Trade Platform. It covers service startup order, health verification, rollback procedures, and incident response playbooks for all 18 microservices and supporting infrastructure.

---

## Table of Contents

1. [Architecture Overview](#1-architecture-overview)
2. [Service Startup Order](#2-service-startup-order)
3. [Health Check Reference](#3-health-check-reference)
4. [Deployment Procedures](#4-deployment-procedures)
5. [Rollback Procedures](#5-rollback-procedures)
6. [Database Operations](#6-database-operations)
7. [TigerBeetle Ledger Operations](#7-tigerbeetle-ledger-operations)
8. [Incident Response Playbooks](#8-incident-response-playbooks)
9. [Monitoring & Alerting Reference](#9-monitoring--alerting-reference)
10. [Secrets & Configuration Management](#10-secrets--configuration-management)
11. [On-Call Escalation Matrix](#11-on-call-escalation-matrix)

---

## 1. Architecture Overview

TradeGateway runs on Kubernetes (minimum 3-node cluster) with the following infrastructure dependencies that must be healthy before any application service starts:

| Tier | Components | Namespace |
|---|---|---|
| **Infrastructure** | PostgreSQL (primary + replica), Redis Cluster, TigerBeetle (3-node), Kafka (3-broker), Temporal Server | `tradegateway-infra` |
| **Security** | Keycloak, Apache APISIX, OpenAppSec WAF | `tradegateway-security` |
| **Core Services** | Declaration, Payment, OGA Hub, Cargo Tracking | `tradegateway` |
| **AI/ML Services** | Risk Engine, HS Classifier, Sanctions, Anomaly Detection | `tradegateway` |
| **Workflow** | Temporal Worker, Workflow Service | `tradegateway` |
| **Analytics** | Fluvio, Lakehouse Bridge | `tradegateway` |
| **Web API** | tRPC Web API (Node.js) | `tradegateway` |
| **Observability** | Prometheus, Grafana, Loki, Wazuh | `monitoring` |

---

## 2. Service Startup Order

Services **must** be started in the following order. Do not proceed to the next tier until all health checks in the current tier pass.

### Tier 0 — Infrastructure (start first, wait for Ready)

```bash
# 1. PostgreSQL — wait for primary to accept connections
kubectl wait --for=condition=Ready pod -l app=postgresql -n tradegateway-infra --timeout=300s

# 2. Redis Cluster — wait for all 6 nodes
kubectl wait --for=condition=Ready pod -l app=redis-cluster -n tradegateway-infra --timeout=300s

# 3. TigerBeetle — wait for 3-node consensus
kubectl wait --for=condition=Ready pod -l app=tigerbeetle -n tradegateway-infra --timeout=300s

# 4. Kafka — wait for all 3 brokers
kubectl wait --for=condition=Ready pod -l app=kafka -n tradegateway-infra --timeout=300s

# 5. Temporal Server — wait for frontend service
kubectl wait --for=condition=Ready pod -l app=temporal -n tradegateway-infra --timeout=300s
```

### Tier 1 — Security Layer

```bash
# Keycloak (IAM) — must be ready before any service that validates JWTs
kubectl wait --for=condition=Ready pod -l app=keycloak -n tradegateway-security --timeout=300s

# APISIX Gateway — must be ready before external traffic
kubectl wait --for=condition=Ready pod -l app=apisix -n tradegateway-security --timeout=300s
```

### Tier 2 — Core Microservices

Start these in parallel after Tier 1 is healthy:

```bash
kubectl rollout status deployment/declaration-service -n tradegateway --timeout=300s &
kubectl rollout status deployment/payment-service -n tradegateway --timeout=300s &
kubectl rollout status deployment/oga-hub -n tradegateway --timeout=300s &
kubectl rollout status deployment/cargo-tracking -n tradegateway --timeout=300s &
kubectl rollout status deployment/aeo-service -n tradegateway --timeout=300s &
kubectl rollout status deployment/post-clearance -n tradegateway --timeout=300s &
kubectl rollout status deployment/bond-service -n tradegateway --timeout=300s &
kubectl rollout status deployment/free-zone -n tradegateway --timeout=300s &
kubectl rollout status deployment/warehouse -n tradegateway --timeout=300s &
wait
```

### Tier 3 — AI/ML Services

```bash
kubectl rollout status deployment/risk-engine -n tradegateway --timeout=300s &
kubectl rollout status deployment/hs-classifier -n tradegateway --timeout=300s &
kubectl rollout status deployment/sanctions-service -n tradegateway --timeout=300s &
kubectl rollout status deployment/anomaly-detection -n tradegateway --timeout=300s &
wait
```

### Tier 4 — Workflow & Analytics

```bash
kubectl rollout status deployment/temporal-worker -n tradegateway --timeout=300s &
kubectl rollout status deployment/workflow-service -n tradegateway --timeout=300s &
kubectl rollout status deployment/tigerbeetle-bridge-go -n tradegateway --timeout=300s &
wait
```

### Tier 5 — Web API (last)

```bash
kubectl rollout status deployment/tradegateway-web-api -n tradegateway --timeout=300s
# Run smoke tests
curl -sf https://tradegateway.gov/health && echo "Web API healthy"
```

---

## 3. Health Check Reference

### Quick System-Wide Health Check

```bash
#!/bin/bash
# Run this to get a full system status in under 30 seconds
echo "=== TradeGateway System Health ==="
kubectl get pods -n tradegateway --no-headers | \
  awk '{print $1, $3, $4}' | \
  column -t

echo ""
echo "=== Infrastructure Health ==="
kubectl get pods -n tradegateway-infra --no-headers | \
  awk '{print $1, $3, $4}' | \
  column -t
```

### Service-Level Health Endpoints

| Service | Health Endpoint | Expected Response |
|---|---|---|
| Web API | `GET /health` | `{"status":"ok","db":"connected"}` |
| Declaration Service | `GET /health` | `{"status":"healthy"}` |
| Payment Service | `GET /health` | `{"status":"healthy","tigerbeetle":"live\|simulation"}` |
| Risk Engine | `GET /health` | `{"status":"healthy","model":"loaded"}` |
| TigerBeetle Bridge (Go) | `GET /api/ledger/health` | `{"status":"healthy","mode":"live\|simulation"}` |
| TigerBeetle Bridge (Rust) | `GET /health` | `{"status":"healthy","ledger_mode":"live\|simulation"}` |
| Temporal Worker | Temporal Web UI at port 8233 | All workers registered |

### TigerBeetle Mode Verification

**Critical:** Verify TigerBeetle is in **live** mode before processing any real payments.

```bash
# Check Go bridge mode
curl -sf http://tigerbeetle-bridge-go.tradegateway.svc.cluster.local:8080/api/ledger/health | \
  jq '.mode'
# Expected: "live"

# Check Rust bridge mode
curl -sf http://tigerbeetle-bridge-rs.tradegateway.svc.cluster.local:8081/health | \
  jq '.ledger_mode'
# Expected: "live"
```

If either returns `"simulation"`, **halt all payment processing immediately** and escalate to the Platform Engineering team. See [Incident Playbook P-003](#p-003-tigerbeetle-in-simulation-mode-in-production).

---

## 4. Deployment Procedures

### Standard Rolling Deployment

```bash
# 1. Verify current state
kubectl get deployments -n tradegateway

# 2. Deploy with Helm (atomic — rolls back automatically on failure)
helm upgrade tradegateway ./infra/helm/tradegateway \
  --namespace tradegateway \
  -f ./infra/helm/tradegateway/values-production.yaml \
  --set global.image.tag=${IMAGE_TAG} \
  --atomic \
  --timeout 15m

# 3. Verify rollout
kubectl rollout status deployment/tradegateway-web-api -n tradegateway
```

### Database Migration Before Deployment

Always run migrations **before** deploying new application code:

```bash
# 1. Take a database snapshot first
./infra/postgres/backup/backup.sh

# 2. Run migrations
DATABASE_URL=${PRODUCTION_DATABASE_URL} pnpm db:push

# 3. Verify migration applied
psql ${PRODUCTION_DATABASE_URL} -c "\d declarations" | head -20

# 4. Then deploy application
helm upgrade ...
```

### Zero-Downtime Payment Service Deployment

The payment service requires special care due to in-flight Temporal workflows:

```bash
# 1. Drain new declarations from the queue (set maintenance mode)
kubectl set env deployment/declaration-service MAINTENANCE_MODE=true -n tradegateway

# 2. Wait for in-flight workflows to complete (check Temporal UI)
# Temporal Web UI: http://temporal-web.tradegateway-infra.svc.cluster.local:8233

# 3. Deploy payment-service
kubectl set image deployment/payment-service \
  payment-service=${REGISTRY}/payment-service:${IMAGE_TAG} \
  -n tradegateway

# 4. Wait for rollout
kubectl rollout status deployment/payment-service -n tradegateway --timeout=300s

# 5. Re-enable declarations
kubectl set env deployment/declaration-service MAINTENANCE_MODE=false -n tradegateway
```

---

## 5. Rollback Procedures

### Helm Rollback (Preferred)

```bash
# List recent releases
helm history tradegateway -n tradegateway

# Roll back to the previous release
helm rollback tradegateway -n tradegateway

# Roll back to a specific revision
helm rollback tradegateway 5 -n tradegateway --wait
```

### Individual Service Rollback

```bash
# Roll back a single deployment to the previous image
kubectl rollout undo deployment/payment-service -n tradegateway

# Roll back to a specific revision
kubectl rollout history deployment/payment-service -n tradegateway
kubectl rollout undo deployment/payment-service --to-revision=3 -n tradegateway
```

### Database Rollback

```bash
# Restore from the most recent backup
./infra/postgres/restore/restore.sh tradegateway_backup_$(date +%Y%m%d).sql.gz

# Verify data integrity after restore
psql ${DATABASE_URL} -c "SELECT COUNT(*) FROM declarations;"
psql ${DATABASE_URL} -c "SELECT COUNT(*) FROM payments;"
```

**Warning:** Database rollbacks are destructive. Always confirm with the Platform Engineering Lead before executing.

---

## 6. Database Operations

### Connection Pool Status

```bash
# Check PgBouncer pool status
psql -h pgbouncer.tradegateway-infra.svc.cluster.local \
     -p 6432 -U pgbouncer pgbouncer \
     -c "SHOW POOLS;"
```

### Replication Lag Check

```bash
# Check replica lag (should be < 100ms in normal operation)
psql ${DATABASE_URL} -c "
  SELECT
    client_addr,
    state,
    sent_lsn,
    write_lsn,
    flush_lsn,
    replay_lsn,
    (sent_lsn - replay_lsn) AS replication_lag_bytes
  FROM pg_stat_replication;
"
```

### Emergency Read-Only Mode

If the primary database is failing, switch to read-only mode to preserve data integrity:

```bash
# Point all services to the read replica
kubectl set env deployment/tradegateway-web-api \
  DATABASE_URL=${REPLICA_DATABASE_URL} \
  DATABASE_READ_ONLY=true \
  -n tradegateway
```

### Backup Schedule

| Backup Type | Frequency | Retention | Storage |
|---|---|---|---|
| Full backup | Daily at 01:00 UTC | 30 days | S3 `tradegateway-backups/daily/` |
| WAL archiving | Continuous | 7 days | S3 `tradegateway-backups/wal/` |
| Pre-deployment snapshot | Before every deploy | 7 days | S3 `tradegateway-backups/pre-deploy/` |

---

## 7. TigerBeetle Ledger Operations

### Verify Ledger Consistency

```bash
# Get account balances from the Go bridge
curl -sf http://tigerbeetle-bridge-go.tradegateway.svc.cluster.local:8080/api/ledger/summary | jq .

# Expected output:
# {
#   "mode": "live",
#   "accounts": [
#     { "id": "customs-duty-revenue", "credits_posted": 1234567, "debits_posted": 0 },
#     { "id": "customs-duty-revenue-pending", "credits_posted": 45678, "debits_posted": 0 },
#     ...
#   ]
# }
```

### TigerBeetle Cluster Health

```bash
# Check all 3 TigerBeetle pods
kubectl get pods -l app=tigerbeetle -n tradegateway-infra

# Check TigerBeetle logs for consensus issues
kubectl logs -l app=tigerbeetle -n tradegateway-infra --tail=50 | grep -E "ERROR|WARN|consensus"
```

### Switching from Simulation to Live Mode

This is a one-time production activation procedure. **Requires Platform Engineering Lead approval.**

```bash
# 1. Verify TigerBeetle cluster is healthy (3/3 nodes)
kubectl get pods -l app=tigerbeetle -n tradegateway-infra

# 2. Update the Go bridge deployment to use the production Dockerfile
kubectl set image deployment/tigerbeetle-bridge-go \
  tigerbeetle-bridge-go=${REGISTRY}/tigerbeetle-bridge-go:${IMAGE_TAG}-live \
  -n tradegateway

# 3. Update the Rust bridge
kubectl set image deployment/tigerbeetle-bridge-rs \
  tigerbeetle-bridge-rs=${REGISTRY}/tigerbeetle-bridge-rs:${IMAGE_TAG}-live \
  -n tradegateway

# 4. Verify mode switched to "live"
sleep 30
curl -sf http://tigerbeetle-bridge-go.tradegateway.svc.cluster.local:8080/api/ledger/health | jq '.mode'
# Must return: "live"

# 5. Run account seeding verification
curl -sf http://payment-service.tradegateway.svc.cluster.local:8082/health | jq '.accounts_seeded'
# Must return: true
```

---

## 8. Incident Response Playbooks

### P-001: Web API Down (5xx errors > 10%)

**Detection:** Prometheus alert `TradeGatewayHighErrorRate` fires.

**Immediate Actions:**

```bash
# 1. Check pod status
kubectl get pods -l app=tradegateway-web-api -n tradegateway

# 2. Check recent logs
kubectl logs -l app=tradegateway-web-api -n tradegateway --tail=100 | grep -E "ERROR|FATAL"

# 3. Check database connectivity
kubectl exec -it $(kubectl get pod -l app=tradegateway-web-api -n tradegateway -o name | head -1) \
  -n tradegateway -- node -e "require('./server/db').getDb().then(() => console.log('DB OK'))"

# 4. If DB is the issue, check PgBouncer
kubectl logs -l app=pgbouncer -n tradegateway-infra --tail=50

# 5. Roll back if the issue started with a recent deployment
helm rollback tradegateway -n tradegateway
```

**Escalation:** If not resolved within 15 minutes, escalate to Platform Engineering Lead.

---

### P-002: Payment Processing Failure

**Detection:** Prometheus alert `TradeGatewayPaymentFailureRate` fires, or Wazuh alert `100021` (dual-write failure).

**Immediate Actions:**

```bash
# 1. Check payment-service health
kubectl logs -l app=payment-service -n tradegateway --tail=100 | grep -E "ERROR|tigerbeetle"

# 2. Check Temporal workflow status
# Open Temporal Web UI: http://temporal-web.tradegateway-infra.svc.cluster.local:8233
# Filter by: Workflow Type = ConfirmPaymentWorkflow, Status = Failed

# 3. Check Prometheus fallback counter
# If payment_temporal_fallback_total is rising, Temporal is down
kubectl logs -l app=temporal -n tradegateway-infra --tail=50

# 4. Check TigerBeetle bridge
curl -sf http://tigerbeetle-bridge-go.tradegateway.svc.cluster.local:8080/api/ledger/health

# 5. If TigerBeetle is down, enable payment hold
kubectl set env deployment/payment-service PAYMENT_HOLD=true -n tradegateway
```

**Recovery:** Once the root cause is resolved, re-run failed Temporal workflows:

```bash
# List failed ConfirmPaymentWorkflow runs
tctl --namespace default workflow list \
  --query "WorkflowType='ConfirmPaymentWorkflow' AND ExecutionStatus='Failed'"

# Reset and re-run each failed workflow
tctl --namespace default workflow reset \
  --workflow_id ${WORKFLOW_ID} \
  --reason "Infrastructure recovered — reprocessing"
```

---

### P-003: TigerBeetle in Simulation Mode in Production

**Detection:** Wazuh alert `100022` fires, or Service Health page shows "Simulation" badge.

**This is a critical incident.** All payments processed in simulation mode will not have real ledger entries.

**Immediate Actions:**

```bash
# 1. HALT all payment processing immediately
kubectl set env deployment/payment-service PAYMENT_HOLD=true -n tradegateway
kubectl set env deployment/declaration-service MAINTENANCE_MODE=true -n tradegateway

# 2. Identify when simulation mode started
kubectl logs deployment/tigerbeetle-bridge-go -n tradegateway --since=24h | \
  grep "simulation\|mode" | head -20

# 3. Identify all payments processed since simulation mode started
psql ${DATABASE_URL} -c "
  SELECT id, amount, status, created_at
  FROM payments
  WHERE tigerbeetle_tx_id IS NULL
    AND status = 'paid'
  ORDER BY created_at DESC;
"

# 4. Switch to live mode (see Section 7)
# 5. Re-post all payments that have NULL tigerbeetle_tx_id
# 6. Re-enable payment processing
kubectl set env deployment/payment-service PAYMENT_HOLD=false -n tradegateway
kubectl set env deployment/declaration-service MAINTENANCE_MODE=false -n tradegateway
```

**Post-Incident:** File a P0 incident report. Audit all affected declarations and payments with the Finance team.

---

### P-004: Kafka Consumer Lag Critical

**Detection:** Prometheus alert `TradeGatewayKafkaConsumerLag` fires (lag > 10,000 messages).

```bash
# 1. Check consumer group lag
kubectl exec -it kafka-0 -n tradegateway-infra -- \
  kafka-consumer-groups.sh --bootstrap-server localhost:9092 \
  --describe --group tradegateway-consumers

# 2. Check which service is lagging
# Look for the consumer group with the highest lag

# 3. Scale up the lagging service
kubectl scale deployment/declaration-service --replicas=5 -n tradegateway

# 4. Monitor lag reduction
watch -n 10 'kubectl exec -it kafka-0 -n tradegateway-infra -- \
  kafka-consumer-groups.sh --bootstrap-server localhost:9092 \
  --describe --group tradegateway-consumers | grep -v "^$"'
```

---

### P-005: Sanctions Screening Service Down

**Detection:** Prometheus alert `TradeGatewaySanctionsServiceDown` fires.

**This is a compliance-critical incident.** Do not allow new declarations to be approved while sanctions screening is unavailable.

```bash
# 1. Enable sanctions bypass hold (blocks green-lane auto-approval)
kubectl set env deployment/risk-engine SANCTIONS_BYPASS_HOLD=true -n tradegateway

# 2. Restart sanctions service
kubectl rollout restart deployment/sanctions-service -n tradegateway

# 3. Verify recovery
kubectl rollout status deployment/sanctions-service -n tradegateway --timeout=120s
curl -sf http://sanctions-service.tradegateway.svc.cluster.local:8085/health

# 4. Re-enable auto-approval
kubectl set env deployment/risk-engine SANCTIONS_BYPASS_HOLD=false -n tradegateway

# 5. Re-screen all declarations that were held during the outage
# These will be in status = 'submitted' with risk_lane = 'green' and created_at during the outage window
```

---

## 9. Monitoring & Alerting Reference

### Grafana Dashboards

| Dashboard | URL | Purpose |
|---|---|---|
| TradeGateway Overview | `/d/tg-overview` | System-wide KPIs and SLA metrics |
| Payment Ledger | `/d/tg-payments` | TigerBeetle balances, payment throughput |
| Declaration Pipeline | `/d/tg-declarations` | Clearance times, lane distribution |
| Service Health | `/d/tg-services` | All 18 microservice health and latency |
| Kafka Lag | `/d/tg-kafka` | Consumer group lag per service |
| Security | `/d/tg-security` | WAF blocks, auth failures, rate limits |

### Key Prometheus Metrics

| Metric | Alert Threshold | Severity |
|---|---|---|
| `tradegateway_http_error_rate` | > 5% for 5m | Critical |
| `tradegateway_clearance_time_p99_hours` | > 4h | Warning |
| `tradegateway_payment_failure_rate` | > 1% for 2m | Critical |
| `payment_temporal_fallback_total` | > 3 in 5m | Warning |
| `tradegateway_kafka_consumer_lag` | > 10,000 | Warning |
| `tradegateway_db_connection_pool_exhausted` | > 0 | Critical |
| `tradegateway_sanctions_service_up` | == 0 | Critical |

### Wazuh Alert Levels

| Level | Meaning | Response Time |
|---|---|---|
| 10–11 | Informational security event | Review within 24h |
| 12–13 | Suspicious activity | Review within 4h |
| 14 | High-severity incident | Respond within 1h |
| 15 | Critical — immediate action required | Respond within 15m |

---

## 10. Secrets & Configuration Management

All secrets are managed via Kubernetes Secrets and injected as environment variables. **Never commit secrets to Git.**

### Rotating Database Credentials

```bash
# 1. Generate new password
NEW_PASSWORD=$(openssl rand -base64 32)

# 2. Update PostgreSQL
psql ${DATABASE_URL} -c "ALTER USER tradegateway PASSWORD '${NEW_PASSWORD}';"

# 3. Update Kubernetes secret
kubectl create secret generic tradegateway-db-secret \
  --from-literal=DATABASE_URL="mysql://tradegateway:${NEW_PASSWORD}@postgres:5432/tradegateway" \
  --namespace tradegateway \
  --dry-run=client -o yaml | kubectl apply -f -

# 4. Restart services to pick up new credentials
kubectl rollout restart deployment/tradegateway-web-api -n tradegateway
```

### Rotating JWT Secret

```bash
# 1. Generate new JWT secret
NEW_JWT_SECRET=$(openssl rand -base64 64)

# 2. Update secret (this will invalidate all existing sessions)
kubectl create secret generic tradegateway-jwt-secret \
  --from-literal=JWT_SECRET="${NEW_JWT_SECRET}" \
  --namespace tradegateway \
  --dry-run=client -o yaml | kubectl apply -f -

# 3. Restart web API
kubectl rollout restart deployment/tradegateway-web-api -n tradegateway
```

---

## 11. On-Call Escalation Matrix

| Severity | First Responder | Escalation (15m) | Escalation (30m) |
|---|---|---|---|
| P0 — Platform down | On-call engineer | Platform Engineering Lead | CTO |
| P1 — Payment failure | On-call engineer | Platform Engineering Lead | Finance Director |
| P2 — Service degraded | On-call engineer | Platform Engineering Lead | — |
| P3 — Non-critical alert | On-call engineer | — | — |

### Communication Channels

- **Slack:** `#tradegateway-incidents` (all incidents), `#tradegateway-alerts` (automated alerts)
- **PagerDuty:** `tradegateway-oncall` schedule for P0/P1 incidents
- **Status Page:** Update `status.tradegateway.gov` for any P0/P1 incident within 10 minutes of detection

---

*This runbook should be reviewed and updated after every major incident and before every major release. Last reviewed: March 2026.*
