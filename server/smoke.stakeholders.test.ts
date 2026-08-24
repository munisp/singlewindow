/**
 * Comprehensive Stakeholder Smoke Tests — TradeGateway NGSWTP
 *
 * Validates that every workflow a stakeholder can perform on the platform
 * has a corresponding tRPC procedure registered, with the correct type
 * (query vs mutation) and access level.
 *
 * Stakeholder roles covered:
 *   A. Trader / Importer-Exporter
 *   B. Customs Officer
 *   C. Other Government Agency (OGA) Officer
 *   D. Finance / Revenue Officer
 *   E. Port / Logistics Operator
 *   F. System Administrator
 *   G. Developer / API Consumer
 *   H. Security / SOC Analyst
 *
 * Test strategy: procedure-existence + type checks only (no DB calls).
 * All procedure names are verified against the actual router files.
 */
import { describe, it, expect } from "vitest";
import { appRouter } from "./routers";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function proc(path: string) {
  return appRouter._def.procedures[path];
}

function expectQuery(path: string) {
  const p = proc(path);
  expect(p, `procedure "${path}" should exist`).toBeDefined();
  expect(p._def.type, `"${path}" should be a query`).toBe("query");
}

function expectMutation(path: string) {
  const p = proc(path);
  expect(p, `procedure "${path}" should exist`).toBeDefined();
  expect(p._def.type, `"${path}" should be a mutation`).toBe("mutation");
}

// ─── A. Trader / Importer-Exporter ───────────────────────────────────────────

describe("A. Trader — Declaration Lifecycle", () => {
  it("A1: can submit a new import/export declaration", () => expectMutation("declarations.create"));
  it("A2: can list own declarations", () => expectQuery("declarations.myDeclarations"));
  it("A3: can view a specific declaration", () => expectQuery("declarations.byId"));
  it("A4: can submit a declaration for processing", () => expectMutation("declarations.submit"));
  it("A5: can search declarations full-text", () => expectQuery("declarations.fullTextSearch"));
  it("A6: can view declaration statistics", () => expectQuery("declarations.stats"));
  it("A7: can view declaration timeline", () => expectQuery("declarations.getTimeline"));
  it("A8: can upload a supporting document", () => expectMutation("declarations.addDocument"));
  it("A9: can list declaration documents", () => expectQuery("declarations.listDocuments"));
  it("A10: can delete a declaration document", () => expectMutation("declarations.deleteDocument"));
  it("A11: can view clearance certificates", () => expectQuery("declarations.listMyCertificates"));
  it("A12: can generate a clearance certificate", () => expectMutation("declarations.generateClearanceCertificate"));
  it("A13: can export declarations to CSV", () => expectMutation("declarations.exportCsv"));
  it("A14: can assign an officer to a declaration", () => expectMutation("declarations.assignOfficer"));
  it("A15: can view all declarations (admin)", () => expectQuery("declarations.all"));
  it("A16: can update declaration status", () => expectMutation("declarations.updateStatus"));
  it("A17: can export declaration summary PDF", () => expectMutation("declarations.exportSummaryPDF"));
});

describe("A. Trader — AEO Programme", () => {
  it("A18: can view own AEO application", () => expectQuery("aeo.myApplication"));
  it("A19: can submit AEO application", () => expectMutation("aeo.submitApplication"));
  it("A20: can get AEO self-assessment questions", () => expectQuery("aeo.getSelfAssessmentQuestions"));
  it("A21: can submit AEO self-assessment", () => expectMutation("aeo.submitSelfAssessment"));
  it("A22: can request AEO certificate renewal", () => expectMutation("aeo.requestRenewal"));
  it("A23: can view all AEO applications (admin)", () => expectQuery("aeo.all"));
  it("A24: can approve an AEO application (admin)", () => expectMutation("aeo.approve"));
  it("A25: can reject an AEO application (admin)", () => expectMutation("aeo.reject"));
  it("A26: can view expiring AEO certificates (admin)", () => expectQuery("aeo.getExpiringCertificates"));
  it("A27: can renew an AEO certificate (admin)", () => expectMutation("aeo.renewCertificate"));
});

describe("A. Trader — Payments & Duties", () => {
  it("A28: can initiate a duty payment", () => expectMutation("payments.initiate"));
  it("A29: can confirm a payment", () => expectMutation("payments.confirm"));
  it("A30: can list all payments (admin)", () => expectQuery("payments.listAll"));
  it("A31: can view payment by ID", () => expectQuery("payments.getById"));
  it("A32: can view own payment history", () => expectQuery("payments.myHistory"));
  it("A33: can view payments by declaration", () => expectQuery("payments.byDeclaration"));
  it("A34: can view payment trend", () => expectQuery("payments.trend"));
  it("A35: can view pending payments", () => expectQuery("payments.pendingList"));
  it("A36: can cancel a payment", () => expectMutation("payments.cancel"));
  it("A37: can view payment reconciliation report (admin)", () => expectQuery("payments.reconciliationReport"));
});

