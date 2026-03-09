# TradeGateway NGSWTP — Orchestration Architecture
# Top 30 Stakeholder Journeys

## Middleware Stack

| Layer | Technology | Role |
|-------|-----------|------|
| API Gateway | Apache APISIX | Route, auth, rate-limit, WAF |
| Identity & Access | Keycloak + Permify | OIDC/SAML SSO + fine-grained RBAC |
| Service Mesh | Dapr | Service-to-service, pub/sub, state |
| Event Bus | Apache Kafka | Durable event streaming |
| Real-time Streams | Fluvio | Low-latency cargo/vessel streams |
| Workflow Engine | Temporal | Durable long-running workflows |
| Cache / Pub-Sub | Redis | Session, rate-limit, notifications |
| Financial Ledger | TigerBeetle | Double-entry duty/payment ledger |
| Lakehouse | Delta Lake + Parquet | Analytics, ML, reporting |
| Microservices | Go (gRPC) + Python (HTTP) | Business logic |

---

## Top 30 Stakeholder Journeys

### Trader Journeys (1–8)

**J01 — Import Declaration Submission**
Stakeholder: Licensed Importer
Flow: Trader logs in (Keycloak OIDC) → submits declaration via portal → APISIX routes to declaration-service (Go) → Temporal workflow `DeclarationLifecycleWorkflow` starts → Kafka topic `declaration.submitted` fires → risk-engine (Python) scores in <5s → lane assigned (GREEN/YELLOW/RED) → OGA permits created → Dapr pub/sub notifies trader.

**J02 — Export Declaration & Permit**
Stakeholder: Exporter
Flow: Exporter submits export declaration → declaration-service validates HS code → Temporal `ExportClearanceWorkflow` → MOFA/MOTI permits via OGA webhook → TigerBeetle records export levy → Fluvio stream updates cargo tracking.

**J03 — Duty Payment via Mobile Money**
Stakeholder: Importer/Exporter
Flow: Trader receives duty assessment → selects Mojaloop payment → payment-service (Go) creates TigerBeetle transfer (debit trader account, credit customs revenue account) → Kafka `payment.confirmed` → declaration status → `payment_confirmed` → Temporal resumes workflow.

**J04 — AEO Application & Onboarding**
Stakeholder: Authorised Economic Operator applicant
Flow: Trader applies for AEO status → Temporal `AEOOnboardingWorkflow` (30-day process) → compliance checks → site inspection scheduling → Permify grants `aeo:read` and `aeo:expedited_clearance` roles → Redis caches AEO status for fast lane checks.

**J05 — Bonded Warehouse Entry**
Stakeholder: Bonded Warehouse Operator
Flow: Operator submits goods-in request → declaration-service creates bonded entry → TigerBeetle suspense account for deferred duty → Temporal `BondedWarehouseWorkflow` tracks dwell time → Fluvio stream updates inventory.

**J06 — Free Zone Operations**
Stakeholder: Free Zone Enterprise
Flow: Enterprise submits free zone admission → declaration-service marks as duty-exempt → Temporal `FreeZoneAdmissionWorkflow` → OGA permits for restricted goods → TigerBeetle zero-duty ledger entry → Kafka `freezone.admission.approved`.

**J07 — Duty Drawback Claim**
Stakeholder: Exporter claiming drawback on re-exported goods
Flow: Exporter files drawback claim → drawback-service queries TigerBeetle for original duty payments → Temporal `DrawbackWorkflow` validates export proof → customs officer approves → TigerBeetle reversal transfer → Kafka `drawback.paid`.

**J08 — Post-Clearance Audit Response**
Stakeholder: Trader under audit
Flow: Audit notification sent (Dapr notification) → trader uploads documents to document vault (S3) → post-clearance-service reviews → Temporal `PostClearanceAuditWorkflow` → outcome: compliant/penalty/prosecution → TigerBeetle penalty ledger entry.

---

### Customs Officer Journeys (9–14)

