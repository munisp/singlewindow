/**
 * Sprint 62 — Language Switcher Component
 * Dropdown for switching between EN, FR, AR with RTL support.
 */
import { useTranslation } from "react-i18next";
import { SUPPORTED_LANGUAGES, applyDocumentDirection } from "@/i18n";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { Globe } from "lucide-react";

export default function LanguageSwitcher() {
  const { i18n, t } = useTranslation();

  const currentLang = SUPPORTED_LANGUAGES.find((l) => l.code === i18n.language)
    ?? SUPPORTED_LANGUAGES[0];

  const handleChange = (code: string) => {
    i18n.changeLanguage(code);
    applyDocumentDirection(code);
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" className="gap-2 text-sm">
          <Globe className="w-4 h-4" />
          <span>{currentLang.label}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-[140px]">
        {SUPPORTED_LANGUAGES.map((lang) => (
          <DropdownMenuItem
            key={lang.code}
            onClick={() => handleChange(lang.code)}
            className={`cursor-pointer ${lang.dir === "rtl" ? "text-right" : ""} ${
              i18n.language === lang.code ? "font-semibold text-primary" : ""
            }`}
          >
            {lang.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
