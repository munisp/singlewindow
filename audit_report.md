# TradeGateway NGSWTP System Audit Report

## 1. Missing Integrations & Mocks

During the initial code review, several critical components were identified as containing mock implementations or missing full end-to-end integration:

### 1.1 Temporal Workflow Engine
- **Issue**: The tRPC router (`server/routers/temporal.ts`) heavily relies on `generateMockWorkflow` and simulation modes instead of communicating with the actual Temporal SDK or API for starting and signaling workflows.
- **Impact**: Multi-agency workflows (like `DeclarationClearanceWorkflow`) are not executing through the Temporal cluster in development mode, preventing true stateful orchestration.

### 1.2 Python AI Services
- **Issue**: The following microservices in `microservices/` are missing their main entry points (`main.py`) and only contain shared middleware and requirements:
  - `gnn-risk`
  - `anomaly-detection`
  - `hs-classifier`
  - `risk-ai`
  - `vision-service`
- **Note**: While there are corresponding implementations in `services/python/`, the `microservices/` directory structure appears incomplete. Furthermore, the `server/routers/vision.ts` and `server/routers/kyc.ts` routers contain explicit fallback functions (e.g., `mockVisionAnalysis`, `mockDocumentAnalysis`) that are triggered when the services are unreachable.

### 1.3 OGA Permit Audit Trail
- **Issue**: The `server/routers/ogaPermitAudit.ts` router uses `mockPermitEvents` when `NODE_ENV !== "production"`.

### 1.4 OpenAppSec (WAF)
- **Issue**: The `server/routers/openAppSec.ts` router uses `makeDevEvent` to generate mock WAF events when not in production mode.

### 1.5 Lakehouse Rollups
- **Issue**: The `server/routers/lakehouse.ts` router uses `makeDevJob` to generate mock Delta Lake batch jobs in non-production environments.

### 1.6 APISIX Audit
- **Issue**: The `server/routers/apisixAudit.ts` router contains dev-mode fallbacks for route audit logs.

## 2. Missing Schemas & Database Gaps

The Drizzle schema (`drizzle/schema.ts`) was compared against the tables referenced in the tRPC routers. The following tables/types are imported by routers but are missing from the schema definition:

- `NotificationPreference` (Type reference mismatch)
- `originCertStatusEnum`
- `originCertTypeEnum`
- `originCriteriaMet`
- `typeOriginCertificate` (Type reference)

These missing enums and types are referenced in `server/routers/rulesOfOrigin.ts` and need to be properly defined in `drizzle/schema.ts`.

## 3. Router Registration Gaps

The `server/routers.ts` file registers the application's tRPC routers. However, several router files exist in `server/routers/` but are not explicitly imported and registered in the `appRouter` definition:

- `adminAnalytics.ts`
- `aeo.ts`
- `aeoRenewals.ts`
- `ai.ts`
- `alerts.ts`
- `analytics.ts`
- `apiChangelog.ts`
- `apisixAudit.ts`
- `aseanSw.ts`
- `auditEngine.ts`
- `batchPayments.ts`
- `bondedWarehouse.ts`
- `bulkExport.ts`
- `cargoTracking.ts`
- `cen.ts`
- `cep.ts`
- `corazaWaf.ts`
- `cost.ts`
- `crsImport.ts`
- `declarationAmendments.ts`
- `declarationRiskHistory.ts`
- `declarations.ts`
- `devPortal.ts`
- `documentVault.ts`
- `drawback.ts`
- `executiveDashboard.ts`
- `exportSchedules.ts`
- `finance.ts`
- `fluvio.ts`
- `fraudCases.ts`
- `freeZone.ts`
- `fund-flow.ts`
- `geofences.ts`
- `geoip.ts`
- `geospatial.ts`
- `health.ts`
- `healthThresholds.ts`
- `heartbeatAdmin.ts`
- `heartbeatJobs.ts`
- `insiderThreat.ts`
- `kafkaEvents.ts`
- `keycloak.ts`
- `knowledgeGraph.ts`
- `kpiTargets.ts`
- `kyc.ts`
- `lakehouse.ts`
- `ledger.ts`
- `mojaloop.ts`
- `nigeriaId.ts`
- `nlQuery.ts`
- `notificationPreferences.ts`
- `notifications.ts`
- `officerWorkload.ts`
- `oga.ts`
- `ogaBulkApprove.ts`
- `ogaPermitAudit.ts`
- `onboarding.ts`
- `onboardingAnalytics.ts`
- `openAppSec.ts`
- `opensearch.ts`
- `payments.ts`
- `permify.ts`
- `pilot.ts`
- `portCongestion.ts`
- `postAudit.ts`
- `postClearanceAuditSched.ts`
- `profiles.ts`
- `pushTokens.ts`
- `redis.ts`
- `riskModel.ts`
- `rulesOfOrigin.ts`
- `sanctionsBatch.ts`
- `security.ts`
- `siteSettings.ts`
- `slaEscalation.ts`
- `soc.ts`
- `stream.ts`
- `temporal.ts`
- `temporalRuns.ts`
- `tenant.ts`
- `threatIntel.ts`
- `tigerbeetleSeed.ts`
- `traderRatings.ts`
- `traderScorecard.ts`
- `userNotifications.ts`
- `v138Features.ts`
- `vision.ts`
- `warehouse.ts`
- `wazuh.ts`
- `webhooks.ts`
- `workflowSchemas.ts`

