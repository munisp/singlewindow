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
