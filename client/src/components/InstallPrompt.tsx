/**
 * InstallPrompt — PWA install UX (WCAG 2.1 AA)
 *
 * Captures the browser's `beforeinstallprompt` event and surfaces a
 * dismissible, non-blocking banner. Choice is remembered for 14 days so
 * dismissing is respected. No fake success: if the native prompt is
 * unavailable (iOS Safari), we show honest manual-install instructions.
 */
import { useEffect, useState } from "react";
import { Download, X, Share } from "lucide-react";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

const DISMISS_KEY = "tg_install_dismissed_at";
const DISMISS_TTL_MS = 14 * 24 * 60 * 60 * 1000;

function isDismissed(): boolean {
  try {
    const at = localStorage.getItem(DISMISS_KEY);
    return at ? Date.now() - parseInt(at, 10) < DISMISS_TTL_MS : false;
  } catch {
    return false;
  }
}

function isIos(): boolean {
  if (typeof navigator === "undefined") return false;
  return /iphone|ipad|ipod/i.test(navigator.userAgent);
}

function isInStandaloneMode(): boolean {
  if (typeof window === "undefined") return false;
  return (
    window.matchMedia?.("(display-mode: standalone)").matches ||
    (navigator as unknown as { standalone?: boolean }).standalone === true
  );
}

export default function InstallPrompt() {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [visible, setVisible] = useState(false);
  const [showIosHelp, setShowIosHelp] = useState(false);

  useEffect(() => {
    if (isInStandaloneMode() || isDismissed()) return;
    const handler = (e: Event) => {
      e.preventDefault();
      setDeferred(e as BeforeInstallPromptEvent);
      setVisible(true);
    };
    window.addEventListener("beforeinstallprompt", handler);
    // iOS Safari never fires beforeinstallprompt — offer manual guidance once
    if (isIos()) setVisible(true);
    return () => window.removeEventListener("beforeinstallprompt", handler);
  }, []);

  if (!visible) return null;

  const dismiss = () => {
    setVisible(false);
    try {
      localStorage.setItem(DISMISS_KEY, String(Date.now()));
    } catch {
      /* ignore */
    }
  };

  const install = async () => {
    if (!deferred) {
      setShowIosHelp(true);
      return;
    }
    try {
      await deferred.prompt();
      const choice = await deferred.userChoice;
      if (choice.outcome === "accepted") setVisible(false);
    } catch {
      // Prompt failed (e.g. already installed) — hide rather than fake success
      setVisible(false);
    } finally {
      setDeferred(null);
    }
  };

  return (
    <div
      role="region"
      aria-label="Install TradeGateway app"
      className="fixed bottom-20 md:bottom-6 left-1/2 -translate-x-1/2 z-40 w-[calc(100%-2rem)] max-w-md"
    >
      <div className="flex items-start gap-3 rounded-xl border border-[#24384F] bg-[#101F33] p-4 shadow-xl text-[#E8E4DA]">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[#D4A017] font-bold text-[#0A1628]" aria-hidden="true">
          TG
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold">Install TradeGateway</p>
          <p className="mt-0.5 text-xs text-[#A8B4C4]">
            Faster access, offline shell, and queued submissions when connectivity drops.
          </p>
          {showIosHelp && (
            <p className="mt-2 rounded-md bg-[#0D1A2B] p-2 text-xs text-[#A8B4C4]">
              On this device: tap <Share className="inline h-3 w-3" aria-hidden="true" /> Share, then
              &ldquo;Add to Home Screen&rdquo;.
            </p>
          )}
          <div className="mt-3 flex gap-2">
            {!showIosHelp && (
              <button
                type="button"
                onClick={install}
                className="inline-flex items-center gap-1.5 rounded-lg bg-[#D4A017] px-3 py-1.5 text-xs font-semibold text-[#0A1628] hover:bg-[#E0B23A] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#E8C554]"
              >
                <Download className="h-3.5 w-3.5" aria-hidden="true" />
                Install
              </button>
            )}
            <button
              type="button"
              onClick={dismiss}
              className="rounded-lg px-3 py-1.5 text-xs text-[#A8B4C4] hover:text-[#E8E4DA] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#E8C554]"
            >
              Not now
            </button>
          </div>
        </div>
        <button
          type="button"
          onClick={dismiss}
          aria-label="Dismiss install prompt"
          className="rounded-md p-1 text-[#7A8798] hover:text-[#E8E4DA] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#E8C554]"
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}
