/**
 * TradeGateway NGSWTP — Mobile Drawer Navigation
 * Design: Sovereign Blueprint — deep navy + gold, Playfair Display headings
 *
 * Slide-in drawer with all 20 section links for mobile devices.
 * Accessible: focus trap, ESC to close, aria-label, role=dialog.
 */

import { useState, useEffect, useRef } from "react";
import { Menu, X, ChevronRight } from "lucide-react";
import { useI18n } from "@/contexts/I18nContext";

interface NavItem {
  label: string;
  href: string;
  group: string;
}

export default function MobileDrawer() {
  const { t } = useI18n();
  const [isOpen, setIsOpen] = useState(false);
  const drawerRef = useRef<HTMLDivElement>(null);
  const firstFocusRef = useRef<HTMLButtonElement>(null);

  const navItems: NavItem[] = [
    { label: t.nav_research, href: "#research", group: "Research" },
    { label: t.nav_architecture, href: "#architecture", group: "Architecture" },
    { label: t.nav_process, href: "#process", group: "Architecture" },
    { label: t.nav_oga_map, href: "#oga-map", group: "Architecture" },
    { label: t.nav_implementation, href: "#implementation", group: "Implementation" },
    { label: t.nav_gap_analysis, href: "#gap-analysis", group: "Implementation" },
    { label: "Temporal Workflow", href: "#temporal-workflow", group: "Implementation" },
    { label: t.nav_sg_comparison, href: "#comparison", group: "Analysis" },
    { label: t.nav_cost, href: "#cost", group: "Planning" },
    { label: t.nav_roadmap, href: "#roadmap", group: "Planning" },
    { label: t.nav_governance, href: "#governance", group: "Planning" },
    { label: t.nav_simulator, href: "#simulator", group: "Interactive" },
    { label: t.nav_api, href: "#api-playground", group: "Interactive" },
    { label: t.nav_hs_lookup, href: "#hs-lookup", group: "Interactive" },
    { label: t.nav_oga_sla, href: "#oga-sla", group: "Interactive" },
    { label: t.nav_payment, href: "#mojaloop-demo", group: "Interactive" },
    { label: t.nav_k8s, href: "#k8s-map", group: "Infrastructure" },
    { label: t.nav_security, href: "#security", group: "Infrastructure" },
  ];

  const groups = Array.from(new Set(navItems.map((i) => i.group)));

  const openDrawer = () => {
    setIsOpen(true);
    document.body.style.overflow = "hidden";
  };

  const closeDrawer = () => {
    setIsOpen(false);
    document.body.style.overflow = "";
  };

  const handleNavClick = (href: string) => {
    closeDrawer();
    setTimeout(() => {
      const el = document.querySelector(href);
      if (el) el.scrollIntoView({ behavior: "smooth" });
    }, 300);
  };

  // Close on ESC
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isOpen) closeDrawer();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isOpen]);

  // Focus first element when drawer opens
  useEffect(() => {
    if (isOpen && firstFocusRef.current) {
      firstFocusRef.current.focus();
    }
  }, [isOpen]);

  return (
    <>
      {/* Hamburger Button — only visible on mobile */}
      <button
        onClick={openDrawer}
        aria-label="Open navigation menu"
        className="md:hidden flex items-center justify-center w-9 h-9 rounded-lg bg-slate-800/60 hover:bg-slate-700/60 text-slate-300 hover:text-white transition-colors"
      >
        <Menu className="w-5 h-5" />
      </button>

      {/* Backdrop */}
      {isOpen && (
        <div
          className="fixed inset-0 z-[60] bg-black/60 backdrop-blur-sm md:hidden"
          onClick={closeDrawer}
          aria-hidden="true"
        />
      )}

      {/* Drawer Panel */}
      <div
        ref={drawerRef}
        role="dialog"
        aria-modal="true"
        aria-label="Navigation menu"
        className={`fixed top-0 left-0 z-[70] h-full w-[300px] bg-[#060F1E] border-r border-white/10 shadow-2xl transform transition-transform duration-300 ease-in-out md:hidden ${
          isOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        {/* Drawer Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/10">
          <div>
            <div className="font-['Playfair_Display'] text-base font-bold text-[#D4A017]">TradeGateway™</div>
            <div className="text-xs text-slate-500">NGSWTP</div>
          </div>
          <button
            ref={firstFocusRef}
            onClick={closeDrawer}
            aria-label="Close navigation menu"
            className="w-8 h-8 flex items-center justify-center rounded-lg bg-slate-800/60 hover:bg-slate-700/60 text-slate-400 hover:text-white transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Nav Items by Group */}
        <div className="overflow-y-auto h-[calc(100%-64px)] py-4 px-3">
          {groups.map((group) => (
            <div key={group} className="mb-5">
              <div className="text-[10px] font-bold text-slate-600 uppercase tracking-widest px-3 mb-2">
                {group}
              </div>
              <div className="space-y-0.5">
                {navItems
                  .filter((item) => item.group === group)
                  .map((item) => (
                    <button
                      key={item.href}
                      onClick={() => handleNavClick(item.href)}
                      className="w-full flex items-center justify-between px-3 py-2.5 rounded-lg text-slate-300 hover:text-white hover:bg-white/5 transition-colors text-sm text-left group"
                    >
                      <span>{item.label}</span>
                      <ChevronRight className="w-3.5 h-3.5 text-slate-600 group-hover:text-[#D4A017] transition-colors" />
                    </button>
                  ))}
              </div>
            </div>
          ))}

          {/* Footer */}
          <div className="mt-6 px-3 pt-4 border-t border-white/5">
            <div className="text-xs text-slate-600 leading-relaxed">
              TradeGateway™ NGSWTP v2.0<br />
              Go · Python · Rust · Kubernetes<br />
              Mojaloop · TigerBeetle · Temporal
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
