/**
 * DeclarationSimulator Component
 * Design: Sovereign Blueprint — deep navy + gold, Playfair Display headings
 * 5-step interactive trader journey: Commodity → Documents → OCR → Risk → Permit
 */

import { useState, useEffect } from "react";
import {
  Package, FileText, ScanLine, ShieldCheck, Award,
  ChevronRight, CheckCircle2, Clock, AlertTriangle,
  Zap, TrendingUp, Globe, Loader2
} from "lucide-react";
import {
  RadarChart, Radar, PolarGrid, PolarAngleAxis, PolarRadiusAxis,
  ResponsiveContainer
} from "recharts";

// ── Types & Data ──────────────────────────────────────────────────────────────

type Lane = "GREEN" | "YELLOW" | "RED";

const commodities = [
  { id: "electronics", label: "Electronics", hs: "8471300000", desc: "Laptop Computers", risk: 23, country: "China", value: 85000, duty: 5, vat: 7.5 },
  { id: "pharmaceuticals", label: "Pharmaceuticals", hs: "3004909000", desc: "Medicinal preparations", risk: 61, country: "India", value: 42000, duty: 0, vat: 0 },
  { id: "textiles", label: "Textiles", hs: "6203420000", desc: "Men's trousers, cotton", risk: 38, country: "Bangladesh", value: 18000, duty: 20, vat: 7.5 },
  { id: "food", label: "Food Products", hs: "1901909000", desc: "Cereal-based food preparations", risk: 72, country: "Ukraine", value: 55000, duty: 10, vat: 7.5 },
  { id: "machinery", label: "Industrial Machinery", hs: "8428390000", desc: "Lifting & handling machinery", risk: 15, country: "Germany", value: 320000, duty: 5, vat: 7.5 },
];

const traderProfiles = [
  { id: "aeo", label: "AEO Certified Trader", riskMod: -20, description: "35+ years trading history, zero violations" },
  { id: "established", label: "Established Trader", riskMod: 0, description: "5+ years history, minor compliance issues" },
  { id: "new", label: "New Importer", riskMod: +25, description: "First declaration, no history" },
  { id: "flagged", label: "Previously Flagged", riskMod: +40, description: "Prior customs violations on record" },
];

const getLane = (score: number): Lane => {
  if (score < 40) return "GREEN";
  if (score < 70) return "YELLOW";
  return "RED";
};

const laneConfig = {
  GREEN: { color: "#22C55E", bg: "rgba(34,197,94,0.15)", label: "Green Lane — Auto-Approve", time: "< 4 hours", icon: "✓" },
  YELLOW: { color: "#F59E0B", bg: "rgba(245,158,11,0.15)", label: "Yellow Lane — Document Review", time: "1–3 business days", icon: "⚠" },
  RED: { color: "#EF4444", bg: "rgba(239,68,68,0.15)", label: "Red Lane — Physical Inspection", time: "3–7 business days", icon: "✗" },
};

const steps = [
  { id: 1, label: "Commodity", icon: Package },
  { id: 2, label: "Trader Profile", icon: Globe },
  { id: 3, label: "OCR Extraction", icon: ScanLine },
  { id: 4, label: "Risk Assessment", icon: ShieldCheck },
  { id: 5, label: "Clearance", icon: Award },
];

// ── Component ─────────────────────────────────────────────────────────────────