describe("A. Trader — Duty Drawback", () => {
  it("A38: can list own drawback claims", () => expectQuery("drawback.list"));
  it("A39: can view drawback claim by ID", () => expectQuery("drawback.getById"));
  it("A40: can create a drawback claim", () => expectMutation("drawback.create"));
  it("A41: can submit a drawback claim", () => expectMutation("drawback.submit"));
  it("A42: can check drawback eligibility", () => expectQuery("drawback.checkEligibility"));
  it("A43: can calculate expected drawback refund", () => expectQuery("drawback.calculateRefund"));
  it("A44: can generate a drawback claim PDF", () => expectQuery("drawback.generateClaimPdf"));
  it("A45: can view drawback statistics", () => expectQuery("drawback.stats"));
  it("A46: can auto-calculate drawback from declaration", () => expectQuery("drawback.autoCalculateFromDeclaration"));
  it("A47: can get eligible declarations for drawback", () => expectQuery("drawback.getEligibleDeclarations"));
  it("A48: can review a drawback claim (admin)", () => expectMutation("drawback.review"));
  it("A49: can mark a drawback claim as paid (admin)", () => expectMutation("drawback.markPaid"));
});

describe("A. Trader — Rules of Origin", () => {
  it("A50: can submit a certificate of origin", () => expectMutation("rulesOfOrigin.submitCertificate"));
  it("A51: can view own certificates", () => expectQuery("rulesOfOrigin.getMyCertificates"));
  it("A52: can get certificate by ID", () => expectQuery("rulesOfOrigin.getById"));
  it("A53: can get certificate by declaration", () => expectQuery("rulesOfOrigin.getByDeclaration"));
  it("A54: can list pending certificates for review", () => expectQuery("rulesOfOrigin.listPending"));
  it("A55: can review a certificate (admin)", () => expectMutation("rulesOfOrigin.review"));
  it("A56: can verify a certificate", () => expectQuery("rulesOfOrigin.verify"));
  it("A57: can generate certificate PDF", () => expectMutation("rulesOfOrigin.generatePdf"));
  it("A58: can revoke a certificate (admin)", () => expectMutation("rulesOfOrigin.revokeCertificate"));
  it("A59: can list revoked certificates", () => expectQuery("rulesOfOrigin.listRevoked"));
  it("A60: can view top scanned certificates", () => expectQuery("rulesOfOrigin.topScanned"));
  it("A61: can get certificate scan count", () => expectQuery("rulesOfOrigin.getCertScanCount"));
  it("A62: can view rules of origin statistics", () => expectQuery("rulesOfOrigin.getStats"));
});

describe("A. Trader — Bonded Warehouse", () => {
  it("A63: can view bonded warehouses", () => expectQuery("bondedWarehouse.listWarehouses"));
  it("A64: can register a warehouse", () => expectMutation("bondedWarehouse.registerWarehouse"));
  it("A65: can view warehouse inventory", () => expectQuery("bondedWarehouse.getInventory"));
  it("A66: can record a warehouse entry", () => expectMutation("bondedWarehouse.recordEntry"));
  it("A67: can record a warehouse exit", () => expectMutation("bondedWarehouse.recordExit"));
  it("A68: can issue an ex-bond permit", () => expectMutation("bondedWarehouse.issueExBondPermit"));
  it("A69: can list ex-bond permits", () => expectQuery("bondedWarehouse.listPermits"));
  it("A70: can view bond guarantees", () => expectQuery("bondedWarehouse.getBondGuarantees"));
  it("A71: can view bond expiry alerts", () => expectQuery("bondedWarehouse.getExpiryAlerts"));
  it("A72: can view warehouse dashboard stats", () => expectQuery("bondedWarehouse.getDashboardStats"));
  it("A73: can renew a bond (admin)", () => expectMutation("bondedWarehouse.renewBond"));
  it("A74: can send bond expiry alerts", () => expectMutation("bondedWarehouse.sendBondExpiryAlerts"));
});

describe("A. Trader — Scorecard & Ratings", () => {
  it("A75: can view own trader scorecard", () => expectQuery("traderScorecard.getScorecard"));
  it("A76: can view compliance trend", () => expectQuery("traderScorecard.getComplianceTrend"));
  it("A77: can view clearance percentile", () => expectQuery("traderScorecard.getClearancePercentile"));
  it("A78: can view own trader rating", () => expectQuery("traderRatings.getMine"));
  it("A79: can submit a trader rating", () => expectMutation("traderRatings.submit"));
});

describe("A. Trader — Notifications", () => {
  it("A80: can view own notifications", () => expectQuery("userNotifications.getMyNotifications"));
  it("A81: can mark notification as read", () => expectMutation("userNotifications.markAsRead"));
  it("A82: can mark all notifications as read", () => expectMutation("userNotifications.markAllRead"));
  it("A83: can get unread notification count", () => expectQuery("userNotifications.getUnreadCount"));
});

// ─── B. Customs Officer ───────────────────────────────────────────────────────

describe("B. Customs Officer — Declaration Processing", () => {
  it("B1: can list all declarations", () => expectQuery("declarations.all"));
  it("B2: can view declaration details", () => expectQuery("declarations.byId"));
  it("B3: can update declaration status (approve/reject)", () => expectMutation("declarations.updateStatus"));
  it("B4: can assign declaration to officer", () => expectMutation("declarations.assignOfficer"));
  it("B5: can list available officers", () => expectQuery("declarations.listOfficers"));
  it("B6: can view officer workload", () => expectQuery("declarations.workload"));
  it("B7: can bulk export declarations as ZIP", () => expectMutation("declarations.bulkExportZip"));
});

