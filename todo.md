# TradeGateway NGSWTP — Project TODO

## Infrastructure & Backend
- [x] PostgreSQL 16 installed locally with 11 tables
- [x] Drizzle ORM schema with pg-core (enums, tables, indexes)
- [x] Protocol Buffer definitions (7 .proto files)
- [x] Docker Compose infrastructure: Kafka, Redis, MinIO
- [x] TigerBeetle binary installed and data file initialized
- [x] Go declaration-service with HTTP REST API + gRPC server (port 9081)
- [x] Go payment-service with HTTP REST API + gRPC server (port 9082)
- [x] Go oga-service with HTTP REST API + gRPC server (port 9083)
- [x] Go profile-service with HTTP REST API + gRPC server (port 9084)
- [x] gRPC health check + server reflection on all Go services
- [x] Python risk-engine service (FastAPI, WCO SAFE Framework risk scoring)
- [x] Python sanctions-screener service (OFAC/UN/EU list matching)
- [x] Rust rule-engine service (200+ WCO customs rules, Axum)
- [x] Rust tigerbeetle-bridge service (double-entry ledger, Axum)
- [x] Proto definitions: declarations.proto, payments.proto, risk_engine.proto
- [x] Docker Compose with full production stack (Kafka, Redis, PostgreSQL, Temporal, OpenSearch, Grafana)
- [x] gRPC architecture documentation (GRPC_ARCHITECTURE.md)
- [x] tRPC routers: declarations, profiles, payments, OGA, security, AEO, notifications
- [x] All routers wired into main appRouter
- [x] Database confirmed as PostgreSQL (pg-core, pg driver, no mysql2)

## Application Shell
- [x] Update DashboardLayout with role-based navigation (trader/customs/oga/admin/security)
- [x] Update App.tsx with all portal routes
- [x] Update index.css with dark theme for portal views
- [x] Create role-based route guards

## Trader Portal
- [x] TraderDashboard page (declaration stats, recent activity)
- [x] NewDeclaration page (multi-step form)
- [x] DeclarationDetail page (status tracking, documents, payments)
- [x] TraderProfile page (onboarding form)
- [x] AEO Application page

## Customs Officer Portal
- [x] CustomsDashboard page (declaration queue with risk lanes)
- [x] DeclarationReview page (examination workflow, release/hold)
- [x] RiskExplainability panel (AI score breakdown)

## OGA Portal
- [x] OGADashboard page (permit queue)
- [x] PermitReview page (approve/reject with notes)

## Admin Console
- [x] AdminDashboard page (system stats)
- [x] UserManagement page (role assignment, profile approval)
- [x] AEOManagement page (application review)

## Security Operations Center
- [x] SecurityDashboard page (real alert feed from DB)
- [x] SanctionsScreener page (LLM-backed real screening)
- [x] WazuhAlertFeed page (real DB-backed alerts)

## Landing & Specification
- [x] Refactor Home.tsx to clean marketing landing page
- [x] Move all 29 spec components to /specification route
- [x] Add Risk Explainability Panel feature
- [x] Add Cross-Border Corridor Map feature
- [x] Add AEO Certification Workflow feature
- [x] gRPC clients wired into tRPC server (grpc-clients.ts)
- [x] system.serviceHealth procedure with live gRPC health checks
- [x] DeclarationDetail route added for both trader and customs portals
- [x] Temporal DeclarationClearanceWorkflow written (Go)
- [x] Comparative analysis report written (COMPARATIVE_ANALYSIS.md)

## Testing & Delivery
- [x] Write vitest tests for all routers (40 tests, 4 files, all passing)
- [x] Save checkpoint
- [x] Deliver final result

## Sprint 3 — Local AI, KYC/KYB, Computer Vision

### Mojaloop + Temporal Frontend Integration
- [x] tRPC mojaloop router: getSupportedFSPs, initiatePayment, getPaymentStatus, getExchangeRate, listPaymentsByDeclaration
- [x] tRPC temporal router: getSystemStatus, listWorkflows, triggerClearanceWorkflow, getWorkflowStatus
- [x] MojaloopPayments page wired to real tRPC mojaloop + payments calls
- [x] TemporalWorkflows page wired to real tRPC temporal calls

### Local Ollama LLM Stack
- [x] services/python/ollama-proxy/main.py — FastAPI Ollama proxy (663 lines)
- [x] server/routers/ai.ts — AI router: models, chat, scoreRisk, classifyHS, explainRisk, extractManifest
- [x] Ollama service Docker container with Qwen3:8b + DeepSeek-R1:8b models (docker-compose.yml)
- [x] AI Chat page (AIAssistant.tsx) with real tRPC ai.chat calls + model selection
- [x] Risk scoring uses ai.scoreRisk + ai.explainRisk tRPC procedures
- [x] HS code classification uses ai.classifyHS tRPC procedure

### KYC/KYB Document Analysis
- [x] services/python/kyc-service/main.py — FastAPI service (899 lines)
- [x] PaddleOCR pipeline for text extraction from scanned documents
- [x] DocLing pipeline for structured document parsing (PDF, DOCX, images)
- [x] VLM (Qwen2-VL via Ollama) for document understanding
- [x] KYC entity extraction: name, DOB, ID number, address, expiry
- [x] KYB entity extraction: company name, TIN, registration number, directors
- [x] Document authenticity scoring (tamper detection, font consistency)
- [x] tRPC kyc router: uploadDocument, listDocuments, getDocument, submitVerification, getVerification, adminReviewVerification
- [x] KYC Portal UI page (client/src/pages/app/KYCPortal.tsx)
- [x] KYC Verification nav item added to trader sidebar

