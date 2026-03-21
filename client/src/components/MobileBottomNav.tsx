/**
 * MobileBottomNav — Trader Portal mobile bottom navigation bar
 * Shown only on mobile (< 768px) for the trader role.
 * Provides quick access to the 5 most-used trader pages.
 */
import { useIsMobile } from "@/hooks/useMobile";
import { useAuth } from "@/_core/hooks/useAuth";
import { useLocation } from "wouter";
import { Bell, FileText, Home, Plus, Wallet } from "lucide-react";
import { trpc } from "@/lib/trpc";

const TRADER_NAV = [
  { path: "/app/trader", label: "Home", icon: Home },
  { path: "/app/trader/declarations", label: "Declarations", icon: FileText },
  { path: "/app/trader/declarations/new", label: "New", icon: Plus, accent: true },
  { path: "/app/trader/payments", label: "Payments", icon: Wallet },
  { path: "/app/notification-centre", label: "Alerts", icon: Bell },
];

export default function MobileBottomNav() {
  const isMobile = useIsMobile();
  const { user } = useAuth();
  const [location, setLocation] = useLocation();
  const { data: unreadData } = trpc.userNotifications.getUnreadCount.useQuery(
    undefined,
    { refetchInterval: 30000, enabled: isMobile && user?.role === "user" }
  );
  const unreadCount = unreadData?.count ?? 0;

  // Only show for traders on mobile
  if (!isMobile || user?.role !== "user") return null;

  return (
    <nav
      style={{
        position: "fixed",
        bottom: 0,
        left: 0,
        right: 0,
        height: 60,
        background: "oklch(0.145 0.005 240)",
        borderTop: "1px solid rgba(255,255,255,0.1)",
        display: "flex",
        alignItems: "stretch",
        zIndex: 60,
        paddingBottom: "env(safe-area-inset-bottom, 0px)",
      }}
    >
      {TRADER_NAV.map(({ path, label, icon: Icon, accent }) => {
        const isActive = location === path || (path !== "/app/trader" && location.startsWith(path));
        return (
          <button
            key={path}
            onClick={() => setLocation(path)}
            style={{
              flex: 1,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              gap: 3,
              border: "none",
              background: "transparent",
              cursor: "pointer",
              color: isActive
                ? "#F5D87A"
                : accent
                ? "rgba(255,255,255,0.9)"
                : "rgba(255,255,255,0.45)",
              position: "relative",
            }}
          >
            {accent ? (
              <div
                style={{
                  width: 40,
                  height: 40,
                  borderRadius: "50%",
                  background: "oklch(0.55 0.18 250)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  marginBottom: 2,
                }}
              >
                <Icon style={{ width: 20, height: 20, color: "#fff" }} />
              </div>
            ) : (
              <>
                <div style={{ position: "relative" }}>
                  <Icon style={{ width: 20, height: 20 }} />
                  {label === "Alerts" && unreadCount > 0 && (
                    <span
                      style={{
                        position: "absolute",
                        top: -4,
                        right: -6,
                        minWidth: 14,
                        height: 14,
                        borderRadius: 7,
                        background: "#ef4444",
                        color: "#fff",
                        fontSize: 9,
                        fontWeight: 700,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        padding: "0 3px",
                      }}
                    >
                      {unreadCount > 9 ? "9+" : unreadCount}
                    </span>
                  )}
                </div>
                <span style={{ fontSize: 10, fontWeight: isActive ? 600 : 400 }}>{label}</span>
              </>
            )}
          </button>
        );
      })}
    </nav>
  );
}
