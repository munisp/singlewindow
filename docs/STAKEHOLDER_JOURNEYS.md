# TradeGateway™ NGSWTP — 30 Stakeholder Journey Reference

**Version:** 2.0.0 | **Date:** March 2026 | **Author:** Manus AI

---

## Executive Summary

TradeGateway NGSWTP (Next-Generation Single Window Trade Platform) serves nine distinct stakeholder roles across thirty documented journeys. Each journey is a bounded sequence of events that a stakeholder must complete to accomplish a specific trade objective. The platform's orchestration layer — comprising Kafka, Dapr, Fluvio, Temporal, Keycloak, Permify, Redis, APISIX, TigerBeetle, and a Delta Lake lakehouse — exists specifically to make these journeys fast, auditable, and resilient. This document maps every journey to the platform services it exercises, the problem it solves, and the measurable value it delivers.

The thirty journeys are grouped into six thematic domains: **Import Clearance** (journeys 1–5), **Export Processing** (journeys 6–8), **OGA Permit Management** (journeys 9–14), **Cargo and Port Operations** (journeys 15–17), **Financial Settlement** (journeys 18–20), **Compliance and Security** (journeys 21–23), **Platform Administration** (journeys 24–27), and **Cross-Border and Interoperability** (journeys 28–30).

---

## Stakeholder Roles

| Role | Description | Portal |
|---|---|---|
| **Trader** | Registered importer or exporter (company or individual) | Trader Portal |
| **Customs Officer** | Ghana Revenue Authority customs examiner | Customs Portal |
| **OGA Officer** | Other Government Agency permit reviewer (FDA, EPA, CEPS, etc.) | OGA Portal |
| **Finance Officer** | Revenue authority finance and reconciliation officer | Finance Portal |
| **Port Operator** | Port operator at Tema, Takoradi, or Keta terminals | Port Portal |
| **Auditor** | Post-clearance audit officer | Admin Console |
| **Compliance Officer** | Sanctions screening and WCO CEN analyst | SOC Dashboard |
| **Inspector** | Physical container inspection officer | Customs Portal |
| **Admin** | Platform administrator | Admin Console |

---

## Platform Services Reference

The table below lists every middleware service and its primary function. Journey descriptions reference these services by name.

| Service | Technology | Role in Platform |
|---|---|---|
| **APISIX** | Apache APISIX 3.x | API gateway — JWT validation, rate limiting, routing to all microservices |
| **Keycloak** | Keycloak 24 | Identity and access management — OIDC tokens, role mappers, MFA |
| **Permify** | Permify v0.9 | Fine-grained authorization — resource-level permission checks |
| **Kafka** | Apache Kafka 3.7 | Durable event bus — all domain events published and consumed here |
| **Fluvio** | Fluvio 0.11 | Real-time stream processing — sub-millisecond AIS and cargo events |
| **Dapr** | Dapr 1.13 | Service mesh — pub/sub, state store, actor model, resiliency policies |
| **Temporal** | Temporal 1.24 | Durable workflow engine — all multi-step, multi-day business processes |
| **Redis** | Redis 7.2 | Session cache, Dapr state store, rate-limit counters, risk score cache |
| **TigerBeetle** | TigerBeetle 0.15 | Double-entry financial ledger — duty invoices, payments, drawback credits |
| **Lakehouse** | Delta Lake + Apache Flink + Apache Spark | Analytical data store — all events partitioned by year/month for BI and ML |
| **Declaration Engine** | Go (declaration-service) | Validates, assigns URN, routes declarations through the clearance FSM |
| **Risk Engine** | Python FastAPI + ML | WCO SAFE Framework risk scoring — assigns GREEN / YELLOW / RED lane |
| **Sanctions Screener** | Python FastAPI + Jaro-Winkler | Fuzzy-match against UN, OFAC, and EU consolidated lists |
| **OGA Hub** | Go (oga-service) | Routes permit requests to the correct OGA and tracks SLA timers |
| **Payment Service** | Go (payment-service) | Mojaloop payment initiation + TigerBeetle ledger posting |
| **Temporal Worker** | Go (temporal-worker) | Executes all 10 Temporal workflow definitions |
| **Knowledge Graph** | FalkorDB + Neo4j + GraphSAGE | GNN-based multi-hop risk propagation across trader-HS-corridor graph |
| **Vision Service** | Python + YOLOv8 + SAM2 | Container seal detection, LPR, dangerous goods label recognition |
| **KYC Service** | Python + PaddleOCR + DocLing | Document OCR, entity extraction, authenticity scoring |

---

## Domain 1 — Import Clearance (Journeys 1–5)

### Journey 1 — Standard Import Declaration (Green Lane)

**Stakeholder:** Trader

**Narrative.** A registered importer submits a customs declaration for a consignment of electronics arriving at Tema Port. The declaration includes the commercial invoice, bill of lading, packing list, and HS code. The Risk Engine scores the shipment as low-risk (score < 35) based on the trader's clean compliance history, the commodity's benign HS chapter, and the origin country's low-risk profile. The Temporal `DeclarationClearanceWorkflow` assigns a green lane, auto-approves the declaration, and issues a clearance permit within four hours. The trader pays duties via Mojaloop mobile money. The port operator receives a cargo release notification via Fluvio.

**Services used:**

