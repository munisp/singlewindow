/**
 * TradeGateway NGSWTP — Internationalization Context
 * Supported languages: English (en), French (fr), Swahili (sw)
 *
 * Rwanda operates in French/Kinyarwanda, COMESA/EAC in English/French/Swahili
 * This demonstrates regional accessibility readiness for the platform.
 */

import { createContext, useContext, useState, ReactNode } from "react";

export type Language = "en" | "fr" | "sw";

export interface Translations {
  // Navigation
  nav_research: string;
  nav_architecture: string;
  nav_process: string;
  nav_oga_map: string;
  nav_cost: string;
  nav_governance: string;
  nav_security: string;
  nav_implementation: string;
  nav_gap_analysis: string;
  nav_sg_comparison: string;
  nav_simulator: string;
  nav_api: string;
  nav_roadmap: string;
  nav_hs_lookup: string;
  nav_oga_sla: string;
  nav_payment: string;
  nav_k8s: string;

  // Hero
  hero_badge: string;
  hero_title_1: string;
  hero_title_2: string;
  hero_subtitle: string;
  hero_stat_clearance: string;
  hero_stat_clearance_label: string;
  hero_stat_ogas: string;
  hero_stat_ogas_label: string;
  hero_stat_uptime: string;
  hero_stat_uptime_label: string;
  hero_stat_declarations: string;
  hero_stat_declarations_label: string;

  // Research section
  research_badge: string;
  research_title: string;
  research_subtitle: string;

  // Architecture
  arch_badge: string;
  arch_title: string;

  // Payment
  payment_badge: string;
  payment_title: string;
  payment_subtitle: string;
  payment_run_btn: string;
  payment_running_btn: string;
  payment_reset_btn: string;
  payment_complete: string;
  payment_lane: string;
  payment_clearance_time: string;
  payment_total_latency: string;

  // HS Lookup
  hs_badge: string;
  hs_title: string;
  hs_subtitle: string;
  hs_search_placeholder: string;
  hs_search_btn: string;
  hs_quick_search: string;
  hs_duty_rates: string;
  hs_required_permits: string;
  hs_bert_confidence: string;
  hs_risk_level: string;
  hs_trade_volume: string;
  hs_vat_rate: string;
  hs_prohibited: string;
  hs_restricted: string;

  // OGA SLA
  oga_badge: string;
  oga_title: string;
  oga_subtitle: string;
  oga_on_target: string;
  oga_at_risk: string;
  oga_breached: string;
  oga_avg_compliance: string;
  oga_pending: string;
  oga_refresh: string;

  // Governance
  gov_badge: string;
  gov_title: string;

  // Footer
  footer_tagline: string;
  footer_built_with: string;
  footer_version: string;

  // Common
  common_learn_more: string;
  common_view_details: string;
  common_download: string;
  common_export_pdf: string;
  common_loading: string;
  common_select_result: string;
  common_no_results: string;
}

