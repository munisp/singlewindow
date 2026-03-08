/**
 * TradeGateway NGSWTP — WCO HS Code Lookup
 * Design: Sovereign Blueprint — deep navy + gold, Playfair Display headings
 *
 * Interactive HS code search with:
 * - Keyword and code search across WCO tariff schedule
 * - BERT classifier confidence simulation
 * - Duty rate display by country
 * - Prohibited/restricted goods flagging
 */

import { useState, useCallback } from "react";
import { Search, AlertTriangle, CheckCircle, Info, ChevronDown, ChevronRight, Zap } from "lucide-react";

// ─── HS Code Data (WCO Harmonized System 2022) ───────────────────────────────

interface HSCode {
  code: string;
  description: string;
  chapter: string;
  chapterDesc: string;
  dutyRates: Record<string, number>; // country -> duty %
  vat: number;
  restricted: boolean;
  prohibited: boolean;
  requiresPermit: string[];
  bertConfidence: number;
  tradeVolume: string;
  riskLevel: "LOW" | "MEDIUM" | "HIGH";
}

const HS_DATABASE: HSCode[] = [
  {
    code: "8471.30.00",
    description: "Portable automatic data processing machines, weighing not more than 10 kg",
    chapter: "84",
    chapterDesc: "Nuclear reactors, boilers, machinery and mechanical appliances",
    dutyRates: { KE: 0, GH: 10, RW: 0, SG: 0, NG: 5 },
    vat: 16,
    restricted: false,
    prohibited: false,
    requiresPermit: [],
    bertConfidence: 0.97,
    tradeVolume: "High",
    riskLevel: "LOW",
  },
  {
    code: "1006.30.00",
    description: "Semi-milled or wholly milled rice, whether or not polished or glazed",
    chapter: "10",
    chapterDesc: "Cereals",
    dutyRates: { KE: 75, GH: 20, RW: 75, SG: 0, NG: 50 },
    vat: 0,
    restricted: true,
    prohibited: false,
    requiresPermit: ["Agriculture Dept", "Standards Authority"],
    bertConfidence: 0.94,
    tradeVolume: "Very High",
    riskLevel: "MEDIUM",
  },
  {
    code: "2709.00.00",
    description: "Petroleum oils and oils obtained from bituminous minerals, crude",
    chapter: "27",
    chapterDesc: "Mineral fuels, mineral oils and products of their distillation",
    dutyRates: { KE: 0, GH: 0, RW: 0, SG: 0, NG: 0 },
    vat: 8,
    restricted: true,
    prohibited: false,
    requiresPermit: ["Energy Regulatory Authority", "Revenue Authority"],
    bertConfidence: 0.99,
    tradeVolume: "Very High",
    riskLevel: "HIGH",
  },
  {
    code: "3004.90.00",
    description: "Medicaments consisting of mixed or unmixed products for therapeutic or prophylactic uses",
    chapter: "30",
    chapterDesc: "Pharmaceutical products",
    dutyRates: { KE: 0, GH: 0, RW: 0, SG: 0, NG: 0 },
    vat: 0,
    restricted: true,
    prohibited: false,
    requiresPermit: ["Pharmacy Board", "Food & Drug Authority"],
    bertConfidence: 0.91,
    tradeVolume: "High",
    riskLevel: "MEDIUM",
  },
  {
    code: "8703.23.00",
    description: "Motor cars and other motor vehicles principally designed for the transport of persons, cylinder capacity 1500–3000cc",
    chapter: "87",
    chapterDesc: "Vehicles other than railway or tramway rolling stock",
    dutyRates: { KE: 25, GH: 20, RW: 25, SG: 0, NG: 35 },
    vat: 16,
    restricted: false,
    prohibited: false,
    requiresPermit: ["Revenue Authority"],
    bertConfidence: 0.96,
    tradeVolume: "High",
    riskLevel: "LOW",
  },
  {
    code: "9301.00.00",
    description: "Military weapons, other than revolvers, pistols and the arms of heading 9307",
    chapter: "93",
    chapterDesc: "Arms and ammunition; parts and accessories thereof",
    dutyRates: { KE: 0, GH: 0, RW: 0, SG: 0, NG: 0 },
    vat: 0,
    restricted: false,
    prohibited: true,
    requiresPermit: ["Ministry of Defence", "Interior Ministry", "INTERPOL Clearance"],
    bertConfidence: 0.99,
    tradeVolume: "Very Low",
    riskLevel: "HIGH",
  },
  {
    code: "6109.10.00",
    description: "T-shirts, singlets and other vests, of cotton, knitted or crocheted",
    chapter: "61",
    chapterDesc: "Articles of apparel and clothing accessories, knitted or crocheted",
    dutyRates: { KE: 35, GH: 20, RW: 25, SG: 0, NG: 20 },
    vat: 16,
    restricted: false,
    prohibited: false,
    requiresPermit: [],
    bertConfidence: 0.88,
    tradeVolume: "Very High",
    riskLevel: "LOW",
  },
  {
    code: "0901.11.00",
    description: "Coffee, not roasted, not decaffeinated",
    chapter: "09",
    chapterDesc: "Coffee, tea, maté and spices",
    dutyRates: { KE: 0, GH: 5, RW: 0, SG: 0, NG: 5 },
    vat: 0,
    restricted: false,
    prohibited: false,
    requiresPermit: ["Agriculture Dept"],
    bertConfidence: 0.95,
    tradeVolume: "High",
    riskLevel: "LOW",
  },
  {
    code: "7208.51.00",
    description: "Flat-rolled products of iron or non-alloy steel, of a width ≥ 600mm, hot-rolled, not clad",
    chapter: "72",
    chapterDesc: "Iron and steel",
    dutyRates: { KE: 10, GH: 10, RW: 10, SG: 0, NG: 10 },
    vat: 16,
    restricted: false,
    prohibited: false,
    requiresPermit: ["Standards Authority"],
    bertConfidence: 0.92,
    tradeVolume: "High",
    riskLevel: "LOW",
  },
  {
    code: "2710.12.00",
    description: "Light oils and preparations of petroleum or bituminous minerals",
    chapter: "27",
    chapterDesc: "Mineral fuels, mineral oils and products of their distillation",
    dutyRates: { KE: 0, GH: 0, RW: 0, SG: 0, NG: 0 },
    vat: 8,
    restricted: true,
    prohibited: false,
    requiresPermit: ["Energy Regulatory Authority"],
    bertConfidence: 0.97,
    tradeVolume: "Very High",
    riskLevel: "HIGH",
  },
];