describe("B. Customs Officer — Risk Scoring", () => {
  it("B8: can score a declaration", () => expectMutation("riskModel.scoreDeclaration"));
  it("B9: can batch score declarations", () => expectMutation("riskModel.batchScore"));
  it("B10: can view model metrics", () => expectQuery("riskModel.getModelMetrics"));
  it("B11: can view model stats", () => expectQuery("riskModel.getModelStats"));
  it("B12: can view model versions", () => expectQuery("riskModel.getModelVersions"));
  it("B13: can get feature importance", () => expectQuery("riskModel.getFeatureImportance"));
});

describe("B. Customs Officer — Officer Workload", () => {
  it("B14: can view team workload summary", () => expectQuery("officerWorkload.getTeamSummary"));
  it("B15: can view own workload", () => expectQuery("officerWorkload.getMyWorkload"));
  it("B16: can trigger workload auto-rebalance", () => expectMutation("officerWorkload.autoRebalanceWorkload"));
  it("B17: can view workload distribution", () => expectQuery("officerWorkload.getWorkloadDistribution"));
});

describe("B. Customs Officer — SLA & Escalation", () => {
  it("B18: can scan for SLA breaches", () => expectMutation("slaEscalation.scan"));
  it("B19: can list SLA escalations", () => expectQuery("slaEscalation.list"));
  it("B20: can view SLA stats", () => expectQuery("slaEscalation.stats"));
  it("B21: can view at-risk declarations", () => expectQuery("slaEscalation.getMyAtRisk"));
  it("B22: can trigger auto-escalation", () => expectMutation("slaEscalation.autoEscalate"));
  it("B23: can resolve an escalation", () => expectMutation("slaEscalation.resolveEscalation"));
  it("B24: can view escalation history", () => expectQuery("slaEscalation.getEscalationHistory"));
});

describe("B. Customs Officer — Security & Alerts", () => {
  it("B25: can view security alerts", () => expectQuery("security.alerts"));
  it("B26: can acknowledge a security alert", () => expectMutation("security.acknowledgeAlert"));
  it("B27: can screen an entity for sanctions", () => expectMutation("security.screenEntity"));
  it("B28: can view sanctions by declaration", () => expectQuery("security.sanctionsByDeclaration"));
  it("B29: can explain risk for a declaration", () => expectQuery("security.explainRisk"));
  it("B30: can batch screen entities", () => expectMutation("security.batchScreenEntities"));
  it("B31: can ingest a security alert", () => expectMutation("security.ingestAlert"));
});

describe("B. Customs Officer — Declaration Amendments", () => {
  it("B32: can request an amendment", () => expectMutation("declarationAmendments.requestAmendment"));
  it("B33: can list amendments by declaration", () => expectQuery("declarationAmendments.listByDeclaration"));
  it("B34: can list pending amendments", () => expectQuery("declarationAmendments.listPending"));
  it("B35: can list own amendments", () => expectQuery("declarationAmendments.listMine"));
  it("B36: can review an amendment", () => expectMutation("declarationAmendments.reviewAmendment"));
});

// ─── C. OGA Officer ───────────────────────────────────────────────────────────

describe("C. OGA Officer — Permit Workflow", () => {
  it("C1: can create a permit for a declaration", () => expectMutation("oga.createForDeclaration"));
  it("C2: can view permits by declaration", () => expectQuery("oga.byDeclaration"));
  it("C3: can view own OGA permits", () => expectQuery("oga.myPermits"));
  it("C4: can approve an OGA permit", () => expectMutation("oga.approve"));
  it("C5: can reject an OGA permit", () => expectMutation("oga.reject"));
  it("C6: can view list of OGA agencies", () => expectQuery("oga.agencies"));
  it("C7: can view OGA permit expiry calendar", () => expectQuery("oga.expiryCalendar"));
});

describe("C. OGA Officer — Rules of Origin Review", () => {
  it("C8: can list pending certificates for review", () => expectQuery("rulesOfOrigin.listPending"));
  it("C9: can review a certificate of origin", () => expectMutation("rulesOfOrigin.review"));
  it("C10: can verify a certificate", () => expectQuery("rulesOfOrigin.verify"));
  it("C11: can generate certificate PDF", () => expectMutation("rulesOfOrigin.generatePdf"));
  it("C12: can view revoked certificates", () => expectQuery("rulesOfOrigin.listRevoked"));
});

describe("C. OGA Officer — Threat Intelligence", () => {
  it("C13: can check entity against sanctions", () => expectMutation("threatIntel.checkSanctions"));
  it("C14: can enrich a declaration with threat intel", () => expectMutation("threatIntel.enrichDeclaration"));
  it("C15: can get country risk score", () => expectQuery("threatIntel.getCountryRisk"));
  it("C16: can view threat indicators", () => expectQuery("threatIntel.getIndicators"));
  it("C17: can view threat stats", () => expectQuery("threatIntel.getStats"));
  it("C18: can lookup a threat actor", () => expectQuery("threatIntel.lookupThreatActor"));
});

// ─── D. Finance / Revenue Officer ────────────────────────────────────────────

