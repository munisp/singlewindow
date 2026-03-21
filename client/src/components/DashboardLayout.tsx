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
  Mail,
  Rocket,
  Server,
} from "lucide-react";
import { CSSProperties, useCallback, useEffect, useRef, useState } from "react";
import { useLocation } from "wouter";
import { DashboardLayoutSkeleton } from "./DashboardLayoutSkeleton";
import { Button } from "./ui/button";
import { useNotificationSocket } from "@/hooks/useNotificationSocket";
import { toast } from "sonner";

// ─── ROLE-BASED NAVIGATION ────────────────────────────────────────────────────

type NavItem = {
  icon: React.ComponentType<{ className?: string; style?: React.CSSProperties }>;
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
          { icon: Mail, label: "Compliance Email Settings", path: "/app/admin/compliance-email-settings" },
          { icon: Rocket, label: "Go-Live Checklist", path: "/app/admin/go-live-checklist" },
          { icon: Server, label: "Service Health", path: "/app/admin/service-health" },
          { icon: ClipboardList, label: "Audit Log", path: "/app/admin/audit-log" },
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
          { icon: FileText, label: "Declaration Queue", path: "/app/customs/queue" },
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
        { icon: CreditCard, label: "Duty Payments", path: "/app/trader/payments" },
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
const DEFAULT_WIDTH = 280;
const MIN_WIDTH = 220;
const MAX_WIDTH = 380;

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
      <DashboardLayoutContent sidebarWidth={sidebarWidth} setSidebarWidth={setSidebarWidth} title={title}>
        {children}
      </DashboardLayoutContent>
    </SidebarProvider>
  );
}

// ─── LAYOUT CONTENT ───────────────────────────────────────────────────────────

