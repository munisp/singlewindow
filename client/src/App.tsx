import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/NotFound";
import { Route, Switch, Redirect } from "wouter";
import ErrorBoundary from "./components/ErrorBoundary";
import { ThemeProvider } from "./contexts/ThemeContext";
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
const AdminUsers = lazy(() => import("./pages/app/AdminUsers"));
const AdminDeclarations = lazy(() => import("./pages/app/AdminDeclarations"));
const AdminAEO = lazy(() => import("./pages/app/AdminAEO"));
const AdminAnalytics = lazy(() => import("./pages/app/AdminAnalytics"));
const CustomsRisk = lazy(() => import("./pages/app/CustomsRisk"));
const TraderDeclarations = lazy(() => import("./pages/app/TraderDeclarations"));
const Notifications = lazy(() => import("./pages/app/Notifications"));
const Finance = lazy(() => import("./pages/app/Finance"));
const PostClearanceAudit = lazy(() => import("./pages/app/PostClearanceAudit"));
const DutyDrawback = lazy(() => import('./pages/app/DutyDrawback'));
const KnowledgeGraph = lazy(() => import('./pages/app/KnowledgeGraph'));
const FraudNetwork = lazy(() => import('./pages/app/FraudNetwork'));
const FraudCases = lazy(() => import('./pages/app/FraudCases'));
const RiskAlerts = lazy(() => import('./pages/app/RiskAlerts'));
const MyCertificates = lazy(() => import('./pages/app/MyCertificates'));
const OfficerWorkload = lazy(() => import('./pages/app/OfficerWorkload'));
const NotificationCentre = lazy(() => import('./pages/app/NotificationCentre'));
const SLABreachDashboard = lazy(() => import('./pages/app/SLABreachDashboard'));
const NotificationPreferences = lazy(() => import('./pages/app/NotificationPreferences'));
const FinanceLedger = lazy(() => import('./pages/FinanceLedger'));
const IdentityProvider = lazy(() => import('./pages/IdentityProvider'));
const BondedWarehouse = lazy(() => import('./pages/app/BondedWarehouse'));
const AseanSingleWindow = lazy(() => import('./pages/app/AseanSingleWindow'));
const WcoCenAlerts = lazy(() => import('./pages/app/WcoCenAlerts'));
const FreeZoneOps = lazy(() => import('./pages/app/FreeZoneOps'));
const DeveloperPortal = lazy(() => import('./pages/app/DeveloperPortal'));
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

const LazyFallback = () => (
  <div className="min-h-screen flex items-center justify-center text-muted-foreground">
    Loading...
  </div>
);

