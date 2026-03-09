import { useAuth } from "@/_core/hooks/useAuth";
import { useOnboardingRedirect } from "@/hooks/useOnboardingRedirect";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
  useSidebar,
} from "@/components/ui/sidebar";
import { getLoginUrl } from "@/const";
import LanguageSwitcher from "@/components/LanguageSwitcher";
import { useIsMobile } from "@/hooks/useMobile";
import { trpc } from "@/lib/trpc";
import {
  AlertTriangle,
  BarChart3,
  Bell,
  BookOpen,
  Building2,
  Camera,
  CheckCircle,
  ClipboardList,
  FileText,
  Fingerprint,
  Globe,
  LayoutDashboard,
  LogOut,
  PanelLeft,
  Settings,
  Shield,
  ShieldCheck,
  Users,
  Sparkles,
  Anchor,
  Map,
  CreditCard,
  Workflow,
  UserCheck,
  Package,
  ClipboardCheck,
  RotateCcw,
  Network,
  GitFork,
  Award,
  Timer,
  CalendarClock,
  FolderLock,
  KeyRound,
  Coins,
  Warehouse,
  Radio,
  Code2,
  ShieldAlert,
  Activity,
  Brain,
  BarChart2,
  Zap,
  DollarSign,
} from "lucide-react";
import { CSSProperties, useEffect, useRef, useState } from "react";
import { useLocation } from "wouter";
import { DashboardLayoutSkeleton } from "./DashboardLayoutSkeleton";
import { Button } from "./ui/button";

// ─── ROLE-BASED NAVIGATION ────────────────────────────────────────────────────

type NavItem = {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  path: string;
  badge?: string;
};

type NavGroup = {
  label: string;
  items: NavItem[];
};