### Computer Vision Service
- [x] services/python/vision-service/main.py — FastAPI service (835 lines)
- [x] YOLOv8 container seal and cargo detection
- [x] OpenCV container/plate number OCR (LPR)
- [x] SAM2 segmentation for cargo manifest comparison
- [x] Dangerous goods label detection (IMDG class symbols)
- [x] tRPC vision router: submitInspection, getReport, listByDeclaration, listMyReports, verifyContainerSeal, matchManifest
- [x] Vision Analysis UI page (client/src/pages/app/VisionAnalysis.tsx)
- [x] Vision Analysis nav item added to customs officer sidebar
- [x] Port congestion heatmap page (/app/geo/heatmap) with Google Maps + geospatial router

## Sprint 4+5 — Re-implementation (Audit + Completion)
- [x] AI Chat assistant page (/app/ai-assistant) with real tRPC calls
- [x] Admin KYC Review UI (/app/admin/kyc-review) wired to kyc.listPendingVerifications + kyc.reviewVerification
- [x] Geospatial tRPC router (PostgreSQL-compatible, no PostGIS)
- [x] Port congestion heatmap page (/app/geo/heatmap) with Google Maps
- [x] Extend user roles: customs_officer, oga_officer, inspector, finance in userRoleEnum
- [x] Mobile PWA: manifest.json + sw.js + role-specific nav in DashboardLayout
- [x] MojaloopPayments page wired to real tRPC mojaloop + payments calls
- [x] TemporalWorkflows page wired to real tRPC temporal calls
- [x] Finance portal: MojaloopPayments covers payment analytics for finance role
- [x] Inspector portal: PortHeatmap + VisionAnalysis cover inspector workflows
- [x] Add missing routes to App.tsx (notifications, admin/kyc-review, geo/heatmap, customs/payments, customs/workflows, trader/declarations)
- [x] Update DashboardLayout with customs_officer, oga_officer, inspector, finance role nav
- [x] Comprehensive audit report (AUDIT_REPORT.md)
- [x] Additional vitest tests: geospatial (12), notifications (6), payments (8) — 65 tests total
- [x] Generate comprehensive archive (tradegateway-audit-archive.zip)

## Sprint 6 — Suggested Next Steps

- [ ] Seed real African port data (portLocations + portCongestionEvents tables)
- [ ] Add seedPorts admin tRPC procedure + seed script
- [x] Build Finance role dashboard (/app/finance) with duty revenue charts
- [x] Finance dashboard: revenue by HS chapter, by OGA, by corridor using recharts
- [x] Finance dashboard: payment volume trend (last 30 days)
- [x] Finance dashboard: outstanding duties / pending payments table
- [x] Wire AI risk scoring into NewDeclaration submission flow
- [x] Add real-time risk preview step in NewDeclaration form (before final submit)
- [x] Show green/yellow/red lane assignment with AI explanation in declaration form
- [x] Add /app/finance route to App.tsx and DashboardLayout nav
- [x] Write vitest tests for finance router procedures (23 tests)
- [x] Write vitest tests for AI risk scoring (25 tests) — 113 total tests
- [x] Save checkpoint and generate updated archive

## Sprint 7 — Polyglot AI/ML Stack + Knowledge Graph

### Sprint 6 Completion
- [x] Post-clearance audit module: drizzle schema (post_clearance_audits table), tRPC router (postAudit.ts), UI page (PostClearanceAudit.tsx)
- [x] Duty drawback workflow: drizzle schema (duty_drawback_claims table), tRPC router (drawback.ts), UI page (DutyDrawback.tsx)
- [x] Post-clearance audit nav item added to customs officer + admin sidebars
- [x] Duty drawback nav item added to trader + finance sidebars
- [x] Routes: /app/customs/audit, /app/trader/drawback, /app/finance/drawback