function Router() {
  return (
    <Switch>
      {/* Public landing page */}
      <Route path="/" component={Home} />

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

      {/* Customs Officer Portal */}
      <Route path="/app/customs" component={CustomsDashboard} />
      <Route path="/app/customs/declarations/:id" component={DeclarationDetail} />
      <Route path="/app/customs/vision" component={VisionAnalysis} />
      <Route path="/app/customs/risk">
        <Suspense fallback={<LazyFallback />}><CustomsRisk /></Suspense>
      </Route>
      <Route path="/app/customs/payments">
        <Suspense fallback={<LazyFallback />}><MojaloopPayments /></Suspense>
      </Route>
      <Route path="/app/customs/workflows">
        <Suspense fallback={<LazyFallback />}><TemporalWorkflows /></Suspense>
      </Route>

      {/* OGA Portal */}
      <Route path="/app/oga" component={OGAPortal} />
      <Route path="/app/oga/expiry-calendar" component={OGAExpiryCalendar} />

      {/* Admin Console */}
      <Route path="/app/admin" component={AdminConsole} />
      <Route path="/app/admin/kyc-review" component={AdminKYCReview} />
      <Route path="/app/admin/users">
        <Suspense fallback={<LazyFallback />}><AdminUsers /></Suspense>
      </Route>
      <Route path="/app/admin/declarations">
        <Suspense fallback={<LazyFallback />}><AdminDeclarations /></Suspense>
      </Route>
      <Route path="/app/admin/aeo">
        <Suspense fallback={<LazyFallback />}><AdminAEO /></Suspense>
      </Route>
      <Route path="/app/admin/analytics">
        <Suspense fallback={<LazyFallback />}><AdminAnalytics /></Suspense>
      </Route>

      {/* Security Operations Center */}
      <Route path="/app/security" component={SecurityOps} />
      <Route path="/app/security/sanctions">
        <Suspense fallback={<LazyFallback />}><SanctionsScreening /></Suspense>
      </Route>

      {/* Geospatial */}
      <Route path="/app/geo/heatmap" component={PortHeatmap} />
      <Route path="/app/geo/congestion-forecast">
        <Suspense fallback={<LazyFallback />}><PortCongestionForecast /></Suspense>
      </Route>

      {/* Notifications */}
      {/* Legacy /app/notifications → redirect to Notification Centre */}
      <Route path="/app/notifications">
        <Redirect to="/app/notification-centre" />
      </Route>

      {/* Finance Dashboard */}
      <Route path="/app/finance">
        <Suspense fallback={<LazyFallback />}><Finance /></Suspense>
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
        <Suspense fallback={<LazyFallback />}><DutyDrawback /></Suspense>
      </Route>
      {/* Sprint 60 — Drawback Automation */}
      <Route path="/app/finance/drawback-automation">
        <Suspense fallback={<LazyFallback />}><DrawbackAutomation /></Suspense>
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
        <Suspense fallback={<LazyFallback />}><FinanceLedger /></Suspense>
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
        <Suspense fallback={<LazyFallback />}><WcoCenAlerts /></Suspense>
      </Route>

      {/* Sprint 40 — Free Zone Operations */}
      <Route path="/app/port/free-zone">
        <Suspense fallback={<LazyFallback />}><FreeZoneOps /></Suspense>
      </Route>

      {/* Sprint 41 — Developer Portal */}
      <Route path="/app/developer">
        <Suspense fallback={<LazyFallback />}><DeveloperPortal /></Suspense>
      </Route>
      <Route path="/app/security/threat-intel">
        <Suspense fallback={<LazyFallback />}><ThreatIntelligence /></Suspense>
      </Route>
      <Route path="/app/security/wazuh">
        <Suspense fallback={<LazyFallback />}><WazuhSecurityEvents /></Suspense>
      </Route>
      <Route path="/app/admin/risk-model">
        <Suspense fallback={<LazyFallback />}><RiskModelDashboard /></Suspense>
      </Route>
      <Route path="/app/analytics">
        <Suspense fallback={<LazyFallback />}><TradeAnalytics /></Suspense>
      </Route>
      <Route path="/app/admin/tenants">
        <Suspense fallback={<LazyFallback />}><TenantPortal /></Suspense>
      </Route>

      {/* Sprint 48 — Flink CEP Trade Pattern Alerts */}
      <Route path="/app/security/cep-alerts">
        <Suspense fallback={<LazyFallback />}><FlinkCepAlerts /></Suspense>
      </Route>

      {/* Sprint 49 — Kubecost Cost Management */}
      <Route path="/app/admin/costs">
        <Suspense fallback={<LazyFallback />}><CostManagement /></Suspense>
      </Route>

      {/* Sprint 54 — Wazuh SOC Dashboard */}
      <Route path="/app/security/soc">
        <Suspense fallback={<LazyFallback />}><SecurityOperationsCentre /></Suspense>
      </Route>

      {/* Sprint 55 — Audit Engine Dashboard */}
      <Route path="/app/admin/audit-engine">
        <Suspense fallback={<LazyFallback />}><AuditEngineDashboard /></Suspense>
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

      {/* 404 */}
      <Route path="/404" component={NotFound} />
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
          <Router />
        </TooltipProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

export default App;
