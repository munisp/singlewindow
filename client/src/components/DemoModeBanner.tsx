/**
 * DemoModeBanner — shown when DEMO_MODE=true is active on the server.
 *
 * A floating banner at the top-right lets the user switch between the
 * 6 demo roles (Trader, Customs Officer, OGA, Admin, Security Analyst, Developer).
 * It reads the current user's role from useAuth() to show the correct active badge.
 */
import { useEffect, useState, useCallback } from "react";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
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
  CheckCircle2,
} from "lucide-react";

type DemoRole = "trader" | "customs" | "oga" | "admin" | "security" | "developer";

const ROLE_CONFIG: Record<DemoRole, {
  label: string;
  name: string;
  title: string;
  color: string;
  dot: string;
  portal: string;
  appRole: string;
}> = {
  trader:    { label: "Trader",           name: "Amara Diallo",    title: "Licensed Trader",           color: "text-blue-400",   dot: "bg-blue-400",   portal: "/app/trader",    appRole: "user" },
  customs:   { label: "Customs Officer",  name: "Kwame Asante",    title: "Senior Customs Officer",    color: "text-amber-400",  dot: "bg-amber-400",  portal: "/app/customs",   appRole: "customs_officer" },
  oga:       { label: "OGA Officer",      name: "Fatima Al-Hassan",title: "OGA Permit Officer",        color: "text-green-400",  dot: "bg-green-400",  portal: "/app/oga",       appRole: "oga_officer" },
  admin:     { label: "Administrator",    name: "Chidi Okonkwo",   title: "Platform Administrator",    color: "text-purple-400", dot: "bg-purple-400", portal: "/app/admin",     appRole: "admin" },
  security:  { label: "Security Analyst", name: "Ngozi Eze",       title: "Trade Security Analyst",    color: "text-red-400",    dot: "bg-red-400",    portal: "/app/security",  appRole: "customs_officer" },
  developer: { label: "Developer",        name: "Tunde Adeyemi",   title: "API Developer",             color: "text-cyan-400",   dot: "bg-cyan-400",   portal: "/app/developer", appRole: "user" },
};

// Map open_id to demo role key
const OPEN_ID_TO_ROLE: Record<string, DemoRole> = {
  "demo-trader":    "trader",
  "demo-customs":   "customs",
  "demo-oga":       "oga",
  "demo-admin":     "admin",
  "demo-security":  "security",
  "demo-developer": "developer",
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
  const { user } = useAuth();
  const [switching, setSwitching] = useState(false);
  const [switchingTo, setSwitchingTo] = useState<DemoRole | null>(null);
  const utils = trpc.useUtils();

  // Derive current role from the logged-in user's open_id
  const currentRole: DemoRole = (user?.openId ? (OPEN_ID_TO_ROLE[user.openId] ?? "admin") : "admin");
  const roleInfo = ROLE_CONFIG[currentRole];

  const switchRole = useCallback(async (role: DemoRole) => {
    if (role === currentRole || switching) return;
    setSwitching(true);
    setSwitchingTo(role);
    const ok = await createDemoSession(role);
    if (ok) {
      await utils.auth.me.invalidate();
      window.location.href = ROLE_CONFIG[role].portal;
    }
    setSwitching(false);
    setSwitchingTo(null);
  }, [currentRole, switching, utils]);

  if (!checked || !isDemoMode) return null;

  return (
    <div
      style={{
        position: "fixed",
        top: 12,
        right: 16,
        zIndex: 9999,
        display: "flex",
        alignItems: "center",
        gap: 6,
        background: "rgba(10, 22, 40, 0.92)",
        backdropFilter: "blur(12px)",
        border: "1px solid rgba(212, 160, 23, 0.35)",
        borderRadius: 999,
        padding: "5px 10px 5px 8px",
        boxShadow: "0 4px 24px rgba(0,0,0,0.4)",
      }}
    >
      {/* Flask icon + label */}
      <FlaskConical style={{ width: 13, height: 13, color: "#D4A017", flexShrink: 0 }} />
      <span style={{ fontSize: 11, fontWeight: 600, color: "#D4A017", letterSpacing: "0.05em", textTransform: "uppercase" }}>
        Demo
      </span>

      {/* Divider */}
      <div style={{ width: 1, height: 14, background: "rgba(255,255,255,0.15)" }} />

      {/* Role dot */}
      <div style={{ width: 7, height: 7, borderRadius: "50%", background: roleInfo.dot.replace("bg-", ""), flexShrink: 0 }}
        className={roleInfo.dot}
      />

      {/* Role switcher dropdown */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            style={{
              display: "flex", alignItems: "center", gap: 5,
              background: "transparent", border: "none", cursor: "pointer",
              padding: "2px 4px", borderRadius: 6,
            }}
          >
            {switching ? (
              <Loader2 style={{ width: 12, height: 12, color: "rgba(255,255,255,0.7)" }} className="animate-spin" />
            ) : (
              <>
                <span style={{ fontSize: 12, fontWeight: 500, color: "rgba(255,255,255,0.9)", whiteSpace: "nowrap" }}>
                  {roleInfo.label}
                </span>
                <ChevronDown style={{ width: 11, height: 11, color: "rgba(255,255,255,0.45)" }} />
              </>
            )}
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="end"
          side="bottom"
          sideOffset={8}
          style={{ width: 240 }}
        >
          <DropdownMenuLabel style={{ fontSize: 10, letterSpacing: "0.08em", textTransform: "uppercase" }}>
            Switch Demo Persona
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          {(Object.entries(ROLE_CONFIG) as [DemoRole, typeof ROLE_CONFIG[DemoRole]][]).map(([role, info]) => {
            const isActive = role === currentRole;
            const isLoading = switchingTo === role;
            return (
              <DropdownMenuItem
                key={role}
                onClick={() => switchRole(role)}
                disabled={isActive || switching}
                style={{ cursor: isActive ? "default" : "pointer", opacity: isActive ? 1 : undefined }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 8, width: "100%" }}>
                  {isLoading ? (
                    <Loader2 style={{ width: 8, height: 8 }} className="animate-spin" />
                  ) : (
                    <div className={`w-2 h-2 rounded-full shrink-0 ${info.dot}`} />
                  )}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <span style={{ fontSize: 12, fontWeight: 500 }}>{info.label}</span>
                      {isActive && (
                        <CheckCircle2 style={{ width: 11, height: 11, color: "#22c55e", flexShrink: 0 }} />
                      )}
                    </div>
                    <p style={{ fontSize: 10, color: "var(--muted-foreground)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {info.name} — {info.title}
                    </p>
                  </div>
                  {isActive && (
                    <Badge variant="secondary" style={{ fontSize: 9, padding: "0 5px", height: 16, flexShrink: 0 }}>
                      Active
                    </Badge>
                  )}
                </div>
              </DropdownMenuItem>
            );
          })}
          <DropdownMenuSeparator />
          <div style={{ padding: "6px 8px" }}>
            <p style={{ fontSize: 10, color: "var(--muted-foreground)", lineHeight: 1.4 }}>
              Switching persona reloads the page and opens the corresponding portal dashboard.
            </p>
          </div>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
