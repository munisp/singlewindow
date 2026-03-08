import { useAuth } from "@/_core/hooks/useAuth";
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
      { icon: Bell, label: "Notifications", path: "/app/notifications" },
    ],
  };

  if (role === "admin") {
    return [
      {
        label: "Administration",
        items: [
          { icon: LayoutDashboard, label: "Admin Dashboard", path: "/app/admin" },
          { icon: Users, label: "User Management", path: "/app/admin/users" },
          { icon: ClipboardList, label: "All Declarations", path: "/app/admin/declarations" },
          { icon: ShieldCheck, label: "AEO Management", path: "/app/admin/aeo" },
          { icon: BarChart3, label: "Analytics", path: "/app/admin/analytics" },
        ],
      },
      {
        label: "Customs Operations",
        items: [
          { icon: FileText, label: "Declaration Queue", path: "/app/customs" },
          { icon: AlertTriangle, label: "Risk Assessment", path: "/app/customs/risk" },
          { icon: Camera, label: "Vision Analysis", path: "/app/customs/vision" },
        ],
      },
      {
        label: "Security",
        items: [
          { icon: Shield, label: "Security Ops", path: "/app/security" },
          { icon: Globe, label: "Sanctions Screening", path: "/app/security/sanctions" },
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

  // Default: trader view
  return [
    {
      label: "Trade Operations",
      items: [
        { icon: LayoutDashboard, label: "My Dashboard", path: "/app/trader" },
        { icon: FileText, label: "My Declarations", path: "/app/trader/declarations" },
        { icon: Building2, label: "My Profile", path: "/app/trader/profile" },
        { icon: ShieldCheck, label: "AEO Application", path: "/app/trader/aeo" },
        { icon: Fingerprint, label: "KYC Verification", path: "/app/trader/kyc" },
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
  const { state, toggleSidebar } = useSidebar();
  const isCollapsed = state === "collapsed";
  const [isResizing, setIsResizing] = useState(false);
  const sidebarRef = useRef<HTMLDivElement>(null);
  const isMobile = useIsMobile();

  const navGroups = getNavGroups(user?.role ?? "user");

  // Unread notifications count
  const { data: notifications } = trpc.notifications.list.useQuery(
    { limit: 20 },
    { refetchInterval: 30000 }
  );
  const unreadCount = notifications?.filter((n: any) => !n.read).length ?? 0;

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
                          {item.label === "Notifications" && unreadCount > 0 && (
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
            {unreadCount > 0 && (
              <Badge variant="destructive" className="h-5 text-[10px]">{unreadCount}</Badge>
            )}
          </div>
        )}
        <main className="flex-1 p-4 md:p-6">{children}</main>
      </SidebarInset>
    </>
  );
}