export default function DeclarationSimulator() {
  const [step, setStep] = useState(1);
  const [selectedCommodity, setSelectedCommodity] = useState<typeof commodities[0] | null>(null);
  const [selectedTrader, setSelectedTrader] = useState<typeof traderProfiles[0] | null>(null);
  const [ocrProgress, setOcrProgress] = useState(0);
  const [ocrDone, setOcrDone] = useState(false);
  const [riskProgress, setRiskProgress] = useState(0);
  const [riskDone, setRiskDone] = useState(false);
  const [urn] = useState(`TG-${new Date().getFullYear()}-IM-${Math.floor(100000 + Math.random() * 900000)}`);

  const riskScore = selectedCommodity && selectedTrader
    ? Math.max(0, Math.min(100, selectedCommodity.risk + selectedTrader.riskMod))
    : 0;
  const lane: Lane = getLane(riskScore);
  const lc = laneConfig[lane];

  const dutyBase = selectedCommodity ? selectedCommodity.value * 1550 : 0;
  const importDuty = selectedCommodity ? dutyBase * (selectedCommodity.duty / 100) : 0;
  const vat = selectedCommodity ? (dutyBase + importDuty) * (selectedCommodity.vat / 100) : 0;
  const totalDuty = importDuty + vat;

  const radarData = selectedCommodity && selectedTrader ? [
    { subject: "HS Code", A: selectedCommodity.risk * 0.8 },
    { subject: "Trader History", A: Math.max(0, 50 + selectedTrader.riskMod) },
    { subject: "Country Risk", A: selectedCommodity.country === "China" ? 35 : selectedCommodity.country === "Ukraine" ? 65 : selectedCommodity.country === "India" ? 45 : 20 },
    { subject: "Value Anomaly", A: selectedCommodity.value > 100000 ? 40 : 15 },
    { subject: "GNN Fraud", A: riskScore * 0.3 },
    { subject: "Sanctions", A: 5 },
  ] : [];

  // OCR animation
  useEffect(() => {
    if (step === 3 && !ocrDone) {
      setOcrProgress(0);
      const interval = setInterval(() => {
        setOcrProgress(prev => {
          if (prev >= 100) { clearInterval(interval); setOcrDone(true); return 100; }
          return prev + 4;
        });
      }, 60);
      return () => clearInterval(interval);
    }
  }, [step]);

  // Risk animation
  useEffect(() => {
    if (step === 4 && !riskDone) {
      setRiskProgress(0);
      const interval = setInterval(() => {
        setRiskProgress(prev => {
          if (prev >= riskScore) { clearInterval(interval); setRiskDone(true); return riskScore; }
          return prev + 2;
        });
      }, 40);
      return () => clearInterval(interval);
    }
  }, [step]);

  const canAdvance = () => {
    if (step === 1) return selectedCommodity !== null;
    if (step === 2) return selectedTrader !== null;
    if (step === 3) return ocrDone;
    if (step === 4) return riskDone;
    return false;
  };

  const reset = () => {
    setStep(1); setSelectedCommodity(null); setSelectedTrader(null);
    setOcrProgress(0); setOcrDone(false); setRiskProgress(0); setRiskDone(false);
  };

  return (
    <section id="simulator" className="py-20" style={{ background: "linear-gradient(180deg, #0D1F3C 0%, #0A1628 100%)" }}>
      <div className="max-w-5xl mx-auto px-6">
        {/* Header */}
        <div className="mb-10">
          <div className="flex items-center gap-3 mb-4">
            <Zap className="w-6 h-6" style={{ color: "#D4A017" }} />
            <span className="text-sm font-semibold uppercase tracking-widest" style={{ color: "#D4A017" }}>
              Live Demonstration
            </span>
          </div>
          <h2 className="text-4xl font-bold mb-4" style={{ fontFamily: "'Playfair Display', serif", color: "#F5F0E8" }}>
            Declaration Simulator
          </h2>
          <p className="text-lg max-w-3xl" style={{ color: "#8BA0B8" }}>
            Walk through the complete trader journey — from commodity selection to clearance permit — and see how the AI risk engine, Temporal workflow, and Mojaloop payment stack work together in real time.
          </p>
        </div>

        {/* Step Progress */}
        <div className="flex items-center justify-between mb-10 relative">
          <div className="absolute top-5 left-0 right-0 h-0.5" style={{ background: "rgba(255,255,255,0.08)" }} />
          <div
            className="absolute top-5 left-0 h-0.5 transition-all duration-500"
            style={{ background: "#D4A017", width: `${((step - 1) / (steps.length - 1)) * 100}%` }}
          />
          {steps.map((s) => {
            const Icon = s.icon;
            const done = step > s.id;
            const active = step === s.id;
            return (
              <div key={s.id} className="flex flex-col items-center gap-2 relative z-10">
                <div
                  className="w-10 h-10 rounded-full flex items-center justify-center transition-all duration-300"
                  style={{
                    background: done ? "#D4A017" : active ? "rgba(212,160,23,0.2)" : "rgba(255,255,255,0.06)",
                    border: active ? "2px solid #D4A017" : done ? "2px solid #D4A017" : "2px solid rgba(255,255,255,0.15)",
                  }}
                >
                  {done ? <CheckCircle2 className="w-5 h-5" style={{ color: "#0A1628" }} /> : <Icon className="w-5 h-5" style={{ color: active ? "#D4A017" : "#8BA0B8" }} />}
                </div>
                <span className="text-xs font-semibold hidden md:block" style={{ color: active ? "#D4A017" : done ? "#F5F0E8" : "#8BA0B8" }}>
                  {s.label}
                </span>
              </div>
            );
          })}
        </div>

        {/* Step Content */}
        <div className="rounded-2xl border p-8 mb-6" style={{ background: "rgba(255,255,255,0.03)", borderColor: "rgba(212,160,23,0.2)" }}>

          {/* Step 1: Commodity Selection */}
          {step === 1 && (
            <div>
              <h3 className="text-2xl font-bold mb-2" style={{ fontFamily: "'Playfair Display', serif", color: "#F5F0E8" }}>
                Select Commodity Type
              </h3>
              <p className="text-sm mb-6" style={{ color: "#8BA0B8" }}>
                The AI engine will classify the HS code using BERT NLP and apply commodity-specific risk rules.
              </p>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                {commodities.map((c) => (
                  <button
                    key={c.id}
                    onClick={() => setSelectedCommodity(c)}
                    className="text-left p-4 rounded-xl border transition-all"
                    style={{
                      background: selectedCommodity?.id === c.id ? "rgba(212,160,23,0.15)" : "rgba(255,255,255,0.04)",
                      borderColor: selectedCommodity?.id === c.id ? "#D4A017" : "rgba(255,255,255,0.08)",
                    }}
                  >
                    <div className="font-semibold mb-1" style={{ color: "#F5F0E8" }}>{c.label}</div>
                    <div className="text-xs font-mono mb-2" style={{ color: "#D4A017" }}>{c.hs}</div>
                    <div className="text-xs" style={{ color: "#8BA0B8" }}>{c.desc} · Origin: {c.country}</div>
                    <div className="mt-2 flex items-center gap-2">
                      <div className="text-xs" style={{ color: "#8BA0B8" }}>Base risk:</div>
                      <div className="flex-1 h-1 rounded-full" style={{ background: "rgba(255,255,255,0.1)" }}>
                        <div className="h-full rounded-full" style={{ width: `${c.risk}%`, background: c.risk < 40 ? "#22C55E" : c.risk < 70 ? "#F59E0B" : "#EF4444" }} />
                      </div>
                      <div className="text-xs font-bold" style={{ color: c.risk < 40 ? "#22C55E" : c.risk < 70 ? "#F59E0B" : "#EF4444" }}>{c.risk}</div>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Step 2: Trader Profile */}
          {step === 2 && (
            <div>
              <h3 className="text-2xl font-bold mb-2" style={{ fontFamily: "'Playfair Display', serif", color: "#F5F0E8" }}>
                Select Trader Profile
              </h3>
              <p className="text-sm mb-6" style={{ color: "#8BA0B8" }}>
                Trader history significantly impacts the risk score. AEO-certified traders receive automatic green-lane routing.
              </p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {traderProfiles.map((t) => (
                  <button
                    key={t.id}
                    onClick={() => setSelectedTrader(t)}
                    className="text-left p-5 rounded-xl border transition-all"
                    style={{
                      background: selectedTrader?.id === t.id ? "rgba(212,160,23,0.15)" : "rgba(255,255,255,0.04)",
                      borderColor: selectedTrader?.id === t.id ? "#D4A017" : "rgba(255,255,255,0.08)",
                    }}
                  >
                    <div className="font-semibold mb-1" style={{ color: "#F5F0E8" }}>{t.label}</div>
                    <div className="text-sm mb-3" style={{ color: "#8BA0B8" }}>{t.description}</div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-bold" style={{ color: t.riskMod <= 0 ? "#22C55E" : "#EF4444" }}>
                        Risk modifier: {t.riskMod > 0 ? "+" : ""}{t.riskMod}
                      </span>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Step 3: OCR Extraction */}
          {step === 3 && (
            <div>
              <h3 className="text-2xl font-bold mb-2" style={{ fontFamily: "'Playfair Display', serif", color: "#F5F0E8" }}>
                AI Document Extraction (OCR)
              </h3>
              <p className="text-sm mb-6" style={{ color: "#8BA0B8" }}>
                LayoutLMv3 processes the uploaded invoice, Bill of Lading, and Certificate of Origin. Fields are extracted and validated against the WCO Data Model v3.10.
              </p>
              <div className="mb-6">
                <div className="flex justify-between text-sm mb-2">
                  <span style={{ color: "#8BA0B8" }}>Processing documents...</span>
                  <span style={{ color: "#D4A017" }}>{ocrProgress}%</span>
                </div>
                <div className="h-2 rounded-full" style={{ background: "rgba(255,255,255,0.08)" }}>
                  <div className="h-full rounded-full transition-all duration-100" style={{ width: `${ocrProgress}%`, background: "linear-gradient(90deg, #D4A017, #22C55E)" }} />
                </div>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {[
                  { doc: "Commercial Invoice", fields: ["Seller", "Buyer", "HS Code", "Description", "Unit Price", "Total Value", "Currency", "Incoterms"], done: ocrProgress >= 33 },
                  { doc: "Bill of Lading", fields: ["Vessel Name", "IMO Number", "Voyage", "Port of Loading", "Port of Discharge", "Container ID", "Seal Number", "Gross Weight"], done: ocrProgress >= 66 },
                  { doc: "Certificate of Origin", fields: ["Exporter", "Consignee", "Country of Origin", "HS Code", "Net Weight", "Certifying Body", "Certificate No.", "Issue Date"], done: ocrProgress >= 100 },
                ].map((d) => (
                  <div key={d.doc} className="rounded-xl border p-4" style={{ background: "rgba(255,255,255,0.03)", borderColor: d.done ? "rgba(34,197,94,0.4)" : "rgba(255,255,255,0.08)" }}>
                    <div className="flex items-center gap-2 mb-3">
                      {d.done ? <CheckCircle2 className="w-4 h-4" style={{ color: "#22C55E" }} /> : <Loader2 className="w-4 h-4 animate-spin" style={{ color: "#D4A017" }} />}
                      <span className="text-sm font-semibold" style={{ color: "#F5F0E8" }}>{d.doc}</span>
                    </div>
                    <div className="space-y-1">
                      {d.fields.map((f) => (
                        <div key={f} className="flex items-center gap-2 text-xs">
                          <div className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: d.done ? "#22C55E" : "rgba(255,255,255,0.2)" }} />
                          <span style={{ color: d.done ? "#C8D8E8" : "#8BA0B8" }}>{f}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Step 4: Risk Assessment */}
          {step === 4 && selectedCommodity && selectedTrader && (
            <div>
              <h3 className="text-2xl font-bold mb-2" style={{ fontFamily: "'Playfair Display', serif", color: "#F5F0E8" }}>
                AI Risk Assessment
              </h3>
              <p className="text-sm mb-6" style={{ color: "#8BA0B8" }}>
                200+ Rust rules + BERT HS classifier + PyTorch GNN fraud detection running in parallel. Score computed in under 5 seconds.
              </p>
              <div className="grid md:grid-cols-2 gap-6">
                {/* Score Gauge */}
                <div className="text-center">
                  <div className="relative inline-flex items-center justify-center mb-4">
                    <svg width="180" height="180" viewBox="0 0 180 180">
                      <circle cx="90" cy="90" r="75" fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="12" />
                      <circle
                        cx="90" cy="90" r="75"
                        fill="none"
                        stroke={riskProgress < 40 ? "#22C55E" : riskProgress < 70 ? "#F59E0B" : "#EF4444"}
                        strokeWidth="12"
                        strokeDasharray={`${(riskProgress / 100) * 471} 471`}
                        strokeLinecap="round"
                        transform="rotate(-90 90 90)"
                        style={{ transition: "stroke-dasharray 0.1s" }}
                      />
                    </svg>
                    <div className="absolute text-center">
                      <div className="text-4xl font-bold" style={{ fontFamily: "'Playfair Display', serif", color: riskProgress < 40 ? "#22C55E" : riskProgress < 70 ? "#F59E0B" : "#EF4444" }}>
                        {Math.round(riskProgress)}
                      </div>
                      <div className="text-xs" style={{ color: "#8BA0B8" }}>Risk Score</div>
                    </div>
                  </div>
                  {riskDone && (
                    <div className="rounded-xl p-4" style={{ background: lc.bg, border: `1px solid ${lc.color}44` }}>
                      <div className="font-bold mb-1" style={{ color: lc.color }}>{lc.label}</div>
                      <div className="flex items-center justify-center gap-2 text-sm" style={{ color: "#8BA0B8" }}>
                        <Clock className="w-4 h-4" />
                        Estimated clearance: {lc.time}
                      </div>
                    </div>
                  )}
                </div>
                {/* Radar */}
                <div>
                  <div className="text-xs uppercase tracking-wider font-semibold mb-3" style={{ color: "#D4A017" }}>Risk Factor Breakdown</div>
                  <ResponsiveContainer width="100%" height={220}>
                    <RadarChart data={radarData}>
                      <PolarGrid stroke="rgba(255,255,255,0.08)" />
                      <PolarAngleAxis dataKey="subject" tick={{ fill: "#8BA0B8", fontSize: 10 }} />
                      <PolarRadiusAxis angle={30} domain={[0, 100]} tick={{ fill: "#8BA0B8", fontSize: 9 }} />
                      <Radar name="Risk" dataKey="A" stroke={lc.color} fill={lc.color} fillOpacity={0.2} />
                    </RadarChart>
                  </ResponsiveContainer>
                </div>
              </div>
              {riskDone && (
                <div className="mt-4 p-4 rounded-xl border" style={{ background: "rgba(255,255,255,0.03)", borderColor: "rgba(255,255,255,0.08)" }}>
                  <div className="text-xs uppercase tracking-wider font-semibold mb-3" style={{ color: "#D4A017" }}>Duty Assessment</div>
                  <div className="grid grid-cols-3 gap-4 text-center">
                    {[
                      { label: "Import Duty", value: `₦${(importDuty / 1000000).toFixed(2)}M`, rate: `${selectedCommodity.duty}%` },
                      { label: "VAT", value: `₦${(vat / 1000000).toFixed(2)}M`, rate: `${selectedCommodity.vat}%` },
                      { label: "Total Due", value: `₦${(totalDuty / 1000000).toFixed(2)}M`, rate: "Combined" },
                    ].map((d) => (
                      <div key={d.label}>
                        <div className="text-xs mb-1" style={{ color: "#8BA0B8" }}>{d.label} ({d.rate})</div>
                        <div className="text-lg font-bold" style={{ color: "#D4A017", fontFamily: "'Playfair Display', serif" }}>{d.value}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Step 5: Clearance Permit */}
          {step === 5 && (
            <div className="text-center">
              <div className="w-20 h-20 rounded-full flex items-center justify-center mx-auto mb-6" style={{ background: "rgba(34,197,94,0.15)", border: "2px solid #22C55E" }}>
                <Award className="w-10 h-10" style={{ color: "#22C55E" }} />
              </div>
              <h3 className="text-3xl font-bold mb-2" style={{ fontFamily: "'Playfair Display', serif", color: "#F5F0E8" }}>
                Clearance Permit Issued
              </h3>
              <p className="text-sm mb-8" style={{ color: "#8BA0B8" }}>
                Ed25519-signed permit generated. QR code active for port scanner verification.
              </p>
              <div className="max-w-md mx-auto rounded-2xl border p-6 text-left" style={{ background: "rgba(255,255,255,0.04)", borderColor: "rgba(212,160,23,0.4)" }}>
                <div className="flex items-center justify-between mb-4">
                  <div className="font-bold" style={{ color: "#D4A017", fontFamily: "'Playfair Display', serif" }}>TradeGateway™ NGSWTP</div>
                  <div className="text-xs px-2 py-1 rounded" style={{ background: "rgba(34,197,94,0.15)", color: "#22C55E" }}>VALID</div>
                </div>
                <div className="space-y-2 text-sm mb-4">
                  {[
                    { label: "Permit No.", value: urn.replace("IM", "PERMIT") },
                    { label: "Declaration URN", value: urn },
                    { label: "Commodity", value: selectedCommodity?.desc || "—" },
                    { label: "HS Code", value: selectedCommodity?.hs || "—" },
                    { label: "Lane", value: lane },
                    { label: "Issued", value: new Date().toLocaleDateString() },
                    { label: "Valid Until", value: new Date(Date.now() + 7 * 86400000).toLocaleDateString() },
                  ].map((r) => (
                    <div key={r.label} className="flex justify-between">
                      <span style={{ color: "#8BA0B8" }}>{r.label}</span>
                      <span style={{ color: r.label === "Lane" ? lc.color : "#F5F0E8" }}>{r.value}</span>
                    </div>
                  ))}
                </div>
                <div className="text-xs font-mono p-2 rounded" style={{ background: "rgba(0,0,0,0.3)", color: "#60A5FA", wordBreak: "break-all" }}>
                  Ed25519: 3d4f8a2b9c1e7f6a5d3b2c8e9f1a4b7c...
                </div>
              </div>
              <button onClick={reset} className="mt-6 px-6 py-3 rounded-xl font-semibold text-sm" style={{ background: "rgba(212,160,23,0.15)", color: "#D4A017", border: "1px solid rgba(212,160,23,0.3)" }}>
                Run Another Simulation
              </button>
            </div>
          )}
        </div>

        {/* Navigation */}
        {step < 5 && (
          <div className="flex justify-between">
            <button
              onClick={() => setStep(s => Math.max(1, s - 1))}
              disabled={step === 1}
              className="px-6 py-3 rounded-xl text-sm font-semibold transition-all"
              style={{ background: "rgba(255,255,255,0.06)", color: step === 1 ? "#4A5568" : "#8BA0B8", cursor: step === 1 ? "not-allowed" : "pointer" }}
            >
              ← Back
            </button>
            <button
              onClick={() => setStep(s => s + 1)}
              disabled={!canAdvance()}
              className="flex items-center gap-2 px-6 py-3 rounded-xl text-sm font-semibold transition-all"
              style={{
                background: canAdvance() ? "#D4A017" : "rgba(212,160,23,0.3)",
                color: canAdvance() ? "#0A1628" : "#8BA0B8",
                cursor: canAdvance() ? "pointer" : "not-allowed"
              }}
            >
              {step === 4 ? "Issue Permit" : "Continue"} <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        )}
      </div>
    </section>
  );
}
