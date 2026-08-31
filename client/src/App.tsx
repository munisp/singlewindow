import { PageSkeleton as _PageSkeleton } from "@/components/LoadingIndicator";
import { Toaster } from "@/components/ui/sonner";
import DemoModeBanner from "@/components/DemoModeBanner";
import OfflineBanner from "@/components/OfflineBanner";
import InstallPrompt from "@/components/InstallPrompt";
import MobileBottomNav from "@/components/MobileBottomNav";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/NotFound";
import { Route, Switch, Redirect } from "wouter";
import ErrorBoundary from "./components/ErrorBoundary";
import { ThemeProvider } from "./contexts/ThemeContext";
import { AdminGuard, CustomsGuard, OGAGuard, FinanceGuard, SecurityGuard, ExecutiveGuard } from "./components/RoleGuard";
import Home from "./pages/Home";
import TraderDashboard from "./pages/app/TraderDashboard";
import NewDeclaration from "./pages/app/NewDeclaration";
import CustomsDashboard from "./pages/app/CustomsDashboard";
import OGAPortal from "./pages/app/OGAPortal";
import OGAExpiryCalendar from "./pages/app/OGAExpiryCalendar";
import AdminConsole from "./pages/app/AdminConsole";
import SecurityOps from "./pages/app/SecurityOps";
import DeclarationDetail from "./pages/app/DeclarationDetail";
import KYCPortal from "./pages/app/KYCPortal";
import VisionAnalysis from "./pages/app/VisionAnalysis";
import AIAssistant from "./pages/app/AIAssistant";
import DocumentVault from "./pages/app/DocumentVault";
import ShareLanding from "./pages/ShareLanding";
import AdminKYCReview from "./pages/app/AdminKYCReview";
import PortHeatmap from "./pages/app/PortHeatmap";
// Lazy-load the specification page (it's large))
import { lazy, Suspense } from "react";
const Specification = lazy(() => import("./pages/Specification"));
// Lazy-load heavy pages
const SanctionsScreening = lazy(() => import("./pages/app/SanctionsScreening"));
const MojaloopPayments = lazy(() => import("./pages/app/MojaloopPayments"));
const TemporalWorkflows = lazy(() => import("./pages/app/TemporalWorkflows"));
const TraderProfile = lazy(() => import("./pages/app/TraderProfile"));
const TraderAEO = lazy(() => import("./pages/app/TraderAEO"));
const AeoSelfAssessment = lazy(() => import("./pages/app/AeoSelfAssessment"));
const PortCongestionForecast = lazy(() => import("./pages/app/PortCongestionForecast"));
const SecureChain = lazy(() => import("./pages/app/SecureChain"));
const AdminUsers = lazy(() => import("./pages/app/AdminUsers"));
const AdminDeclarations = lazy(() => import("./pages/app/AdminDeclarations"));
const AdminAEO = lazy(() => import("./pages/app/AdminAEO"));
const AdminAnalytics = lazy(() => import("./pages/app/AdminAnalytics"));
const CustomsRisk = lazy(() => import("./pages/app/CustomsRisk"));
const TraderDeclarations = lazy(() => import("./pages/app/TraderDeclarations"));
// Phase 8 — PCS Trader Portal
const PcsConsignments = lazy(() => import("./pages/app/PcsConsignments"));
const PcsConsignmentTimeline = lazy(() => import("./pages/app/PcsConsignmentTimeline"));
const PcsBookings = lazy(() => import("./pages/app/PcsBookings"));
const PcsBilling = lazy(() => import("./pages/app/PcsBilling"));
const PcsDocuments = lazy(() => import("./pages/app/PcsDocuments"));
const Notifications = lazy(() => import("./pages/app/Notifications"));
const Finance = lazy(() => import("./pages/app/Finance"));
const PostClearanceAudit = lazy(() => import("./pages/app/PostClearanceAudit"));
const DutyDrawback = lazy(() => import('./pages/app/DutyDrawback'));
const PaymentQueue = lazy(() => import('./pages/app/PaymentQueue'));
const KnowledgeGraph = lazy(() => import('./pages/app/KnowledgeGraph'));
const BalanceAccounts = lazy(() => import('./pages/app/BalanceAccounts'));
const FraudNetwork = lazy(() => import('./pages/app/FraudNetwork'));
const FraudCases = lazy(() => import('./pages/app/FraudCases'));
const RiskAlerts = lazy(() => import('./pages/app/RiskAlerts'));
const MyCertificates = lazy(() => import('./pages/app/MyCertificates'));
const OfficerWorkload = lazy(() => import('./pages/app/OfficerWorkload'));
const NotificationCentre = lazy(() => import('./pages/app/NotificationCentre'));
const SLABreachDashboard = lazy(() => import('./pages/app/SLABreachDashboard'));
const NotificationPreferences = lazy(() => import('./pages/app/NotificationPreferences'));
const FinanceLedger = lazy(() => import('./pages/FinanceLedger'));
const TradeFinanceConsents = lazy(() => import('./pages/TradeFinanceConsents'));
const TradeFinanceApply = lazy(() => import('./pages/TradeFinanceApply'));
const TradeFinanceStatus = lazy(() => import('./pages/TradeFinanceStatus'));
const IdentityProvider = lazy(() => import('./pages/IdentityProvider'));
const BondedWarehouse = lazy(() => import('./pages/app/BondedWarehouse'));
const AseanSingleWindow = lazy(() => import('./pages/app/AseanSingleWindow'));
const WcoCenAlerts = lazy(() => import('./pages/app/WcoCenAlerts'));
const FreeZoneOps = lazy(() => import('./pages/app/FreeZoneOps'));
const DeveloperPortal = lazy(() => import('./pages/app/DeveloperPortal'));
const Marketplace = lazy(() => import('./pages/app/Marketplace'));
const OperationalKpis = lazy(() => import('./pages/app/OperationalKpis'));
const ThreatIntelligence = lazy(() => import('./pages/app/ThreatIntelligence'));
const WazuhSecurityEvents = lazy(() => import('./pages/app/WazuhSecurityEvents'));
const RiskModelDashboard = lazy(() => import('./pages/app/RiskModelDashboard'));
const TradeAnalytics = lazy(() => import('./pages/app/TradeAnalytics'));
const TenantPortal = lazy(() => import('./pages/app/TenantPortal'));
const FlinkCepAlerts = lazy(() => import('./pages/FlinkCepAlerts'));
const CostManagement = lazy(() => import('./pages/CostManagement'));
const SecurityOperationsCentre = lazy(() => import('./pages/app/SecurityOperationsCentre'));
const AuditEngineDashboard = lazy(() => import('./pages/app/AuditEngineDashboard'));
const BondedWarehouseManagement = lazy(() => import('./pages/app/BondedWarehouseManagement'));
const DrawbackAutomation = lazy(() => import('./pages/app/DrawbackAutomation'));
const TraderScorecard = lazy(() => import('./pages/app/TraderScorecard'));
// Sprint 66 — Cargo Tracking Real-Time Map
const CargoTrackingMap = lazy(() => import('./pages/app/CargoTrackingMap'));
// Sprint 67 — Trader Onboarding Wizard
const TraderOnboarding = lazy(() => import('./pages/app/TraderOnboarding'));
// Sprint 68 — OpenAPI Explorer
const ApiExplorer = lazy(() => import('./pages/app/ApiExplorer'));
const SdkGenerator = lazy(() => import('./pages/app/SdkGenerator'));
// Sprint 72-74 — Onboarding Analytics, Geofence Management, Webhook Management, API Changelog
const OnboardingAnalyticsDashboard = lazy(() => import('./pages/app/OnboardingAnalyticsDashboard'));
const GeofenceManagement = lazy(() => import('./pages/app/GeofenceManagement'));
const WebhookManagement = lazy(() => import('./pages/app/WebhookManagement'));
const ApiChangelog = lazy(() => import('./pages/app/ApiChangelog'));
const RulesOfOrigin = lazy(() => import('./pages/app/RulesOfOrigin'));
const PilotDashboard = lazy(() => import('./pages/app/PilotDashboard'));
const ExecutiveDashboard = lazy(() => import('./pages/app/ExecutiveDashboard'));
const ComplianceEmailSettings = lazy(() => import('./pages/app/ComplianceEmailSettings'));
const AdminSettings = lazy(() => import('./pages/app/AdminSettings'));
const CertRevocationLog = lazy(() => import('./pages/app/CertRevocationLog'));
// Sprint 80 — Public certificate verification page (no auth required)
const GoLiveChecklist = lazy(() => import('./pages/app/GoLiveChecklist'));
const AdminProductionChecklist = lazy(() => import('./pages/app/AdminProductionChecklist'));
const ServiceHealth = lazy(() => import('./pages/app/ServiceHealth'));
const AuditLog = lazy(() => import('./pages/app/AuditLog'));
const CertVerify = lazy(() => import('./pages/public/CertVerify'));
const SystemStatus = lazy(() => import('./pages/SystemStatus'));
const DemoLogin = lazy(() => import('./pages/DemoLogin'));
const NLFinancialQuery = lazy(() => import('./pages/app/NLFinancialQuery'));
// v31 — New production pages
const Payments = lazy(() => import('./pages/app/Payments'));
const AEOApplications = lazy(() => import('./pages/app/AEOApplications'));
const BulkExport = lazy(() => import('./pages/app/BulkExport'));
const WebhookLogs = lazy(() => import('./pages/app/WebhookLogs'));
const SecurityAlerts = lazy(() => import('./pages/app/SecurityAlerts'));
const TenantManagement = lazy(() => import('./pages/app/TenantManagement'));
const TenantBranding = lazy(() => import('./pages/app/TenantBranding'));
const OfficerWorkloadRebalancer = lazy(() => import('./pages/app/OfficerWorkloadRebalancer'));
const OnboardingProgress = lazy(() => import('./pages/app/OnboardingProgress'));
// v67 — Insider Threat Prevention & Batch Seed
const SecurityMonitor = lazy(() => import('./pages/app/SecurityMonitor'));
const KafkaEventLog = lazy(() => import('./pages/app/KafkaEventLog'));
const OGAPermitAuditTrail = lazy(() => import('./pages/app/OGAPermitAuditTrail'));
const AdminBatchSeed = lazy(() => import('./pages/app/AdminBatchSeed'));
// v81 — Temporal Runs, WAF Events, Lakehouse Jobs
const TemporalWorkflowRuns = lazy(() => import('./pages/app/TemporalWorkflowRuns'));
const WafEvents = lazy(() => import('./pages/app/WafEvents'));
const LakehouseJobs = lazy(() => import('./pages/app/LakehouseJobs'));
const GeoipSeed = lazy(() => import('./pages/app/GeoipSeed'));
// v88-v91, v104 — Middleware & Platform pages
const FluvioTopicOffsets = lazy(() => import('./pages/FluvioTopicOffsets'));
const ApisixRouteAudit = lazy(() => import('./pages/ApisixRouteAudit'));
const KeycloakSessions = lazy(() => import('./pages/KeycloakSessions'));
const PermifyAuditLog = lazy(() => import('./pages/PermifyAuditLog'));
const PlatformHealthScorecard = lazy(() => import('./pages/PlatformHealthScorecard'));
const VisionBatchAnalysis = lazy(() => import('./pages/app/VisionBatchAnalysis'));
const CronJobManager = lazy(() => import('./pages/admin/CronJobManager'));
const AdminSystemStatus = lazy(() => import('./pages/admin/SystemStatus'));
const KeycloakAdmin = lazy(() => import('./pages/admin/KeycloakAdmin'));
const CorazaWafDashboard = lazy(() => import('./pages/admin/CorazaWafDashboard'));
const HeartbeatAdmin = lazy(() => import('./pages/admin/HeartbeatAdmin'));
// v136 sprint pages
const ThresholdAuditLog = lazy(() => import('./pages/admin/ThresholdAuditLog'));
const SanctionsBatchUpload = lazy(() => import('./pages/admin/SanctionsBatchUpload'));
const OGABulkApprove = lazy(() => import('./pages/admin/OGABulkApprove'));
const PostClearanceAuditScheduler = lazy(() => import('./pages/admin/PostClearanceAuditScheduler'));
const ExportScheduleManager = lazy(() => import('./pages/app/ExportScheduleManager'));
const AEORenewalWorkflow = lazy(() => import('./pages/app/AEORenewalWorkflow'));