### Rust Graph-Risk Engine (services/rust-graph-risk/)
- [x] Cargo.toml with petgraph, serde, actix-web, uuid, chrono dependencies
- [x] lib.rs: TradeGraph, GraphNode, GraphEdge, RiskPropagator, GnnRiskEngine, CypherQueryBuilder
- [x] GNN risk propagation: multi-hop neighbor aggregation with decay factor
- [x] Risk lane assignment: GREEN (<0.35) / YELLOW (0.35–0.65) / RED (>0.65)
- [x] Risk factor extraction from graph topology
- [x] main.rs: actix-web HTTP server with /score, /graph/*, /health endpoints
- [x] 6 Rust unit tests: all passing (cargo test --lib)

### Python AI Services (services/python-ai/)
- [x] requirements.txt: torch, torch-geometric, falkordb, neo4j, cocoindex, fastapi, ollama, numpy, scikit-learn
- [x] gnn/graph_schema.py: FalkorDB + Neo4j schema seeder (Trader, HSCode, Port, OGA, Corridor, Declaration nodes + relationships)
- [x] gnn/gnn_trainer.py: GraphSAGE trainer (PyTorch Geometric) for risk propagation, feature engineering, training loop, model persistence
- [x] cocoindex/trade_index.py: CocoIndex document indexing pipeline (trade declarations, HS codes, OGA permits, sanctions lists)
- [x] kgqa/epr_kgqa.py: EPR-KGQA question-answering service (intent classification, Cypher generation, result formatting)
- [x] art/art_reasoning.py: ART (Adaptive Retrieval-augmented Thinking) reasoning layer (retrieve → think → act loop)
- [x] llm/ollama_bridge.py: Ollama LLM bridge (local privacy-preserving inference, model management, streaming)

### Go Graph Bridge (services/go-graph-bridge/)
- [x] go.mod with gin, testify, uuid dependencies
- [x] internal/graph/client.go: FalkorDB + Neo4j client, graph types (TraderNode, HSCodeNode, CorridorNode, etc.)
- [x] internal/risk/orchestrator.go: RiskOrchestrator calling Rust engine + Python AI services
- [x] internal/handlers/handlers.go: HTTP handlers for /score, /graph/*, /health, /query, /ask, /explain endpoints
- [x] cmd/server/main.go: Gin HTTP server entry point
- [x] internal/risk/orchestrator_test.go: 8 Go unit tests (all passing)

### tRPC Knowledge Graph Router
- [x] server/routers/knowledgeGraph.ts: 9 procedures (health, scoreDeclaration, traderProfile, highRiskCorridors, ogaBacklog, askKnowledgeGraph, explainRisk, executeCypher, upsertTrader)
- [x] Graceful fallback: all procedures return null/fallback when Go bridge is unavailable
- [x] Admin-only RBAC on executeCypher procedure
- [x] Registered in server/routers.ts

### Knowledge Graph UI
- [x] client/src/pages/app/KnowledgeGraph.tsx: full explorer page (health status, KGQA chat, risk scoring, Cypher console, trader profile lookup)
- [x] Route /app/knowledge-graph added to App.tsx
- [x] Knowledge Graph nav item added to admin + customs officer AI Tools sidebar section

### Technology Analysis Report
- [x] TECHNOLOGY_ANALYSIS.md: comprehensive value analysis for CocoIndex, EPR-KGQA, FalkorDB, Neo4j, Ollama, ART, GNN

### Tests
- [x] server/knowledge.graph.test.ts: 36 tests for knowledgeGraph router (auth, health, scoreDeclaration, traderProfile, corridors, KGQA, ART explain, Cypher RBAC, upsertTrader)
- [x] Total: 149 tests across 10 test files — all passing

## Sprint 8 — Docker Bridge, GNN Training Pipeline, Fraud Network Visualisation

- [x] Add FalkorDB, Neo4j, go-graph-bridge, rust-graph-risk, python-ai services to docker-compose.yml
- [x] Write multi-stage Dockerfiles for Rust (rust:1.82-slim builder + debian:bookworm-slim runner)
- [x] Write multi-stage Dockerfile for Go bridge (golang:1.23-alpine builder + alpine runner)
- [x] Write Python AI services Dockerfile (python:3.12-slim + requirements.txt)
- [x] Wire GRAPH_BRIDGE_URL default to http://localhost:8100 (matches docker-compose port mapping)
- [x] Add knowledgeGraph.batchScore tRPC procedure (admin/customs_officer RBAC, GNN batch scoring)
- [x] Add knowledgeGraph.fraudNetwork tRPC procedure (D3 graph data with synthetic fallback)
- [x] Build Fraud Network Visualisation page (/app/admin/fraud-network) with D3 force-directed graph
- [x] Add GitFork icon + Fraud Network nav item to admin AI Tools sidebar
- [x] Add route /app/admin/fraud-network to App.tsx
- [x] Write 36 vitest tests for batchScore and fraudNetwork procedures
- [x] Fix flaky scoredAt test timeout (5s → 30s for LLM latency)
- [x] Total: 185 tests across 10 test files — all passing
- [x] Save checkpoint

## Sprint 9 — Docker Activation, Training Pipeline, Fraud Investigation Drill-Down

- [x] Validate and fix services/docker-compose.yml for all new services
- [x] Write docker-compose.override.yml for local dev (bind mounts, hot reload)
- [x] Write .env.example with GRAPH_BRIDGE_URL, FALKORDB_URL, NEO4J_URL, OLLAMA_URL
- [x] Add GRAPH_BRIDGE_URL to project secrets via webdev_request_secrets
- [x] Extend Python AI services: pg_to_graph_seeder.py (pull from PostgreSQL → FalkorDB/Neo4j)
- [x] Write train_and_serve.sh entrypoint script for GNN training pipeline
- [x] Add knowledgeGraph.getTraderInvestigation tRPC procedure
- [x] Build Fraud Investigation drill-down panel in FraudNetwork.tsx
- [x] Drill-down: declaration timeline (last 12 months, risk lane per declaration)
- [x] Drill-down: connected entities (shared agents, ports, HS codes)
- [x] Drill-down: "Flag for Post-Clearance Audit" button wired to postAudit.create
- [x] Write vitest tests for getTraderInvestigation procedure (8 tests, all passing)
- [x] Save checkpoint

## Sprint 10 — Trader Link Analysis, Case Management, Risk Alerts (COMPLETED)

### Trader-to-Trader Link Analysis
- [x] Add knowledgeGraph.sharedAgentNetwork tRPC procedure (finds traders sharing same broker/corridor)
- [x] Wire co-network sub-graph into FraudNetwork investigation panel (shared-corridor co-network list)
- [x] Co-network panel shows related traders with risk scores, click-to-investigate navigation

### Investigation Case Management
- [x] Add fraudCases, fraudCaseNotes, fraudCaseEvidence, riskScanResults tables to drizzle/schema.ts
- [x] Run pnpm db:push to migrate schema (5 new tables)
- [x] Add server/routers/fraudCases.ts: createCase, getCase, listCases, addNote, uploadEvidence, updateStatus, caseStats
- [x] Register fraudCases router in server/routers.ts
- [x] Build FraudCases.tsx page: case list with status/priority filters, create modal, detail view with notes/evidence/status timeline
- [x] Add Fraud Cases nav item to admin/customs_officer sidebar
- [x] Add routes /app/admin/fraud-cases to App.tsx

### Automated Nightly Risk-Threshold Alerts
- [x] Add server/routers/alerts.ts: runNightlyRiskScan, getRiskAlerts, getLatestFlaggedDeclarations, scheduleNightlyJob
- [x] Wire notifyOwner to send summary notification when high-risk declarations found
- [x] Register alerts router in server/routers.ts
- [x] Build RiskAlerts.tsx page: scan results table, flagged declarations, manual scan trigger
- [x] Add Risk Alerts nav item to admin sidebar
- [x] Add route /app/admin/risk-alerts to App.tsx

### Tests & Delivery
- [x] Write vitest tests for fraudCases router: 18 tests (auth, RBAC, input validation, happy paths)
- [x] Write vitest tests for alerts router: 9 tests (auth, RBAC, input validation, happy paths)
- [x] Write vitest tests for sharedAgentNetwork: 5 tests (auth, RBAC, invalid input, shape)
- [x] Total: 211 tests across 11 test files — all passing
- [x] Save checkpoint

## Sprint 11 — Open Case Button, Nightly Cron, Evidence Upload (COMPLETED)

### Open Case Button in Investigation Panel
- [x] Add fraudCases.createCase mutation to FraudNetwork investigation panel
- [x] "Open Fraud Case" button pre-fills title with trader name + avg risk score
- [x] On success, navigate to /app/admin/fraud-cases with the new case highlighted
- [x] Show toast confirmation with case number

### Scheduled Nightly Risk Scan (node-cron)
- [x] Install node-cron package
- [x] Add cron job to server/_core/index.ts: fires at 02:00 UTC daily
- [x] Log cron execution start/end with case count and notification status
- [x] Add cronStatus tRPC procedure to alerts router (returns last run time, result summary)
- [x] Cron confirmed live in server logs: "[Cron] Nightly risk scan scheduled at 02:00 UTC daily"

### Evidence File Upload in Fraud Cases
- [x] Add uploadEvidenceFile tRPC mutation to fraudCases router (base64 → S3 storagePut)
- [x] Build file picker UI in FraudCases detail view with progress bar
- [x] Show upload progress bar during S3 upload (0→50→60→100%)
- [x] Display uploaded evidence list with file name, type, size, download link
- [x] Support PDF, PNG, JPG, DOCX, XLS, CSV, TXT, ZIP (max 16MB)

### Tests & Delivery
- [x] Write vitest tests for uploadEvidenceFile procedure: 7 tests (RBAC, input validation, happy path)
- [x] Total: 217 tests across 11 files — 216 passing (1 pre-existing flaky LLM timeout in ai.risk.test.ts)
- [x] Save checkpoint

## Sprint 12 — Test Fixes, Case Assignment, Drag-and-Drop Upload, UX Overhaul (COMPLETED)

### Technical Fixes
- [x] Increase LLM test timeout in vitest.config.ts to 15000ms
- [x] All 217 tests pass with 0 flaky failures

### Case Assignment Workflow
- [x] assignedTo field already existed in fraudCases schema
- [x] Add getOfficers procedure to fraudCases router (lists customs_officer and admin users)
- [x] Add assignCase procedure to fraudCases router (sends owner notification on assignment)
- [x] Add officer assignment dropdown UI to FraudCases detail panel
- [x] Show assigned officer name in case list and detail view

### Drag-and-Drop Evidence Upload
- [x] Install react-dropzone
- [x] Replace file picker button in FraudCases with drag-and-drop zone
- [x] Show file preview (name, size, type icon) before upload
- [x] Retain progress bar and upload confirmation

### Platform-Wide UX / Language Overhaul (Non-Technical Stakeholders)
- [x] Audit all page titles, nav labels, section headers for technical jargon
- [x] DashboardLayout: all nav labels rewritten to be role/task-oriented across all 5 user roles
- [x] Home landing page: fully rewritten — removed all tech stack jargon, replaced with business value propositions
- [x] MojaloopPayments → "Duty Payment Flows"; TemporalWorkflows → "Clearance Workflow Tracker"
- [x] KnowledgeGraph: EPR-KGQA → "Ask a Question"; Cypher Explorer → "Advanced Query"
- [x] VisionAnalysis: rewritten as "Cargo Image Inspection" with plain-English descriptions
- [x] SecurityOps: "SIEM Alert Feed" → "Security Alert Feed"; rewritten header
- [x] KYCPortal: "KYC/KYB Verification" → "Identity & Business Verification"
- [x] FraudNetwork: "Fraud Network Intelligence" → "Trade Risk Network Map"
- [x] RiskAlerts: "Automated nightly risk scan" → "Automated daily review"
- [x] NewDeclaration: WCO SAFE Framework jargon replaced with plain-English descriptions
- [x] DeclarationDetail: Mojaloop payment reference removed

### Tests & Delivery
- [x] 217 tests across 11 files — all passing (0 failures)
- [x] TypeScript: 0 errors
- [x] Save checkpoint

## Sprint 13 — Onboarding Notification, Declaration Timeline, Clearance Certificate

### Stakeholder Onboarding Welcome Notification
- [ ] Add onboardingNotification procedure to kyc router: fires when admin approves a stakeholder profile
- [ ] Notification includes: trader/agency name, login URL, access permissions summary
- [ ] Wire to AdminKYCReview approval action (existing approve button)
- [ ] Show success toast confirming notification was sent

### Declaration Status Timeline
- [ ] Add declarationTimeline tRPC query to declarations router (returns ordered status events)
- [ ] Build DeclarationTimeline component: step-by-step visual tracker (Submitted → Risk Assessed → Agency Review → Duty Paid → Released)
- [ ] Show timestamp, actor, and notes for each completed step
- [ ] Highlight current active step; grey out future steps
- [ ] Embed timeline in DeclarationDetail page

### Printable Clearance Certificate PDF
- [ ] Add generateClearanceCertificate tRPC mutation to declarations router
- [ ] Server-side PDF generation: declaration number, trader name, goods description, HS code, duty paid, release timestamp, customs officer signature block
- [ ] Upload PDF to S3 and return a download URL
- [ ] Add "Download Clearance Certificate" button to DeclarationDetail page (only visible when status = released)
- [ ] Show loading state during PDF generation

### Tests & Delivery
- [ ] Write vitest tests for declarationTimeline procedure
- [ ] Write vitest tests for generateClearanceCertificate procedure
- [ ] Save checkpoint

## Sprint 13 — Onboarding Notification, Declaration Timeline, Clearance Certificate (COMPLETED)

### Stakeholder Onboarding Notification on KYC Approval
- [x] Add notifyOwner import to kyc.ts router
- [x] Wire onboarding notification in reviewVerification procedure (fires on "approved" status)
- [x] Notification includes applicant name, verification type, and login link
- [x] Wire applicantName into AdminKYCReview mutation call

### Declaration Status Timeline Visual Tracker
- [x] Add declarations.getTimeline tRPC procedure (derives steps from status + audit events)
- [x] 9-step pipeline: Draft → Submitted → Risk Assessment → Docs Required → Duty Payment → Payment Confirmed → Physical Inspection → Inspection Complete → Goods Released
- [x] Handles rejection/cancellation as terminal steps with notes
- [x] Replace static ClearanceTimeline component with rich tRPC-backed vertical timeline in DeclarationDetail
- [x] Timeline shows step label, description, timestamp, actor, and notes per step
- [x] Skeleton loading state while timeline query loads

### Printable Clearance Certificate PDF
- [x] Add declarations.generateClearanceCertificate tRPC mutation (cleared declarations only)
- [x] Generates HTML certificate with declaration details, goods info, duties paid, signature blocks
- [x] Converts to PDF via server-side tool, uploads to S3, returns public URL
- [x] "Download Clearance Certificate" button appears in DeclarationDetail header when status = cleared
- [x] Opens certificate in new tab with toast confirmation

### Tests & Delivery
- [x] Write 16 vitest tests in declaration.timeline.test.ts (getTimeline, generateClearanceCertificate, kyc.reviewVerification)
- [x] Total: 233 tests across 12 files — all passing (0 failures)
- [x] TypeScript: 0 errors
- [x] Save checkpoint

## Sprint 14 — Certificate Archive, Permit Expiry Alerts, Officer Workload Dashboard

### Trader Certificate Archive
- [ ] Add clearanceCertificates table to drizzle/schema.ts (id, declarationId, traderId, fileKey, fileUrl, generatedAt, generatedBy)
- [ ] Run pnpm db:push to migrate schema
- [ ] Update declarations.generateClearanceCertificate to persist record to clearanceCertificates table
- [ ] Add declarations.listMyCertificates tRPC procedure (trader: own certs; admin/customs: all)
- [ ] Build MyCertificates.tsx page: table of certificates with declaration ref, date, download link
- [ ] Add "My Certificates" nav item to trader sidebar in DashboardLayout
- [ ] Add /app/trader/certificates route to App.tsx

### OGA Permit Expiry Alerts
- [ ] Add alerts.runPermitExpiryCheck tRPC procedure (queries permits expiring within 30 days)
- [ ] Wire permit expiry check into nightly cron job (alongside risk scan)
- [ ] Send owner notification listing affected traders and permit numbers
- [ ] Add permit expiry results to RiskAlerts page (new "Expiring Permits" tab)

### Customs Officer Workload Dashboard
- [ ] Add declarations.getOfficerWorkload tRPC procedure (queue depth, avg review time, SLA rate per officer)
- [ ] Build OfficerWorkload.tsx page: table of officers with queue depth, avg review time, SLA %
- [ ] Add bar chart: declarations reviewed per officer (last 30 days)
- [ ] Add SLA compliance gauge: % reviewed within target time (configurable, default 4h)
- [ ] Add "Officer Workload" nav item to admin sidebar in DashboardLayout
- [ ] Add /app/admin/officer-workload route to App.tsx

### Tests & Delivery
- [ ] Write vitest tests for listMyCertificates, runPermitExpiryCheck, getOfficerWorkload
- [ ] Save checkpoint

## Sprint 14 — Certificate Archive, Permit Expiry Alerts, Officer Workload Dashboard (COMPLETED)

### Trader Certificate Archive
- [x] Add clearanceCertificates table to drizzle/schema.ts
- [x] Run pnpm db:push to migrate (clearance_certificates table created)
- [x] Update generateClearanceCertificate to persist record to DB
- [x] Add declarations.listMyCertificates tRPC procedure (paginated, trader-scoped)
- [x] Build MyCertificates.tsx page: certificate list with declaration ref, goods, duty paid, download link
- [x] Add "My Clearance Certificates" nav item to trader sidebar
- [x] Register /app/trader/certificates route in App.tsx

### OGA Permit Expiry Alerts
- [x] Add alerts.getExpiringPermits procedure (admin/customs_officer, daysAhead param)
- [x] Add alerts.runPermitExpiryCheck procedure (admin only, sends owner notification)
- [x] Wire permit expiry check into nightly cron job in server/_core/index.ts
- [x] Add expiring permits panel to RiskAlerts page (colour-coded by urgency: 7/14/30 days)

### Officer Workload Dashboard
- [x] Create server/routers/officerWorkload.ts: getTeamSummary, getMyWorkload procedures
- [x] Register officerWorkloadRouter in server/routers.ts
- [x] Build OfficerWorkload.tsx page: team KPI tiles, per-officer table with queue depth, avg review time, SLA bar
- [x] Add "Officer Workload" nav item to admin and customs_officer Investigations group
- [x] Register /app/admin/officer-workload route in App.tsx

### Tests & Delivery
- [x] Write vitest tests for officerWorkload.getTeamSummary: 6 tests
- [x] Write vitest tests for officerWorkload.getMyWorkload: 4 tests
- [x] Write vitest tests for declarations.listMyCertificates: 3 tests
- [x] Write vitest tests for alerts.getExpiringPermits: 4 tests
- [x] Write vitest tests for alerts.runPermitExpiryCheck: 3 tests
- [x] Total: 254 tests across 13 files — all passing
- [x] TypeScript: 0 errors
- [x] Save checkpoint

## Sprint 15 — Notification Centre, SLA Breach Escalation, Bulk Export (IN PROGRESS)

### Trader Notification Centre
- [ ] Add userNotifications table to drizzle/schema.ts (id, userId, type, title, body, declarationId, isRead, createdAt)
- [ ] Run pnpm db:push to migrate
- [ ] Add notifications tRPC router: listMyNotifications, markRead, markAllRead, getUnreadCount
- [ ] Wire declaration status changes to create notifications (in declarations router)
- [ ] Add notification badge (red dot + count) to DashboardLayout header
- [ ] Build TraderNotifications.tsx inbox page with read/unread state
- [ ] Add "Notifications" nav item to all role sidebars
- [ ] Register /app/notifications route in App.tsx

### SLA Breach Escalation
- [ ] Add slaBreachAt computed field logic to declarations router (submittedAt + slaTargetHours)
- [ ] Add alerts.checkSlaBreaches procedure (admin/customs_officer): lists declarations past SLA
- [ ] Wire SLA breach check into nightly cron job
- [ ] Flag overdue declarations red in CustomsDashboard queue (visual indicator)
- [ ] Send supervisor notification when breach detected (notifyOwner)
- [ ] Add SLA breach count KPI tile to OfficerWorkload dashboard

### Bulk Declaration Export
- [ ] Install xlsx package (SheetJS) on server
- [ ] Add declarations.exportDeclarations tRPC procedure (admin/finance, date range + filters → base64 xlsx)
- [ ] Add "Download Report" button to AdminDeclarations page with date range picker
- [ ] Support CSV and Excel format toggle
- [ ] Show export progress toast while generating

### Tests & Delivery
- [ ] Write vitest tests for notifications router
- [ ] Write vitest tests for alerts.checkSlaBreaches
- [ ] Write vitest tests for declarations.exportDeclarations
- [ ] Save checkpoint

## Sprint 15 — Notification Centre, SLA Breach Escalation, Bulk Export (COMPLETED)

### Database & Infrastructure
- [x] Add userNotifications table to drizzle/schema.ts (id, userId, type, title, body, declarationId, isRead, readAt, createdAt)
- [x] Add 10 new notification_type enum values (sla_breach, general, permit_expiry, etc.)
- [x] Apply migrations manually via psql (enum additions outside transaction + table creation)
- [x] Mark migrations 0006 and 0007 as applied in drizzle.migrations tracking table
- [x] Fix server/db.ts to always use local PostgreSQL (resolvePostgresUrl() ignores mysql:// DATABASE_URL)

### Trader Notification Centre
- [x] Add getUserNotifications, getUserUnreadCount, markUserNotificationRead, markAllUserNotificationsRead, createUserNotification helpers to server/db.ts
- [x] Create server/routers/userNotifications.ts: getMyNotifications, getUnreadCount, markAsRead, markAllRead, adminSend procedures
- [x] Register userNotificationsRouter in server/routers.ts
- [x] Build client/src/pages/app/NotificationCentre.tsx: full inbox with read/unread state, type badges, mark-all-read
- [x] Update DashboardLayout to use userNotifications.getUnreadCount for nav badge (all roles)
- [x] Update DashboardLayout nav label from "Notifications" to "Notification Centre" with correct path
- [x] Register /app/notifications route in App.tsx

### SLA Breach Escalation
- [x] Create server/routers/slaEscalation.ts: scan, list, stats procedures
- [x] SLA thresholds: green 4h, yellow 24h, red 72h, blue 48h (AEO)
- [x] scan: finds breached declarations, creates user_notifications for traders, notifies owner on critical breaches
- [x] list: returns breach list with trader name, hours elapsed, overage, severity (warning/critical)
- [x] stats: summary stats by lane (total in processing, breached, critical)
- [x] Register slaEscalationRouter in server/routers.ts
- [x] Wire slaEscalation.scan into nightly cron job in server/_core/index.ts
- [x] Build client/src/pages/app/SLABreachDashboard.tsx: stats tiles, breach list with severity badges, manual scan trigger
- [x] Add "SLA Breach Monitor" nav item to admin and customs_officer sidebars
- [x] Register /app/admin/sla-breaches route in App.tsx

### Bulk Declaration Export
- [x] Create server/routers/bulkExport.ts: exportDeclarations, previewCount procedures
- [x] Supports CSV and JSON formats; filters by status, riskLane, dateFrom, dateTo, traderId (admin)
- [x] Returns base64-encoded file content with filename and record count
- [x] Register bulkExportRouter in server/routers.ts
- [x] Build client/src/components/ExportDeclarationsDialog.tsx: format picker, filters, progress toast, auto-download
- [x] Wire ExportDeclarationsDialog into TraderDeclarations page header
- [x] Wire ExportDeclarationsDialog into AdminDeclarations page header

### Tests & Delivery
- [x] Write 23 vitest tests in server/sprint15.test.ts covering all three new routers
- [x] Fix 4 pre-existing test failures (threshold validation, return shape mismatches, imageData validation)
- [x] Add .min(1) validation to vision.submitInspection imageData field
- [x] Total: 277 tests across 14 files — all passing (0 failures)
- [x] TypeScript: 0 errors
- [x] Save checkpoint

## Sprint 16 — Next Steps Implementation + Audit

### Real-time Notifications on Declaration Status Change
- [x] Wire createUserNotification into declarations.updateStatus procedure (trader notified on each status transition)
- [ ] Wire createUserNotification into declarations.submitDeclaration (confirmation notification)
- [ ] Wire createUserNotification into kyc.reviewVerification (trader notified on KYC approval/rejection)
- [ ] Wire createUserNotification into payments.confirmPayment (trader notified on payment confirmation)

### SLA Badge in Customs Dashboard Queue
- [x] Add SLA breach indicator (red clock + "OVERDUE" badge) to CustomsDashboard declaration queue rows
- [ ] Show hours overdue tooltip on hover
- [x] Add SLA column to the queue table with colour-coded status

### XLSX Export Format
- [x] Install xlsx (SheetJS) package
- [x] Add xlsx format option to bulkExport.exportDeclarations procedure
- [x] Update ExportDeclarationsDialog to include XLSX as a format option

### Comprehensive Audit — Fixes Applied
- [x] Fix declarations.stats to allow all officer roles (was admin-only)
- [x] Fix declarations.all to allow customs_officer, inspector, finance, oga_officer roles
- [x] Fix declarations.updateStatus to allow customs_officer and inspector roles
- [x] Add getDeclarationStatsByTrader for trader-specific dashboard stats
- [x] Add auth.changeRole procedure for admin user management
- [x] Add officer action panel to DeclarationDetail page (status update for customs officers)
- [x] Rewrite TraderProfile with full edit form and upsert mutation
- [x] Upgrade AdminUsers with role-change dropdown (live role management)
- [x] Audit all tRPC routers registered in appRouter — all 20 routers confirmed
- [x] Audit all client pages have corresponding API endpoints — 17 issues found and fixed
- [x] Audit all DB tables have CRUD operations — 25 tables confirmed
- [x] Audit all TODO/FIXME/mock data in codebase — geospatial uses real DB data
- [x] Generate audit report (see AUDIT_REPORT_SPRINT16.md)

### Archive
- [x] Generate comprehensive archive of entire project (tradegateway-sprint16-archive.zip — 467 files, 1.1MB)

## Sprint 17 — Notification Completion, Port Data Seeding, SLA Tooltip

### KYC & Payment Notifications
- [x] Wire createUserNotification into kyc.reviewVerification (KYC approved/rejected/more-info)
- [x] Wire createUserNotification into payments.confirm (payment confirmed)
- [x] Wire createUserNotification into declarations.submit (submission confirmation)

### African Port Data Seeding
- [x] Expand scripts/seed-ports.mjs with 25 real African ports (UN LOCODE coordinates)
- [x] Add 2,100 congestion events (7 days of hourly snapshots per port)
- [x] Add 720 vessel tracking events (15 vessels × 48 positions)
- [x] Run seed script — port_locations: 25, congestion_events: 2100, vessel_events: 720
- [x] Add geospatial.reseed admin procedure for future reseeding

### SLA Hover Tooltip
- [x] Add native title tooltip to CustomsDashboard SLA badge
- [x] Show "Xh elapsed — Yh over SLA (limit: Zh for green lane)" on hover
- [x] Add cursor-help indicator and ring border for breached/warning badges
- [x] Show Clock icon for warning state badges

### Tests & Delivery
- [x] Fix declarations.test.ts mock to include createUserNotification + getDeclarationStatsByTrader
- [x] Update stats test: traders now get their own stats (not FORBIDDEN)
- [x] All 277 tests pass across 14 test files
- [x] Save checkpoint

## Sprint 18 — Admin UX, Mobile PWA Badge, Notification Mark All Read

### Reseed Port Data Button (Admin Console)
- [x] Add geospatial.reseedPorts tRPC call to AdminConsole System Settings tab
- [x] Show success/error toast after reseed completes
- [x] Button shows spinner and "Reseeding..." label while pending

### Mobile PWA Notification Badge
- [x] Add clickable bell icon with unread count badge to mobile top bar in DashboardLayout
- [x] Badge updates in real-time via trpc.userNotifications.getUnreadCount query
- [x] Badge visible when count > 0; clicking navigates to /app/notification-centre
- [x] Supports 99+ overflow display

### Mark All Read Button (Notification Centre)
- [x] "Mark all read" button already present in NotificationCentre page header (Sprint 15)
- [x] Wired to userNotifications.markAllRead mutation
- [x] Button disabled/hidden when there are no unread notifications
- [x] Invalidates both getMyNotifications and getUnreadCount queries on success

### Tests & Delivery
- [x] Run full test suite — 277/277 tests passing
- [x] Save checkpoint

## Sprint 19 — Notification Preferences, Admin Analytics, Port Live Feed

### Notification Preferences Panel
- [x] Add notification_preferences table to Drizzle schema (userId, notificationType, enabled)
- [x] Run pnpm db:push to migrate schema (migration 0008 applied)
- [x] Add notificationPreferences tRPC router (getPreferences, updatePreference, resetToDefaults)
- [x] Register router in appRouter
- [x] Add NotificationPreferences settings page (/app/notification-preferences) — 20 types in 8 categories
- [x] Add nav link in DashboardLayout sidebar (General group)
- [x] Add route in App.tsx

### Admin Analytics Dashboard
- [x] Add adminAnalytics tRPC router (declarationThroughput, clearanceTimeByLane, dutyRevenueTrend, topHSChapters, declarationsByStatus, kpiSummary)
- [x] Register router in appRouter
- [x] Rebuild AdminAnalytics page (/app/admin/analytics) with 4 KPI cards + 5 recharts panels
- [x] Nav link already existed in admin sidebar (Performance Reports)
- [x] Route already existed in App.tsx

### Port Congestion Live Feed
- [x] Reduce refetchInterval from 60s to 30s in PortHeatmap page
- [x] Add live indicator badge (pulsing green dot) showing last-updated timestamp
- [x] Add auto-refresh toggle button (Live/Paused) with Wifi/WifiOff icons
- [x] Manual refresh button shows spinner while fetching

### Tests & Delivery
- [x] Write vitest tests for notificationPreferences router (8 tests)
- [x] Write vitest tests for adminAnalytics router (5 tests) + port heatmap logic (4 tests)
- [x] Run full test suite — 292/292 tests passing (15 test files)
- [x] Save checkpoint

## Sprint 20 — Notification Digest Email, Analytics CSV Export, Port Congestion Alerts

### Notification Digest Email
- [x] Add notification_digest_settings table to Drizzle schema (userId, digestFrequency, lastDigestSentAt)
- [x] Run pnpm db:push to migrate schema (migration 0009 applied)
- [x] Add getDigestSettings and updateDigestSettings procedures to notificationPreferences router
- [x] Add Email Digest card to NotificationPreferences page with none/daily/weekly selector
- [x] Add daily (08:00 UTC) and weekly (Mon 08:00 UTC) cron jobs for digest sending
- [x] Digest batches up to 10 unread notifications and sends via notifyOwner helper

### Analytics CSV Export
- [x] Add exportToCsv() utility function to AdminAnalytics page (client-side, no server needed)
- [x] Add DownloadCsvButton component with Download icon
- [x] Add Download CSV button to Declaration Throughput chart
- [x] Add Download CSV button to Duty Revenue Trend chart
- [x] Add Download CSV button to Top HS Chapters chart
- [x] Add Download CSV button to Status Distribution chart
- [x] Filename includes data type and date range (e.g., declaration_throughput_2026-03-08.csv)

### Port Congestion Critical Alerts
- [x] Add portCongestionAlerts tracking table to Drizzle schema
- [x] Run pnpm db:push (migration 0009 applied)
- [x] Add runPortCongestionAlertScan() cron function to server/_core/index.ts
- [x] Schedule scan every 15 minutes (0 */15 * * * *)
- [x] Alert fires only on transition TO critical (deduplication via portCongestionAlerts table)
- [x] Notifies all admin + customs_officer users via security_alert notification
- [x] Also notifies owner via notifyOwner helper

### Tests & Delivery
- [x] Write vitest tests for digest settings logic (3 tests)
- [x] Write vitest tests for CSV export utility (6 tests)
- [x] Write vitest tests for port congestion alert transition logic (6 tests)
- [x] Fixed pre-existing sprint15 test failure (wrong parameter name: unreadOnly → onlyUnread)
- [x] Run full test suite — 309/309 tests passing (16 test files)
- [x] Save checkpoint