function DashboardLayoutContent({
  children,
  sidebarWidth,
  setSidebarWidth,
  title,
}: {
  children: React.ReactNode;
  sidebarWidth: number;
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
  const utils = trpc.useUtils();
  const { data: unreadData } = trpc.userNotifications.getUnreadCount.useQuery(
    undefined,
    { refetchInterval: 30000 }
  );
  const [liveUnreadCount, setLiveUnreadCount] = useState<number | null>(null);
  const unreadCount = liveUnreadCount ?? unreadData?.count ?? 0;

  // Sprint 63: Real-time WebSocket for live bell badge + toast notifications
  const handleWsNotification = useCallback((notif: { title: string; body: string }) => {
    utils.userNotifications.getUnreadCount.invalidate();
    utils.userNotifications.getMyNotifications.invalidate();
    toast.info(notif.title, {
      description: notif.body,
      duration: 5000,
      action: { label: "View", onClick: () => setLocation("/app/notification-centre") },
    });
  }, [utils, setLocation]);

  const handleWsUnreadCount = useCallback((count: number) => {
    setLiveUnreadCount(count);
  }, []);

  useNotificationSocket({
    onNotification: handleWsNotification,
    onUnreadCount: handleWsUnreadCount,
    enabled: !!user,
  });

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

  // Mobile sidebar open state (separate from collapsed state used on desktop)
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);

  // On mobile, toggle sidebar open/close; on desktop, collapse/expand
  const handleToggleSidebar = () => {
    if (isMobile) {
      setMobileSidebarOpen(v => !v);
    } else {
      toggleSidebar();
    }
  };

  // Close mobile sidebar on navigation
  useEffect(() => {
    if (isMobile) setMobileSidebarOpen(false);
  }, [location]);

  return (
    <>
      {/* Mobile sidebar backdrop overlay */}
      {isMobile && mobileSidebarOpen && (
        <div
          onClick={() => setMobileSidebarOpen(false)}
          style={{
            position: "fixed", inset: 0,
            background: "rgba(0,0,0,0.6)",
            zIndex: 49,
          }}
        />
      )}
      {/* ── CUSTOM SIDEBAR ── fully controlled, no shadcn overrides ── */}
      <div
        ref={sidebarRef}
        style={{
          position: isMobile ? "fixed" : "relative",
          left: isMobile ? (mobileSidebarOpen ? 0 : -280) : undefined,
          top: isMobile ? 0 : undefined,
          display: "flex",
          flexDirection: "column",
          width: isMobile ? 280 : (isCollapsed ? 56 : sidebarWidth),
          minWidth: isMobile ? 280 : (isCollapsed ? 56 : sidebarWidth),
          height: "100vh",
          background: "oklch(0.145 0.005 240)",
          borderRight: "1px solid rgba(255,255,255,0.08)",
          transition: isResizing ? "none" : "width 0.2s ease, left 0.25s ease",
          overflow: "hidden",
          flexShrink: 0,
          zIndex: 50,
        }}
      >
        {/* Header */}
        <div style={{
          height: 64,
          display: "flex",
          alignItems: "center",
          padding: "0 12px",
          borderBottom: "1px solid rgba(255,255,255,0.08)",
          gap: 10,
          flexShrink: 0,
        }}>
          <button
            onClick={toggleSidebar}
            style={{
              width: 32, height: 32, borderRadius: 8, border: "none",
              background: "transparent", cursor: "pointer",
              display: "flex", alignItems: "center", justifyContent: "center",
              color: "rgba(255,255,255,0.6)", flexShrink: 0,
            }}
            aria-label="Toggle navigation"
          >
            <PanelLeft style={{ width: 16, height: 16 }} />
          </button>
          {!isCollapsed && (
            <div style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
              <span style={{ fontWeight: 700, fontSize: 14, color: "#F5D87A", letterSpacing: "-0.01em", lineHeight: 1.3 }}>TradeGateway™</span>
              <span style={{ fontSize: 9, color: "rgba(255,255,255,0.4)", letterSpacing: "0.15em", textTransform: "uppercase" }}>NGSWTP</span>
            </div>
          )}
        </div>

        {/* Nav scroll area */}
        <div style={{ flex: 1, overflowY: "auto", overflowX: "hidden", padding: "4px 0" }}>
          {navGroups.map((group, gi) => (
            <div key={group.label} style={{ marginTop: gi > 0 ? 4 : 0 }}>
              {/* Section separator + label */}
              {!isCollapsed && (
                <div style={{
                  padding: gi > 0 ? "12px 16px 4px" : "8px 16px 4px",
                  borderTop: gi > 0 ? "1px solid rgba(255,255,255,0.07)" : "none",
                }}>
                  <span style={{
                    fontSize: 10,
                    fontWeight: 700,
                    letterSpacing: "0.12em",
                    textTransform: "uppercase",
                    color: "rgba(255,255,255,0.45)",
                    display: "block",
                  }}>{group.label}</span>
                </div>
              )}
              {/* Nav items */}
              <div style={{ padding: "2px 8px" }}>
                {group.items.map((item, ii) => {
                  const isActive = location === item.path || (item.path !== "/" && location.startsWith(item.path));
                  return (
                    <button
                      key={`${gi}-${ii}-${item.path}`}
                      onClick={() => setLocation(item.path)}
                      title={isCollapsed ? item.label : undefined}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 10,
                        width: "100%",
                        padding: isCollapsed ? "0 8px" : "0 10px",
                        height: 34,
                        borderRadius: 6,
                        border: "none",
                        borderLeft: isActive ? "3px solid #D4A017" : "3px solid transparent",
                        background: isActive ? "rgba(212,160,23,0.15)" : "transparent",
                        cursor: "pointer",
                        textAlign: "left",
                        marginBottom: 1,
                        transition: "background 0.15s",
                      }}
                      onMouseEnter={e => { if (!isActive) (e.currentTarget as HTMLButtonElement).style.background = "rgba(255,255,255,0.07)"; }}
                      onMouseLeave={e => { if (!isActive) (e.currentTarget as HTMLButtonElement).style.background = "transparent"; }}
                    >
                      <item.icon style={{
                        width: 15, height: 15, flexShrink: 0,
                        color: isActive ? "#D4A017" : "rgba(255,255,255,0.5)",
                      }} />
                      {!isCollapsed && (
                        <>
                          <span style={{
                            fontSize: 13,
                            fontWeight: isActive ? 600 : 400,
                            color: isActive ? "#F5D87A" : "rgba(255,255,255,0.88)",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                            flex: 1,
                            lineHeight: 1.4,
                          }}>{item.label}</span>
                          {item.label === "Notification Centre" && unreadCount > 0 && (
                            <Badge variant="destructive" style={{ marginLeft: "auto", height: 18, minWidth: 18, fontSize: 9, padding: "0 4px" }}>
                              {unreadCount}
                            </Badge>
                          )}
                        </>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>

        {/* Footer */}
        <div style={{
          borderTop: "1px solid rgba(255,255,255,0.08)",
          padding: 12,
          flexShrink: 0,
        }}>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button style={{
                display: "flex", alignItems: "center", gap: 10,
                width: "100%", padding: "6px 8px", borderRadius: 8,
                border: "none", background: "transparent", cursor: "pointer",
                textAlign: "left",
              }}>
                <Avatar className="h-8 w-8 border shrink-0">
                  <AvatarFallback className="text-xs font-semibold bg-primary text-primary-foreground">
                    {user?.name?.charAt(0).toUpperCase() ?? "U"}
                  </AvatarFallback>
                </Avatar>
                {!isCollapsed && (
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{ fontSize: 13, fontWeight: 500, color: "rgba(255,255,255,0.9)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", lineHeight: 1.3 }}>{user?.name || "User"}</p>
                    <p style={{ fontSize: 11, color: "rgba(255,255,255,0.45)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", marginTop: 2 }}>
                      {user?.role === "admin" ? "Administrator" : user?.role === "customs_officer" ? "Customs Officer" : user?.role === "oga_officer" ? "OGA Officer" : user?.role === "inspector" ? "Inspector" : user?.role === "finance" ? "Finance" : "Trader"}
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
        </div>

        {/* Resize handle */}
        {!isCollapsed && (
          <div
            style={{
              position: "absolute", top: 0, right: 0,
              width: 4, height: "100%",
              cursor: "col-resize", zIndex: 50,
            }}
            onMouseDown={() => setIsResizing(true)}
          />
        )}
      </div>

      {/* Main content area */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0, height: "100vh", overflow: "auto" }}>
        {/* Mobile top bar */}
        {isMobile && (
          <div className="flex border-b h-14 items-center justify-between bg-background/95 px-4 backdrop-blur supports-[backdrop-filter]:backdrop-blur sticky top-0 z-40">
            <div className="flex items-center gap-3">
              <button onClick={handleToggleSidebar} className="h-9 w-9 rounded-lg flex items-center justify-center hover:bg-muted transition-colors">
                <PanelLeft className="h-5 w-5" />
              </button>
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
        {/* Incomplete onboarding banner */}
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
        <main style={{ flex: 1, padding: isMobile ? "12px" : "24px", paddingBottom: isMobile ? "72px" : "24px" }}>{children}</main>
      </div>
    </>
  );
}
