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
- [ ] MojaloopDemo component upgraded from simulation to real tRPC calls
- [ ] TemporalWorkflow component upgraded from simulation to real tRPC calls

### Local Ollama LLM Stack
- [x] services/python/ollama-proxy/main.py — FastAPI Ollama proxy (663 lines)
- [x] server/routers/ai.ts — AI router: models, chat, scoreRisk, classifyHS, explainRisk, extractManifest
- [ ] Ollama service Docker container with Qwen3:8b + DeepSeek-R1:8b models
- [ ] AI Chat page upgraded to support local Ollama model selection
- [ ] Risk scoring updated to use local DeepSeek-R1 for reasoning
- [ ] HS code classification updated to use local Qwen3 for structured output

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
- [ ] Port congestion heatmap generation (future sprint)