| Step | Service | What it does |
|---|---|---|
| Authentication | Keycloak + APISIX | Issues OIDC token; APISIX JWT plugin validates on every request |
| Submission | Declaration Engine (Go) | Validates HS code, assigns UCR, persists to PostgreSQL |
| Authorization | Permify | Checks `declaration:submit` permission for the trader |
| Risk scoring | Risk Engine (Python) | Computes weighted risk score; caches result in Redis (TTL 1h) |
| Workflow | Temporal | Runs `DeclarationClearanceWorkflow`; green lane → auto-approve path |
| Event publish | Kafka + Dapr | Publishes `declaration.submitted` and `declaration.approved` events |
| Payment | Payment Service + TigerBeetle | Creates duty invoice; posts debit/credit entries to TigerBeetle ledger |
| Cargo release | Fluvio + fluvio-consumer | Publishes `CLEARANCE_PERMIT_ISSUED` event; port operator WebSocket receives it in < 1s |
| Analytics | Lakehouse (Delta Lake) | Flink job ingests all events into `declaration_events` Delta table |

**Problem solved.** Before the platform, a standard import took 4–6 days due to manual document submission, physical queuing at customs counters, and sequential (not parallel) OGA approvals. Green-lane declarations now clear in under four hours with zero human intervention.

**Value delivered.** Clearance time reduced from 4.2 days (Ghana pre-ICUMS baseline) to < 4 hours for green-lane shipments. Trader cost of capital tied up in transit inventory falls proportionally.

---

### Journey 2 — Yellow-Lane Declaration (Documentary Review)

**Stakeholder:** Trader → Customs Officer

**Narrative.** A shipment of pharmaceutical raw materials from India scores 52 on the risk model (yellow lane) due to the sensitive HS chapter and a first-time origin-destination pair. The Temporal workflow pauses at the `AwaitDocumentaryReview` activity and assigns the declaration to an available customs officer via the officer workload router. The officer reviews the certificate of analysis and import permit in the document vault, requests one additional document via the `request_docs` tRPC procedure, and approves after receipt. The entire documentary review completes in 6 hours against a 24-hour SLA.

**Services used:** Keycloak, APISIX, Permify (`declaration:assess`), Declaration Engine, Risk Engine, Temporal (`AwaitDocumentaryReview` activity), Dapr (pub/sub notification to officer), Redis (officer assignment cache), Document Vault (S3), Kafka, Lakehouse.

**Problem solved.** Manual assignment of declarations to officers was ad hoc and created bottlenecks. The officer workload router distributes declarations evenly and the Temporal SLA timer escalates automatically if the 24-hour window is breached.

**Value delivered.** Documentary review SLA compliance rises to > 95%. Officer utilisation is balanced, eliminating the "star officer" bottleneck common in manual systems.

---

### Journey 3 — Red-Lane Declaration (Physical Inspection)

**Stakeholder:** Trader → Customs Officer → Inspector

**Narrative.** A consignment of used tyres from a high-risk corridor scores 78 (red lane). The Temporal workflow routes the declaration to physical inspection. The inspector uses the Vision Service to photograph container seals and scan the cargo manifest. YOLOv8 detects a broken seal; the inspector raises a hold and notifies the customs officer. The officer issues a discrepancy notice to the trader. After the trader provides a satisfactory explanation and a re-inspection confirms no prohibited goods, the declaration is approved. Total elapsed time: 48 hours.

**Services used:** Keycloak, APISIX, Permify (`cargo:hold`, `cargo:release`), Declaration Engine, Risk Engine, Temporal (`PhysicalInspectionActivity`), Vision Service (YOLOv8 + SAM2), Dapr (multi-service notification), Kafka, Fluvio (real-time inspection status updates), Lakehouse.

**Problem solved.** Physical inspections previously had no digital audit trail. The Vision Service creates a timestamped photographic record of every inspection, eliminating disputes about cargo condition at the time of examination.

**Value delivered.** Inspection fraud reduced. Average red-lane clearance time falls from 5 days to 48 hours. Photographic evidence admissible in post-clearance audit proceedings.

---

### Journey 4 — AEO Certification Application

**Stakeholder:** Trader → Admin

**Narrative.** An established importer with three years of clean compliance history applies for Authorised Economic Operator (AEO) status. The trader submits a self-assessment questionnaire, audited financial statements, and a supply chain security plan via the AEO Application page. The admin reviews the KYC documents (processed by the KYC Service using PaddleOCR and DocLing), scores the application against WCO SAFE Framework criteria, and approves. The trader's Keycloak user attribute `aeo_status` is updated to `approved`. Subsequent declarations by this trader receive a 40% risk score discount, routing most shipments to the green lane automatically.

**Services used:** Keycloak (user attribute update), Permify (`aeo_application:approve`), KYC Service (PaddleOCR + DocLing + VLM), Temporal (`AEOCertificationWorkflow`), Dapr, Kafka, TigerBeetle (AEO fee payment), Lakehouse.

**Problem solved.** AEO programmes in most African customs administrations are paper-based and take 6–18 months. The digital workflow reduces approval time to 2–4 weeks and creates a continuously auditable compliance record.

**Value delivered.** AEO traders receive 40% risk score reduction, dramatically increasing green-lane throughput. Revenue authority benefits from a pre-vetted, low-risk trader population that requires fewer costly physical inspections.

---

### Journey 5 — Duty Drawback Claim

**Stakeholder:** Trader → Finance Officer

**Narrative.** A manufacturer who imported raw materials under a duty suspension scheme re-exports finished goods and files a duty drawback claim. The trader submits the original import declaration reference, the export declaration, and proof of re-export. The Temporal `DutyDrawbackWorkflow` verifies the import and export records in PostgreSQL, calculates the refund amount using TigerBeetle's ledger query API, and routes the claim to a finance officer for approval. Upon approval, TigerBeetle posts a credit entry and Mojaloop initiates a bank transfer to the trader's registered account.