function getNavGroups(role: string): NavGroup[] {
  const common: NavGroup = {
    label: "General",
    items: [
      { icon: Bell, label: "Notification Centre", path: "/app/notification-centre" },
      { icon: Settings, label: "Notification Preferences", path: "/app/notification-preferences" },
    ],
  };

  if (role === "admin") {
    return [
      {
        label: "Administration",
        items: [
          { icon: LayoutDashboard, label: "Overview", path: "/app/admin" },
          { icon: Users, label: "Staff & Accounts", path: "/app/admin/users" },
          { icon: ClipboardList, label: "All Shipment Declarations", path: "/app/admin/declarations" },
          { icon: ShieldCheck, label: "Trusted Trader Programme", path: "/app/admin/aeo" },
          { icon: UserCheck, label: "Trader Verification", path: "/app/admin/kyc-review" },
          { icon: BarChart3, label: "Performance Reports", path: "/app/admin/analytics" },
        ],
      },
      {
        label: "Clearance Operations",
        items: [
          { icon: FileText, label: "Pending Declarations", path: "/app/customs" },
          { icon: AlertTriangle, label: "Risk Screening", path: "/app/customs/risk" },
          { icon: Camera, label: "Cargo Inspection", path: "/app/customs/vision" },
          { icon: CreditCard, label: "Duty Payments", path: "/app/customs/payments" },
          { icon: Workflow, label: "Clearance Workflows", path: "/app/customs/workflows" },
          { icon: ClipboardCheck, label: "Post-Clearance Review", path: "/app/customs/audit" },
        ],
      },
      {
        label: "Port & Trade Intelligence",
        items: [
          { icon: Anchor, label: "Port Activity Map", path: "/app/geo/heatmap" },
          { icon: Activity, label: "Congestion Forecast", path: "/app/geo/congestion-forecast" },
          { icon: Anchor, label: "Cargo Tracking Map", path: "/app/geo/cargo-tracking" },
        ],
      },
      {
        label: "Compliance & Security",
        items: [
          { icon: Shield, label: "Security Monitoring", path: "/app/security" },
          { icon: Globe, label: "Restricted Parties", path: "/app/security/sanctions" },
          { icon: Radio, label: "WCO CEN Alerts", path: "/app/security/cen-alerts" },
          { icon: ShieldAlert, label: "Threat Intelligence", path: "/app/security/threat-intel" },
          { icon: Activity, label: "Wazuh SIEM / XDR", path: "/app/security/wazuh" },
          { icon: Zap, label: "CEP Pattern Alerts", path: "/app/security/cep-alerts" },
          { icon: Shield, label: "SOC Dashboard", path: "/app/security/soc" },
        ],
      },
      {
        label: "Smart Tools",
        items: [
          { icon: Sparkles, label: "Trade Advisory Assistant", path: "/app/ai-assistant" },
          { icon: Network, label: "Entity Relationship Map", path: "/app/knowledge-graph" },
          { icon: GitFork, label: "Suspicious Activity Map", path: "/app/admin/fraud-network" },
        ],
      },
      {
        label: "Investigations",
        items: [
          { icon: AlertTriangle, label: "High-Risk Shipments", path: "/app/admin/risk-alerts" },
          { icon: Shield, label: "Investigation Cases", path: "/app/admin/fraud-cases" },
          { icon: Users, label: "Officer Workload", path: "/app/admin/officer-workload" },
          { icon: Timer, label: "SLA Breach Escalation", path: "/app/admin/sla-breach" },
        ],
      },
      {
        label: "Identity & Security",
        items: [
          { icon: KeyRound, label: "Identity Provider (Keycloak)", path: "/app/admin/identity-provider" },
          { icon: Globe, label: "ASEAN Single Window (G2G)", path: "/app/admin/asean-sw" },
        ],
      },
      {
        label: "Port Operations",
        items: [
          { icon: Warehouse, label: "Bonded Warehouse", path: "/app/port/bonded-warehouse" },
          { icon: Building2, label: "Free Zone Operations", path: "/app/port/free-zone" },
          { icon: Warehouse, label: "Bonded Warehouse Mgmt", path: "/app/port/bonded-warehouse-mgmt" },
        ],
      },
      {
        label: "Reference",
        items: [
          { icon: Brain, label: "Risk Model Dashboard", path: "/app/admin/risk-model" },
          { icon: BarChart2, label: "Trade Analytics", path: "/app/analytics" },
          { icon: Building2, label: "Tenant Portal", path: "/app/admin/tenants" },
          { icon: DollarSign, label: "Cost Management", path: "/app/admin/costs" },
          { icon: ClipboardCheck, label: "Audit Engine", path: "/app/admin/audit-engine" },
          { icon: Code2, label: "Developer Portal", path: "/app/developer" },
          { icon: Code2, label: "API Explorer", path: "/app/developer/api-explorer" },
          { icon: Package, label: "SDK Generator", path: "/app/developer/sdk" },
          { icon: GitFork, label: "API Changelog", path: "/app/developer/changelog" },
          { icon: Bell, label: "Webhook Management", path: "/app/admin/webhooks" },
          { icon: Map, label: "Geofence Alerts", path: "/app/admin/geofences" },
          { icon: BarChart3, label: "Onboarding Analytics", path: "/app/admin/onboarding-analytics" },
          { icon: Activity, label: "Apapa Pilot Dashboard", path: "/app/admin/pilot-dashboard" },
          { icon: BarChart2, label: "Executive Revenue Dashboard", path: "/app/executive-dashboard" },
          { icon: BookOpen, label: "Platform Specification", path: "/specification" },
        ],
      },
      common,
    ];
  }
  if (role === "customs_officer" || role === "inspector") {
    return [
      {
        label: "Clearance Operations",
        items: [
          { icon: LayoutDashboard, label: "My Workstation", path: "/app/customs" },
          { icon: FileText, label: "Pending Declarations", path: "/app/customs" },
          { icon: AlertTriangle, label: "Risk Screening", path: "/app/customs/risk" },
          { icon: Camera, label: "Cargo Inspection", path: "/app/customs/vision" },
          { icon: Package, label: "Agency Permits", path: "/app/oga" },
          { icon: ClipboardCheck, label: "Post-Clearance Review", path: "/app/customs/audit" },
        ],
      },
      {
        label: "Port & Trade Intelligence",
        items: [
          { icon: Anchor, label: "Port Activity Map", path: "/app/geo/heatmap" },
        ],
      },
      {
        label: "Smart Tools",
        items: [
          { icon: Sparkles, label: "Trade Advisory Assistant", path: "/app/ai-assistant" },
          { icon: Network, label: "Entity Relationship Map", path: "/app/knowledge-graph" },
          { icon: GitFork, label: "Suspicious Activity Map", path: "/app/admin/fraud-network" },
        ],
      },
      {
        label: "Investigations",
        items: [
          { icon: AlertTriangle, label: "High-Risk Shipments", path: "/app/admin/risk-alerts" },
          { icon: Shield, label: "Investigation Cases", path: "/app/admin/fraud-cases" },
          { icon: Users, label: "Officer Workload", path: "/app/admin/officer-workload" },
          { icon: Timer, label: "SLA Breach Escalation", path: "/app/admin/sla-breach" },
        ],
      },
      common,
    ];
  }
  if (role === "oga_officer") {
    return [
      {
        label: "Permit Operations",
        items: [
          { icon: LayoutDashboard, label: "My Workstation", path: "/app/oga" },
          { icon: Package, label: "Pending Permit Requests", path: "/app/oga" },
          { icon: CalendarClock, label: "Expiry Calendar", path: "/app/oga/expiry-calendar" },
          { icon: FileText, label: "Related Declarations", path: "/app/customs" },
          { icon: Globe, label: "Rules of Origin (AfCFTA)", path: "/app/oga/rules-of-origin" },
        ],
      },
      {
        label: "Smart Tools",
        items: [
          { icon: Sparkles, label: "Trade Advisory Assistant", path: "/app/ai-assistant" },
        ],
      },
      common,
    ];
  }
  if (role === "finance") {
    return [
      {
        label: "Revenue & Finance",
        items: [
          { icon: LayoutDashboard, label: "Revenue Overview", path: "/app/finance" },
          { icon: CreditCard, label: "Duty Collections", path: "/app/customs/payments" },
          { icon: BarChart3, label: "Revenue Reports", path: "/app/finance" },
          { icon: RotateCcw, label: "Duty Refunds", path: "/app/finance/drawback" },
          { icon: RotateCcw, label: "Drawback Automation", path: "/app/finance/drawback-automation" },
          { icon: Coins, label: "Ledger (TigerBeetle)", path: "/app/finance/ledger" },
          { icon: Map, label: "Port Activity Map", path: "/app/geo/heatmap" },
          { icon: BarChart2, label: "Executive Dashboard", path: "/app/executive-dashboard" },
        ],
      },
      common,
    ];
  }

  // Default: trader view
  return [
    {
      label: "My Trade Portal",
      items: [
        { icon: LayoutDashboard, label: "My Overview", path: "/app/trader" },
        { icon: FileText, label: "My Shipment Declarations", path: "/app/trader/declarations" },
        { icon: Award, label: "My Clearance Certificates", path: "/app/trader/certificates" },
        { icon: FolderLock, label: "Document Vault", path: "/app/document-vault" },
        { icon: Building2, label: "My Business Profile", path: "/app/trader/profile" },
        { icon: ShieldCheck, label: "Trusted Trader Status", path: "/app/trader/aeo" },
        { icon: Award, label: "AEO Self-Assessment", path: "/app/trader/aeo-self-assessment" },
        { icon: BarChart3, label: "Performance Scorecard", path: "/app/trader/scorecard" },
        { icon: RotateCcw, label: "Duty Refund Requests", path: "/app/trader/drawback" },
        { icon: Fingerprint, label: "Identity Verification", path: "/app/trader/kyc" },
        { icon: Anchor, label: "Cargo Tracking Map", path: "/app/geo/cargo-tracking" },
        { icon: CheckCircle, label: "Account Setup Wizard", path: "/app/onboarding" },
      ],
    },
    {
      label: "Reference",
      items: [
        { icon: BookOpen, label: "Specification", path: "/specification" },
      ],
    },
    common,
  ];
}