const TRANSLATIONS: Record<Language, Translations> = {
  en: {
    nav_research: "Research",
    nav_architecture: "Architecture",
    nav_process: "Process Flow",
    nav_oga_map: "OGA Map",
    nav_cost: "Cost Calculator",
    nav_governance: "Governance",
    nav_security: "Security",
    nav_implementation: "Implementation",
    nav_gap_analysis: "Gap Analysis",
    nav_sg_comparison: "SG Comparison",
    nav_simulator: "Simulator",
    nav_api: "API Playground",
    nav_roadmap: "Roadmap",
    nav_hs_lookup: "HS Lookup",
    nav_oga_sla: "OGA SLA",
    nav_payment: "Payment Flow",
    nav_k8s: "K8s Map",
    hero_badge: "REVISED TECHNICAL SPECIFICATION · VERSION 2.0 · MARCH 2026",
    hero_title_1: "TradeGateway™",
    hero_title_2: "NGSWTP",
    hero_subtitle: "End-to-end implementation specification synthesized from Singapore NTP, Ghana ICUMS, and Rwanda ReSW — rebuilt on Go, Python, Mojaloop, TigerBeetle, and a comprehensive open-source cloud-native stack.",
    hero_stat_clearance: "< 4 Hours",
    hero_stat_clearance_label: "Green-lane clearance",
    hero_stat_ogas: "37+ OGAs",
    hero_stat_ogas_label: "Connected agencies",
    hero_stat_uptime: "99.99%",
    hero_stat_uptime_label: "Uptime SLA",
    hero_stat_declarations: "5M+",
    hero_stat_declarations_label: "Annual declarations",
    research_badge: "Comparative Research",
    research_title: "Built on Proven Foundations",
    research_subtitle: "The TradeGateway NGSWTP specification synthesizes 35+ years of single window implementation experience from three landmark platforms.",
    arch_badge: "System Architecture",
    arch_title: "Seven-Layer Cloud-Native Architecture",
    payment_badge: "Financial Architecture",
    payment_title: "Mojaloop + TigerBeetle Payment Flow",
    payment_subtitle: "Interactive walkthrough of the full ILP duty payment cycle — from tariff assessment through Mojaloop FSPIOP transfer to TigerBeetle two-phase ledger finalization and Ed25519-signed clearance permit issuance.",
    payment_run_btn: "Run Payment Flow",
    payment_running_btn: "Processing...",
    payment_reset_btn: "Reset",
    payment_complete: "Payment Complete",
    payment_lane: "Lane",
    payment_clearance_time: "Clearance Time",
    payment_total_latency: "Total Latency",
    hs_badge: "WCO Tariff Intelligence",
    hs_title: "HS Code Lookup & Duty Calculator",
    hs_subtitle: "Search the WCO Harmonized System 2022 tariff schedule. The BERT NLP classifier provides confidence scores for commodity classification, with duty rates across Kenya, Ghana, Rwanda, Singapore, and Nigeria.",
    hs_search_placeholder: "Search by HS code (e.g. 8471) or description (e.g. laptop, rice, petroleum)...",
    hs_search_btn: "Search",
    hs_quick_search: "Quick search:",
    hs_duty_rates: "Duty Rates by Country",
    hs_required_permits: "Required Agency Permits",
    hs_bert_confidence: "BERT Confidence",
    hs_risk_level: "Risk Level",
    hs_trade_volume: "Trade Volume",
    hs_vat_rate: "VAT Rate",
    hs_prohibited: "PROHIBITED",
    hs_restricted: "RESTRICTED",
    oga_badge: "Real-Time Monitoring",
    oga_title: "OGA SLA Dashboard",
    oga_subtitle: "Live SLA compliance monitoring for all 37+ government agencies, international systems, and financial institutions connected to the NGSWTP hub.",
    oga_on_target: "On Target",
    oga_at_risk: "At Risk",
    oga_breached: "Breached",
    oga_avg_compliance: "Avg Compliance",
    oga_pending: "Pending Requests",
    oga_refresh: "Refresh",
    gov_badge: "Legal & Governance",
    gov_title: "Governance & Legal Framework",
    footer_tagline: "Next Generation Single Window Trade Platform",
    footer_built_with: "Built with Go · Python · Rust · Kubernetes · Mojaloop · TigerBeetle",
    footer_version: "Version 2.0 — March 2026",
    common_learn_more: "Learn More",
    common_view_details: "View Details",
    common_download: "Download",
    common_export_pdf: "Export PDF",
    common_loading: "Loading...",
    common_select_result: "Select a Result",
    common_no_results: "No results found",
  },

  fr: {
    nav_research: "Recherche",
    nav_architecture: "Architecture",
    nav_process: "Flux de Processus",
    nav_oga_map: "Carte OGA",
    nav_cost: "Calculateur de Coûts",
    nav_governance: "Gouvernance",
    nav_security: "Sécurité",
    nav_implementation: "Implémentation",
    nav_gap_analysis: "Analyse des Écarts",
    nav_sg_comparison: "Comparaison SG",
    nav_simulator: "Simulateur",
    nav_api: "Terrain de Jeu API",
    nav_roadmap: "Feuille de Route",
    nav_hs_lookup: "Recherche SH",
    nav_oga_sla: "SLA OGA",
    nav_payment: "Flux de Paiement",
    nav_k8s: "Carte K8s",
    hero_badge: "SPÉCIFICATION TECHNIQUE RÉVISÉE · VERSION 2.0 · MARS 2026",
    hero_title_1: "TradeGateway™",
    hero_title_2: "NGSWTP",
    hero_subtitle: "Spécification d'implémentation de bout en bout synthétisée à partir de Singapore NTP, Ghana ICUMS et Rwanda ReSW — reconstruite sur Go, Python, Mojaloop, TigerBeetle et une pile cloud-native open source complète.",
    hero_stat_clearance: "< 4 Heures",
    hero_stat_clearance_label: "Dédouanement voie verte",
    hero_stat_ogas: "37+ OGA",
    hero_stat_ogas_label: "Agences connectées",
    hero_stat_uptime: "99.99%",
    hero_stat_uptime_label: "SLA de disponibilité",
    hero_stat_declarations: "5M+",
    hero_stat_declarations_label: "Déclarations annuelles",
    research_badge: "Recherche Comparative",
    research_title: "Construit sur des Fondations Éprouvées",
    research_subtitle: "La spécification TradeGateway NGSWTP synthétise plus de 35 ans d'expérience d'implémentation de guichet unique à partir de trois plateformes phares.",
    arch_badge: "Architecture Système",
    arch_title: "Architecture Cloud-Native à Sept Couches",
    payment_badge: "Architecture Financière",
    payment_title: "Flux de Paiement Mojaloop + TigerBeetle",
    payment_subtitle: "Parcours interactif du cycle complet de paiement des droits ILP — de l'évaluation tarifaire au transfert Mojaloop FSPIOP jusqu'à la finalisation du grand livre TigerBeetle en deux phases et l'émission du permis de dédouanement signé Ed25519.",
    payment_run_btn: "Lancer le Flux de Paiement",
    payment_running_btn: "Traitement en cours...",
    payment_reset_btn: "Réinitialiser",
    payment_complete: "Paiement Terminé",
    payment_lane: "Voie",
    payment_clearance_time: "Temps de Dédouanement",
    payment_total_latency: "Latence Totale",
    hs_badge: "Intelligence Tarifaire OMD",
    hs_title: "Recherche de Code SH et Calculateur de Droits",
    hs_subtitle: "Recherchez dans le calendrier tarifaire du Système Harmonisé OMD 2022. Le classificateur BERT NLP fournit des scores de confiance pour la classification des marchandises, avec des taux de droits pour le Kenya, le Ghana, le Rwanda, Singapour et le Nigeria.",
    hs_search_placeholder: "Rechercher par code SH (ex. 8471) ou description (ex. ordinateur, riz, pétrole)...",
    hs_search_btn: "Rechercher",
    hs_quick_search: "Recherche rapide :",
    hs_duty_rates: "Taux de Droits par Pays",
    hs_required_permits: "Permis d'Agence Requis",
    hs_bert_confidence: "Confiance BERT",
    hs_risk_level: "Niveau de Risque",
    hs_trade_volume: "Volume Commercial",
    hs_vat_rate: "Taux de TVA",
    hs_prohibited: "INTERDIT",
    hs_restricted: "RESTREINT",
    oga_badge: "Surveillance en Temps Réel",
    oga_title: "Tableau de Bord SLA OGA",
    oga_subtitle: "Surveillance de la conformité SLA en temps réel pour les 37+ agences gouvernementales, systèmes internationaux et institutions financières connectés au hub NGSWTP.",
    oga_on_target: "Dans les Délais",
    oga_at_risk: "À Risque",
    oga_breached: "Dépassé",
    oga_avg_compliance: "Conformité Moy.",
    oga_pending: "Demandes en Attente",
    oga_refresh: "Actualiser",
    gov_badge: "Juridique et Gouvernance",
    gov_title: "Cadre de Gouvernance et Juridique",
    footer_tagline: "Plateforme de Commerce à Guichet Unique de Nouvelle Génération",
    footer_built_with: "Construit avec Go · Python · Rust · Kubernetes · Mojaloop · TigerBeetle",
    footer_version: "Version 2.0 — Mars 2026",
    common_learn_more: "En Savoir Plus",
    common_view_details: "Voir les Détails",
    common_download: "Télécharger",
    common_export_pdf: "Exporter en PDF",
    common_loading: "Chargement...",
    common_select_result: "Sélectionner un Résultat",
    common_no_results: "Aucun résultat trouvé",
  },

  sw: {
    nav_research: "Utafiti",
    nav_architecture: "Usanifu",
    nav_process: "Mtiririko wa Mchakato",
    nav_oga_map: "Ramani ya OGA",
    nav_cost: "Kikokotoo cha Gharama",
    nav_governance: "Utawala",
    nav_security: "Usalama",
    nav_implementation: "Utekelezaji",
    nav_gap_analysis: "Uchambuzi wa Pengo",
    nav_sg_comparison: "Ulinganisho wa SG",
    nav_simulator: "Kisimulizi",
    nav_api: "Uwanja wa API",
    nav_roadmap: "Ramani ya Barabara",
    nav_hs_lookup: "Utafutaji wa HS",
    nav_oga_sla: "SLA ya OGA",
    nav_payment: "Mtiririko wa Malipo",
    nav_k8s: "Ramani ya K8s",
    hero_badge: "MAELEZO YA KIUFUNDI YALIYOREKEBISHWA · TOLEO 2.0 · MACHI 2026",
    hero_title_1: "TradeGateway™",
    hero_title_2: "NGSWTP",
    hero_subtitle: "Maelezo ya utekelezaji wa mwisho hadi mwisho yaliyounganishwa kutoka Singapore NTP, Ghana ICUMS, na Rwanda ReSW — yaliyojengwa upya kwa Go, Python, Mojaloop, TigerBeetle, na mfumo kamili wa cloud-native wa chanzo wazi.",
    hero_stat_clearance: "< Masaa 4",
    hero_stat_clearance_label: "Ufafanuzi wa njia ya kijani",
    hero_stat_ogas: "OGA 37+",
    hero_stat_ogas_label: "Mashirika yaliyounganishwa",
    hero_stat_uptime: "99.99%",
    hero_stat_uptime_label: "SLA ya upatikanaji",
    hero_stat_declarations: "5M+",
    hero_stat_declarations_label: "Matangazo ya kila mwaka",
    research_badge: "Utafiti wa Kulinganisha",
    research_title: "Imejengwa kwenye Misingi Iliyothibitishwa",
    research_subtitle: "Maelezo ya TradeGateway NGSWTP yanaunganisha zaidi ya miaka 35 ya uzoefu wa utekelezaji wa dirisha moja kutoka majukwaa matatu ya kihistoria.",
    arch_badge: "Usanifu wa Mfumo",
    arch_title: "Usanifu wa Cloud-Native wa Tabaka Saba",
    payment_badge: "Usanifu wa Kifedha",
    payment_title: "Mtiririko wa Malipo wa Mojaloop + TigerBeetle",
    payment_subtitle: "Mwongozo wa maingiliano wa mzunguko kamili wa malipo ya ushuru wa ILP — kutoka tathmini ya ushuru kupitia uhamisho wa Mojaloop FSPIOP hadi kukamilika kwa daftari la TigerBeetle la awamu mbili na utoaji wa kibali cha ufafanuzi kilichosainiwa na Ed25519.",
    payment_run_btn: "Endesha Mtiririko wa Malipo",
    payment_running_btn: "Inashughulikiwa...",
    payment_reset_btn: "Weka Upya",
    payment_complete: "Malipo Yamekamilika",
    payment_lane: "Njia",
    payment_clearance_time: "Muda wa Ufafanuzi",
    payment_total_latency: "Ucheleweshaji wa Jumla",
    hs_badge: "Akili ya Ushuru wa WCO",
    hs_title: "Utafutaji wa Msimbo wa HS na Kikokotoo cha Ushuru",
    hs_subtitle: "Tafuta ratiba ya ushuru ya Mfumo wa Upatanisho wa WCO 2022. Kiainishaji cha BERT NLP kinatoa alama za kuamini kwa uainishaji wa bidhaa, na viwango vya ushuru kwa Kenya, Ghana, Rwanda, Singapore, na Nigeria.",
    hs_search_placeholder: "Tafuta kwa msimbo wa HS (mf. 8471) au maelezo (mf. kompyuta, mchele, mafuta)...",
    hs_search_btn: "Tafuta",
    hs_quick_search: "Utafutaji wa haraka:",
    hs_duty_rates: "Viwango vya Ushuru kwa Nchi",
    hs_required_permits: "Vibali vya Shirika Vinavyohitajika",
    hs_bert_confidence: "Imani ya BERT",
    hs_risk_level: "Kiwango cha Hatari",
    hs_trade_volume: "Kiasi cha Biashara",
    hs_vat_rate: "Kiwango cha VAT",
    hs_prohibited: "IMEKATAZWA",
    hs_restricted: "IMEZUIWA",
    oga_badge: "Ufuatiliaji wa Wakati Halisi",
    oga_title: "Dashibodi ya SLA ya OGA",
    oga_subtitle: "Ufuatiliaji wa utiifu wa SLA wa wakati halisi kwa mashirika yote ya serikali 37+, mifumo ya kimataifa, na taasisi za fedha zilizounganishwa na kitovu cha NGSWTP.",
    oga_on_target: "Kwenye Lengo",
    oga_at_risk: "Katika Hatari",
    oga_breached: "Imevunjwa",
    oga_avg_compliance: "Utiifu wa Wastani",
    oga_pending: "Maombi Yanayosubiri",
    oga_refresh: "Onyesha Upya",
    gov_badge: "Kisheria na Utawala",
    gov_title: "Mfumo wa Utawala na Kisheria",
    footer_tagline: "Jukwaa la Biashara la Dirisha Moja la Kizazi Kipya",
    footer_built_with: "Imejengwa kwa Go · Python · Rust · Kubernetes · Mojaloop · TigerBeetle",
    footer_version: "Toleo 2.0 — Machi 2026",
    common_learn_more: "Jifunze Zaidi",
    common_view_details: "Angalia Maelezo",
    common_download: "Pakua",
    common_export_pdf: "Hamisha PDF",
    common_loading: "Inapakia...",
    common_select_result: "Chagua Matokeo",
    common_no_results: "Hakuna matokeo yaliyopatikana",
  }
};

// ─── Context ──────────────────────────────────────────────────────────────────

interface I18nContextType {
  language: Language;
  setLanguage: (lang: Language) => void;
  t: Translations;
}

const I18nContext = createContext<I18nContextType>({
  language: "en",
  setLanguage: () => {},
  t: TRANSLATIONS.en,
});

export function I18nProvider({ children }: { children: ReactNode }) {
  const [language, setLanguage] = useState<Language>("en");

  return (
    <I18nContext.Provider value={{ language, setLanguage, t: TRANSLATIONS[language] }}>
      {children}
    </I18nContext.Provider>
  );
}

export function useI18n() {
  return useContext(I18nContext);
}

export { TRANSLATIONS };