**Services used:** Permify (`drawback_claim:approve`), Temporal (`DutyDrawbackWorkflow`), TigerBeetle (ledger query + credit posting), Payment Service (Mojaloop refund), Dapr, Kafka, Lakehouse.

**Problem solved.** Duty drawback in Ghana historically took 12–18 months due to manual cross-referencing of import and export records. The automated workflow reduces this to 5–10 business days.

**Value delivered.** Faster drawback processing improves exporter cash flow and incentivises value-added manufacturing for export. TigerBeetle's double-entry ledger ensures every refund is fully reconciled with no risk of double payment.

---

## Domain 2 — Export Processing (Journeys 6–8)

### Journey 6 — Standard Export Declaration

**Stakeholder:** Trader → Customs Officer

**Narrative.** An exporter declares a shipment of cocoa beans destined for the Netherlands. The declaration triggers OGA permit requests to the Ghana Cocoa Board and the Food and Drugs Authority in parallel (via Dapr pub/sub). Both agencies approve within 2 hours. The Risk Engine scores the shipment as low-risk. The Temporal workflow issues an export permit and notifies the port operator to schedule loading.

**Services used:** Declaration Engine, Risk Engine, OGA Hub (parallel permit requests via Dapr), Temporal (`DeclarationClearanceWorkflow` export variant), Keycloak, Permify, Kafka, Fluvio, TigerBeetle (export levy payment), Lakehouse.

**Problem solved.** Export declarations previously required sequential visits to multiple agency offices. Parallel OGA processing via Dapr reduces total permit wait time from days to hours.

**Value delivered.** Export clearance time reduced from 3–5 days to under 8 hours for standard agricultural exports. Ghana's Doing Business ranking for trading across borders improves directly.

---

### Journey 7 — Transit Declaration (COMESA Corridor)

**Stakeholder:** Trader → Customs Officer (origin) → Customs Officer (transit) → Customs Officer (destination)

**Narrative.** A Ghanaian trader transits goods through Burkina Faso to Mali under the COMESA Transit Guarantee scheme. The platform generates a Transit Accompanying Document (TAD) with a unique UCR. The Temporal `ASEANSingleWindowWorkflow` (adapted for COMESA) sends the TAD to the Burkina Faso and Mali customs systems via the WCO CEN Network integration. Each transit point confirms arrival and departure. The guarantee is released automatically when the destination customs authority confirms final clearance.

**Services used:** Declaration Engine (transit mode), Temporal (`ASEANSingleWindowWorkflow`), WCO CEN Router (cenRouter tRPC), Dapr (cross-border event routing), Kafka, TigerBeetle (transit guarantee bond), Permify, Lakehouse.

**Problem solved.** Transit fraud and cargo diversion are major revenue leakage points. The UCR-tracked TAD with real-time cross-border confirmation eliminates the ability to divert transit cargo without detection.

**Value delivered.** Transit guarantee release time reduced from 30 days (manual) to 48 hours (automated confirmation). Corridor dwell time at border posts falls by an estimated 60%.

---

### Journey 8 — Post-Clearance Audit

**Stakeholder:** Auditor → Trader

