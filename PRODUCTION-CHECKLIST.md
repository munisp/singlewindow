# TradeGateway™ NGSWTP — Production Launch Checklist

**Document Version:** 1.0.0  
**Prepared by:** Platform Engineering Team  
**Classification:** RESTRICTED — Internal Use Only  
**Last Updated:** 2026-03-16  

> This checklist is the **mandatory pre-launch gate** for the TradeGateway™ Next Generation Single Window Trade Platform. Every item marked `[REQUIRED]` must be signed off by the responsible party before the Go/No-Go decision. Items marked `[RECOMMENDED]` should be completed before launch but may be deferred to Day-30 post-launch with documented risk acceptance.

---

## Sign-Off Summary

| Section | Owner | Sign-Off | Date | Notes |
|---------|-------|----------|------|-------|
| 1. Infrastructure | Platform Eng | `[ ]` | | |
| 2. Security & IAM | Security Team | `[ ]` | | |
| 3. Database & Storage | DBA Team | `[ ]` | | |
| 4. Application Services | Dev Lead | `[ ]` | | |
| 5. Payment & Ledger | FinOps Lead | `[ ]` | | |
| 6. Observability | SRE Team | `[ ]` | | |
| 7. Compliance & Legal | Compliance Officer | `[ ]` | | |
| 8. Performance | QA Lead | `[ ]` | | |
| 9. Disaster Recovery | Infra Lead | `[ ]` | | |
| 10. Operational Readiness | Ops Manager | `[ ]` | | |

**Go/No-Go Decision:**  
- Authorised by: ___________________________  
- Role: ___________________________  
- Date: ___________________________  
- Decision: `[ ] GO` / `[ ] NO-GO` / `[ ] CONDITIONAL GO`  
- Conditions (if applicable): ___________________________

---

## 1. Infrastructure Readiness

### 1.1 Kubernetes Cluster

| # | Check | Status | Owner | Notes |
|---|-------|--------|-------|-------|
| 1.1.1 | [REQUIRED] Kubernetes cluster v1.28+ deployed and healthy (`kubectl cluster-info`) | `[ ]` | Platform Eng | |
| 1.1.2 | [REQUIRED] All 3 worker node pools running (general, compute, memory-optimised) | `[ ]` | Platform Eng | |
| 1.1.3 | [REQUIRED] Node auto-scaling configured (min 3, max 20 per pool) | `[ ]` | Platform Eng | |
| 1.1.4 | [REQUIRED] `tradegateway` namespace created with resource quotas applied | `[ ]` | Platform Eng | |
| 1.1.5 | [REQUIRED] PodDisruptionBudgets applied to all stateful services | `[ ]` | Platform Eng | |
| 1.1.6 | [REQUIRED] Network policies enforced — inter-namespace traffic blocked by default | `[ ]` | Security Team | |
| 1.1.7 | [REQUIRED] Pod Security Standards (Restricted) applied to `tradegateway` namespace | `[ ]` | Security Team | |
| 1.1.8 | [RECOMMENDED] Cluster node OS hardening (CIS Benchmark Level 2) | `[ ]` | Platform Eng | |

### 1.2 Networking & DNS

