/**
 * TradeGateway NGSWTP — Language Toggle Component
 * Supports: English (en), French (fr), Swahili (sw)
 */

import { useI18n, Language } from "@/contexts/I18nContext";
import { Globe } from "lucide-react";

const LANGUAGE_OPTIONS: { code: Language; label: string; flag: string; native: string }[] = [
  { code: "en", label: "English", flag: "🇬🇧", native: "English" },
  { code: "fr", label: "French", flag: "🇫🇷", native: "Français" },
  { code: "sw", label: "Swahili", flag: "🇰🇪", native: "Kiswahili" },
];

export default function LanguageToggle() {
  const { language, setLanguage } = useI18n();

  return (
    <div className="flex items-center gap-1 bg-[#0A1628]/80 border border-slate-700/50 rounded-lg p-1">
      <Globe className="w-3.5 h-3.5 text-slate-400 ml-1" />
      {LANGUAGE_OPTIONS.map((opt) => (
        <button
          key={opt.code}
          onClick={() => setLanguage(opt.code)}
          title={opt.label}
          className={`flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-medium transition-all ${
            language === opt.code
              ? "bg-[#D4A017] text-[#0A1628] font-bold"
              : "text-slate-400 hover:text-white hover:bg-white/5"
          }`}
        >
          <span>{opt.flag}</span>
          <span className="hidden sm:inline">{opt.native}</span>
          <span className="sm:hidden uppercase">{opt.code}</span>
        </button>
      ))}
    </div>
  );
}