**Narrative.** An auditor selects a completed import declaration for post-clearance review based on a risk-based audit selection algorithm. The auditor examines the original documents, the risk score rationale (from the Knowledge Graph's `explainRisk` procedure), and the TigerBeetle ledger entries for the duty payment. A discrepancy in the declared value is identified. The auditor issues a penalty notice and a demand for additional duty. The Temporal `PostClearanceAuditWorkflow` tracks the trader's response deadline and escalates to the admin if the deadline is missed.

**Services used:** Permify (`audit_record:create`, `audit_record:issue_penalty`), Temporal (`PostClearanceAuditWorkflow`), Knowledge Graph (risk explainability), TigerBeetle (ledger audit trail), Dapr (penalty notification), Kafka, Lakehouse.

**Problem solved.** Post-clearance audits were previously conducted on paper with no systematic risk-based selection. The platform's audit selection algorithm targets high-risk declarations, maximising revenue recovery per audit-hour.

**Value delivered.** Audit coverage increases from < 1% to 5–10% of declarations (risk-targeted). Revenue recovery per audit improves by an estimated 3–5x. TigerBeetle's immutable ledger makes every duty payment legally defensible.

---

## Domain 3 — OGA Permit Management (Journeys 9–14)

### Journey 9 — Food and Drugs Authority (FDA) Import Permit

**Stakeholder:** Trader → OGA Officer (FDA)

**Narrative.** A trader importing pharmaceutical products submits an FDA import permit request as part of the declaration workflow. The OGA Hub routes the request to the FDA officer queue. The officer reviews the product registration certificate, certificate of analysis, and manufacturer's licence. The Temporal `OGASLAEnforcementWorkflow` monitors the 48-hour SLA and sends escalation alerts via Dapr if the review is not completed in time. The officer approves and the permit is attached to the declaration.

**Services used:** OGA Hub (Go), Permify (`permit:approve`), Temporal (`OGASLAEnforcementWorkflow`), Dapr (SLA alert pub/sub), Redis (SLA timer state), Kafka, Lakehouse.

**Problem solved.** OGA permit delays are the single largest contributor to clearance time in Ghana. The SLA enforcement workflow creates accountability — every delay is logged, escalated, and visible to the admin.

**Value delivered.** OGA permit turnaround time reduced from 3–7 days to < 48 hours for 90% of applications. SLA breach rate visible in real time on the admin dashboard.

---

### Journey 10 — Environmental Protection Agency (EPA) Permit

**Stakeholder:** Trader → OGA Officer (EPA)

**Narrative.** A trader importing industrial chemicals requires an EPA import permit. The permit request includes a Material Safety Data Sheet (MSDS) and a waste management plan. The Vision Service analyses the MSDS document using DocLing to extract hazard classifications. The OGA officer reviews the extracted data alongside the trader's environmental compliance history (from the Knowledge Graph) and approves or rejects with conditions.

**Services used:** OGA Hub, Vision Service (DocLing MSDS analysis), Knowledge Graph (trader compliance history), Permify, Temporal, Dapr, Kafka, Lakehouse.

**Problem solved.** EPA officers previously reviewed MSDS documents manually, a time-consuming process prone to error. Automated extraction reduces review time and ensures no hazard classification is missed.

**Value delivered.** EPA permit review time reduced by 60%. Environmental compliance data is captured in the Knowledge Graph, enabling pattern detection of repeat environmental violators.

---

### Journey 11 — Ghana Cocoa Board (COCOBOD) Export Permit

**Stakeholder:** Trader (cocoa exporter) → OGA Officer (COCOBOD)

**Narrative.** A licensed cocoa buyer applies for a COCOBOD export permit. The permit request includes the purchase contract, quality grading certificate, and licensed buying company registration. The OGA Hub routes the request to COCOBOD. The officer verifies the grading certificate against the COCOBOD quality database (via the OGA service's external API integration) and approves. The permit is embedded in the export declaration's UCR chain.

**Services used:** OGA Hub (external API call to COCOBOD database), Permify, Temporal, Dapr, Kafka, Lakehouse.

**Problem solved.** COCOBOD permit processing was entirely manual and paper-based. Digital integration eliminates the need for physical visits to COCOBOD offices and reduces permit fraud.

**Value delivered.** COCOBOD permit processing time reduced from 5 days to 4 hours. Quality certificate verification is automated, reducing the risk of fraudulent certificates.

---

### Journey 12 — Minerals Commission Export Permit

**Stakeholder:** Trader (minerals exporter) → OGA Officer (Minerals Commission)

**Narrative.** A gold mining company exports refined gold. The permit request includes an assay certificate, royalty payment receipt, and export licence. The Temporal workflow verifies the royalty payment via TigerBeetle (the royalty was paid through the platform's payment service) and routes the permit request to the Minerals Commission officer. The officer approves after verifying the assay certificate.

**Services used:** OGA Hub, TigerBeetle (royalty payment verification), Permify, Temporal, Dapr, Kafka, Lakehouse.

**Problem solved.** Gold export permit fraud (under-declaration of weight or purity) is a major source of revenue leakage. TigerBeetle's immutable ledger provides an auditable royalty payment trail that cannot be altered.

**Value delivered.** Royalty leakage on gold exports reduced. Permit processing time falls from 7 days to 24 hours.

---

### Journey 13 — Veterinary Service Department (VSD) Import Permit

**Stakeholder:** Trader (livestock/meat importer) → OGA Officer (VSD)

**Narrative.** A trader importing frozen poultry requires a VSD import permit and a veterinary health certificate. The Vision Service analyses the uploaded health certificate using OCR to extract the issuing authority, date, and disease-free attestation. The OGA officer reviews the extracted data and cross-references with the OIE disease notification database (via the OGA service's external API). The permit is approved with a condition for cold-chain temperature monitoring.

**Services used:** OGA Hub, Vision Service (OCR health certificate), Permify, Temporal, Dapr, Kafka, Lakehouse.

**Problem solved.** Manual review of veterinary health certificates is slow and error-prone. Automated OCR extraction and OIE cross-referencing reduces the risk of importing livestock products from disease-affected zones.

**Value delivered.** VSD permit review time reduced by 50%. Disease outbreak risk from imported livestock products is quantifiably reduced.

---

### Journey 14 — Multi-Agency Joint Inspection (Rwanda ReSW Model)

**Stakeholder:** Trader → Customs Officer → Multiple OGA Officers → Port Operator

**Narrative.** A high-value shipment of medical equipment triggers simultaneous permit requests to the FDA, EPA, and the Standards Authority. Following the Rwanda ReSW joint inspection model, all three agencies must finalise their reviews before the declaration can proceed. The Temporal workflow uses a `WaitForAll` activity that holds the clearance FSM until all three OGA approvals are received. If any agency rejects, the entire declaration is held and the trader is notified with the specific rejection reason.

**Services used:** OGA Hub (parallel routing via Dapr), Temporal (`WaitForAll` activity), Permify (multi-agency permission checks), Redis (joint inspection state), Dapr (simultaneous notifications), Kafka, Lakehouse.

**Problem solved.** Sequential OGA approvals create a "longest chain" problem where the total clearance time equals the sum of all individual agency review times. The joint inspection model makes total time equal to the slowest agency, not the sum.

**Value delivered.** Multi-agency clearance time reduced by 60–70% for complex shipments. The joint inspection model is the single most impactful architectural decision for clearance time reduction.

---

## Domain 4 — Cargo and Port Operations (Journeys 15–17)

### Journey 15 — Container Gate-In and Berth Scheduling

**Stakeholder:** Port Operator

**Narrative.** A vessel arrives at Tema Container Terminal. The port operator logs the vessel arrival in the platform, triggering an AIS position update published to the `ais-vessel-positions` Fluvio topic. The fluvio-consumer broadcasts the event to all subscribed WebSocket clients (port heatmap, customs dashboard) in under 1 second. The port operator schedules berth allocation and container gate-in. The Fluvio stream updates the port congestion heatmap in real time.

**Services used:** Fluvio (AIS event streaming), fluvio-consumer (WebSocket broadcast), Permify (`cargo:schedule_berth`), Dapr (cargo event pub/sub), Kafka, Redis (berth state cache), Lakehouse.

**Problem solved.** Port operators previously had no real-time visibility of vessel positions or container gate-in status. The Fluvio stream provides sub-second updates, enabling proactive berth scheduling and reducing vessel waiting time.

**Value delivered.** Vessel turnaround time at Tema Port reduced. Port congestion heatmap enables the port authority to identify and address bottlenecks in real time.

---

### Journey 16 — Cargo Release After Clearance

**Stakeholder:** Port Operator → Trader

**Narrative.** A clearance permit is issued by the customs officer. The Declaration Engine publishes a `CLEARANCE_PERMIT_ISSUED` event to the `cargo-events` Kafka topic. Fluvio mirrors this event in under 100ms. The fluvio-consumer broadcasts it to the port operator's WebSocket connection. The port operator authorises cargo release in the platform. A `CONTAINER_GATE_OUT` event is published and the trader receives a push notification via the user notifications service.

**Services used:** Fluvio + fluvio-consumer (real-time permit notification), Permify (`cargo:release`), Dapr (release authorisation event), Kafka, User Notifications (push), Lakehouse.

**Problem solved.** Cargo release delays after clearance permit issuance are a major source of port congestion. Real-time notification via Fluvio eliminates the "waiting for the fax" problem common in manual systems.

**Value delivered.** Average time from permit issuance to cargo gate-out reduced from 4–8 hours to < 1 hour. Port congestion reduced proportionally.

---

### Journey 17 — Bonded Warehouse Operations

**Stakeholder:** Trader → Customs Officer → Port Operator

**Narrative.** A trader places goods in a customs-bonded warehouse pending duty payment or re-export. The platform creates a bonded warehouse entry linked to the original declaration UCR. The Temporal `BondedWarehouseWorkflow` tracks the goods' location, quantity, and the bond expiry date. If the trader does not pay duties or re-export within the bond period, the Temporal workflow automatically initiates a seizure procedure and notifies the customs officer.

**Services used:** Bonded Warehouse Router (tRPC), Temporal (`BondedWarehouseWorkflow`), TigerBeetle (bond posting), Permify, Dapr, Kafka, Lakehouse.

**Problem solved.** Bonded warehouse abuse (goods disappearing without duty payment) is a significant revenue leakage vector. The Temporal workflow's durable timer ensures no bond expires without action.

**Value delivered.** Bonded warehouse revenue leakage eliminated. Bond expiry compliance rate rises to 100% (automated enforcement).

---

## Domain 5 — Financial Settlement (Journeys 18–20)

### Journey 18 — Duty Payment via Mobile Money

**Stakeholder:** Trader

**Narrative.** A trader receives a duty invoice generated by TigerBeetle. The invoice is displayed in the trader portal with a Mojaloop payment link. The trader initiates payment via MTN Mobile Money. The Payment Service calls the Mojaloop API, which routes the payment through the interbank switch. Upon confirmation, TigerBeetle posts the credit entry and the declaration status transitions to `DUTIES_PAID`. The Temporal workflow resumes and issues the clearance permit.

**Services used:** TigerBeetle (invoice creation + credit posting), Payment Service (Mojaloop API), Temporal (workflow resume on payment confirmation), Dapr (payment confirmed event), Kafka, Lakehouse.

**Problem solved.** Duty payment previously required physical visits to bank branches or customs cashiers, creating queues and delays. Mobile money integration enables payment from anywhere, at any time.

**Value delivered.** Duty payment processing time reduced from 1–2 days (bank branch) to < 5 minutes (mobile money). Payment fraud eliminated by TigerBeetle's double-entry ledger.

---

### Journey 19 — Revenue Reconciliation

**Stakeholder:** Finance Officer

**Narrative.** At end of day, the finance officer runs a reconciliation report that compares TigerBeetle ledger entries with the Mojaloop settlement records. The Finance Dashboard queries the Lakehouse (Delta Lake) for all payment events in the day's partition. Discrepancies are flagged automatically. The finance officer investigates flagged items using the TigerBeetle ledger drill-down view.

**Services used:** TigerBeetle (ledger query), Lakehouse (Delta Lake analytical query via Spark), Finance Router (tRPC), Permify (`payment:reconcile`), Kafka.

**Problem solved.** Manual reconciliation of duty payments against bank settlement records took 2–3 days and was error-prone. Automated reconciliation against TigerBeetle's immutable ledger reduces this to minutes.

**Value delivered.** Reconciliation time reduced from 2–3 days to < 30 minutes. Unreconciled items are detected and investigated the same day, preventing revenue leakage.

---

### Journey 20 — Finance Analytics and Reporting

**Stakeholder:** Finance Officer → Admin

**Narrative.** The finance officer generates a monthly revenue report showing duty collection by HS chapter, by OGA, and by trade corridor. The Finance Dashboard queries the Lakehouse's `payment_events` and `declaration_events` Delta tables using Spark SQL. The report is exported as a PDF for submission to the Ministry of Finance.

**Services used:** Lakehouse (Delta Lake + Apache Spark), Finance Router (tRPC), Permify (`system:view_analytics`), Kafka.

**Problem solved.** Revenue reporting previously required manual extraction from multiple disconnected systems. The Lakehouse provides a single source of truth for all financial analytics.

**Value delivered.** Monthly revenue report generation time reduced from 2 weeks to < 1 hour. Data accuracy improves as all figures derive from TigerBeetle's immutable ledger.

---

## Domain 6 — Compliance and Security (Journeys 21–23)

### Journey 21 — Sanctions Screening

**Stakeholder:** Compliance Officer

**Narrative.** Every trader, consignee, and shipper name in every declaration is automatically screened against the UN Consolidated Sanctions List, OFAC SDN List, and EU Consolidated List using the Sanctions Service's Jaro-Winkler fuzzy matching algorithm. A match above the 0.85 threshold triggers a `SANCTIONS_MATCH` event published to Kafka. The Temporal `SanctionsHoldWorkflow` places the declaration on hold and notifies the compliance officer. The officer reviews the match, confirms or dismisses it, and either releases the declaration or initiates a seizure procedure.

**Services used:** Sanctions Service (Python + Jaro-Winkler), Temporal (`SanctionsHoldWorkflow`), Permify (`sanctions_entry:screen`, `sanctions_entry:alert`), Dapr (hold notification), Kafka, Lakehouse.

**Problem solved.** Manual sanctions screening is slow and inconsistent. Automated fuzzy matching ensures no sanctioned entity can slip through due to name variations or transliteration differences.

**Value delivered.** Sanctions screening coverage rises to 100% of declarations (vs. < 20% manual spot-checking). False positive rate controlled by the 0.85 Jaro-Winkler threshold. Compliance with FATF Recommendation 6 (targeted financial sanctions) achieved.

---

### Journey 22 — WCO CEN Alert Management

**Stakeholder:** Compliance Officer → Customs Officer

**Narrative.** The platform receives a WCO Customs Enforcement Network (CEN) alert about a specific container type associated with drug trafficking on the West Africa corridor. The compliance officer reviews the alert in the SOC Dashboard and creates a targeting rule that automatically flags declarations matching the alert criteria (origin country, HS code, container type) for red-lane physical inspection. The Knowledge Graph's risk propagation engine updates risk scores for all affected declarations in the queue.

**Services used:** CEN Router (tRPC), Knowledge Graph (risk score update via GNN propagation), Risk Engine (score recalculation), Permify (`security_alert:escalate`), Dapr (targeting rule broadcast), Kafka, Lakehouse.

**Problem solved.** WCO CEN alerts were previously received by email and manually actioned. The platform's automated targeting rule engine ensures alerts are applied to all relevant declarations within minutes.

**Value delivered.** Response time to WCO CEN alerts reduced from days to minutes. Risk score updates propagate through the Knowledge Graph to all related declarations automatically.

---

### Journey 23 — Threat Intelligence and SIEM Integration

**Stakeholder:** Compliance Officer

**Narrative.** The Wazuh SIEM detects an anomalous login pattern — a customs officer account logging in from an unusual IP address at 3 AM. The Wazuh alert is ingested by the platform's `wazuhRouter` and displayed in the SOC Dashboard. The compliance officer investigates using the OpenCTI threat intelligence integration, identifies the IP as associated with a known cybercrime group, and suspends the officer's Keycloak account pending investigation.

**Services used:** Wazuh Router (tRPC), OpenCTI (Threat Intel Router), Keycloak (account suspension via admin API), Permify (`security_alert:resolve`), Dapr, Kafka, Lakehouse.

**Problem solved.** Insider threat detection in customs systems is a critical but often neglected security requirement. Integration of SIEM alerts with the platform's identity management enables rapid response to compromised accounts.

**Value delivered.** Mean time to detect (MTTD) insider threats reduced from weeks to hours. Keycloak account suspension is automated, limiting the window of exposure.

---

## Domain 7 — Platform Administration (Journeys 24–27)

### Journey 24 — Trader Onboarding and KYB

**Stakeholder:** Trader → Admin

**Narrative.** A new trading company registers on the platform. The onboarding workflow collects company registration documents, TIN certificate, and director identification. The KYC Service processes the documents using PaddleOCR (text extraction), DocLing (structured parsing), and a VLM (document authenticity scoring). The admin reviews the extracted data and approves the trader profile. The trader's Keycloak account is created with the `trader` role and the `company_name` and `tin` attributes are set for inclusion in JWT tokens.

**Services used:** KYC Service (PaddleOCR + DocLing + VLM), Keycloak (user creation + attribute setting), Permify (`profile:kyc_verify`), Temporal (`TraderOnboardingWorkflow`), Dapr, Kafka, Lakehouse.

**Problem solved.** Trader registration was a paper-based process taking 2–4 weeks. Digital KYB with automated document analysis reduces this to 2–3 business days.

**Value delivered.** Trader onboarding time reduced by 80%. KYB document analysis creates a permanent, auditable compliance record for every registered trader.

---

### Journey 25 — User Role Management

**Stakeholder:** Admin

**Narrative.** A new customs officer joins the Ghana Revenue Authority. The admin creates a Keycloak user account, assigns the `customs_officer` realm role, and sets the officer's assigned port code as a user attribute. The Permify seed script is run to create the officer's initial relationship tuples. The officer logs in and is immediately presented with the Customs Portal with the correct navigation and data access.

**Services used:** Keycloak (user creation + role assignment), Permify (tuple creation via `writeTuple`), APISIX (JWT validation with new role), Admin Router (tRPC), Lakehouse.

**Problem solved.** User provisioning in legacy systems required IT department involvement and took days. Self-service admin provisioning via the Admin Console reduces this to minutes.

**Value delivered.** New officer onboarding time reduced from days to minutes. Role-based access control is enforced at both the API gateway (APISIX JWT) and resource level (Permify), providing defence in depth.

---

### Journey 26 — API Developer Portal and Webhook Management

**Stakeholder:** Third-party developer

**Narrative.** A logistics company wants to integrate their warehouse management system with the platform. The developer registers in the API Developer Portal, obtains a client credentials token from Keycloak, and subscribes to the `declaration.approved` and `cargo.released` webhook events. The Webhooks Router delivers events to the developer's endpoint within 5 seconds of the event being published to Kafka.

**Services used:** Dev Portal Router (tRPC), Keycloak (client credentials flow), APISIX (API key rate limiting), Webhooks Router (tRPC), Kafka (event source), Dapr (webhook delivery), Lakehouse.

**Problem solved.** Without a developer portal, third-party integrations required custom bilateral agreements and bespoke API development. The standardised webhook model enables self-service integration.

**Value delivered.** Third-party integration time reduced from months to days. The open API ecosystem creates network effects that drive platform adoption, mirroring Singapore NTP's success model.

---

### Journey 27 — System Health Monitoring and Cost Management

**Stakeholder:** Admin

**Narrative.** The admin monitors platform health via the Admin Dashboard, which displays live gRPC health check results for all seven microservices, Temporal workflow queue depths, Kafka consumer lag, and Kubecost FinOps metrics. When the risk engine's response time exceeds the 500ms SLA, the admin receives an alert via the notification system and scales the risk engine deployment.

**Services used:** System Health Router (tRPC + gRPC health checks), Temporal (workflow metrics), Kafka (consumer lag metrics), Cost Router (Kubecost integration), Permify (`system:view_metrics`), Lakehouse (metrics time series).

**Problem solved.** Platform health monitoring was reactive — issues were discovered when traders complained. Proactive monitoring with SLA alerting enables issues to be resolved before they impact traders.

**Value delivered.** Mean time to resolve (MTTR) platform incidents reduced. Kubecost integration enables cost attribution per service, supporting evidence-based infrastructure investment decisions.

---

## Domain 8 — Cross-Border and Interoperability (Journeys 28–30)

### Journey 28 — ASEAN Single Window Connectivity

**Stakeholder:** Trader → Customs Officer (Ghana) → Customs Officer (partner country)

**Narrative.** Ghana joins the ASEAN Single Window network as an observer. A Ghanaian trader exporting to Singapore submits a declaration that triggers an electronic Certificate of Origin (eCO) request to the Ghana Export Promotion Authority. The platform sends the eCO to Singapore Customs via the ASEAN SW message broker using the WCO Data Model v3.10 XML schema. Singapore Customs validates the eCO and confirms receipt. The trader receives a notification that the eCO has been accepted.

**Services used:** ASEAN SW Router (tRPC), Temporal (`ASEANSingleWindowWorkflow`), WCO Data Model transformer (EDI Translation Engine), Dapr (cross-border event routing), Kafka, Lakehouse.

**Problem solved.** Manual Certificate of Origin processing required physical documents to be couriered to destination customs authorities, taking days. Electronic exchange via the ASEAN SW reduces this to minutes.

**Value delivered.** eCO processing time reduced from 3–5 days to < 30 minutes. Ghana's participation in the ASEAN SW network opens preferential tariff access for Ghanaian exporters.

---

### Journey 29 — G2G Digital Document Exchange

**Stakeholder:** Customs Officer (Ghana) → Customs Officer (partner country)

**Narrative.** Ghana and Côte d'Ivoire establish a bilateral digital trade corridor. The platform's CEN Router enables Ghana Customs to send and receive electronic advance cargo information (ACI) for shipments crossing the Elubo-Noé border. The Temporal workflow validates incoming ACI messages against the WCO Data Model schema and pre-populates declaration fields for Ghanaian importers, reducing data entry errors.

**Services used:** CEN Router (tRPC), Temporal (ACI validation workflow), WCO Data Model transformer, Dapr, Kafka, Lakehouse.

**Problem solved.** Border crossing between Ghana and Côte d'Ivoire required duplicate data entry at both sides. G2G ACI exchange eliminates duplication and enables pre-arrival risk assessment.

**Value delivered.** Border crossing time at Elubo-Noé reduced. Pre-arrival risk assessment enables green-lane assignments before the truck arrives at the border, eliminating queuing.

---

### Journey 30 — Free Zone Operations

**Stakeholder:** Free Zone Operator → Customs Officer → Trader

**Narrative.** A company operating in the Ghana Free Zones Authority (GFZA) imports raw materials duty-free for manufacturing. The Free Zone Router manages the company's duty suspension account in TigerBeetle. When finished goods are sold into the domestic market (domestic sales are subject to duty), the platform automatically calculates the duty liability based on the value-added in the free zone and issues a duty invoice. The Temporal `FreeZoneWorkflow` tracks the company's annual domestic sales quota and alerts the admin when the quota is approached.

**Services used:** Free Zone Router (tRPC), TigerBeetle (duty suspension account + domestic sales levy), Temporal (`FreeZoneWorkflow`), Permify, Dapr, Kafka, Lakehouse.

**Problem solved.** Free zone duty suspension accounts were managed manually on spreadsheets, creating opportunities for under-reporting of domestic sales. TigerBeetle's immutable ledger provides a real-time, auditable account of every transaction.

**Value delivered.** Free zone duty leakage eliminated. Domestic sales quota monitoring is automated, enabling the GFZA to enforce compliance without manual audits.

---

## Summary Matrix

The table below provides a consolidated view of all 30 journeys, their primary stakeholders, the middleware services they exercise, and the headline value delivered.

| # | Journey | Primary Stakeholders | Key Middleware | Headline Value |
|---|---|---|---|---|
| 1 | Standard Import (Green Lane) | Trader | Temporal, Risk Engine, TigerBeetle, Fluvio | 4.2 days → < 4 hours |
| 2 | Yellow-Lane Documentary Review | Trader, Customs Officer | Temporal, Dapr, Redis | SLA compliance > 95% |
| 3 | Red-Lane Physical Inspection | Trader, Customs Officer, Inspector | Temporal, Vision Service, Fluvio | Inspection fraud eliminated |
| 4 | AEO Certification | Trader, Admin | Keycloak, KYC Service, Temporal, TigerBeetle | 40% risk score discount |
| 5 | Duty Drawback | Trader, Finance Officer | Temporal, TigerBeetle, Mojaloop | 12–18 months → 5–10 days |
| 6 | Standard Export | Trader, Customs Officer | OGA Hub, Dapr, Temporal | 3–5 days → < 8 hours |
| 7 | Transit (COMESA) | Trader, Multi-country Customs | Temporal, CEN Router, TigerBeetle | 30-day bond → 48 hours |
| 8 | Post-Clearance Audit | Auditor, Trader | Temporal, Knowledge Graph, TigerBeetle | 3–5x revenue recovery |
| 9 | FDA Import Permit | Trader, OGA Officer | OGA Hub, Temporal SLA, Dapr | 3–7 days → < 48 hours |
| 10 | EPA Permit | Trader, OGA Officer | OGA Hub, Vision Service | Review time -60% |
| 11 | COCOBOD Export Permit | Trader, OGA Officer | OGA Hub (external API) | 5 days → 4 hours |
| 12 | Minerals Commission Permit | Trader, OGA Officer | OGA Hub, TigerBeetle | Royalty leakage eliminated |
| 13 | VSD Import Permit | Trader, OGA Officer | OGA Hub, Vision Service | Disease risk reduced |
| 14 | Multi-Agency Joint Inspection | Trader, Multiple OGAs | Dapr, Temporal WaitForAll | Clearance time -60–70% |
| 15 | Container Gate-In / Berth | Port Operator | Fluvio, fluvio-consumer, Redis | Sub-second AIS updates |
| 16 | Cargo Release | Port Operator, Trader | Fluvio, Dapr, Kafka | Permit → gate-out < 1 hour |
| 17 | Bonded Warehouse | Trader, Customs Officer | Temporal, TigerBeetle | Revenue leakage eliminated |
| 18 | Duty Payment (Mobile Money) | Trader | TigerBeetle, Mojaloop | 1–2 days → < 5 minutes |
| 19 | Revenue Reconciliation | Finance Officer | TigerBeetle, Lakehouse | 2–3 days → < 30 minutes |
| 20 | Finance Analytics | Finance Officer, Admin | Lakehouse (Spark), TigerBeetle | 2 weeks → < 1 hour |
| 21 | Sanctions Screening | Compliance Officer | Sanctions Service, Temporal | 100% coverage (vs. < 20%) |
| 22 | WCO CEN Alert Management | Compliance Officer | CEN Router, Knowledge Graph | Alert response: days → minutes |
| 23 | Threat Intelligence / SIEM | Compliance Officer | Wazuh, OpenCTI, Keycloak | MTTD: weeks → hours |
| 24 | Trader Onboarding / KYB | Trader, Admin | KYC Service, Keycloak, Temporal | 2–4 weeks → 2–3 days |
| 25 | User Role Management | Admin | Keycloak, Permify, APISIX | Provisioning: days → minutes |
| 26 | API Developer Portal | Third-party developer | Dev Portal, Keycloak, Webhooks | Integration: months → days |
| 27 | System Health / FinOps | Admin | gRPC health, Kubecost, Lakehouse | Proactive incident resolution |
| 28 | ASEAN Single Window | Trader, Multi-country Customs | Temporal, WCO EDI, Dapr | eCO: 3–5 days → < 30 min |
| 29 | G2G Digital Document Exchange | Multi-country Customs | CEN Router, Temporal, WCO EDI | Duplicate entry eliminated |
| 30 | Free Zone Operations | Free Zone Operator, Customs | Free Zone Router, TigerBeetle, Temporal | Domestic sales leakage eliminated |

---

## Middleware Coverage Analysis

The table below shows which middleware services are exercised by each journey domain, providing a quick reference for infrastructure sizing and resilience planning.

| Middleware | Import | Export | OGA | Port | Finance | Compliance | Admin | Cross-Border |
|---|---|---|---|---|---|---|---|---|
| APISIX | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Keycloak | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Permify | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Kafka | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Fluvio | ✓ | — | — | ✓ | — | — | — | — |
| Dapr | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Temporal | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Redis | ✓ | — | ✓ | ✓ | — | — | — | — |
| TigerBeetle | ✓ | ✓ | ✓ | ✓ | ✓ | — | — | ✓ |
| Lakehouse | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |

**Key observation:** Kafka, Dapr, APISIX, Keycloak, Permify, and the Lakehouse are universal — every journey depends on them. Fluvio is concentrated in real-time port and cargo journeys. TigerBeetle is present wherever money moves. Temporal is the backbone of every multi-step, multi-day business process.

---

*Document generated by Manus AI for TradeGateway™ NGSWTP. All journey timelines are targets based on Singapore NTP, Ghana ICUMS, and Rwanda ReSW benchmarks. Actual performance will depend on infrastructure sizing, network connectivity, and stakeholder adoption rates.*