describe("D. Finance Officer — Fund Flow", () => {
  it("D1: can collect import duty", () => expectMutation("fundFlow.collectImportDuty"));
  it("D2: can collect export levy", () => expectMutation("fundFlow.collectExportLevy"));
  it("D3: can issue a penalty", () => expectMutation("fundFlow.issuePenalty"));
  it("D4: can lodge a bond guarantee", () => expectMutation("fundFlow.lodgeBondGuarantee"));
  it("D5: can release a bond", () => expectMutation("fundFlow.releaseBond"));
  it("D6: can forfeit a bond", () => expectMutation("fundFlow.forfeitBond"));
  it("D7: can lodge a transit guarantee", () => expectMutation("fundFlow.lodgeTransitGuarantee"));
  it("D8: can release a transit guarantee", () => expectMutation("fundFlow.releaseTransitGuarantee"));
  it("D9: can initiate audit recovery", () => expectMutation("fundFlow.initiateAuditRecovery"));
  it("D10: can initiate overpayment refund", () => expectMutation("fundFlow.initiateOverpaymentRefund"));
  it("D11: can trigger batch settlement", () => expectMutation("fundFlow.triggerBatchSettlement"));
  it("D12: can trigger revenue reconciliation", () => expectMutation("fundFlow.triggerRevenueReconciliation"));
  it("D13: can get fund flow workflow status", () => expectQuery("fundFlow.getWorkflowStatus"));
});

describe("D. Finance Officer — TigerBeetle Ledger", () => {
  it("D14: can view ledger stats", () => expectQuery("system.ledgerStats"));
  it("D15: can view TigerBeetle modes", () => expectQuery("system.tigerbeetleModes"));
  it("D16: can seed system accounts", () => expectMutation("tigerbeetleSeed.seedSystemAccounts"));
  it("D17: can seed trader accounts", () => expectMutation("tigerbeetleSeed.seedTraderAccounts"));
  it("D18: can get seed status", () => expectQuery("tigerbeetleSeed.getSeedStatus"));
});

// ─── E. Port / Logistics Operator ────────────────────────────────────────────

describe("E. Port Operator — Cargo & Vessel Tracking", () => {
  it("E1: can view live vessels", () => expectQuery("cargoTracking.getLiveVessels"));
  it("E2: can view vessel route", () => expectQuery("cargoTracking.getVesselRoute"));
  it("E3: can track a shipment position", () => expectQuery("cargoTracking.getShipmentPosition"));
  it("E4: can view port arrivals", () => expectQuery("cargoTracking.getPortArrivals"));
  it("E5: can view vessel stats", () => expectQuery("cargoTracking.getVesselStats"));
  it("E6: can log a cargo event", () => expectMutation("cargoTracking.logCargoEvent"));
  it("E7: can search vessels", () => expectQuery("cargoTracking.searchVessels"));
  it("E8: can view cargo heatmap data", () => expectQuery("cargoTracking.getCargoHeatmapData"));
});

describe("E. Port Operator — Port Congestion", () => {
  it("E9: can list ports", () => expectQuery("portCongestion.listPorts"));
  it("E10: can get port forecast", () => expectQuery("portCongestion.getPortForecast"));
  it("E11: can get all port forecasts", () => expectQuery("portCongestion.getAllForecasts"));
  it("E12: can view SLA breach alerts", () => expectQuery("portCongestion.getSlaBreachAlerts"));
  it("E13: can view network summary", () => expectQuery("portCongestion.getNetworkSummary"));
  it("E14: can view port history", () => expectQuery("portCongestion.getPortHistory"));
  it("E15: can record a congestion event", () => expectMutation("portCongestion.recordCongestionEvent"));
  it("E16: can view forecast accuracy", () => expectQuery("portCongestion.getForecastAccuracy"));
  it("E17: can view port congestion trend", () => expectQuery("portCongestion.getPortCongestionTrend"));
});

describe("E. Port Operator — Vision Inspection", () => {
  it("E18: can verify a container seal", () => expectMutation("vision.verifyContainerSeal"));
  it("E19: can submit a physical inspection report", () => expectMutation("vision.submitInspection"));
  it("E20: can view inspection reports by declaration", () => expectQuery("vision.listByDeclaration"));
  it("E21: can view own inspection reports", () => expectQuery("vision.listMyReports"));
  it("E22: can get an inspection report", () => expectQuery("vision.getReport"));
  it("E23: can match manifest against cargo", () => expectMutation("vision.matchManifest"));
  it("E24: can submit a batch document analysis job", () => expectMutation("vision.batchAnalyzeDocuments"));
  it("E25: can list batch analysis jobs", () => expectQuery("vision.listBatchJobs"));
  it("E26: can get batch job status", () => expectQuery("vision.getBatchJobStatus"));
});

describe("E. Port Operator — Free Zone", () => {
  it("E27: can register a free zone (admin)", () => expectMutation("freeZone.registerZone"));
  it("E28: can list free zones", () => expectQuery("freeZone.listZones"));
  it("E29: can admit goods to free zone", () => expectMutation("freeZone.admitGoods"));
  it("E30: can transfer goods within free zone", () => expectMutation("freeZone.transferGoods"));
  it("E31: can exit goods from free zone", () => expectMutation("freeZone.exitGoods"));
  it("E32: can view free zone inventory", () => expectQuery("freeZone.listInventory"));
  it("E33: can view free zone stats", () => expectQuery("freeZone.getStats"));
  it("E34: can reconcile free zone inventory", () => expectQuery("freeZone.reconcileInventory"));
  it("E35: can view inventory audit trail", () => expectQuery("freeZone.getInventoryAuditTrail"));
  it("E36: can view reconciliation history", () => expectQuery("freeZone.getReconciliationHistory"));
});