**J09 — Declaration Risk Review (Yellow Lane)**
Stakeholder: Customs Document Review Officer
Flow: Officer receives Dapr notification → opens declaration in portal → reviews AI risk score breakdown → requests additional documents → Temporal workflow resumes on document upload → officer approves/rejects → Kafka `declaration.reviewed`.

**J10 — Physical Inspection (Red Lane)**
Stakeholder: Customs Inspection Officer
Flow: Red-lane declaration assigned → officer-workload-service balances assignment (Redis sorted set) → officer schedules inspection → inspection result recorded → Temporal resumes → Kafka `declaration.inspected` → port operator notified via Fluvio.

**J11 — Sanctions Screening**
Stakeholder: Customs Compliance Officer
Flow: On declaration submission → sanctions-service (Python) queries OpenCTI threat intel → screens trader, vessel, HS code against OFAC/UN/EU lists → Kafka `sanctions.hit` if match → Temporal pauses workflow → compliance officer reviews → Wazuh SIEM alert.

**J12 — OGA Permit Review**
Stakeholder: OGA Officer (FDA, EPA, MOH, etc.)
Flow: OGA officer receives Dapr notification → reviews permit request in OGA portal → approves/rejects/requests more info → OGA system calls POST /api/webhooks/oga → declaration-service updates permit status → Temporal resumes if all permits resolved.

**J13 — Officer Workload Management**
Stakeholder: Customs Supervisor
Flow: Supervisor views workload dashboard → officer-workload-service queries Redis for real-time assignment counts → reassigns declarations → Kafka `declaration.reassigned` → officer notified via Dapr.

**J14 — Fraud Case Investigation**
Stakeholder: Anti-Fraud Unit Officer
Flow: Risk AI flags fraud pattern → fraud-service creates case → Wazuh SIEM alert → officer investigates → links related declarations → Temporal `FraudInvestigationWorkflow` → outcome: prosecution/clearance → Kafka `fraud.case.closed`.

---

### Port & Logistics Journeys (15–18)

**J15 — Vessel Arrival & Berth Assignment**
Stakeholder: Port Operator
Flow: Vessel AIS data ingested via Fluvio stream → cargo-tracking-service updates vessel position → port operator receives ETA notification → berth assignment → Kafka `vessel.arrived` → declaration-service triggers pre-arrival processing.

**J16 — Container Release Authorization**
Stakeholder: Port Terminal Operator
Flow: Customs issues clearance → Kafka `declaration.cleared` → cargo-tracking-service updates container status → port operator receives release authorization → Fluvio stream updates terminal management system → trader notified.

**J17 — Geofence Crossing Alert**
Stakeholder: Customs Intelligence Unit
Flow: Fluvio stream receives vessel position → geofence-service checks against restricted zones → Kafka `geofence.breach` → Wazuh SIEM alert → intelligence officer notified → Temporal `GeofenceInvestigationWorkflow` starts.

**J18 — Port Congestion Management**
Stakeholder: Port Authority
Flow: Congestion-service aggregates vessel counts → congestion score calculated → Fluvio stream broadcasts to all subscribers → port authority issues congestion advisory → APISIX rate-limits declaration submissions for congested ports.

---

### Financial Journeys (19–22)

**J19 — Duty Assessment & Collection**
Stakeholder: Revenue Authority
Flow: Declaration cleared → duty-calculation-service computes tariff (HS code + CIF value + applicable rates) → TigerBeetle debit trader account → credit revenue authority account → Kafka `duty.collected` → Delta Lake ingests for revenue analytics.

**J20 — Bond & Securities Management**
Stakeholder: Customs Bond Officer
Flow: Trader applies for bond → bond-service creates TigerBeetle bond account → Temporal `BondWorkflow` tracks utilization → auto-debit on breach → bond renewal reminder 30 days before expiry → Kafka `bond.renewed`.

**J21 — Financial Reconciliation**
Stakeholder: Finance Director
Flow: End-of-day → reconciliation-service queries TigerBeetle for all transfers → cross-references with declaration records → Delta Lake stores reconciliation report → Kafka `reconciliation.complete` → finance director notified.