// ─── SIDEBAR WIDTH PERSISTENCE ────────────────────────────────────────────────

const SIDEBAR_WIDTH_KEY = "sidebar-width";
const DEFAULT_WIDTH = 260;
const MIN_WIDTH = 200;
const MAX_WIDTH = 360;

// ─── MAIN LAYOUT ──────────────────────────────────────────────────────────────

export default function DashboardLayout({
  children,
  title,
}: {
  children: React.ReactNode;
  title?: string;
}) {
  const [sidebarWidth, setSidebarWidth] = useState(() => {
    const saved = localStorage.getItem(SIDEBAR_WIDTH_KEY);
    return saved ? parseInt(saved, 10) : DEFAULT_WIDTH;
  });
  const { loading, user } = useAuth();

  useEffect(() => {
    localStorage.setItem(SIDEBAR_WIDTH_KEY, sidebarWidth.toString());
  }, [sidebarWidth]);

  if (loading) return <DashboardLayoutSkeleton />;

  if (!user) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-background">
        <div className="flex flex-col items-center gap-8 p-8 max-w-md w-full">
          <div className="w-16 h-16 rounded-2xl bg-primary flex items-center justify-center">
            <Shield className="h-8 w-8 text-primary-foreground" />
          </div>
          <div className="flex flex-col items-center gap-3 text-center">
            <h1 className="text-2xl font-semibold tracking-tight">Sign in to continue</h1>
            <p className="text-sm text-muted-foreground max-w-sm">
              Access to TradeGateway NGSWTP requires authentication. Sign in with your registered account.
            </p>
          </div>
          <Button
            onClick={() => { window.location.href = getLoginUrl(); }}
            size="lg"
            className="w-full"
          >
            Sign in to TradeGateway
          </Button>
        </div>
      </div>
    );
  }

  return (
    <SidebarProvider
      style={{ "--sidebar-width": `${sidebarWidth}px` } as CSSProperties}
    >
      <DashboardLayoutContent setSidebarWidth={setSidebarWidth} title={title}>
        {children}
      </DashboardLayoutContent>
    </SidebarProvider>
  );
}

