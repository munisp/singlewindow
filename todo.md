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
- [ ] Update DashboardLayout with role-based navigation (trader/customs/oga/admin/security)
- [ ] Update App.tsx with all portal routes
- [ ] Update index.css with dark theme for portal views
- [ ] Create role-based route guards

## Trader Portal
- [ ] TraderDashboard page (declaration stats, recent activity)
- [ ] NewDeclaration page (multi-step form)
- [ ] DeclarationDetail page (status tracking, documents, payments)
- [ ] TraderProfile page (onboarding form)
- [ ] AEO Application page

## Customs Officer Portal
- [ ] CustomsDashboard page (declaration queue with risk lanes)
- [ ] DeclarationReview page (examination workflow, release/hold)
- [ ] RiskExplainability panel (AI score breakdown)

## OGA Portal
- [ ] OGADashboard page (permit queue)
- [ ] PermitReview page (approve/reject with notes)

## Admin Console
- [ ] AdminDashboard page (system stats)
- [ ] UserManagement page (role assignment, profile approval)
- [ ] AEOManagement page (application review)

## Security Operations Center
- [ ] SecurityDashboard page (real alert feed from DB)
- [ ] SanctionsScreener page (LLM-backed real screening)
- [ ] WazuhAlertFeed page (real DB-backed alerts)

## Landing & Specification
- [ ] Refactor Home.tsx to clean marketing landing page
- [ ] Move all 29 spec components to /specification route
- [ ] Add Risk Explainability Panel feature
- [ ] Add Cross-Border Corridor Map feature
- [ ] Add AEO Certification Workflow feature

## Testing & Delivery
- [ ] Write vitest tests for all routers
- [ ] Save checkpoint
- [ ] Deliver final result