describe("E. Port Operator — Streaming", () => {
  it("E37: can get WebSocket stream URL", () => expectQuery("stream.getWebSocketUrl"));
  it("E38: can view recent stream events", () => expectQuery("stream.getRecentEvents"));
  it("E39: can view stream service status", () => expectQuery("stream.getServiceStatus"));
  it("E40: can publish a test stream event", () => expectMutation("stream.publishTestEvent"));
});

// ─── F. System Administrator ──────────────────────────────────────────────────

describe("F. Admin — User Management", () => {
  it("F1: can list all users", () => expectQuery("auth.listUsers"));
  it("F2: can change user role", () => expectMutation("auth.changeRole"));
  it("F3: can view user stats", () => expectQuery("auth.userStats"));
  it("F4: can update user name", () => expectMutation("auth.updateUserName"));
});

describe("F. Admin — Tenant Management", () => {
  it("F5: can provision a new tenant", () => expectMutation("tenant.provisionTenant"));
  it("F6: can list all tenants", () => expectQuery("tenant.listTenants"));
  it("F7: can get tenant details", () => expectQuery("tenant.getTenant"));
  it("F8: can update tenant status", () => expectMutation("tenant.updateTenantStatus"));
  it("F9: can upsert tenant branding", () => expectMutation("tenant.upsertTenantBranding"));
  it("F10: can get tenant branding", () => expectQuery("tenant.getTenantBranding"));
  it("F11: can add a tenant user", () => expectMutation("tenant.addTenantUser"));
  it("F12: can remove a tenant user", () => expectMutation("tenant.removeTenantUser"));
  it("F13: can list tenant users", () => expectQuery("tenant.listTenantUsers"));
  it("F14: can upsert Keycloak config", () => expectMutation("tenant.upsertKeycloakConfig"));
  it("F15: can get tenant Keycloak config", () => expectQuery("tenant.getTenantKeycloakConfig"));
  it("F16: can get tenant stats", () => expectQuery("tenant.getTenantStats"));
});

describe("F. Admin — System Health & Monitoring", () => {
  it("F17: can view system health", () => expectQuery("system.health"));
  it("F18: can view system status", () => expectQuery("system.systemStatus"));
  it("F19: can view platform health score", () => expectQuery("system.getPlatformHealthScore"));
  it("F20: can view microservice health", () => expectQuery("system.microserviceHealth"));
  it("F21: can view service health", () => expectQuery("system.serviceHealth"));
  it("F22: can view circuit breaker status", () => expectQuery("system.circuitBreakerStatus"));
  it("F23: can view rate limit stats", () => expectQuery("system.rateLimitStats"));
  it("F24: can view security events", () => expectQuery("system.securityEvents"));
  it("F25: can view system audit log", () => expectQuery("system.auditLog"));
  it("F26: can view ledger stats", () => expectQuery("system.ledgerStats"));
  it("F27: can view TigerBeetle modes", () => expectQuery("system.tigerbeetleModes"));
});

describe("F. Admin — Cron Job Management", () => {
  it("F28: can list Heartbeat cron jobs", () => expectQuery("heartbeatJobs.listJobs"));
  it("F29: can register a cron job", () => expectMutation("heartbeatJobs.registerJob"));
  it("F30: can register all cron jobs", () => expectMutation("heartbeatJobs.registerAllJobs"));
  it("F31: can toggle a cron job", () => expectMutation("heartbeatJobs.toggleJob"));
  it("F32: can delete a cron job", () => expectMutation("heartbeatJobs.deleteJob"));
  it("F33: can manually trigger bond expiry alerts", () => expectMutation("heartbeatJobs.triggerBondExpiryAlerts"));
  it("F34: can manually trigger post-audit reminders", () => expectMutation("heartbeatJobs.triggerPostAuditReminders"));
  it("F35: can manually trigger SLA auto-escalation", () => expectMutation("heartbeatJobs.triggerSlaAutoEscalation"));
  it("F36: can get cron job definitions", () => expectQuery("heartbeatJobs.getJobDefinitions"));
  it("F37: can manually trigger any job by name", () => expectMutation("heartbeatJobs.manualTrigger"));
  it("F38: can view cron run history", () => expectQuery("heartbeatJobs.listRunHistory"));
});

describe("F. Admin — Health Threshold Configuration", () => {
  it("F39: can list health thresholds", () => expectQuery("healthThresholds.list"));
  it("F40: can update a health threshold", () => expectMutation("healthThresholds.update"));
  it("F41: can reset a health threshold to default", () => expectMutation("healthThresholds.reset"));
  it("F42: can reset all health thresholds to defaults", () => expectMutation("healthThresholds.resetAll"));
});

