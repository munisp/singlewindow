# TradeGateway™ NGSWTP — Architecture Reference

## Overview

TradeGateway™ NGSWTP is a **National Single Window Trade Platform** designed to digitise and streamline customs clearance for import, export, and transit declarations. The platform integrates 37+ Other Government Agencies (OGAs), supports cross-border document exchange via the ASEAN Single Window and WCO CEN, and processes duty payments through Mojaloop and TigerBeetle.

**Design principles:**
- **API-first:** All business logic is exposed via tRPC procedures with end-to-end TypeScript types.
- **Event-driven:** Kafka and Fluvio carry all inter-service events; no synchronous coupling between microservices.
- **Durable workflows:** Temporal orchestrates multi-step clearance processes with guaranteed execution.
- **Zero-trust security:** mTLS between services, Keycloak for identity, OpenAppSec WAF at the edge.

---

## System Layers

```
┌─────────────────────────────────────────────────────────────────┐
│  PRESENTATION LAYER                                             │
│  React 19 + Tailwind 4 SPA  │  Mobile App  │  WhatsApp Bot     │
├─────────────────────────────────────────────────────────────────┤
│  API GATEWAY LAYER                                              │
│  Apache APISIX  │  OpenAppSec WAF  │  Keycloak OIDC/SAML       │
├─────────────────────────────────────────────────────────────────┤
│  APPLICATION LAYER (Node.js / Express + tRPC)                   │
│  57 tRPC router namespaces  │  WebSocket server                 │
├─────────────────────────────────────────────────────────────────┤
│  MICROSERVICES LAYER (Go + Python)                              │
│  Declaration  │  Risk Engine  │  OGA Hub  │  Cargo Tracking     │
│  Mojaloop GW  │  KYC          │  Sanctions │  ASEAN SW          │
│  CEN Service  │  Temporal WKR │  Analytics │  TigerBeetle Bridge│
├─────────────────────────────────────────────────────────────────┤
│  WORKFLOW ORCHESTRATION                                         │
│  Temporal (durable workflows)  │  Dapr (service mesh)           │
├─────────────────────────────────────────────────────────────────┤
│  INTEGRATION LAYER                                              │
│  Apache Kafka  │  Fluvio  │  EDI Translation  │  WCO DM v3.10   │
├─────────────────────────────────────────────────────────────────┤
│  DATA LAYER                                                     │
│  PostgreSQL  │  Redis  │  TigerBeetle  │  OpenSearch            │
│  Delta Lake  │  Apache Flink  │  Apache Spark  │  Ray (ML)      │
├─────────────────────────────────────────────────────────────────┤
│  SECURITY LAYER                                                 │
│  OpenCTI  │  Wazuh SIEM/XDR  │  mTLS everywhere                │
├─────────────────────────────────────────────────────────────────┤
│  INFRASTRUCTURE                                                 │
│  Kubernetes  │  Helm  │  Kubecost  │  Prometheus + Grafana       │
│  OpenTelemetry Collector  │  Jaeger  │  Promtail + Loki          │
└─────────────────────────────────────────────────────────────────┘
```

---

## Declaration Clearance Flow

```
Trader submits declaration
        │
        ▼
[1] Declaration Engine (Go)
    • Validate HS code via BERT NLP
    • Generate UCR (Unique Consignment Reference)
    • Persist to PostgreSQL
    • Emit declaration.submitted event → Kafka
        │
        ▼
[2] Risk Engine (Python / Ray)
    • Pull declaration from Kafka
    • Score against 200+ risk rules (ML model)
    • Assign lane: GREEN / YELLOW / RED / BLUE
    • Emit risk.scored event → Kafka
        │
        ▼
[3] Temporal Workflow Engine
    • Receives risk.scored event
    • Spawns clearance workflow based on lane
    • Orchestrates parallel OGA permit requests (Dapr)
    • Waits for all OGA approvals (joint inspection model)
        │
        ▼
[4] Payment Gateway (Mojaloop + TigerBeetle)
    • Calculate duties (tariff engine)
    • Create payment request via Mojaloop
    • Record financial transaction in TigerBeetle ledger
    • Emit payment.completed event → Kafka
        │
        ▼
[5] Clearance Engine
    • Verify all OGA approvals + payment confirmation
    • Issue clearance permit
    • Notify trader via WebSocket + push notification
    • Update cargo tracking status
    • Emit declaration.cleared event → Kafka → Delta Lake
```

---

## Key Technology Decisions

| Decision | Choice | Rationale |
|---|---|---|
| API layer | tRPC 11 | End-to-end TypeScript types, no REST boilerplate, Superjson for Date/BigInt |
| Primary DB | PostgreSQL (Drizzle ORM) | ACID compliance, mature ecosystem, single DB reduces operational complexity |
| Financial ledger | TigerBeetle | Purpose-built for financial accounting, 1M+ TPS, immutable audit log |
| Payment network | Mojaloop | Open-source interoperable payment hub, ISO 20022 compliant |
| Workflow engine | Temporal | Durable execution, automatic retries, versioned workflow history |
| Service mesh | Dapr | Language-agnostic, sidecar pattern, built-in pub/sub and state management |
| Event bus | Kafka + Fluvio | Kafka for durability, Fluvio for real-time stream processing |
| Analytics | Delta Lake + Spark + Flink | Open table format, ACID on data lake, real-time + batch in one stack |
| ML platform | Ray + DataFusion | Distributed ML training, columnar query engine for feature engineering |
| Geospatial | Apache Sedona | Distributed spatial queries on vessel/cargo position data |
| API gateway | Apache APISIX | High-performance, plugin ecosystem, native Kubernetes integration |
| WAF | OpenAppSec | AI-powered, self-learning WAF, open-source |
| Identity | Keycloak | OIDC/SAML/OAuth2, enterprise SSO, role-based access control |
| Threat intel | OpenCTI | STIX/TAXII compliant, integrates with MITRE ATT&CK |
| SIEM/XDR | Wazuh | Open-source, agent-based, integrates with OpenSearch |
| Observability | Prometheus + Grafana + OTel | Industry standard, 50+ custom metrics, tail-based sampling |
| Tracing | Jaeger + OTel Collector | Distributed trace correlation across all services |
| Log aggregation | Promtail + Loki | Kubernetes-native, label-based querying |
| Container orch. | Kubernetes + Helm | Industry standard, GitOps-ready Helm charts |
| FinOps | Kubecost | Per-namespace cost allocation, rightsizing recommendations |

