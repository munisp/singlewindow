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
- [ ] Write vitest tests for all routers
- [ ] Save checkpoint
- [ ] Deliver final result