**J22 — Revenue Analytics Dashboard**
Stakeholder: Revenue Authority Analyst
Flow: Analyst opens analytics dashboard → analytics-service queries Delta Lake (Parquet) → Flink real-time aggregations → charts rendered (revenue by HS chapter, port, trader) → anomaly detection via Ray ML → Kafka `anomaly.detected` if revenue drop >20%.

---

### Admin & Governance Journeys (23–27)

**J23 — Trader Registration & KYC**
Stakeholder: New Trader
Flow: Trader registers → kyc-service (Python) validates documents via vision-service → Keycloak creates user account → Permify assigns `trader:basic` role → Redis caches KYC status → Kafka `trader.registered` → admin notified.

**J24 — Multi-Tenant Onboarding**
Stakeholder: Platform Administrator
Flow: New country/agency onboards → tenant-service creates isolated Keycloak realm → Permify tenant namespace → APISIX tenant routing rules → database schema isolation → Kafka `tenant.created` → onboarding workflow starts.

**J25 — API Key Management**
Stakeholder: Third-Party Developer
Flow: Developer registers → dev-portal-service creates API key → APISIX key-auth plugin activated → Redis rate-limit bucket created → Kafka `apikey.created` → developer receives key via email → usage analytics in Delta Lake.

**J26 — Compliance Scorecard Generation**
Stakeholder: WCO Compliance Officer
Flow: Monthly → compliance-service queries all declarations → calculates scores (clearance time, error rate, OGA SLA) → Temporal `ComplianceScorecardWorkflow` → Delta Lake stores scorecard → PDF generated → Kafka `scorecard.published`.

**J27 — System Health Monitoring**
Stakeholder: Platform DevOps Engineer
Flow: Prometheus scrapes all services → Grafana dashboards → Wazuh SIEM monitors security events → Kubecost tracks infrastructure costs → Kafka `system.alert` on threshold breach → PagerDuty notification → Temporal `IncidentResponseWorkflow`.

---

### Intelligence & Analytics Journeys (28–30)

**J28 — Risk Model Training**
Stakeholder: Risk AI Engineer
Flow: Delta Lake exports declaration features → Ray distributed training → model evaluation → model registry update → risk-engine-service hot-reloads model → Kafka `model.deployed` → A/B test new vs old model → performance metrics in Delta Lake.

**J29 — Trade Intelligence Report**
Stakeholder: Trade Policy Analyst
Flow: Analyst requests report → analytics-service queries Delta Lake → Apache Sedona geospatial analysis → trade flow visualization → Flink aggregates by HS chapter/country/period → PDF/Excel export → Kafka `report.generated`.

**J30 — Threat Intelligence Integration**
Stakeholder: Customs Intelligence Director
Flow: OpenCTI ingests threat feeds (INTERPOL, WCO CEN, OFAC) → threat-intel-service enriches declaration data → Wazuh SIEM correlates with customs events → Kafka `threat.intel.update` → risk-engine re-scores affected declarations → Temporal `ThreatResponseWorkflow`.

---

## Kafka Topic Schema