---

## Database Schema Summary

The platform uses **51 PostgreSQL tables** across these domains:

| Domain | Tables |
|---|---|
| Users & Auth | `users`, `sessions`, `trader_profiles`, `kyc_submissions` |
| Declarations | `declarations`, `declaration_events`, `declaration_documents` |
| Risk | `risk_rules`, `risk_scan_results`, `fraud_cases` |
| Payments | `payments`, `payment_events`, `ledger_accounts`, `ledger_transactions` |
| OGA | `oga_agencies`, `oga_permits`, `oga_sla_configs` |
| Cargo | `cargo_events`, `vessels`, `port_locations`, `port_congestion_events` |
| Security | `security_incidents`, `security_alerts`, `audit_logs` |
| Compliance | `aeo_certifications`, `post_audit_cases`, `post_audit_findings` |
| Analytics | `api_changelog_entries`, `onboarding_steps`, `notification_preferences` |
| Infrastructure | `webhooks`, `webhook_deliveries`, `user_notifications` |

---

## Observability Stack

### Metrics
- **Endpoint:** `GET /metrics` (Prometheus format)
- **Registry:** `server/_core/metrics.ts` — 50+ custom counters, histograms, and gauges
- **Dashboards:** 5 Grafana dashboards in `infra/monitoring/grafana/dashboards/`
- **Alerting:** 25 alerting rules in `infra/monitoring/prometheus/alerting_rules.yaml`

### Tracing
- **Collector:** OpenTelemetry Collector (`infra/monitoring/tracing/otel-collector-config.yaml`)
- **Backend:** Jaeger (tail-based sampling: 100% errors, 10% success)
- **Instrumentation:** All tRPC procedures, Temporal workers, Kafka consumers

### Logs
- **Shipper:** Promtail DaemonSet (`infra/monitoring/promtail/promtail-daemonset.yaml`)
- **Backend:** Loki
- **Scrape jobs:** all-pods, temporal-workers, risk-engine, security-audit

### Health Checks
- `GET /api/health/live` — Kubernetes liveness probe (always 200 if process is alive)
- `GET /api/health/ready` — Kubernetes readiness probe (503 if DB is down)
- `GET /api/health` — Full deep health report (DB, Redis, TigerBeetle, Temporal, Kafka, ASEAN SW, CEN)

---

## Security Architecture

### Network Isolation
Five-layer Kubernetes network policies in `infra/k8s/network-policies/`:
1. Default deny-all ingress and egress for the `tradegateway` namespace
2. DNS egress allowed (port 53 UDP/TCP to kube-dns)
3. APISIX-only ingress (only the API gateway can reach application pods)
4. Inter-service mesh (Dapr sidecar communication on port 3500)
5. Data layer access (only application pods can reach PostgreSQL, Redis, Kafka, TigerBeetle)

### Authentication & Authorisation
- **OAuth 2.0:** Manus OAuth for user authentication
- **Session:** JWT signed with `JWT_SECRET`, stored in httpOnly cookie
- **Roles:** `user` (trader) and `admin` (customs officer / system admin)
- **Procedure guards:** `publicProcedure`, `protectedProcedure`, `adminProcedure`

### Data Protection
- All data at rest encrypted (PostgreSQL TDE, Redis AOF encryption)
- All data in transit encrypted (TLS 1.3, mTLS between services)
- PII fields (NIN, BVN, passport numbers) encrypted at the column level
- Audit log for all admin mutations (immutable, append-only)

---

## Deployment

### Helm Chart
Located at `infra/helm/tradegateway/`. Key files:
- `Chart.yaml` — chart metadata and dependencies
- `values.yaml` — default values for all 17 services
- `templates/deployment.yaml` — HPA + PodDisruptionBudget for each service
- `templates/service.yaml` — ClusterIP services
- `templates/ingress.yaml` — APISIX ingress with TLS
- `templates/configmap.yaml` — environment configuration
- `templates/NOTES.txt` — post-install instructions

### Environment Overrides
Create `values-production.yaml` with:
```yaml
global:
  registry: "registry.tradegateway.gov"
  imageTag: "1.0.0"
services:
  web-api:
    replicas: 5
  declaration-service:
    replicas: 10
```

### CI/CD
```
git push → GitHub Actions
  → pnpm test (1,679 tests)
  → pnpm build
  → docker build + push to registry
  → helm upgrade --install tradegateway ./infra/helm/tradegateway \
      -f values-production.yaml \
      --namespace tradegateway \
      --atomic --timeout 10m
```

---

*TradeGateway™ NGSWTP v1.0.0 — Architecture Reference — March 2026*