const COUNTRY_NAMES: Record<string, string> = {
  KE: "Kenya",
  GH: "Ghana",
  RW: "Rwanda",
  SG: "Singapore",
  NG: "Nigeria",
};

// ─── Component ────────────────────────────────────────────────────────────────

export default function HSCodeLookup() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<HSCode[]>([]);
  const [selectedCode, setSelectedCode] = useState<HSCode | null>(null);
  const [isSearching, setIsSearching] = useState(false);
  const [selectedCountry, setSelectedCountry] = useState("GH");
  const [hasSearched, setHasSearched] = useState(false);

  const handleSearch = useCallback(() => {
    if (!query.trim()) return;
    setIsSearching(true);
    setHasSearched(true);
    setSelectedCode(null);

    // Simulate BERT NLP classification latency
    setTimeout(() => {
      const q = query.toLowerCase();
      const filtered = HS_DATABASE.filter(
        (hs) =>
          hs.code.includes(q) ||
          hs.description.toLowerCase().includes(q) ||
          hs.chapterDesc.toLowerCase().includes(q)
      );
      setResults(filtered);
      setIsSearching(false);
    }, 600);
  }, [query]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") handleSearch();
  };

  const riskColor = (level: string) => {
    if (level === "LOW") return "text-emerald-400";
    if (level === "MEDIUM") return "text-amber-400";
    return "text-red-400";
  };

  const riskBg = (level: string) => {
    if (level === "LOW") return "bg-emerald-900/30 border-emerald-700/40";
    if (level === "MEDIUM") return "bg-amber-900/30 border-amber-700/40";
    return "bg-red-900/30 border-red-700/40";
  };

  const confidenceColor = (c: number) => {
    if (c >= 0.9) return "text-emerald-400";
    if (c >= 0.75) return "text-amber-400";
    return "text-red-400";
  };

  return (
    <section id="hs-lookup" className="py-20 bg-[#0A1628]">
      <div className="max-w-6xl mx-auto px-6">
        {/* Header */}
        <div className="mb-12">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-1 h-10 bg-[#D4A017] rounded-full" />
            <span className="text-[#D4A017] text-sm font-semibold tracking-widest uppercase">
              WCO Tariff Intelligence
            </span>
          </div>
          <h2 className="font-['Playfair_Display'] text-4xl font-bold text-white mb-4">
            HS Code Lookup & Duty Calculator
          </h2>
          <p className="text-slate-400 text-lg max-w-3xl">
            Search the WCO Harmonized System 2022 tariff schedule. The BERT NLP classifier
            provides confidence scores for commodity classification, with duty rates across
            Kenya, Ghana, Rwanda, Singapore, and Nigeria.
          </p>
        </div>

        {/* Search Bar */}
        <div className="bg-[#0D1E35] border border-slate-700/50 rounded-2xl p-6 mb-8">
          <div className="flex gap-4 mb-4">
            <div className="flex-1 relative">
              <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 w-5 h-5" />
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Search by HS code (e.g. 8471) or description (e.g. laptop, rice, petroleum)..."
                className="w-full bg-[#0A1628] border border-slate-600 rounded-xl pl-12 pr-4 py-3 text-white placeholder-slate-500 focus:outline-none focus:border-[#D4A017] transition-colors"
              />
            </div>
            <select
              value={selectedCountry}
              onChange={(e) => setSelectedCountry(e.target.value)}
              className="bg-[#0A1628] border border-slate-600 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-[#D4A017] transition-colors"
            >
              {Object.entries(COUNTRY_NAMES).map(([code, name]) => (
                <option key={code} value={code}>{name}</option>
              ))}
            </select>
            <button
              onClick={handleSearch}
              disabled={isSearching || !query.trim()}
              className="bg-[#D4A017] hover:bg-[#B8860B] disabled:opacity-50 text-[#0A1628] font-bold px-8 py-3 rounded-xl transition-colors flex items-center gap-2"
            >
              {isSearching ? (
                <>
                  <div className="w-4 h-4 border-2 border-[#0A1628] border-t-transparent rounded-full animate-spin" />
                  Classifying...
                </>
              ) : (
                <>
                  <Zap className="w-4 h-4" />
                  Search
                </>
              )}
            </button>
          </div>

          {/* Quick search chips */}
          <div className="flex flex-wrap gap-2">
            <span className="text-slate-500 text-sm mr-2">Quick search:</span>
            {["laptop", "rice", "petroleum", "pharmaceuticals", "vehicles", "coffee", "steel"].map((term) => (
              <button
                key={term}
                onClick={() => { setQuery(term); }}
                className="text-xs bg-slate-800 hover:bg-slate-700 text-slate-300 px-3 py-1 rounded-full border border-slate-600 transition-colors capitalize"
              >
                {term}
              </button>
            ))}
          </div>
        </div>

        {/* Results */}
        {hasSearched && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Results List */}
            <div>
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-white font-semibold">
                  {results.length > 0
                    ? `${results.length} result${results.length !== 1 ? "s" : ""} found`
                    : "No results found"}
                </h3>
                {results.length > 0 && (
                  <span className="text-slate-400 text-sm">
                    BERT NLP Classification Active
                  </span>
                )}
              </div>

              {results.length === 0 && !isSearching && (
                <div className="bg-[#0D1E35] border border-slate-700/50 rounded-xl p-8 text-center">
                  <Search className="w-12 h-12 text-slate-600 mx-auto mb-3" />
                  <p className="text-slate-400">No HS codes matched your search.</p>
                  <p className="text-slate-500 text-sm mt-1">Try broader terms like "food", "machinery", or "chemicals"</p>
                </div>
              )}

              <div className="space-y-3">
                {results.map((hs) => (
                  <button
                    key={hs.code}
                    onClick={() => setSelectedCode(hs)}
                    className={`w-full text-left bg-[#0D1E35] border rounded-xl p-4 transition-all hover:border-[#D4A017]/50 ${
                      selectedCode?.code === hs.code
                        ? "border-[#D4A017] shadow-[0_0_20px_rgba(212,160,23,0.15)]"
                        : "border-slate-700/50"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-[#D4A017] font-mono font-bold text-sm">{hs.code}</span>
                          {hs.prohibited && (
                            <span className="bg-red-900/50 text-red-400 text-xs px-2 py-0.5 rounded-full border border-red-700/40">
                              PROHIBITED
                            </span>
                          )}
                          {hs.restricted && !hs.prohibited && (
                            <span className="bg-amber-900/50 text-amber-400 text-xs px-2 py-0.5 rounded-full border border-amber-700/40">
                              RESTRICTED
                            </span>
                          )}
                        </div>
                        <p className="text-white text-sm leading-snug line-clamp-2">{hs.description}</p>
                        <p className="text-slate-500 text-xs mt-1">Chapter {hs.chapter}: {hs.chapterDesc}</p>
                      </div>
                      <div className="text-right shrink-0">
                        <div className="text-white font-bold text-lg">
                          {hs.dutyRates[selectedCountry]}%
                        </div>
                        <div className="text-slate-400 text-xs">duty</div>
                        <div className={`text-xs mt-1 font-semibold ${riskColor(hs.riskLevel)}`}>
                          {hs.riskLevel}
                        </div>
                      </div>
                    </div>

                    {/* BERT confidence bar */}
                    <div className="mt-3">
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-slate-500 text-xs">BERT Confidence</span>
                        <span className={`text-xs font-semibold ${confidenceColor(hs.bertConfidence)}`}>
                          {(hs.bertConfidence * 100).toFixed(1)}%
                        </span>
                      </div>
                      <div className="h-1.5 bg-slate-700 rounded-full overflow-hidden">
                        <div
                          className={`h-full rounded-full transition-all ${
                            hs.bertConfidence >= 0.9
                              ? "bg-emerald-500"
                              : hs.bertConfidence >= 0.75
                              ? "bg-amber-500"
                              : "bg-red-500"
                          }`}
                          style={{ width: `${hs.bertConfidence * 100}%` }}
                        />
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            </div>

            {/* Detail Panel */}
            <div>
              {selectedCode ? (
                <div className="bg-[#0D1E35] border border-[#D4A017]/30 rounded-2xl p-6 sticky top-24">
                  <div className="flex items-start justify-between mb-6">
                    <div>
                      <div className="text-[#D4A017] font-mono font-bold text-2xl mb-1">
                        {selectedCode.code}
                      </div>
                      <h3 className="text-white font-semibold text-lg leading-snug">
                        {selectedCode.description}
                      </h3>
                    </div>
                    {selectedCode.prohibited ? (
                      <AlertTriangle className="w-8 h-8 text-red-400 shrink-0" />
                    ) : selectedCode.restricted ? (
                      <AlertTriangle className="w-8 h-8 text-amber-400 shrink-0" />
                    ) : (
                      <CheckCircle className="w-8 h-8 text-emerald-400 shrink-0" />
                    )}
                  </div>

                  {/* Status Banner */}
                  {selectedCode.prohibited && (
                    <div className="bg-red-900/30 border border-red-700/40 rounded-xl p-4 mb-6">
                      <div className="flex items-center gap-2 text-red-400 font-semibold mb-1">
                        <AlertTriangle className="w-4 h-4" />
                        PROHIBITED GOODS
                      </div>
                      <p className="text-red-300 text-sm">
                        This commodity requires special government authorization. Multiple agency permits
                        and INTERPOL clearance are mandatory before import/export.
                      </p>
                    </div>
                  )}
                  {selectedCode.restricted && !selectedCode.prohibited && (
                    <div className="bg-amber-900/30 border border-amber-700/40 rounded-xl p-4 mb-6">
                      <div className="flex items-center gap-2 text-amber-400 font-semibold mb-1">
                        <Info className="w-4 h-4" />
                        RESTRICTED GOODS
                      </div>
                      <p className="text-amber-300 text-sm">
                        Permits required from: {selectedCode.requiresPermit.join(", ")}
                      </p>
                    </div>
                  )}

                  {/* Duty Rates Table */}
                  <div className="mb-6">
                    <h4 className="text-slate-300 font-semibold text-sm uppercase tracking-wider mb-3">
                      Duty Rates by Country
                    </h4>
                    <div className="space-y-2">
                      {Object.entries(selectedCode.dutyRates).map(([country, rate]) => (
                        <div
                          key={country}
                          className={`flex items-center justify-between px-4 py-2.5 rounded-lg ${
                            country === selectedCountry
                              ? "bg-[#D4A017]/10 border border-[#D4A017]/30"
                              : "bg-slate-800/50"
                          }`}
                        >
                          <div className="flex items-center gap-3">
                            <span className="text-slate-400 font-mono text-xs w-6">{country}</span>
                            <span className={`text-sm ${country === selectedCountry ? "text-white font-semibold" : "text-slate-300"}`}>
                              {COUNTRY_NAMES[country]}
                            </span>
                            {country === selectedCountry && (
                              <span className="text-[#D4A017] text-xs">▶ selected</span>
                            )}
                          </div>
                          <div className="text-right">
                            <span className={`font-bold ${country === selectedCountry ? "text-[#D4A017] text-lg" : "text-white"}`}>
                              {rate}%
                            </span>
                            <span className="text-slate-500 text-xs ml-1">duty</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* VAT & Additional Info */}
                  <div className="grid grid-cols-2 gap-3 mb-6">
                    <div className="bg-slate-800/50 rounded-xl p-4">
                      <div className="text-slate-400 text-xs mb-1">VAT Rate</div>
                      <div className="text-white font-bold text-xl">{selectedCode.vat}%</div>
                    </div>
                    <div className="bg-slate-800/50 rounded-xl p-4">
                      <div className="text-slate-400 text-xs mb-1">Trade Volume</div>
                      <div className="text-white font-bold text-xl">{selectedCode.tradeVolume}</div>
                    </div>
                    <div className={`rounded-xl p-4 border ${riskBg(selectedCode.riskLevel)}`}>
                      <div className="text-slate-400 text-xs mb-1">Risk Level</div>
                      <div className={`font-bold text-xl ${riskColor(selectedCode.riskLevel)}`}>
                        {selectedCode.riskLevel}
                      </div>
                    </div>
                    <div className="bg-slate-800/50 rounded-xl p-4">
                      <div className="text-slate-400 text-xs mb-1">BERT Confidence</div>
                      <div className={`font-bold text-xl ${confidenceColor(selectedCode.bertConfidence)}`}>
                        {(selectedCode.bertConfidence * 100).toFixed(1)}%
                      </div>
                    </div>
                  </div>

                  {/* Required Permits */}
                  {selectedCode.requiresPermit.length > 0 && (
                    <div>
                      <h4 className="text-slate-300 font-semibold text-sm uppercase tracking-wider mb-3">
                        Required Agency Permits
                      </h4>
                      <div className="space-y-2">
                        {selectedCode.requiresPermit.map((permit) => (
                          <div
                            key={permit}
                            className="flex items-center gap-3 bg-slate-800/50 rounded-lg px-4 py-2.5"
                          >
                            <ChevronRight className="w-4 h-4 text-[#D4A017]" />
                            <span className="text-slate-300 text-sm">{permit}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <div className="bg-[#0D1E35] border border-slate-700/50 rounded-2xl p-8 text-center">
                  <div className="w-16 h-16 bg-slate-800 rounded-2xl flex items-center justify-center mx-auto mb-4">
                    <Search className="w-8 h-8 text-slate-500" />
                  </div>
                  <h3 className="text-white font-semibold mb-2">Select a Result</h3>
                  <p className="text-slate-400 text-sm">
                    Click any HS code result on the left to view detailed duty rates,
                    permit requirements, and risk classification.
                  </p>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Initial State */}
        {!hasSearched && (
          <div className="text-center py-16">
            <div className="w-20 h-20 bg-[#0D1E35] border border-slate-700/50 rounded-3xl flex items-center justify-center mx-auto mb-6">
              <Search className="w-10 h-10 text-[#D4A017]" />
            </div>
            <h3 className="text-white text-xl font-semibold mb-3">
              Search the WCO Harmonized System
            </h3>
            <p className="text-slate-400 max-w-md mx-auto">
              Enter a commodity description or HS code above. The BERT NLP classifier
              will provide confidence scores for accurate tariff classification.
            </p>
          </div>
        )}
      </div>
    </section>
  );
}