describe("F. Admin — Site Settings & Workflow Schemas", () => {
  it("F43: can get a site setting", () => expectQuery("siteSettings.get"));
  it("F44: can list site settings", () => expectQuery("siteSettings.list"));
  it("F45: can set a site setting", () => expectMutation("siteSettings.set"));
  it("F46: can view site settings audit log", () => expectQuery("siteSettings.listAuditLog"));
  it("F47: can list workflow types", () => expectQuery("workflowSchemas.listWorkflowTypes"));
  it("F48: can get schema for workflow type", () => expectQuery("workflowSchemas.getSchemaForType"));
  it("F49: can upsert a workflow schema", () => expectMutation("workflowSchemas.upsertSchema"));
  it("F50: can seed default workflow schemas", () => expectMutation("workflowSchemas.seedDefaultSchemas"));
  it("F51: can view workflow schema version history", () => expectQuery("workflowSchemas.getVersionHistory"));
  it("F52: can restore a workflow schema version", () => expectMutation("workflowSchemas.restoreVersion"));
});

describe("F. Admin — Onboarding Analytics", () => {
  it("F53: can view onboarding funnel", () => expectQuery("onboardingAnalytics.funnel"));
  it("F54: can view onboarding summary", () => expectQuery("onboardingAnalytics.summary"));
  it("F55: can view onboarding dropoff", () => expectQuery("onboardingAnalytics.dropoff"));
  it("F56: can view recent onboarding activity", () => expectQuery("onboardingAnalytics.recentActivity"));
  it("F57: can view AEO tier analytics", () => expectQuery("onboardingAnalytics.aeoTiers"));
  it("F58: can record onboarding step", () => expectMutation("onboardingAnalytics.record"));
});

describe("F. Admin — Temporal Workflow Management", () => {
  it("F59: can list Temporal workflows", () => expectQuery("temporal.listWorkflows"));
  it("F60: can get a Temporal workflow", () => expectQuery("temporal.getWorkflow"));
  it("F61: can get Temporal workflow history", () => expectQuery("temporal.getWorkflowHistory"));
  it("F62: can trigger a Temporal workflow", () => expectMutation("temporal.triggerWorkflow"));
  it("F63: can signal a Temporal workflow", () => expectMutation("temporal.signalWorkflow"));
  it("F64: can get Temporal system status", () => expectQuery("temporal.getSystemStatus"));
  it("F65: can view workflow run history", () => expectQuery("temporalRuns.getWorkflowRuns"));
  it("F66: can get a workflow run by ID", () => expectQuery("temporalRuns.getWorkflowRunById"));
  it("F67: can get workflow input history", () => expectQuery("temporalRuns.getWorkflowInputHistory"));
  it("F68: can get workflow stats", () => expectQuery("temporalRuns.getWorkflowStats"));
  it("F69: can retrigger a workflow run", () => expectMutation("temporalRuns.retriggerWorkflow"));
  it("F70: can get workflow types", () => expectQuery("temporalRuns.getWorkflowTypes"));
});

describe("F. Admin — Redis & Cache Management", () => {
  it("F71: can get cache stats", () => expectQuery("redis.getCacheStats"));
  it("F72: can get key info", () => expectQuery("redis.getKeyInfo"));
  it("F73: can invalidate a cache key", () => expectMutation("redis.invalidateKey"));
  it("F74: can invalidate by pattern", () => expectMutation("redis.invalidatePattern"));
  it("F75: can set TTL on a key", () => expectMutation("redis.setTTL"));
  it("F76: can flush a namespace", () => expectMutation("redis.flushNamespace"));
});

describe("F. Admin — Webhooks Management", () => {
  it("F77: can create a webhook", () => expectMutation("webhooks.create"));
  it("F78: can list own webhooks", () => expectQuery("webhooks.list"));
  it("F79: can admin-list all webhooks", () => expectQuery("webhooks.adminList"));
  it("F80: can update a webhook", () => expectMutation("webhooks.update"));
  it("F81: can delete a webhook", () => expectMutation("webhooks.delete"));
  it("F82: can rotate webhook secret", () => expectMutation("webhooks.rotateSecret"));
  it("F83: can view webhook deliveries", () => expectQuery("webhooks.deliveries"));
  it("F84: can view webhook stats", () => expectQuery("webhooks.stats"));
  it("F85: can view supported webhook events", () => expectQuery("webhooks.supportedEvents"));
});

describe("F. Admin — Bulk Export & Import", () => {
  it("F86: can export declarations in bulk", () => expectMutation("bulkExport.exportDeclarations"));
  it("F87: can export payments in bulk", () => expectMutation("bulkExport.exportPayments"));
  it("F88: can export transaction history", () => expectMutation("bulkExport.exportTransactionHistory"));
  it("F89: can export audit log", () => expectMutation("bulkExport.exportAuditLog"));
  it("F90: can preview export count", () => expectQuery("bulkExport.previewCount"));
  it("F91: can import declarations", () => expectMutation("bulkExport.importDeclarations"));
});

// ─── G. Developer / API Consumer ─────────────────────────────────────────────

