# TradeGateway™ NGSWTP — API Reference

All API calls are made via **tRPC** over HTTP POST to `/api/trpc/{namespace}.{procedure}`.
Authentication uses a session cookie set by the OAuth flow at `/api/oauth/callback`.

**Base URL:** `https://api.tradegateway.gov`
**Protocol:** tRPC 11 + Superjson transformer
**Auth:** Manus OAuth 2.0 session cookie (`tg_session`)

---

## Authentication

| Procedure | Type | Auth | Description |
|---|---|---|---|
| `auth.me` | query | public | Returns the current authenticated user or null |
| `auth.logout` | mutation | protected | Clears the session cookie |

---

## Declarations (`declarations.*`)

Core customs declaration lifecycle management.

| Procedure | Type | Auth | Description |
|---|---|---|---|
| `declarations.create` | mutation | protected | Submit a new import/export declaration |
| `declarations.myDeclarations` | query | protected | List declarations for the current trader |
| `declarations.getById` | query | protected | Fetch a single declaration by ID |
| `declarations.updateStatus` | mutation | admin | Update declaration status (customs officer) |
| `declarations.stats` | query | admin | Aggregate declaration statistics |
| `declarations.timeline` | query | protected | Fetch the event timeline for a declaration |

---

## Payments (`payments.*`)

Duty payment processing via Mojaloop and TigerBeetle.

| Procedure | Type | Auth | Description |
|---|---|---|---|
| `payments.initiatePayment` | mutation | protected | Initiate a duty payment for a declaration |
| `payments.getPaymentStatus` | query | protected | Check payment status by payment ID |
| `payments.listPayments` | query | protected | List payments for the current user |
| `payments.adminListPayments` | query | admin | List all payments (admin view) |
| `payments.refundPayment` | mutation | admin | Issue a refund for a completed payment |

---

## Risk Engine (`risk.*`)

AI-powered risk scoring and lane assignment.

| Procedure | Type | Auth | Description |
|---|---|---|---|
| `risk.scoreDeclaration` | mutation | protected | Score a declaration and assign a risk lane |
| `risk.getScore` | query | protected | Retrieve the risk score for a declaration |
| `risk.updateRules` | mutation | admin | Update risk scoring rules |
| `risk.getRules` | query | admin | List all active risk rules |
| `risk.getAnalytics` | query | admin | Risk analytics dashboard data |

---

## OGA Integrations (`oga.*`)

Other Government Agency permit and licence management.

| Procedure | Type | Auth | Description |
|---|---|---|---|
| `oga.listAgencies` | query | protected | List all connected OGAs |
| `oga.submitPermitRequest` | mutation | protected | Submit a permit/licence request to an OGA |
| `oga.getPermitStatus` | query | protected | Check permit request status |
| `oga.listPermits` | query | protected | List permits for a declaration |
| `oga.adminListRequests` | query | admin | List all OGA requests (admin view) |

---

## Cargo Tracking (`cargoTracking.*`)

Real-time cargo and vessel tracking.

| Procedure | Type | Auth | Description |
|---|---|---|---|
| `cargoTracking.trackByUCR` | query | protected | Track cargo by Unique Consignment Reference |
| `cargoTracking.trackByBL` | query | protected | Track cargo by Bill of Lading number |
| `cargoTracking.getVesselPosition` | query | protected | Get real-time vessel position |
| `cargoTracking.listEvents` | query | protected | List cargo tracking events |
| `cargoTracking.updateEvent` | mutation | admin | Record a new cargo tracking event |

---

## ASEAN Single Window (`aseanSw.*`)

Cross-border document exchange with ASEAN member states.

| Procedure | Type | Auth | Description |
|---|---|---|---|
| `aseanSw.sendMessage` | mutation | protected | Send a trade document to an ASEAN partner |
| `aseanSw.listMessages` | query | protected | List outbound ASEAN SW messages |
| `aseanSw.listInboundMessages` | query | protected | List inbound messages from ASEAN partners |
| `aseanSw.receiveAck` | mutation | protected | Record acknowledgement from a partner |
| `aseanSw.getStatus` | query | protected | Get ASEAN SW connectivity status |
| `aseanSw.getStats` | query | admin | ASEAN SW throughput statistics |

---

## WCO CEN (`cen.*`)

WCO Customs Enforcement Network alert exchange.

