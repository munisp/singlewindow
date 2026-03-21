/**
 * DemoModeBanner — shown when DEMO_MODE=true is active on the server.
 *
 * On first load it auto-creates a demo admin session so all dashboards are
 * immediately accessible. A floating banner lets the user switch between the
 * 6 demo roles (Trader, Customs Officer, OGA, Admin, Security Analyst, Developer).
 */
import { useEffect, useState, useCallback } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Badge } from "@/components/ui/badge";
import {
  UserCircle,
  ChevronDown,
  Loader2,
  FlaskConical,
} from "lucide-react";

type DemoRole = "trader" | "customs" | "oga" | "admin" | "security" | "developer";

const ROLE_LABELS: Record<DemoRole, { label: string; title: string; color: string }> = {
  trader:    { label: "Trader",           title: "Amara Diallo — Licensed Trader",          color: "bg-blue-500" },
  customs:   { label: "Customs Officer",  title: "Kwame Asante — Senior Customs Officer",   color: "bg-amber-500" },
  oga:       { label: "OGA Officer",      title: "Fatima Al-Hassan — OGA Permit Officer",   color: "bg-green-500" },
  admin:     { label: "Administrator",    title: "Chidi Okonkwo — Platform Administrator",  color: "bg-purple-500" },
  security:  { label: "Security Analyst", title: "Ngozi Eze — Security Analyst",            color: "bg-red-500" },
  developer: { label: "Developer",        title: "Tunde Adeyemi — API Developer",           color: "bg-cyan-500" },
};

async function createDemoSession(role: DemoRole): Promise<boolean> {
  try {
    const res = await fetch("/api/demo/session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ role }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export function useDemoMode() {
  const [isDemoMode, setIsDemoMode] = useState(false);
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    fetch("/api/demo/status", { credentials: "include" })
      .then((r) => r.ok ? r.json() : null)
      .then((data) => {
        if (data?.demoMode) setIsDemoMode(true);
      })
      .catch(() => {})
      .finally(() => setChecked(true));
  }, []);

  return { isDemoMode, checked };
}

export default function DemoModeBanner() {
  const { isDemoMode, checked } = useDemoMode();
  const [currentRole, setCurrentRole] = useState<DemoRole>("admin");
  const [switching, setSwitching] = useState(false);
  const utils = trpc.useUtils();

  // Auto-create demo session on first load
  useEffect(() => {
    if (!isDemoMode) return;
    createDemoSession("admin").then((ok) => {
      if (ok) utils.auth.me.invalidate();
    });
  }, [isDemoMode]);

  const switchRole = useCallback(async (role: DemoRole) => {
    setSwitching(true);
    const ok = await createDemoSession(role);
    if (ok) {
      setCurrentRole(role);
      await utils.auth.me.invalidate();
      // Redirect to the appropriate portal
      const portalMap: Record<DemoRole, string> = {
        trader:    "/app/trader",
        customs:   "/app/customs",
        oga:       "/app/oga",
        admin:     "/app/admin",
        security:  "/app/security",
        developer: "/app/developer",
      };
      window.location.href = portalMap[role];
    }
    setSwitching(false);
  }, [utils]);

  if (!checked || !isDemoMode) return null;

  const roleInfo = ROLE_LABELS[currentRole];

  return (
    <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2 bg-background/95 backdrop-blur border border-border rounded-full shadow-lg px-3 py-1.5">
      <FlaskConical className="h-3.5 w-3.5 text-amber-500 shrink-0" />
      <span className="text-xs font-medium text-muted-foreground">Demo Mode</span>
      <div className={`w-2 h-2 rounded-full shrink-0 ${roleInfo.color}`} />
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="sm" className="h-6 px-2 text-xs gap-1 rounded-full">
            {switching ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <>
                <UserCircle className="h-3 w-3" />
                {roleInfo.label}
                <ChevronDown className="h-3 w-3 opacity-50" />
              </>
            )}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="center" side="top" className="w-56 mb-1">
          <DropdownMenuLabel className="text-xs text-muted-foreground">Switch Demo Role</DropdownMenuLabel>
          <DropdownMenuSeparator />
          {(Object.entries(ROLE_LABELS) as [DemoRole, typeof ROLE_LABELS[DemoRole]][]).map(([role, info]) => (
            <DropdownMenuItem
              key={role}
              onClick={() => switchRole(role)}
              className="flex items-center gap-2 cursor-pointer"
            >
              <div className={`w-2 h-2 rounded-full shrink-0 ${info.color}`} />
              <div className="flex flex-col">
                <span className="text-xs font-medium">{info.label}</span>
                <span className="text-[10px] text-muted-foreground truncate max-w-[160px]">{info.title}</span>
              </div>
              {role === currentRole && (
                <Badge variant="secondary" className="ml-auto text-[10px] px-1 py-0">Active</Badge>
              )}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