```
declaration.submitted       → { declarationId, traderId, hsCode, riskScore, lane }
declaration.reviewed        → { declarationId, officerId, decision, remarks }
declaration.inspected       → { declarationId, officerId, result, findings }
declaration.cleared         → { declarationId, clearanceTime, dutyAmount }
declaration.rejected        → { declarationId, reason, agencyCode }
declaration.reassigned      → { declarationId, fromOfficerId, toOfficerId }
payment.initiated           → { paymentId, declarationId, amount, method }
payment.confirmed           → { paymentId, declarationId, tigerbeetleTransferId }
payment.failed              → { paymentId, declarationId, reason }
oga.permit.requested        → { permitId, declarationId, agencyCode }
oga.permit.approved         → { permitId, declarationId, agencyCode, permitRef }
oga.permit.rejected         → { permitId, declarationId, agencyCode, reason }
vessel.arrived              → { mmsi, portCode, eta, cargoType }
vessel.departed             → { mmsi, portCode, actualDeparture }
geofence.breach             → { mmsi, vesselName, geofenceId, lat, lng }
cargo.released              → { containerId, declarationId, portCode }
trader.registered           → { traderId, companyName, kycStatus }
trader.aeo.approved         → { traderId, aeoNumber, validUntil }
fraud.case.opened           → { caseId, declarationId, fraudType, riskScore }
fraud.case.closed           → { caseId, outcome, penaltyAmount }
sanctions.hit               → { declarationId, entityType, listName, matchScore }
duty.collected              → { declarationId, amount, currency, tigerbeetleId }
drawback.paid               → { drawbackId, traderId, amount }
bond.renewed                → { bondId, traderId, newExpiry }
reconciliation.complete     → { date, totalRevenue, discrepancies }
anomaly.detected            → { type, value, threshold, period }
model.deployed              → { modelId, version, accuracy, f1Score }
threat.intel.update         → { sourceId, threatType, affectedEntities }
tenant.created              → { tenantId, countryCode, adminEmail }
apikey.created              → { keyId, developerId, scopes }
```

---

## Temporal Workflow Definitions

| Workflow | Activities | SLA |
|----------|-----------|-----|
| DeclarationLifecycleWorkflow | validateDeclaration, scoreRisk, createOGAPermits, awaitPayment, awaitOGAApprovals, issueRelease | 4h (green) / 24h (yellow) / 72h (red) |
| ExportClearanceWorkflow | validateExport, checkExportRestrictions, createExportPermits, awaitOGAApprovals, issueExportCertificate | 8h |
| AEOOnboardingWorkflow | validateApplication, scheduleAudit, conductAudit, reviewFindings, grantAEOStatus | 30 days |
| PaymentClearingWorkflow | createTigerBeetleTransfer, awaitMojaloopConfirmation, updateDeclarationStatus, sendReceipt | 15 min |
| BondedWarehouseWorkflow | createBondedEntry, trackDwellTime, triggerDutyOnExpiry, issueReleaseOnPayment | 90 days max |
| DrawbackWorkflow | validateDrawbackClaim, verifyExportProof, calculateDrawbackAmount, processRefund | 14 days |
| PostClearanceAuditWorkflow | notifyTrader, awaitDocuments, reviewDocuments, issueAuditReport, collectPenalty | 60 days |
| FraudInvestigationWorkflow | freezeDeclaration, notifyIntelligence, gatherEvidence, conductHearing, issueOutcome | 90 days |
| ComplianceScorecardWorkflow | gatherMetrics, calculateScores, generateReport, publishScorecard | Monthly |
| IncidentResponseWorkflow | alertOnCall, assessSeverity, escalate, mitigate, postMortem | 4h P1 / 24h P2 |

---

## Permify RBAC Schema

```
entity user {}
entity declaration {
  relation owner @user
  relation reviewer @user
  relation inspector @user
  action submit = owner
  action review = reviewer
  action inspect = inspector
  action approve = reviewer or inspector
  action view = owner or reviewer or inspector
}
entity payment {
  relation payer @user
  relation collector @user
  action initiate = payer
  action confirm = collector
  action view = payer or collector
}
entity oga_permit {
  relation applicant @user
  relation oga_officer @user
  action request = applicant
  action approve = oga_officer
  action reject = oga_officer
  action view = applicant or oga_officer
}
entity tenant {
  relation admin @user
  relation member @user
  action manage = admin
  action access = admin or member
}
```

## Roles
- `trader` — can submit declarations, initiate payments, view own records
- `customs_officer` — can review/inspect declarations, approve/reject
- `oga_officer` — can approve/reject OGA permits for their agency
- `aeo_trader` — trader with expedited green-lane clearance
- `port_operator` — can view vessel/cargo data, issue release authorizations
- `finance_officer` — can view/manage payments, reconciliation
- `admin` — full platform access
- `developer` — API key access, sandbox environment only
- `analyst` — read-only access to analytics/lakehouse
- `intelligence_officer` — access to sanctions, fraud, threat intel