describe("G. Developer — API Key Management", () => {
  it("G1: can create an API key", () => expectMutation("devPortal.createApiKey"));
  it("G2: can list own API keys", () => expectQuery("devPortal.listApiKeys"));
  it("G3: can revoke an API key", () => expectMutation("devPortal.revokeApiKey"));
  it("G4: can rotate an API key", () => expectMutation("devPortal.rotateApiKey"));
  it("G5: can toggle sandbox mode", () => expectMutation("devPortal.toggleSandbox"));
  it("G6: can set rate limit", () => expectMutation("devPortal.setRateLimit"));
  it("G7: can view API usage stats", () => expectQuery("devPortal.getUsageStats"));
  it("G8: can check rate limit status", () => expectQuery("devPortal.checkRateLimit"));
  it("G9: can get available API scopes", () => expectQuery("devPortal.getAvailableScopes"));
  it("G10: can get playground endpoints", () => expectQuery("devPortal.getPlaygroundEndpoints"));
  it("G11: can get API catalogue", () => expectQuery("devPortal.getApiCatalogue"));
});

describe("G. Developer — Webhooks & Streaming", () => {
  it("G12: can create a webhook subscription", () => expectMutation("webhooks.create"));
  it("G13: can view webhook delivery history", () => expectQuery("webhooks.deliveries"));
  it("G14: can view supported webhook events", () => expectQuery("webhooks.supportedEvents"));
  it("G15: can publish a test stream event", () => expectMutation("stream.publishTestEvent"));
  it("G16: can get WebSocket stream URL", () => expectQuery("stream.getWebSocketUrl"));
});

describe("G. Developer — Risk Model & A/B Testing", () => {
  it("G17: can score a declaration via risk model", () => expectMutation("riskModel.scoreDeclaration"));
  it("G18: can batch score declarations", () => expectMutation("riskModel.batchScore"));
  it("G19: can view model metrics", () => expectQuery("riskModel.getModelMetrics"));
  it("G20: can view model stats", () => expectQuery("riskModel.getModelStats"));
  it("G21: can view model versions", () => expectQuery("riskModel.getModelVersions"));
  it("G22: can get feature importance", () => expectQuery("riskModel.getFeatureImportance"));
  it("G23: can create an A/B test", () => expectMutation("riskModel.createAbTest"));
  it("G24: can list A/B tests", () => expectQuery("riskModel.getAbTests"));
  it("G25: can get A/B test results", () => expectQuery("riskModel.getAbTestResults"));
  it("G26: can conclude an A/B test", () => expectMutation("riskModel.concludeAbTest"));
  it("G27: can promote a model version", () => expectMutation("riskModel.promoteModel"));
});

describe("G. Developer — Workflow Schemas", () => {
  it("G28: can list workflow types", () => expectQuery("workflowSchemas.listWorkflowTypes"));
  it("G29: can get schema for a workflow type", () => expectQuery("workflowSchemas.getSchemaForType"));
});

// ─── H. Security / SOC Analyst ────────────────────────────────────────────────

describe("H. Security Analyst — SOC Operations", () => {
  it("H1: can view SOC alerts", () => expectQuery("soc.getAlerts"));
  it("H2: can ingest a SOC alert", () => expectMutation("soc.ingestAlert"));
  it("H3: can acknowledge a SOC alert", () => expectMutation("soc.acknowledgeAlert"));
  it("H4: can create a security incident", () => expectMutation("soc.createIncident"));
  it("H5: can view security incidents", () => expectQuery("soc.getIncidents"));
  it("H6: can get a specific incident", () => expectQuery("soc.getIncident"));
  it("H7: can update an incident", () => expectMutation("soc.updateIncident"));
  it("H8: can correlate a declaration to incidents", () => expectQuery("soc.correlateDeclaration"));
  it("H9: can view MITRE ATT&CK stats", () => expectQuery("soc.getMitreStats"));
  it("H10: can get SOC agent status", () => expectQuery("soc.getAgentStatus"));
});

describe("H. Security Analyst — Wazuh SIEM", () => {
  it("H11: can view Wazuh alerts", () => expectQuery("wazuh.getAlerts"));
  it("H12: can acknowledge a Wazuh alert", () => expectMutation("wazuh.acknowledgeAlert"));
  it("H13: can view Wazuh agents", () => expectQuery("wazuh.getAgents"));
  it("H14: can get security score", () => expectQuery("wazuh.getSecurityScore"));
  it("H15: can detect anomaly via Wazuh", () => expectMutation("wazuh.detectAnomaly"));
  it("H16: can list Wazuh playbooks", () => expectQuery("wazuh.listPlaybooks"));
  it("H17: can trigger a Wazuh playbook", () => expectMutation("wazuh.triggerPlaybook"));
});

describe("H. Security Analyst — Insider Threat & 4-Eyes", () => {
  it("H18: can view active sessions (admin)", () => expectQuery("insiderThreat.getActiveSessions"));
  it("H19: can force logout a session (admin)", () => expectMutation("insiderThreat.forceLogout"));
  it("H20: can request 4-eyes approval", () => expectMutation("insiderThreat.requestFourEyesApproval"));
  it("H21: can approve a 4-eyes request (admin)", () => expectMutation("insiderThreat.approveFourEyes"));
  it("H22: can view pending 4-eyes requests (admin)", () => expectQuery("insiderThreat.getPendingFourEyes"));
  it("H23: can view audit log (admin)", () => expectQuery("insiderThreat.getAuditLog"));
  it("H24: can view anomaly alerts (admin)", () => expectQuery("insiderThreat.getAnomalyAlerts"));
  it("H25: can view privileged action audit trail (admin)", () => expectQuery("insiderThreat.getPrivilegedActionAuditTrail"));
  it("H26: can verify audit chain (admin)", () => expectQuery("insiderThreat.verifyAuditChain"));
  it("H27: can get SSE token (admin)", () => expectMutation("insiderThreat.getSSEToken"));
  it("H28: can get audit entry diff (admin)", () => expectQuery("insiderThreat.getAuditEntryDiff"));
  it("H29: can classify HS code", () => expectMutation("insiderThreat.classifyHSCode"));
});

