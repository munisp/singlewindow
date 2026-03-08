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

// Lazy-load the specification page (it's large)
import { lazy, Suspense } from "react";
const Specification = lazy(() => import("./pages/Specification"));

function Router() {
  return (
    <Switch>
      {/* Public landing page */}
      <Route path="/" component={Home} />

      {/* Architecture specification (all 29 interactive components) */}
      <Route path="/specification">
        <Suspense fallback={<div className="min-h-screen flex items-center justify-center text-muted-foreground">Loading specification...</div>}>
          <Specification />
        </Suspense>
      </Route>

      {/* Trader Portal */}
      <Route path="/app/trader" component={TraderDashboard} />
      <Route path="/app/trader/new" component={NewDeclaration} />

      {/* Customs Officer Portal */}
      <Route path="/app/customs" component={CustomsDashboard} />

      {/* OGA Portal */}
      <Route path="/app/oga" component={OGAPortal} />

      {/* Admin Console */}
      <Route path="/app/admin" component={AdminConsole} />

      {/* Security Operations Center */}
      <Route path="/app/security" component={SecurityOps} />

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
