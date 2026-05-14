/**
 * OfflineBanner — Directive 11: Offline / low-bandwidth resilience
 *
 * Shows a persistent banner when the browser loses network connectivity.
 * Automatically dismisses when connectivity is restored.
 * Uses the browser's `online`/`offline` events + `navigator.onLine`.
 */
import { useEffect, useState } from "react";
import { WifiOff, Wifi } from "lucide-react";

export default function OfflineBanner() {
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [justReconnected, setJustReconnected] = useState(false);

  useEffect(() => {
    const handleOnline = () => {
      setIsOnline(true);
      setJustReconnected(true);
      // Auto-dismiss the "reconnected" banner after 3 seconds
      setTimeout(() => setJustReconnected(false), 3000);
    };
    const handleOffline = () => {
      setIsOnline(false);
      setJustReconnected(false);
    };

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  if (isOnline && !justReconnected) return null;

  if (!isOnline) {
    return (
      <div
        role="alert"
        aria-live="assertive"
        className="fixed top-0 left-0 right-0 z-[9999] flex items-center justify-center gap-2 bg-red-600 text-white text-sm font-medium py-2 px-4 shadow-lg"
      >
        <WifiOff size={16} className="shrink-0" />
        <span>
          You are offline. Some features may be unavailable. Data will sync when connectivity is restored.
        </span>
      </div>
    );
  }

  // Just reconnected — show green confirmation banner briefly
  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed top-0 left-0 right-0 z-[9999] flex items-center justify-center gap-2 bg-green-600 text-white text-sm font-medium py-2 px-4 shadow-lg"
    >
      <Wifi size={16} className="shrink-0" />
      <span>Connection restored. Syncing latest data…</span>
    </div>
  );
}