Conversely, some routers are registered in `routers.ts` but do not have corresponding individual files (they are bundled in `v138Features.ts`):
- `aeoComments`
- `docVersions`
- `checklistTemplates`
- `scheduleStats`
- `scheduleDeps`
- `sanctionsEntities`
- `watchlistAlerts`
- `batchErrors`
- `conflictStats`

## 4. Frontend Wiring

The frontend (`client/src/App.tsx` and pages) relies heavily on the tRPC client (`trpc.`). Because of the missing router registrations and mock data implementations on the backend, several pages will not function correctly end-to-end.

Key pages affected by mock data:
- `TemporalWorkflows.tsx` and `TemporalWorkflowRuns.tsx` (Temporal mock data)
- `VisionAnalysis.tsx` and `VisionBatchAnalysis.tsx` (Vision mock data)
- `KYCPortal.tsx` (KYC mock data)
- `WafEvents.tsx` and `CorazaWafDashboard.tsx` (OpenAppSec mock data)
- `LakehouseJobs.tsx` (Lakehouse mock data)
- `OGAPermitAuditTrail.tsx` (OGA Permit mock data)

## 5. Infrastructure Integrations

- **TigerBeetle**: The `tigerbeetle-bridge` service is implemented in Rust (`services/tigerbeetle-bridge/src/main.rs`). It connects to the TigerBeetle cluster and exposes a gRPC interface. The integration needs to be verified across the payment and drawback workflows.
- **Keycloak**: The `keycloak-svc` is implemented in Go (`services/go/keycloak-svc/cmd/main.go`). It handles OIDC discovery and JWT validation. The tRPC middleware (`server/_core/keycloakVerifier.ts`) needs to ensure it correctly routes requests through this service.
- **Permify**: The `server/_core/permify.ts` middleware implements the Permify client. It needs to be fully integrated across all protected tRPC procedures.
- **Dapr**: Dapr sidecars are configured for pub/sub (Kafka) and state store (Redis). The Python and Go microservices use Dapr for inter-service communication.
- **APISIX**: The `infra/apisix/routes.yaml` file defines the upstream routing. It needs to be verified against the actual deployed services.

## Next Steps

1. **Fix Missing Schemas**: Add the missing enums and types for Rules of Origin to `drizzle/schema.ts`.
2. **Remove Mocks**: Replace all mock data generation in the tRPC routers with actual service calls or database queries.
3. **Fix Router Registration**: Ensure all tRPC routers are properly imported and registered in `server/routers.ts`.
4. **Implement Missing Python Services**: Ensure the `microservices/` directory contains the correct entry points for the AI services, or update the deployment configuration to use the implementations in `services/python/`.
5. **Verify End-to-End Wiring**: Test the frontend pages to ensure they correctly communicate with the backend services without relying on mock data.