| # | Check | Status | Owner | Notes |
|---|-------|--------|-------|-------|
| 1.2.1 | [REQUIRED] Production domain (`trade.gov.ng` or equivalent) DNS A record pointing to load balancer | `[ ]` | Platform Eng | |
| 1.2.2 | [REQUIRED] TLS certificate (Let's Encrypt or CA-signed) installed and auto-renewing | `[ ]` | Platform Eng | |
| 1.2.3 | [REQUIRED] APISIX API Gateway deployed and health-checked (`/apisix/status`) | `[ ]` | Platform Eng | |
| 1.2.4 | [REQUIRED] OpenAppSec WAF rules loaded and blocking OWASP Top-10 attack patterns | `[ ]` | Security Team | |
| 1.2.5 | [REQUIRED] Internal service mesh (Dapr) sidecar injected on all microservice pods | `[ ]` | Platform Eng | |
| 1.2.6 | [REQUIRED] mTLS enforced between all internal services | `[ ]` | Security Team | |
| 1.2.7 | [RECOMMENDED] CDN configured for static assets (images, JS bundles) | `[ ]` | Platform Eng | |

### 1.3 Kafka & Event Bus

| # | Check | Status | Owner | Notes |
|---|-------|--------|-------|-------|
| 1.3.1 | [REQUIRED] Strimzi Kafka cluster (3 brokers, 3 ZooKeeper nodes) running | `[ ]` | Platform Eng | |
| 1.3.2 | [REQUIRED] All required topics created with correct retention and replication factor (3) | `[ ]` | Platform Eng | |
| 1.3.3 | [REQUIRED] Kafka consumer group lag monitoring active | `[ ]` | SRE Team | |
| 1.3.4 | [REQUIRED] Dead-letter queue (DLQ) topics created for all consumer groups | `[ ]` | Platform Eng | |
| 1.3.5 | [RECOMMENDED] Kafka Schema Registry deployed for Avro/Protobuf validation | `[ ]` | Platform Eng | |

---

## 2. Security & Identity

### 2.1 Keycloak IAM

| # | Check | Status | Owner | Notes |
|---|-------|--------|-------|-------|
| 2.1.1 | [REQUIRED] Keycloak production realm (`tradegateway-prod`) imported from `infra/keycloak/realm-production.json` | `[ ]` | Security Team | |
| 2.1.2 | [REQUIRED] Admin password rotated from default — stored in Vault/Secrets Manager | `[ ]` | Security Team | |
| 2.1.3 | [REQUIRED] SMTP relay configured for email verification and password reset | `[ ]` | Platform Eng | |
| 2.1.4 | [REQUIRED] MFA (TOTP) enforced for all admin and customs officer accounts | `[ ]` | Security Team | |
| 2.1.5 | [REQUIRED] Session timeout set to 8 hours for trader accounts, 4 hours for officers | `[ ]` | Security Team | |
| 2.1.6 | [REQUIRED] Brute-force protection enabled (5 failures → 15-minute lockout) | `[ ]` | Security Team | |
| 2.1.7 | [REQUIRED] NIN (National Identity Number) IDP connector tested end-to-end | `[ ]` | Security Team | |
| 2.1.8 | [RECOMMENDED] Keycloak HA (2+ replicas) with shared PostgreSQL backend | `[ ]` | Platform Eng | |

### 2.2 Secrets Management

| # | Check | Status | Owner | Notes |
|---|-------|--------|-------|-------|
| 2.2.1 | [REQUIRED] All secrets stored in Kubernetes Secrets or external Vault — no plaintext in code | `[ ]` | Security Team | |
| 2.2.2 | [REQUIRED] `JWT_SECRET` rotated from development value — minimum 256-bit entropy | `[ ]` | Security Team | |
| 2.2.3 | [REQUIRED] Database credentials rotated and stored in Secrets Manager | `[ ]` | DBA Team | |
| 2.2.4 | [REQUIRED] TigerBeetle cluster key stored securely — not in environment variables | `[ ]` | Security Team | |
| 2.2.5 | [REQUIRED] Mojaloop API keys and certificates provisioned from production DFSP | `[ ]` | FinOps Lead | |
| 2.2.6 | [REQUIRED] All 18 `*_GRPC_ADDR` environment variables set to production service addresses | `[ ]` | Platform Eng | |
| 2.2.7 | [RECOMMENDED] Secret rotation policy automated (90-day rotation for API keys) | `[ ]` | Security Team | |

### 2.3 SIEM & Threat Intelligence

| # | Check | Status | Owner | Notes |
|---|-------|--------|-------|-------|
| 2.3.1 | [REQUIRED] Wazuh agents deployed on all cluster nodes | `[ ]` | Security Team | |
| 2.3.2 | [REQUIRED] Wazuh custom rules from `infra/monitoring/wazuh/tradegateway-rules.xml` loaded | `[ ]` | Security Team | |
| 2.3.3 | [REQUIRED] OpenCTI connected to MISP threat feed and WCO CEN Network | `[ ]` | Security Team | |
| 2.3.4 | [REQUIRED] Sanctions screening service connected to OFAC/UN/EU lists (live feed) | `[ ]` | Compliance Officer | |
| 2.3.5 | [REQUIRED] Security incident response runbook reviewed and distributed to SOC team | `[ ]` | Security Team | |
| 2.3.6 | [RECOMMENDED] Penetration test completed by independent third party (within 90 days) | `[ ]` | Security Team | |

### 2.4 Permify RBAC

| # | Check | Status | Owner | Notes |
|---|-------|--------|-------|-------|
| 2.4.1 | [REQUIRED] Permify schema from `infra/permify/schema.perm` applied to production | `[ ]` | Security Team | |
| 2.4.2 | [REQUIRED] All 7 roles (TRADER, CUSTOMS_OFFICER, CUSTOMS_SUPERVISOR, OGA_OFFICER, ADMIN, AUDITOR, SYSTEM) verified with test accounts | `[ ]` | Security Team | |
| 2.4.3 | [REQUIRED] Row-Level Security (RLS) policies verified on all 11 database tables | `[ ]` | DBA Team | |

---

## 3. Database & Storage

### 3.1 Primary Database (TiDB/PostgreSQL)

| # | Check | Status | Owner | Notes |
|---|-------|--------|-------|-------|
| 3.1.1 | [REQUIRED] Production database cluster provisioned with HA (3 nodes minimum) | `[ ]` | DBA Team | |
| 3.1.2 | [REQUIRED] All Drizzle migrations applied (`pnpm db:push` completed successfully) | `[ ]` | DBA Team | |
| 3.1.3 | [REQUIRED] 22 composite indexes verified present (`\d+ declarations` etc.) | `[ ]` | DBA Team | |
| 3.1.4 | [REQUIRED] RLS policies active — test with non-admin user confirms row isolation | `[ ]` | DBA Team | |
| 3.1.5 | [REQUIRED] PgBouncer connection pooler deployed (config from `infra/db/pgbouncer.ini`) | `[ ]` | DBA Team | |
| 3.1.6 | [REQUIRED] Automated daily backup configured (`infra/db/backup.sh` cron job) | `[ ]` | DBA Team | |
| 3.1.7 | [REQUIRED] Backup restoration tested — RTO < 4 hours verified | `[ ]` | DBA Team | |
| 3.1.8 | [REQUIRED] Database connection string uses SSL (`sslmode=require`) | `[ ]` | DBA Team | |
| 3.1.9 | [RECOMMENDED] Point-in-time recovery (PITR) enabled with 30-day retention | `[ ]` | DBA Team | |

### 3.2 TigerBeetle Financial Ledger

| # | Check | Status | Owner | Notes |
|---|-------|--------|-------|-------|
| 3.2.1 | [REQUIRED] TigerBeetle StatefulSet deployed from `infra/kubernetes/tigerbeetle.yaml` | `[ ]` | FinOps Lead | |
| 3.2.2 | [REQUIRED] TigerBeetle binary installed in payment-service container (CGO_ENABLED=1) | `[ ]` | Dev Lead | |
| 3.2.3 | [REQUIRED] Build tag `tigerbeetle` confirmed in production Docker image (`docker inspect`) | `[ ]` | Dev Lead | |
| 3.2.4 | [REQUIRED] 5 standard accounts seeded on startup (seed.go idempotent run verified) | `[ ]` | FinOps Lead | |
| 3.2.5 | [REQUIRED] Dual-write to PostgreSQL mirror table (`tigerbeetle_ledger_entries`) verified | `[ ]` | FinOps Lead | |
| 3.2.6 | [REQUIRED] Service Health dashboard shows `mode: live` (not `simulation`) | `[ ]` | FinOps Lead | |
| 3.2.7 | [REQUIRED] TigerBeetle data directory on persistent volume (not emptyDir) | `[ ]` | Platform Eng | |
| 3.2.8 | [RECOMMENDED] TigerBeetle cluster (3 replicas) for production HA | `[ ]` | FinOps Lead | |

### 3.3 Redis Cache

| # | Check | Status | Owner | Notes |
|---|-------|--------|-------|-------|
| 3.3.1 | [REQUIRED] Redis cluster deployed (3 nodes, Sentinel or Cluster mode) | `[ ]` | Platform Eng | |
| 3.3.2 | [REQUIRED] Redis password authentication enabled | `[ ]` | Security Team | |
| 3.3.3 | [REQUIRED] Rate limiter Redis backend confirmed active (not in-memory fallback) | `[ ]` | Dev Lead | |
| 3.3.4 | [REQUIRED] Redis maxmemory policy set to `allkeys-lru` | `[ ]` | Platform Eng | |

---

## 4. Application Services

### 4.1 Go Microservices (18 services)

| # | Check | Status | Owner | Notes |
|---|-------|--------|-------|-------|
| 4.1.1 | [REQUIRED] All 18 Go services deployed and passing `/health` endpoint check | `[ ]` | Dev Lead | |
| 4.1.2 | [REQUIRED] All services running with `SIMULATION_MODE=false` in production | `[ ]` | Dev Lead | |
| 4.1.3 | [REQUIRED] HPA (HorizontalPodAutoscaler) active for declaration, payment, risk-engine | `[ ]` | Platform Eng | |
| 4.1.4 | [REQUIRED] Temporal worker deployed and connected to Temporal server | `[ ]` | Dev Lead | |
| 4.1.5 | [REQUIRED] ConfirmPaymentWorkflow tested end-to-end in staging environment | `[ ]` | Dev Lead | |
| 4.1.6 | [REQUIRED] gRPC health checks passing for all services | `[ ]` | Dev Lead | |
| 4.1.7 | [RECOMMENDED] Circuit breakers configured for all external service calls | `[ ]` | Dev Lead | |

### 4.2 Python AI Services (4 services)

| # | Check | Status | Owner | Notes |
|---|-------|--------|-------|-------|
| 4.2.1 | [REQUIRED] risk-engine, hs-classifier, sanctions-service, anomaly-detection all deployed | `[ ]` | Dev Lead | |
| 4.2.2 | [REQUIRED] ML models loaded from model registry (not hardcoded paths) | `[ ]` | Dev Lead | |
| 4.2.3 | [REQUIRED] HS code classifier accuracy ≥ 85% on validation set | `[ ]` | QA Lead | |
| 4.2.4 | [REQUIRED] Risk scoring latency < 5 seconds (P95) verified in load test | `[ ]` | QA Lead | |
| 4.2.5 | [RECOMMENDED] Model versioning and rollback procedure documented | `[ ]` | Dev Lead | |

### 4.3 Frontend Application

| # | Check | Status | Owner | Notes |
|---|-------|--------|-------|-------|
| 4.3.1 | [REQUIRED] Production build (`pnpm build`) completes with 0 TypeScript errors | `[ ]` | Dev Lead | |
| 4.3.2 | [REQUIRED] All 1,360 tests passing (`pnpm test`) | `[ ]` | Dev Lead | |
| 4.3.3 | [REQUIRED] CSP headers verified (no `unsafe-inline` in production) | `[ ]` | Security Team | |
| 4.3.4 | [REQUIRED] HSTS header present with `max-age=31536000; includeSubDomains` | `[ ]` | Security Team | |
| 4.3.5 | [REQUIRED] Public `/status` page accessible without authentication | `[ ]` | Dev Lead | |
| 4.3.6 | [REQUIRED] Error boundaries implemented on all critical pages | `[ ]` | Dev Lead | |
| 4.3.7 | [RECOMMENDED] Lighthouse score ≥ 90 (Performance, Accessibility, Best Practices) | `[ ]` | QA Lead | |

---

## 5. Payment & Financial Integrity

### 5.1 Mojaloop Integration

| # | Check | Status | Owner | Notes |
|---|-------|--------|-------|-------|
| 5.1.1 | [REQUIRED] Mojaloop production DFSP (Digital Financial Service Provider) registration complete | `[ ]` | FinOps Lead | |
| 5.1.2 | [REQUIRED] Mojaloop callback URL (`/api/mojaloop/callback`) reachable from Mojaloop hub | `[ ]` | Platform Eng | |
| 5.1.3 | [REQUIRED] Payment flow tested end-to-end: quote → transfer → confirmation | `[ ]` | FinOps Lead | |
| 5.1.4 | [REQUIRED] Idempotency keys verified — duplicate payment callbacks handled correctly | `[ ]` | Dev Lead | |
| 5.1.5 | [REQUIRED] Payment reconciliation report tested for a 24-hour period | `[ ]` | FinOps Lead | |
| 5.1.6 | [REQUIRED] Temporal `payment_temporal_fallback_total` counter at 0 in staging | `[ ]` | Dev Lead | |
| 5.1.7 | [RECOMMENDED] Mobile money (USSD) payment channel tested with all major MNOs | `[ ]` | FinOps Lead | |

### 5.2 Financial Audit Trail

| # | Check | Status | Owner | Notes |
|---|-------|--------|-------|-------|
| 5.2.1 | [REQUIRED] Every duty payment creates an immutable TigerBeetle ledger entry | `[ ]` | FinOps Lead | |
| 5.2.2 | [REQUIRED] Dual-write consistency verified — TigerBeetle and PostgreSQL balances match | `[ ]` | FinOps Lead | |
| 5.2.3 | [REQUIRED] Daily reconciliation script (`infra/db/reconcile.sh`) tested | `[ ]` | FinOps Lead | |
| 5.2.4 | [REQUIRED] Audit log immutability verified — no UPDATE/DELETE on `audit_logs` table | `[ ]` | DBA Team | |

---

## 6. Observability & Monitoring

### 6.1 Metrics & Alerting

| # | Check | Status | Owner | Notes |
|---|-------|--------|-------|-------|
| 6.1.1 | [REQUIRED] Prometheus deployed and scraping all 18 Go services + 4 Python services | `[ ]` | SRE Team | |
| 6.1.2 | [REQUIRED] All 22 alert rules from `infra/monitoring/alerts/tradegateway-alerts.yaml` loaded | `[ ]` | SRE Team | |
| 6.1.3 | [REQUIRED] AlertManager configured with PagerDuty/Slack routing for P1/P2 alerts | `[ ]` | SRE Team | |
| 6.1.4 | [REQUIRED] 5 Grafana dashboards provisioned (overview, payments, declarations, services, kafka) | `[ ]` | SRE Team | |
| 6.1.5 | [REQUIRED] SLO dashboards configured: declaration processing < 4h (green lane) | `[ ]` | SRE Team | |
| 6.1.6 | [RECOMMENDED] Kubecost cost allocation dashboard active | `[ ]` | Platform Eng | |

### 6.2 Logging

| # | Check | Status | Owner | Notes |
|---|-------|--------|-------|-------|
| 6.2.1 | [REQUIRED] Loki deployed and receiving logs from all pods (Promtail DaemonSet) | `[ ]` | SRE Team | |
| 6.2.2 | [REQUIRED] Structured JSON logging verified on all Go and Python services | `[ ]` | Dev Lead | |
| 6.2.3 | [REQUIRED] Log retention policy set to 90 days minimum | `[ ]` | SRE Team | |
| 6.2.4 | [REQUIRED] PII fields (NIN, passport numbers) masked in logs | `[ ]` | Security Team | |
| 6.2.5 | [RECOMMENDED] OpenSearch index lifecycle management configured | `[ ]` | SRE Team | |

### 6.3 Distributed Tracing

| # | Check | Status | Owner | Notes |
|---|-------|--------|-------|-------|
| 6.3.1 | [REQUIRED] Jaeger or Tempo deployed for distributed tracing | `[ ]` | SRE Team | |
| 6.3.2 | [REQUIRED] Trace IDs propagated across all service boundaries | `[ ]` | Dev Lead | |
| 6.3.3 | [RECOMMENDED] Sampling rate set to 10% for production (100% for errors) | `[ ]` | SRE Team | |

---

## 7. Compliance & Legal

### 7.1 Regulatory Compliance

| # | Check | Status | Owner | Notes |
|---|-------|--------|-------|-------|
| 7.1.1 | [REQUIRED] Data Protection Act compliance review completed by DPO | `[ ]` | Compliance Officer | |
| 7.1.2 | [REQUIRED] NDPR (Nigeria Data Protection Regulation) impact assessment filed | `[ ]` | Compliance Officer | |
| 7.1.3 | [REQUIRED] WCO Revised Kyoto Convention alignment verified (Annex B.1) | `[ ]` | Compliance Officer | |
| 7.1.4 | [REQUIRED] ASEAN Single Window Protocol Art. 8 interoperability confirmed | `[ ]` | Compliance Officer | |
| 7.1.5 | [REQUIRED] Legal framework for e-signatures and e-transactions in place | `[ ]` | Legal Team | |
| 7.1.6 | [REQUIRED] Data residency requirements met — all PII stored within national borders | `[ ]` | Compliance Officer | |
| 7.1.7 | [RECOMMENDED] ISO 27001 certification roadmap initiated | `[ ]` | Compliance Officer | |

### 7.2 Trade Compliance

| # | Check | Status | Owner | Notes |
|---|-------|--------|-------|-------|
| 7.2.1 | [REQUIRED] HS code tariff schedule loaded and current (WCO HS 2022 edition) | `[ ]` | Compliance Officer | |
| 7.2.2 | [REQUIRED] Sanctions lists (OFAC, UN, EU, INTERPOL) loaded and auto-updating | `[ ]` | Compliance Officer | |
| 7.2.3 | [REQUIRED] Prohibited and restricted goods list loaded | `[ ]` | Compliance Officer | |
| 7.2.4 | [REQUIRED] AEO programme criteria and approval workflow tested | `[ ]` | Compliance Officer | |
| 7.2.5 | [REQUIRED] Duty drawback calculation verified against NCS tariff schedule | `[ ]` | Compliance Officer | |

---

## 8. Performance & Load Testing

### 8.1 Load Test Results

| # | Check | Status | Owner | Notes |
|---|-------|--------|-------|-------|
| 8.1.1 | [REQUIRED] Load test: 10,000 concurrent users sustained for 30 minutes | `[ ]` | QA Lead | |
| 8.1.2 | [REQUIRED] Declaration submission P95 latency < 2 seconds | `[ ]` | QA Lead | |
| 8.1.3 | [REQUIRED] Risk scoring P95 latency < 5 seconds | `[ ]` | QA Lead | |
| 8.1.4 | [REQUIRED] Payment processing P95 latency < 10 seconds | `[ ]` | QA Lead | |
| 8.1.5 | [REQUIRED] Zero data loss under simulated node failure (chaos engineering test) | `[ ]` | QA Lead | |
| 8.1.6 | [REQUIRED] Database query P99 latency < 100ms under full load | `[ ]` | DBA Team | |
| 8.1.7 | [RECOMMENDED] Stress test: 2× expected peak load without service degradation | `[ ]` | QA Lead | |

### 8.2 Capacity Planning

| # | Check | Status | Owner | Notes |
|---|-------|--------|-------|-------|
| 8.2.1 | [REQUIRED] Cluster capacity sufficient for 6-month projected growth | `[ ]` | Platform Eng | |
| 8.2.2 | [REQUIRED] Database storage provisioned for 2 years of declaration data | `[ ]` | DBA Team | |
| 8.2.3 | [REQUIRED] TigerBeetle data volume capacity verified (estimated 500GB/year) | `[ ]` | FinOps Lead | |

---

## 9. Disaster Recovery

### 9.1 Backup & Recovery

| # | Check | Status | Owner | Notes |
|---|-------|--------|-------|-------|
| 9.1.1 | [REQUIRED] RTO (Recovery Time Objective) < 4 hours — tested and documented | `[ ]` | Infra Lead | |
| 9.1.2 | [REQUIRED] RPO (Recovery Point Objective) < 1 hour — backup frequency confirmed | `[ ]` | Infra Lead | |
| 9.1.3 | [REQUIRED] Full DR drill completed in staging environment | `[ ]` | Infra Lead | |
| 9.1.4 | [REQUIRED] Backup encryption at rest verified | `[ ]` | Security Team | |
| 9.1.5 | [REQUIRED] Backup stored in geographically separate region | `[ ]` | Infra Lead | |
| 9.1.6 | [RECOMMENDED] Multi-region active-passive failover configured | `[ ]` | Infra Lead | |

### 9.2 Incident Response

| # | Check | Status | Owner | Notes |
|---|-------|--------|-------|-------|
| 9.2.1 | [REQUIRED] Production Runbook (`PRODUCTION-RUNBOOK.md`) reviewed by all on-call engineers | `[ ]` | Ops Manager | |
| 9.2.2 | [REQUIRED] On-call rotation schedule published for first 90 days | `[ ]` | Ops Manager | |
| 9.2.3 | [REQUIRED] Escalation contacts list (L1/L2/L3/Vendor) distributed | `[ ]` | Ops Manager | |
| 9.2.4 | [REQUIRED] War room communication channel (Slack/Teams) created | `[ ]` | Ops Manager | |
| 9.2.5 | [RECOMMENDED] GameDay exercise conducted with simulated P1 incident | `[ ]` | Ops Manager | |

---

## 10. Operational Readiness

### 10.1 Documentation

| # | Check | Status | Owner | Notes |
|---|-------|--------|-------|-------|
| 10.1.1 | [REQUIRED] `PRODUCTION-RUNBOOK.md` — 11 sections complete | `[ ]` | Ops Manager | |
| 10.1.2 | [REQUIRED] `PRODUCTION-CHECKLIST.md` — all REQUIRED items signed off | `[ ]` | Ops Manager | |
| 10.1.3 | [REQUIRED] API documentation published (OpenAPI spec at `/api/openapi.json`) | `[ ]` | Dev Lead | |
| 10.1.4 | [REQUIRED] Trader onboarding guide published | `[ ]` | Ops Manager | |
| 10.1.5 | [REQUIRED] OGA integration guide distributed to all 37+ agencies | `[ ]` | Ops Manager | |
| 10.1.6 | [RECOMMENDED] Video training materials for customs officers | `[ ]` | Ops Manager | |

### 10.2 Training & Stakeholder Readiness

| # | Check | Status | Owner | Notes |
|---|-------|--------|-------|-------|
| 10.2.1 | [REQUIRED] Customs officers trained on declaration review workflow | `[ ]` | Ops Manager | |
| 10.2.2 | [REQUIRED] OGA officers trained on permit approval workflow | `[ ]` | Ops Manager | |
| 10.2.3 | [REQUIRED] System administrators trained on Grafana dashboards and alert response | `[ ]` | SRE Team | |
| 10.2.4 | [REQUIRED] Helpdesk team trained on common trader issues | `[ ]` | Ops Manager | |
| 10.2.5 | [RECOMMENDED] Pilot programme with 50 AEO traders completed before full launch | `[ ]` | Ops Manager | |

### 10.3 Launch Communication

| # | Check | Status | Owner | Notes |
|---|-------|--------|-------|-------|
| 10.3.1 | [REQUIRED] Public announcement issued to all registered traders (minimum 30 days notice) | `[ ]` | Ops Manager | |
| 10.3.2 | [REQUIRED] Legacy system (if any) migration plan communicated | `[ ]` | Ops Manager | |
| 10.3.3 | [REQUIRED] Public status page (`/status`) live and accessible | `[ ]` | Dev Lead | |
| 10.3.4 | [REQUIRED] Support contact channels (email, phone, portal) published | `[ ]` | Ops Manager | |
| 10.3.5 | [RECOMMENDED] Press release and media briefing prepared | `[ ]` | Ops Manager | |

---

## Appendix A: Environment Variable Verification

Run the following command on each production pod to verify all required environment variables are set:

```bash
# Verify all required env vars are present
kubectl exec -n tradegateway deploy/payment-service -- env | grep -E \
  "DATABASE_URL|REDIS_URL|TEMPORAL_ADDRESS|TIGERBEETLE_ADDRESS|TB_GO_BRIDGE_HTTP_ADDR|\
MOJALOOP_HUB_URL|KEYCLOAK_URL|KAFKA_BROKERS|JWT_SECRET|PERMIFY_URL" | \
  awk -F= '{print $1": SET"}' | sort
```

Expected output: All 10 variables should show `SET`.

---

## Appendix B: Smoke Test Script

After deployment, run the following smoke tests:

```bash
# 1. Health check all services
for svc in declaration payment oga-hub cargo-tracking document-vault \
           workflow notification audit bond drawback tariff trader-registry \
           risk-engine hs-classifier sanctions anomaly-detection; do
  status=$(curl -sf "http://${svc}-service.tradegateway.svc.cluster.local:8080/health" | jq -r .status)
  echo "${svc}: ${status}"
done

# 2. Submit a test declaration
curl -X POST https://trade.gov.ng/api/trpc/declarations.submit \
  -H "Authorization: Bearer ${TEST_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"hsCode":"8471.30","description":"Test laptop","value":1000,"currency":"NGN"}'

# 3. Verify TigerBeetle mode
curl -sf https://trade.gov.ng/api/trpc/system.tigerbeetleModes \
  -H "Authorization: Bearer ${ADMIN_TOKEN}" | jq .

# 4. Check Prometheus targets
curl -sf http://prometheus.monitoring.svc.cluster.local:9090/api/v1/targets | \
  jq '.data.activeTargets | length'
```

---

## Appendix C: Rollback Procedure

If a critical issue is discovered post-launch:

1. **Immediate**: Enable maintenance mode via APISIX route (`kubectl apply -f infra/kubernetes/maintenance-mode.yaml`)
2. **Database**: Run `infra/db/restore.sh --timestamp <last-known-good>` to restore from backup
3. **Application**: `helm rollback tradegateway <previous-revision> -n tradegateway`
4. **TigerBeetle**: TigerBeetle is append-only — coordinate with FinOps for manual reconciliation
5. **Communication**: Post incident update to `/status` page within 15 minutes

---

*This document must be retained for a minimum of 7 years as part of the platform's audit trail.*

**Document Control:**  
- Version 1.0.0 — Initial release  
- Next review: 90 days post-launch or after any major incident
