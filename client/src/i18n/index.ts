import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import LanguageDetector from "i18next-browser-languagedetector";

import enTranslation from "./locales/en/translation.json";
import frTranslation from "./locales/fr/translation.json";
import arTranslation from "./locales/ar/translation.json";

export const SUPPORTED_LANGUAGES = [
  { code: "en", label: "English", dir: "ltr" as const },
  { code: "fr", label: "Français", dir: "ltr" as const },
  { code: "ar", label: "العربية", dir: "rtl" as const },
];

export const RTL_LANGUAGES = new Set(["ar"]);

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: {
      en: { translation: enTranslation },
      fr: { translation: frTranslation },
      ar: { translation: arTranslation },
    },
    fallbackLng: "en",
    supportedLngs: ["en", "fr", "ar"],
    interpolation: {
      escapeValue: false, // React already escapes
    },
    detection: {
      order: ["localStorage", "navigator"],
      caches: ["localStorage"],
      lookupLocalStorage: "tradegateway_lang",
    },
  });

/** Apply RTL direction to document root when language changes */
export function applyDocumentDirection(lang: string) {
  const dir = RTL_LANGUAGES.has(lang) ? "rtl" : "ltr";
  document.documentElement.setAttribute("dir", dir);
  document.documentElement.setAttribute("lang", lang);
}

i18n.on("languageChanged", applyDocumentDirection);

export default i18n;