| Procedure | Type | Auth | Description |
|---|---|---|---|
| `cen.getPartners` | query | protected | List CEN partner customs administrations |
| `cen.sendAlert` | mutation | admin | Send a risk alert to a partner |
| `cen.receiveAlert` | mutation | admin | Record an inbound alert from a partner |
| `cen.listAlerts` | query | protected | List all CEN alerts (inbound + outbound) |
| `cen.correlateAlert` | query | protected | Find correlated alerts for a given alert |
| `cen.acknowledgeAlert` | mutation | protected | Acknowledge an inbound alert |
| `cen.getStats` | query | protected | CEN network statistics |

---

## KYC (`kyc.*`)

Know Your Customer identity verification.

| Procedure | Type | Auth | Description |
|---|---|---|---|
| `kyc.submitVerification` | mutation | protected | Submit KYC documents for verification |
| `kyc.getStatus` | query | protected | Get KYC verification status |
| `kyc.adminReview` | mutation | admin | Approve or reject a KYC submission |
| `kyc.listPending` | query | admin | List pending KYC reviews |

---

## Sanctions Screening (`sanctions.*`)

OFAC, UN, EU sanctions list screening.

| Procedure | Type | Auth | Description |
|---|---|---|---|
| `sanctions.screenTrader` | query | protected | Screen a trader against sanctions lists |
| `sanctions.screenDeclaration` | mutation | protected | Screen all parties in a declaration |
| `sanctions.getScreeningHistory` | query | protected | Get screening history for a trader |
| `sanctions.updateLists` | mutation | admin | Trigger sanctions list refresh |

---

## Ledger (`ledger.*`)

TigerBeetle financial ledger operations.

| Procedure | Type | Auth | Description |
|---|---|---|---|
| `ledger.getBalance` | query | protected | Get account balance |
| `ledger.getTransactions` | query | protected | List transactions for an account |
| `ledger.getStats` | query | admin | Ledger aggregate statistics |
| `ledger.reconcile` | mutation | admin | Trigger ledger reconciliation |

---

## Temporal Workflows (`temporal.*`)

Durable workflow orchestration status and management.

| Procedure | Type | Auth | Description |
|---|---|---|---|
| `temporal.listWorkflows` | query | admin | List active/completed workflows |
| `temporal.getWorkflow` | query | admin | Get workflow details and history |
| `temporal.terminateWorkflow` | mutation | admin | Terminate a running workflow |
| `temporal.getStats` | query | admin | Workflow engine statistics |

---

## Security Operations Centre (`soc.*`)

SOC incident management and security alerts.

| Procedure | Type | Auth | Description |
|---|---|---|---|
| `soc.getAlerts` | query | protected | List security alerts |
| `soc.getIncidents` | query | protected | List security incidents |
| `soc.createIncident` | mutation | protected | Create a new security incident |
| `soc.updateIncident` | mutation | protected | Update incident status/notes |
| `soc.ingestAlert` | mutation | protected | Ingest a raw security alert |
| `soc.correlateDeclaration` | query | protected | Correlate a declaration with security events |

---

## Wazuh SIEM (`wazuh.*`)

Wazuh SIEM/XDR integration for threat detection.

| Procedure | Type | Auth | Description |
|---|---|---|---|
| `wazuh.getAlerts` | query | protected | List Wazuh alerts |
| `wazuh.getAgents` | query | protected | List monitored agents |
| `wazuh.detectAnomaly` | mutation | protected | Run anomaly detection on a payload |
| `wazuh.getStats` | query | protected | Wazuh statistics |

---

## Threat Intelligence (`threatIntel.*`)

OpenCTI threat intelligence integration.

| Procedure | Type | Auth | Description |
|---|---|---|---|
| `threatIntel.getIndicators` | query | admin | List threat indicators |
| `threatIntel.enrichAlert` | mutation | protected | Enrich a security alert with threat intel |
| `threatIntel.enrichDeclaration` | mutation | protected | Enrich a declaration with threat intel |
| `threatIntel.lookupThreatActor` | query | protected | Look up a threat actor by name |
| `threatIntel.checkSanctions` | query | protected | Check entity against sanctions via CTI |
| `threatIntel.getCountryRisk` | query | protected | Get country risk assessment |
| `threatIntel.matchDeclaration` | mutation | admin | Match a declaration against threat intel |

---