const AEORenewalComments = lazy(() => import("@/pages/app/AEORenewalComments"));
const SanctionsEntitiesPage = lazy(() => import("@/pages/admin/SanctionsEntities"));
const ScheduleAnalyticsPage = lazy(() => import("@/pages/app/ScheduleAnalytics"));
const BatchValidationReportPage = lazy(() => import("@/pages/admin/BatchValidationReport"));
const UCRManagement = lazy(() => import("@/pages/UCRManagement"));
const ManifestManagement = lazy(() => import("@/pages/ManifestManagement"));
const TradeAnalyticsDashboard = lazy(() => import("@/pages/TradeAnalyticsDashboard"));
const NCSNRSDashboard = lazy(() => import("@/pages/NCSNRSDashboard"));


const LazyFallback = () => <_PageSkeleton />;

function Router() {
  return (
    <Switch>
      {/* Demo mode role-picker login screen */}
      <Route path="/demo">
        <Suspense fallback={<LazyFallback />}><DemoLogin /></Suspense>
      </Route>

      {/* Public landing page */}
      <Route path="/" component={Home} />

      {/* Sprint 80 — Public certificate verification (no auth required, QR-scannable) */}
      <Route path="/verify/:certNumber">
        <Suspense fallback={<LazyFallback />}><CertVerify /></Suspense>
      </Route>

      {/* Public system status page — no authentication required */}
      <Route path="/status">
        <Suspense fallback={<LazyFallback />}><SystemStatus /></Suspense>
      </Route>

      {/* Architecture specification (all 29 interactive components) */}
      <Route path="/specification">
        <Suspense fallback={<LazyFallback />}>
          <Specification />
        </Suspense>
      </Route>

      {/* Trader Portal */}
      <Route path="/app/trader" component={TraderDashboard} />
      <Route path="/app/trader/new" component={NewDeclaration} />
      <Route path="/app/trader/declarations">
        <Suspense fallback={<LazyFallback />}><TraderDeclarations /></Suspense>
      </Route>
      <Route path="/app/trader/declarations/new" component={NewDeclaration} />
      <Route path="/app/trader/declarations/:id" component={DeclarationDetail} />
      <Route path="/app/trader/kyc" component={KYCPortal} />
      <Route path="/app/trader/profile">
        <Suspense fallback={<LazyFallback />}><TraderProfile /></Suspense>
      </Route>
      <Route path="/app/trader/aeo">
        <Suspense fallback={<LazyFallback />}><TraderAEO /></Suspense>
      </Route>
      <Route path="/app/trader/aeo-self-assessment">
        <Suspense fallback={<LazyFallback />}><AeoSelfAssessment /></Suspense>
      </Route>

      {/* Customs Officer Portal — B9: CustomsGuard wraps all /app/customs routes */}
      <Route path="/app/customs"><CustomsGuard><CustomsDashboard /></CustomsGuard></Route>
      <Route path="/app/customs/queue"><CustomsGuard><CustomsDashboard /></CustomsGuard></Route>
      <Route path="/app/customs/declarations/:id"><CustomsGuard><DeclarationDetail /></CustomsGuard></Route>
      <Route path="/app/customs/vision"><CustomsGuard><VisionAnalysis /></CustomsGuard></Route>
      <Route path="/app/customs/vision-batch">
        <CustomsGuard><Suspense fallback={<LazyFallback />}><VisionBatchAnalysis /></Suspense></CustomsGuard>
      </Route>
      <Route path="/app/customs/risk">
        <CustomsGuard><Suspense fallback={<LazyFallback />}><CustomsRisk /></Suspense></CustomsGuard>
      </Route>
      <Route path="/app/customs/payments">
        <CustomsGuard><Suspense fallback={<LazyFallback />}><MojaloopPayments /></Suspense></CustomsGuard>
      </Route>
      <Route path="/app/trader/payments">
        <Suspense fallback={<LazyFallback />}><MojaloopPayments /></Suspense>
      </Route>
      <Route path="/app/customs/workflows">
        <Suspense fallback={<LazyFallback />}><TemporalWorkflows /></Suspense>
      </Route>

      {/* OGA Portal */}
      <Route path="/app/oga" component={OGAPortal} />
      <Route path="/app/nl-query">{() => <Suspense fallback={<LazyFallback />}><NLFinancialQuery /></Suspense>}</Route>
      <Route path="/app/oga/expiry-calendar" component={OGAExpiryCalendar} />

      {/* Admin Console — B9: AdminGuard wraps all /app/admin routes */}
      <Route path="/app/admin"><AdminGuard><AdminConsole /></AdminGuard></Route>
      <Route path="/app/admin/kyc-review"><AdminGuard><AdminKYCReview /></AdminGuard></Route>
      <Route path="/app/admin/users">
        <AdminGuard><Suspense fallback={<LazyFallback />}><AdminUsers /></Suspense></AdminGuard>
      </Route>
      <Route path="/app/admin/declarations">
        <AdminGuard><Suspense fallback={<LazyFallback />}><AdminDeclarations /></Suspense></AdminGuard>
      </Route>
      <Route path="/app/admin/aeo">
        <AdminGuard><Suspense fallback={<LazyFallback />}><AdminAEO /></Suspense></AdminGuard>
      </Route>
      <Route path="/app/admin/analytics">
        <AdminGuard><Suspense fallback={<LazyFallback />}><AdminAnalytics /></Suspense></AdminGuard>
      </Route>

      {/* Security Operations Center — B9: SecurityGuard wraps all /app/security routes */}
      <Route path="/app/security"><SecurityGuard><SecurityOps /></SecurityGuard></Route>
      <Route path="/app/security/sanctions">
        <SecurityGuard><Suspense fallback={<LazyFallback />}><SanctionsScreening /></Suspense></SecurityGuard>
      </Route>

      {/* Geospatial */}
      <Route path="/app/geo/heatmap" component={PortHeatmap} />
      <Route path="/app/geo/congestion-forecast">
        <Suspense fallback={<LazyFallback />}><PortCongestionForecast /></Suspense>
      </Route>
      <Route path="/app/secure-chain">
        <Suspense fallback={<LazyFallback />}><SecureChain /></Suspense>
      </Route>

      {/* Notifications */}
      {/* Legacy /app/notifications → redirect to Notification Centre */}
      <Route path="/app/notifications">
        <Redirect to="/app/notification-centre" />
      </Route>

      {/* Finance Dashboard — B9: FinanceGuard wraps all /app/finance routes */}
      <Route path="/app/finance">
        <FinanceGuard><Suspense fallback={<LazyFallback />}><Finance /></Suspense></FinanceGuard>
      </Route>
      {/* Post-Clearance Audit */}
      <Route path="/app/customs/audit">
        <Suspense fallback={<LazyFallback />}><PostClearanceAudit /></Suspense>
      </Route>

      {/* Duty Drawback */}
      <Route path="/app/trader/drawback">
        <Suspense fallback={<LazyFallback />}><DutyDrawback /></Suspense>
      </Route>
      <Route path="/app/finance/drawback">
        <FinanceGuard><Suspense fallback={<LazyFallback />}><DutyDrawback /></Suspense></FinanceGuard>
      </Route>
      {/* Sprint 60 — Drawback Automation */}
      <Route path="/app/finance/drawback-automation">
        <FinanceGuard><Suspense fallback={<LazyFallback />}><DrawbackAutomation /></Suspense></FinanceGuard>
      </Route>
      {/* 1B Payments/Day — Async Payment Queue */}
      <Route path="/app/trader/payment-queue">
        <Suspense fallback={<LazyFallback />}><PaymentQueue /></Suspense>
      </Route>
      <Route path="/app/finance/payment-queue">
        <FinanceGuard><Suspense fallback={<LazyFallback />}><PaymentQueue /></Suspense></FinanceGuard>
      </Route>
      {/* Balance Accounts — Payment Mirror */}
      <Route path="/app/finance/balance-accounts">
        <FinanceGuard><Suspense fallback={<LazyFallback />}><BalanceAccounts /></Suspense></FinanceGuard>
      </Route>
      {/* Sprint 61 — Trader Performance Scorecard */}
      <Route path="/app/trader/scorecard">
        <Suspense fallback={<LazyFallback />}><TraderScorecard /></Suspense>
      </Route>

      {/* Knowledge Graph Explorer */}
      <Route path="/app/knowledge-graph">
        <Suspense fallback={<LazyFallback />}><KnowledgeGraph /></Suspense>
      </Route>

      {/* Fraud Network Visualisation */}
      <Route path="/app/admin/fraud-network">
        <Suspense fallback={<LazyFallback />}><FraudNetwork /></Suspense>
      </Route>

      {/* Fraud Cases & Risk Alerts */}
      <Route path="/app/admin/fraud-cases">
        <Suspense fallback={<LazyFallback />}><FraudCases /></Suspense>
      </Route>
      <Route path="/app/admin/risk-alerts">
        <Suspense fallback={<LazyFallback />}><RiskAlerts /></Suspense>
      </Route>

      {/* Trader Certificate Archive */}
      <Route path="/app/trader/certificates">
        <Suspense fallback={<LazyFallback />}><MyCertificates /></Suspense>
      </Route>

      {/* Officer Workload Dashboard */}
      <Route path="/app/admin/officer-workload">
        <Suspense fallback={<LazyFallback />}><OfficerWorkload /></Suspense>
      </Route>

      {/* Notification Centre (Sprint 15) */}
      <Route path="/app/notification-centre">
        <Suspense fallback={<LazyFallback />}><NotificationCentre /></Suspense>
      </Route>

      {/* Notification Preferences (Sprint 19) */}
      <Route path="/app/notification-preferences">
        <Suspense fallback={<LazyFallback />}><NotificationPreferences /></Suspense>
      </Route>

      {/* SLA Breach Escalation (Sprint 15) */}
      <Route path="/app/admin/sla-breach">
        <Suspense fallback={<LazyFallback />}><SLABreachDashboard /></Suspense>
      </Route>

      {/* AI Assistant */}
      <Route path="/app/ai-assistant" component={AIAssistant} />
      <Route path="/app/document-vault" component={DocumentVault} />
      <Route path="/share/:token" component={ShareLanding} />

      {/* Sprint 31 — Finance Ledger (TigerBeetle) */}
      <Route path="/app/finance/ledger">
        <FinanceGuard><Suspense fallback={<LazyFallback />}><FinanceLedger /></Suspense></FinanceGuard>
      </Route>

      {/* WP-6 — Trade Finance rail (consents, application wizard, status) */}
      <Route path="/app/finance/trade/consents">
        <Suspense fallback={<LazyFallback />}><TradeFinanceConsents /></Suspense>
      </Route>
      <Route path="/app/finance/trade/apply">
        <Suspense fallback={<LazyFallback />}><TradeFinanceApply /></Suspense>
      </Route>
      <Route path="/app/finance/trade/status">
        <Suspense fallback={<LazyFallback />}><TradeFinanceStatus /></Suspense>
      </Route>

      {/* Sprint 32 — Identity Provider (Keycloak) */}
      <Route path="/app/admin/identity-provider">
        <Suspense fallback={<LazyFallback />}><IdentityProvider /></Suspense>
      </Route>

      {/* Sprint 37 — Bonded Warehouse Management */}
      <Route path="/app/port/bonded-warehouse">
        <Suspense fallback={<LazyFallback />}><BondedWarehouse /></Suspense>
      </Route>

      {/* Sprint 38 — ASEAN Single Window G2G */}
      <Route path="/app/admin/asean-sw">
        <Suspense fallback={<LazyFallback />}><AseanSingleWindow /></Suspense>
      </Route>

      {/* Sprint 39 — WCO CEN Alerts */}
      <Route path="/app/security/cen-alerts">
        <SecurityGuard><Suspense fallback={<LazyFallback />}><WcoCenAlerts /></Suspense></SecurityGuard>
      </Route>

      {/* Sprint 40 — Free Zone Operations */}
      <Route path="/app/port/free-zone">
        <Suspense fallback={<LazyFallback />}><FreeZoneOps /></Suspense>
      </Route>

      {/* Sprint 41 — Developer Portal */}
      <Route path="/app/developer">
        <Suspense fallback={<LazyFallback />}><DeveloperPortal /></Suspense>
      </Route>
      {/* WP-8 — API Marketplace catalogue browser */}
      <Route path="/app/developer/marketplace">
        <Suspense fallback={<LazyFallback />}><Marketplace /></Suspense>
      </Route>
      {/* WP-8 — Executive operational KPI dashboard (real, provenance-stamped) */}
      <Route path="/app/executive/kpis">
        <Suspense fallback={<LazyFallback />}><OperationalKpis /></Suspense>
      </Route>
      <Route path="/app/security/threat-intel">
        <SecurityGuard><Suspense fallback={<LazyFallback />}><ThreatIntelligence /></Suspense></SecurityGuard>
      </Route>
      <Route path="/app/security/wazuh">
        <SecurityGuard><Suspense fallback={<LazyFallback />}><WazuhSecurityEvents /></Suspense></SecurityGuard>
      </Route>
      <Route path="/app/admin/risk-model">
        <AdminGuard><Suspense fallback={<LazyFallback />}><RiskModelDashboard /></Suspense></AdminGuard>
      </Route>
      <Route path="/app/analytics">
        <Suspense fallback={<LazyFallback />}><TradeAnalytics /></Suspense>
      </Route>
      <Route path="/app/admin/tenants">
        <Suspense fallback={<LazyFallback />}><TenantPortal /></Suspense>
      </Route>

      {/* Phase 8 — PCS Trader Portal */}
      <Route path="/app/pcs">
        <Suspense fallback={<LazyFallback />}><PcsConsignments /></Suspense>
      </Route>
      <Route path="/app/pcs/consignments/:id">
        {(params) => (
          <Suspense fallback={<LazyFallback />}><PcsConsignmentTimeline id={Number(params.id)} /></Suspense>
        )}
      </Route>
      <Route path="/app/pcs/bookings">
        <Suspense fallback={<LazyFallback />}><PcsBookings /></Suspense>
      </Route>
      <Route path="/app/pcs/billing">
        <Suspense fallback={<LazyFallback />}><PcsBilling /></Suspense>
      </Route>
      <Route path="/app/pcs/documents">
        <Suspense fallback={<LazyFallback />}><PcsDocuments /></Suspense>
      </Route>

      {/* Sprint 48 — Flink CEP Trade Pattern Alerts */}
      <Route path="/app/security/cep-alerts">
        <SecurityGuard><Suspense fallback={<LazyFallback />}><FlinkCepAlerts /></Suspense></SecurityGuard>
      </Route>

      {/* Sprint 49 — Kubecost Cost Management */}
      <Route path="/app/admin/costs">
        <Suspense fallback={<LazyFallback />}><CostManagement /></Suspense>
      </Route>

      {/* Sprint 54 — Wazuh SOC Dashboard */}
      <Route path="/app/security/soc">
        <SecurityGuard><Suspense fallback={<LazyFallback />}><SecurityOperationsCentre /></Suspense></SecurityGuard>
      </Route>

      {/* Sprint 55 — Audit Engine Dashboard */}
      <Route path="/app/admin/audit-engine">
        <AdminGuard><Suspense fallback={<LazyFallback />}><AuditEngineDashboard /></Suspense></AdminGuard>
      </Route>

      {/* Sprint 56 — Bonded Warehouse Management */}
      <Route path="/app/port/bonded-warehouse-mgmt">
        <Suspense fallback={<LazyFallback />}><BondedWarehouseManagement /></Suspense>
      </Route>

      {/* Sprint 66 — Cargo Tracking Real-Time Map */}
      <Route path="/app/geo/cargo-tracking">
        <Suspense fallback={<LazyFallback />}><CargoTrackingMap /></Suspense>
      </Route>

      {/* Sprint 67 — Trader Onboarding Wizard */}
      <Route path="/app/onboarding">
        <Suspense fallback={<LazyFallback />}><TraderOnboarding /></Suspense>
      </Route>

      {/* Sprint 68 — OpenAPI Explorer */}
      <Route path="/app/developer/api-explorer">
        <Suspense fallback={<LazyFallback />}><ApiExplorer /></Suspense>
      </Route>
      <Route path="/app/developer/sdk">
        <Suspense fallback={<LazyFallback />}><SdkGenerator /></Suspense>
      </Route>

      {/* Sprint 72-74 — Onboarding Analytics, Geofence Management, Webhook Management, API Changelog */}
      <Route path="/app/admin/onboarding-analytics">
        <Suspense fallback={<LazyFallback />}><OnboardingAnalyticsDashboard /></Suspense>
      </Route>
      <Route path="/app/admin/geofences">
        <Suspense fallback={<LazyFallback />}><GeofenceManagement /></Suspense>
      </Route>
      <Route path="/app/admin/webhooks">
        <Suspense fallback={<LazyFallback />}><WebhookManagement /></Suspense>
      </Route>
      <Route path="/app/developer/changelog">
        <Suspense fallback={<LazyFallback />}><ApiChangelog /></Suspense>
      </Route>
      {/* Sprint 78 — Rules of Origin, Pilot Dashboard, Executive Dashboard */}
      <Route path="/app/oga/rules-of-origin">
        <Suspense fallback={<LazyFallback />}><RulesOfOrigin /></Suspense>
      </Route>
      <Route path="/app/admin/pilot-dashboard">
        <Suspense fallback={<LazyFallback />}><PilotDashboard /></Suspense>
      </Route>
      <Route path="/app/executive/dashboard">
        <ExecutiveGuard><Suspense fallback={<LazyFallback />}><ExecutiveDashboard /></Suspense></ExecutiveGuard>
      </Route>
      <Route path="/app/executive-dashboard">
        <Suspense fallback={<LazyFallback />}><ExecutiveDashboard /></Suspense>
      </Route>
      {/* Sprint 86 — Compliance Email Settings */}
      <Route path="/app/admin/compliance-email-settings">
        <Suspense fallback={<LazyFallback />}><ComplianceEmailSettings /></Suspense>
      </Route>
      <Route path="/app/admin/go-live-checklist">
        <Suspense fallback={<LazyFallback />}><GoLiveChecklist /></Suspense>
      </Route>
      <Route path="/app/admin/service-health">
        <Suspense fallback={<LazyFallback />}><ServiceHealth /></Suspense>
      </Route>
      <Route path="/app/admin/audit-log">
        <Suspense fallback={<LazyFallback />}><AuditLog /></Suspense>
      </Route>
      <Route path="/app/admin/settings">
        <Suspense fallback={<LazyFallback />}><AdminSettings /></Suspense>
      </Route>
      {/* Sprint 83/84 — Certificate Revocation Audit Log */}
      <Route path="/app/admin/cert-revocations">
        <Suspense fallback={<LazyFallback />}><CertRevocationLog /></Suspense>
      </Route>
      {/* Production Readiness Checklist */}
      <Route path="/app/admin/production-checklist">
        <Suspense fallback={<LazyFallback />}><AdminProductionChecklist /></Suspense>
      </Route>
      {/* v31 — New production pages */}
      <Route path="/app/payments">
        <Suspense fallback={<LazyFallback />}><Payments /></Suspense>
      </Route>
      <Route path="/app/trader/payments-new">
        <Suspense fallback={<LazyFallback />}><Payments /></Suspense>
      </Route>
      <Route path="/app/aeo/applications">
        <Suspense fallback={<LazyFallback />}><AEOApplications /></Suspense>
      </Route>
      <Route path="/app/admin/bulk-export">
        <Suspense fallback={<LazyFallback />}><BulkExport /></Suspense>
      </Route>
      <Route path="/app/developer/webhooks">
        <Suspense fallback={<LazyFallback />}><WebhookLogs /></Suspense>
      </Route>
      <Route path="/app/security/alerts">
        <SecurityGuard><Suspense fallback={<LazyFallback />}><SecurityAlerts /></Suspense></SecurityGuard>
      </Route>
      <Route path="/app/admin/tenants-mgmt">
        <Suspense fallback={<LazyFallback />}><TenantManagement /></Suspense>
      </Route>
      <Route path="/app/admin/tenant-branding">
        <AdminGuard><Suspense fallback={<LazyFallback />}><TenantBranding /></Suspense></AdminGuard>
      </Route>
      <Route path="/app/admin/workload-rebalancer">
        <AdminGuard><Suspense fallback={<LazyFallback />}><OfficerWorkloadRebalancer /></Suspense></AdminGuard>
      </Route>
      <Route path="/app/onboarding/progress">
        <Suspense fallback={<LazyFallback />}><OnboardingProgress /></Suspense>
      </Route>

      {/* v67 — Insider Threat Prevention */}
      <Route path="/app/security/monitor">
        <AdminGuard><Suspense fallback={<LazyFallback />}><SecurityMonitor /></Suspense></AdminGuard>
      </Route>
      <Route path="/app/admin/batch-seed">
        <AdminGuard><Suspense fallback={<LazyFallback />}><AdminBatchSeed /></Suspense></AdminGuard>
      </Route>

      {/* v79 — Kafka Event Log, KYC Timeline, OGA Audit Trail */}
      <Route path="/app/admin/kafka-event-log">
        <AdminGuard><Suspense fallback={<LazyFallback />}><KafkaEventLog /></Suspense></AdminGuard>
      </Route>
      <Route path="/app/admin/oga-permit-audit">
        <AdminGuard><Suspense fallback={<LazyFallback />}><OGAPermitAuditTrail /></Suspense></AdminGuard>
      </Route>

      {/* v81 — Temporal Runs, WAF Events, Lakehouse Jobs */}
      <Route path="/app/admin/temporal-runs">
        <AdminGuard><Suspense fallback={<LazyFallback />}><TemporalWorkflowRuns /></Suspense></AdminGuard>
      </Route>
      <Route path="/app/admin/waf-events">
        <AdminGuard><Suspense fallback={<LazyFallback />}><WafEvents /></Suspense></AdminGuard>
      </Route>
      <Route path="/app/admin/lakehouse-jobs">
        <AdminGuard><Suspense fallback={<LazyFallback />}><LakehouseJobs /></Suspense></AdminGuard>
      </Route>
      <Route path="/app/admin/geoip-seed">
        <AdminGuard><Suspense fallback={<LazyFallback />}><GeoipSeed /></Suspense></AdminGuard>
      </Route>
      <Route path="/app/admin/fluvio-offsets">
        <AdminGuard><Suspense fallback={<LazyFallback />}><FluvioTopicOffsets /></Suspense></AdminGuard>
      </Route>
      <Route path="/app/admin/apisix-audit">
        <AdminGuard><Suspense fallback={<LazyFallback />}><ApisixRouteAudit /></Suspense></AdminGuard>
      </Route>
      <Route path="/app/admin/keycloak-sessions">
        <AdminGuard><Suspense fallback={<LazyFallback />}><KeycloakSessions /></Suspense></AdminGuard>
      </Route>
      <Route path="/app/admin/permify-audit">
        <AdminGuard><Suspense fallback={<LazyFallback />}><PermifyAuditLog /></Suspense></AdminGuard>
      </Route>
      <Route path="/app/admin/platform-health">
        <AdminGuard><Suspense fallback={<LazyFallback />}><PlatformHealthScorecard /></Suspense></AdminGuard>
      </Route>
      {/* v131 — Cron Job Manager & System Status */}
      <Route path="/app/admin/cron-jobs">
        <AdminGuard><Suspense fallback={<LazyFallback />}><CronJobManager /></Suspense></AdminGuard>
      </Route>
      <Route path="/app/admin/system-status">
        <AdminGuard><Suspense fallback={<LazyFallback />}><AdminSystemStatus /></Suspense></AdminGuard>
      </Route>
      {/* Sprint Caddy — Keycloak + Caddy Admin */}
      <Route path="/app/admin/keycloak">
        <AdminGuard><Suspense fallback={<LazyFallback />}><KeycloakAdmin /></Suspense></AdminGuard>
      </Route>
      {/* Sprint Caddy — Coraza WAF Rule Tuning Dashboard */}
      <Route path="/app/admin/coraza-waf">
        <AdminGuard><Suspense fallback={<LazyFallback />}><CorazaWafDashboard /></Suspense></AdminGuard>
      </Route>
      {/* Sprint Caddy v4 — Heartbeat Job Manager */}
      <Route path="/app/admin/heartbeat-admin">
        <AdminGuard><Suspense fallback={<LazyFallback />}><HeartbeatAdmin /></Suspense></AdminGuard>
      </Route>

      {/* v136 sprint routes */}
      <Route path="/app/admin/threshold-audit-log">
        <AdminGuard><Suspense fallback={<LazyFallback />}><ThresholdAuditLog /></Suspense></AdminGuard>
      </Route>
      <Route path="/app/admin/sanctions-batch">
        <AdminGuard><Suspense fallback={<LazyFallback />}><SanctionsBatchUpload /></Suspense></AdminGuard>
      </Route>
      <Route path="/app/admin/oga-bulk-approve">
        <AdminGuard><Suspense fallback={<LazyFallback />}><OGABulkApprove /></Suspense></AdminGuard>
      </Route>
      <Route path="/app/admin/post-clearance-scheduler">
        <AdminGuard><Suspense fallback={<LazyFallback />}><PostClearanceAuditScheduler /></Suspense></AdminGuard>
      </Route>
      <Route path="/app/finance/export-schedules">
        <FinanceGuard><Suspense fallback={<LazyFallback />}><ExportScheduleManager /></Suspense></FinanceGuard>
      </Route>
      <Route path="/app/trader/aeo-renewal">
        <Suspense fallback={<LazyFallback />}><AEORenewalWorkflow /></Suspense>
      </Route>
      <Route path="/app/admin/aeo-renewal">
        <AdminGuard><Suspense fallback={<LazyFallback />}><AEORenewalWorkflow /></Suspense></AdminGuard>
      </Route>

      {/* 404 */}
      <Route path="/404" component={NotFound} />
              <Route path="/app/aeo-comments/:renewalId" component={AEORenewalComments} />
        <Route path="/admin/sanctions-entities" component={SanctionsEntitiesPage} />
        <Route path="/app/schedule-analytics" component={ScheduleAnalyticsPage} />
        <Route path="/admin/batch-reports" component={BatchValidationReportPage} />
        <Route path="/app/ucr">{() => <Suspense fallback={<LazyFallback />}><UCRManagement /></Suspense>}</Route>
        <Route path="/app/manifests">{() => <Suspense fallback={<LazyFallback />}><ManifestManagement /></Suspense>}</Route>
        <Route path="/app/trade-analytics">{() => <Suspense fallback={<LazyFallback />}><TradeAnalyticsDashboard /></Suspense>}</Route>
        <Route path="/app/ncs-nrs">{() => <Suspense fallback={<LazyFallback />}><NCSNRSDashboard /></Suspense>}</Route>
        <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider defaultTheme="light">
        <TooltipProvider>
          <Toaster />
          <OfflineBanner />
          <DemoModeBanner />
          <InstallPrompt />
          <Router />
          <MobileBottomNav />
        </TooltipProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

export default App;