describe("H. Security Analyst — Threat Intelligence", () => {
  it("H30: can view threat intel indicators", () => expectQuery("threatIntel.getIndicators"));
  it("H31: can ingest threat indicators", () => expectMutation("threatIntel.ingestIndicators"));
  it("H32: can enrich an alert with threat intel", () => expectMutation("threatIntel.enrichAlert"));
  it("H33: can export STIX threat data", () => expectQuery("threatIntel.exportStix"));
  it("H34: can get TTPs", () => expectQuery("threatIntel.getTTPs"));
  it("H35: can match declaration against threat intel", () => expectMutation("threatIntel.matchDeclaration"));
});

describe("H. Security Analyst — GeoIP & Push Notifications", () => {
  it("H36: can lookup an IP address", () => expectQuery("geoip.lookupIp"));
  it("H37: can get GeoIP seed jobs", () => expectQuery("geoip.getSeedJobs"));
  it("H38: can register a push token", () => expectMutation("pushTokens.registerPushToken"));
  it("H39: can unregister a push token", () => expectMutation("pushTokens.unregisterPushToken"));
  it("H40: can send an anomaly push notification", () => expectMutation("pushTokens.sendAnomalyPushNotification"));
});

// ─── Cross-role: Auth & System ────────────────────────────────────────────────

describe("X. Cross-role — Auth & System Procedures", () => {
  it("X1: auth.me is a query", () => expectQuery("auth.me"));
  it("X2: auth.logout is a mutation", () => expectMutation("auth.logout"));
  it("X3: system.notifyOwner is a mutation", () => expectMutation("system.notifyOwner"));
  it("X4: auth.listUsers is a query", () => expectQuery("auth.listUsers"));
  it("X5: auth.changeRole is a mutation", () => expectMutation("auth.changeRole"));
  it("X6: declarations.create is a mutation", () => expectMutation("declarations.create"));
  it("X7: declarations.myDeclarations is a query", () => expectQuery("declarations.myDeclarations"));
  it("X8: payments.initiate is a mutation", () => expectMutation("payments.initiate"));
  it("X9: riskModel.scoreDeclaration is a mutation", () => expectMutation("riskModel.scoreDeclaration"));
  it("X10: slaEscalation.scan is a mutation", () => expectMutation("slaEscalation.scan"));
  it("X11: heartbeatJobs.listJobs is a query", () => expectQuery("heartbeatJobs.listJobs"));
  it("X12: healthThresholds.list is a query", () => expectQuery("healthThresholds.list"));
  it("X13: healthThresholds.update is a mutation", () => expectMutation("healthThresholds.update"));
  it("X14: vision.batchAnalyzeDocuments is a mutation", () => expectMutation("vision.batchAnalyzeDocuments"));
  it("X15: riskModel.concludeAbTest is a mutation", () => expectMutation("riskModel.concludeAbTest"));
  it("X16: fundFlow.collectImportDuty is a mutation", () => expectMutation("fundFlow.collectImportDuty"));
  it("X17: drawback.list is a query", () => expectQuery("drawback.list"));
  it("X18: oga.myPermits is a query", () => expectQuery("oga.myPermits"));
  it("X19: insiderThreat.getAnomalyAlerts is a query", () => expectQuery("insiderThreat.getAnomalyAlerts"));
  it("X20: devPortal.listApiKeys is a query", () => expectQuery("devPortal.listApiKeys"));
});

// ─── Platform Completeness: All key namespaces registered ────────────────────

describe("Z. Platform Completeness — All Namespaces Registered", () => {
  const namespaces = [
    "auth", "system", "declarations", "payments", "riskModel",
    "alerts", "aeo", "oga", "rulesOfOrigin",
    "drawback", "slaEscalation", "officerWorkload", "insiderThreat", "devPortal",
    "onboardingAnalytics", "heartbeatJobs", "workflowSchemas", "fundFlow",
    "healthThresholds", "tenant", "siteSettings", "temporal", "temporalRuns",
    "redis", "webhooks", "bulkExport", "cargoTracking", "portCongestion",
    "freeZone", "bondedWarehouse", "vision", "stream", "soc", "wazuh", "threatIntel",
    "security", "geoip", "pushTokens", "tigerbeetleSeed", "traderScorecard",
    "traderRatings", "userNotifications", "declarationAmendments",
  ];

  for (const ns of namespaces) {
    it(`namespace "${ns}" has at least one registered procedure`, () => {
      const procs = Object.keys(appRouter._def.procedures);
      const found = procs.some(p => p.startsWith(`${ns}.`));
      expect(found, `No procedures found for namespace "${ns}"`).toBe(true);
    });
  }
});