## Post-Clearance Audit (`postAudit.*`)

Post-clearance audit case management.

| Procedure | Type | Auth | Description |
|---|---|---|---|
| `postAudit.list` | query | admin | List audit cases with pagination |
| `postAudit.getById` | query | admin | Get audit case details |
| `postAudit.create` | mutation | admin | Open a new audit case |
| `postAudit.update` | mutation | admin | Update audit case status/findings |
| `postAudit.addFinding` | mutation | admin | Add a finding to an audit case |
| `postAudit.getStats` | query | admin | Audit statistics |

---

## Executive Dashboard (`executiveDashboard.*`)

C-level analytics and revenue reporting.

| Procedure | Type | Auth | Description |
|---|---|---|---|
| `executiveDashboard.getRevenueCounter` | query | admin | Real-time revenue counters (today/month/year) |
| `executiveDashboard.getKPIs` | query | admin | Key performance indicators |
| `executiveDashboard.getRevenueTrend` | query | admin | Revenue trend over time |
| `executiveDashboard.exportRevenueCsv` | mutation | admin | Export revenue data as CSV |

---

## Trader Scorecard (`traderScorecard.*`)

AEO compliance scoring and benchmarking.

| Procedure | Type | Auth | Description |
|---|---|---|---|
| `traderScorecard.getScorecard` | query | protected | Get compliance scorecard for a trader |
| `traderScorecard.getClearancePercentile` | query | protected | Clearance time percentile ranking |
| `traderScorecard.getHsCodeBreakdown` | query | protected | HS code distribution analysis |
| `traderScorecard.getRiskProfile` | query | protected | Risk profile over time |
| `traderScorecard.getBenchmarkComparison` | query | protected | Benchmark against sector peers |

---

## Nigeria ID Verification (`nigeriaId.*`)

Nigeria NIN/BVN/CAC identity verification.

| Procedure | Type | Auth | Description |
|---|---|---|---|
| `nigeriaId.verify` | mutation | protected | Submit an identity for verification |
| `nigeriaId.getVerificationStatus` | query | protected | Check verification status |
| `nigeriaId.adminListVerified` | query | admin | List all verified identities |

---

## API Changelog (`apiChangelog.*`)

API version changelog and deprecation notices.

| Procedure | Type | Auth | Description |
|---|---|---|---|
| `apiChangelog.list` | query | public | List changelog entries |
| `apiChangelog.getById` | query | public | Get a specific changelog entry |
| `apiChangelog.publish` | mutation | admin | Publish a new changelog entry |
| `apiChangelog.archive` | mutation | admin | Archive an old changelog entry |

---

## System (`system.*`)

Platform health and owner notifications.

| Procedure | Type | Auth | Description |
|---|---|---|---|
| `system.ping` | query | public | Liveness check — returns `pong` |
| `system.systemStatus` | query | public | Full platform health status |
| `system.notifyOwner` | mutation | protected | Send a notification to the platform owner |

---

## REST Endpoints

| Endpoint | Method | Auth | Description |
|---|---|---|---|
| `/api/health/live` | GET | none | Kubernetes liveness probe |
| `/api/health/ready` | GET | none | Kubernetes readiness probe (checks DB) |
| `/api/health` | GET | none | Full deep health check report |
| `/metrics` | GET | none | Prometheus metrics (scrape target) |
| `/api/openapi.json` | GET | none | OpenAPI 3.0 specification |
| `/api/oauth/login` | GET | none | Initiate OAuth login flow |
| `/api/oauth/callback` | GET | none | OAuth callback handler |
| `/api/oauth/logout` | POST | session | Clear session and redirect |

---

## Error Codes

| Code | HTTP Status | Description |
|---|---|---|
| `UNAUTHORIZED` | 401 | Not authenticated — redirect to login |
| `FORBIDDEN` | 403 | Authenticated but insufficient role |
| `NOT_FOUND` | 404 | Resource does not exist |
| `BAD_REQUEST` | 400 | Invalid input (Zod validation failure) |
| `INTERNAL_SERVER_ERROR` | 500 | Unexpected server error |
| `SERVICE_UNAVAILABLE` | 503 | External dependency (OGA, Mojaloop, etc.) is down |
| `TOO_MANY_REQUESTS` | 429 | Rate limit exceeded |

---

*Generated from TradeGateway™ NGSWTP v1.0.0 — March 2026*