// ─── LAYOUT CONTENT ───────────────────────────────────────────────────────────

function DashboardLayoutContent({
  children,
  setSidebarWidth,
  title,
}: {
  children: React.ReactNode;
  setSidebarWidth: (width: number) => void;
  title?: string;
}) {
  const { user, logout } = useAuth();
  const [location, setLocation] = useLocation();
  // Sprint 69: first-login redirect to onboarding wizard
  const { hasCompletedOnboarding } = useOnboardingRedirect();
  const isTraderRole = user?.role === "user";
  const showOnboardingBanner = isTraderRole && !hasCompletedOnboarding && location !== "/app/onboarding";
  const { state, toggleSidebar } = useSidebar();
  const isCollapsed = state === "collapsed";
  const [isResizing, setIsResizing] = useState(false);
  const sidebarRef = useRef<HTMLDivElement>(null);
  const isMobile = useIsMobile();

  const navGroups = getNavGroups(user?.role ?? "user");

  // Unread notifications count (Sprint 15 - uses userNotifications.getUnreadCount for efficiency)
  const { data: unreadData } = trpc.userNotifications.getUnreadCount.useQuery(
    undefined,
    { refetchInterval: 30000 }
  );
  const unreadCount = unreadData?.count ?? 0;

  useEffect(() => {
    if (isCollapsed) setIsResizing(false);
  }, [isCollapsed]);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isResizing) return;
      const sidebarLeft = sidebarRef.current?.getBoundingClientRect().left ?? 0;
      const newWidth = e.clientX - sidebarLeft;
      if (newWidth >= MIN_WIDTH && newWidth <= MAX_WIDTH) setSidebarWidth(newWidth);
    };
    const handleMouseUp = () => setIsResizing(false);

    if (isResizing) {
      document.addEventListener("mousemove", handleMouseMove);
      document.addEventListener("mouseup", handleMouseUp);
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
    }
    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
  }, [isResizing, setSidebarWidth]);

  const activeLabel = navGroups
    .flatMap(g => g.items)
    .find(i => location.startsWith(i.path))?.label ?? title ?? "TradeGateway";

  return (
    <>
      <div className="relative" ref={sidebarRef}>
        <Sidebar collapsible="icon" className="border-r" disableTransition={isResizing}>
          {/* Header */}
          <SidebarHeader className="h-16 justify-center border-b">
            <div className="flex items-center gap-3 px-2 w-full">
              <button
                onClick={toggleSidebar}
                className="h-8 w-8 flex items-center justify-center hover:bg-accent rounded-lg transition-colors focus:outline-none shrink-0"
                aria-label="Toggle navigation"
              >
                <PanelLeft className="h-4 w-4 text-muted-foreground" />
              </button>
              {!isCollapsed && (
                <div className="flex flex-col min-w-0">
                  <span className="font-bold text-sm tracking-tight text-primary truncate">
                    TradeGateway™
                  </span>
                  <span className="text-[10px] text-muted-foreground tracking-widest uppercase">
                    NGSWTP
                  </span>
                </div>
              )}
            </div>
          </SidebarHeader>

          {/* Navigation Groups */}
          <SidebarContent className="gap-0 overflow-y-auto">
            {navGroups.map(group => (
              <SidebarGroup key={group.label}>
                {!isCollapsed && (
                  <SidebarGroupLabel className="text-[10px] tracking-widest uppercase text-muted-foreground/70 px-3 py-2">
                    {group.label}
                  </SidebarGroupLabel>
                )}
                <SidebarMenu className="px-2">
                  {group.items.map(item => {
                    const isActive = location === item.path || (item.path !== "/" && location.startsWith(item.path));
                    return (
                      <SidebarMenuItem key={item.path}>
                        <SidebarMenuButton
                          isActive={isActive}
                          onClick={() => setLocation(item.path)}
                          tooltip={item.label}
                          className="h-9 transition-all font-normal"
                        >
                          <item.icon className={`h-4 w-4 shrink-0 ${isActive ? "text-primary" : "text-muted-foreground"}`} />
                          <span className="truncate">{item.label}</span>
                          {item.label === "Notification Centre" && unreadCount > 0 && (
                            <Badge variant="destructive" className="ml-auto h-5 min-w-5 text-[10px] px-1">
                              {unreadCount}
                            </Badge>
                          )}
                        </SidebarMenuButton>
                      </SidebarMenuItem>
                    );
                  })}
                </SidebarMenu>
              </SidebarGroup>
            ))}
          </SidebarContent>

          {/* Footer */}
          <SidebarFooter className="p-3 border-t">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className="flex items-center gap-3 rounded-lg px-2 py-2 hover:bg-accent/50 transition-colors w-full text-left focus:outline-none">
                  <Avatar className="h-8 w-8 border shrink-0">
                    <AvatarFallback className="text-xs font-semibold bg-primary text-primary-foreground">
                      {user?.name?.charAt(0).toUpperCase() ?? "U"}
                    </AvatarFallback>
                  </Avatar>
                  {!isCollapsed && (
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate leading-none">{user?.name || "User"}</p>
                      <p className="text-[11px] text-muted-foreground truncate mt-1">
                        {user?.role === "admin" ? "Administrator" : "Trader"}
                      </p>
                    </div>
                  )}
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-52">
                <div className="px-3 py-2">
                  <p className="text-sm font-medium">{user?.name}</p>
                  <p className="text-xs text-muted-foreground">{user?.email}</p>
                </div>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => setLocation("/app/trader/profile")} className="cursor-pointer">
                  <Settings className="mr-2 h-4 w-4" />
                  <span>Profile Settings</span>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={logout} className="cursor-pointer text-destructive focus:text-destructive">
                  <LogOut className="mr-2 h-4 w-4" />
                  <span>Sign out</span>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </SidebarFooter>
        </Sidebar>

        {/* Resize handle */}
        <div
          className={`absolute top-0 right-0 w-1 h-full cursor-col-resize hover:bg-primary/20 transition-colors ${isCollapsed ? "hidden" : ""}`}
          onMouseDown={() => { if (!isCollapsed) setIsResizing(true); }}
          style={{ zIndex: 50 }}
        />
      </div>

      <SidebarInset>
        {/* Mobile top bar */}
        {isMobile && (
          <div className="flex border-b h-14 items-center justify-between bg-background/95 px-4 backdrop-blur supports-[backdrop-filter]:backdrop-blur sticky top-0 z-40">
            <div className="flex items-center gap-3">
              <SidebarTrigger className="h-9 w-9 rounded-lg" />
              <span className="font-medium text-sm">{activeLabel}</span>
            </div>
            <div className="flex items-center gap-1">
              <LanguageSwitcher />
              <button
                onClick={() => setLocation("/app/notification-centre")}
                className="relative flex items-center justify-center h-9 w-9 rounded-lg hover:bg-muted transition-colors"
                aria-label={`Notifications${unreadCount > 0 ? ` (${unreadCount} unread)` : ""}`}
              >
                <Bell className="h-5 w-5" />
                {unreadCount > 0 && (
                  <span className="absolute -top-0.5 -right-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-destructive text-[9px] font-bold text-destructive-foreground">
                    {unreadCount > 99 ? "99+" : unreadCount}
                  </span>
                )}
              </button>
            </div>
          </div>
        )}
        {/* Sprint 69: Incomplete onboarding banner */}
        {showOnboardingBanner && (
          <div className="bg-amber-500/10 border-b border-amber-500/30 px-4 py-2.5 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-sm">
              <CheckCircle className="h-4 w-4 text-amber-500 shrink-0" />
              <span className="text-amber-700 dark:text-amber-400 font-medium">Complete your account setup</span>
              <span className="text-muted-foreground hidden sm:inline">— finish the onboarding wizard to unlock all features.</span>
            </div>
            <Button
              size="sm"
              variant="outline"
              className="shrink-0 h-7 text-xs border-amber-500/50 text-amber-700 dark:text-amber-400 hover:bg-amber-500/10"
              onClick={() => setLocation("/app/onboarding")}
            >
              Continue Setup
            </Button>
          </div>
        )}
        <main className="flex-1 p-4 md:p-6">{children}</main>
      </SidebarInset>
    </>
  );
}
