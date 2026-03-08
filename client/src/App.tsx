import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/NotFound";
import { Route, Switch } from "wouter";
import ErrorBoundary from "./components/ErrorBoundary";
import { ThemeProvider } from "./contexts/ThemeContext";
import Home from "./pages/Home";
import TraderDashboard from "./pages/app/TraderDashboard";
import NewDeclaration from "./pages/app/NewDeclaration";
import CustomsDashboard from "./pages/app/CustomsDashboard";
import OGAPortal from "./pages/app/OGAPortal";
import AdminConsole from "./pages/app/AdminConsole";
import SecurityOps from "./pages/app/SecurityOps";
import DeclarationDetail from "./pages/app/DeclarationDetail";
import KYCPortal from "./pages/app/KYCPortal";
import VisionAnalysis from "./pages/app/VisionAnalysis";
import AIAssistant from "./pages/app/AIAssistant";
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

      {/* Notifications */}
      <Route path="/app/notifications">
        <Suspense fallback={<LazyFallback />}><Notifications /></Suspense>
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

      {/* Knowledge Graph Explorer */}
      <Route path="/app/knowledge-graph">
        <Suspense fallback={<LazyFallback />}><KnowledgeGraph /></Suspense>
      </Route>

      {/* AI Assistant */}
      <Route path="/app/ai-assistant" component={AIAssistant} />

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
