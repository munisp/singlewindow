/**
 * Cost Estimation Calculator — Interactive sliders for CAPEX/OPEX estimation
 * Design: Sovereign Blueprint — Deep Navy + Gold
 * Based on: Ghana ICUMS, Rwanda ReSW, and Singapore NTP cost benchmarks
 */

import { useState, useMemo } from "react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Cell, Legend
} from "recharts";
import { Info } from "lucide-react";

// ─── TYPES ───────────────────────────────────────────────────────────────────

interface SliderConfig {
  id: string;
  label: string;
  min: number;
  max: number;
  step: number;
  default: number;
  unit: string;
  description: string;
  multiplier: number; // cost impact per unit (USD thousands)
}

// ─── SLIDER CONFIGS ───────────────────────────────────────────────────────────

const sliders: SliderConfig[] = [
  {
    id: "ogas",
    label: "Number of OGAs Integrated",
    min: 5,
    max: 50,
    step: 1,
    default: 20,
    unit: "agencies",
    description: "Each additional OGA requires integration development, testing, and change management.",
    multiplier: 85, // $85K per OGA
  },
  {
    id: "declarations",
    label: "Annual Declaration Volume",
    min: 100000,
    max: 10000000,
    step: 100000,
    default: 1000000,
    unit: "declarations/yr",
    description: "Higher volumes require more compute, storage, and infrastructure capacity.",
    multiplier: 0.000035, // $35 per 1000 declarations in infra cost
  },
  {
    id: "team",
    label: "Core Implementation Team Size",
    min: 10,
    max: 120,
    step: 5,
    default: 40,
    unit: "FTEs",
    description: "Includes Go/Python developers, DevOps, security, data engineers, and project managers.",
    multiplier: 180, // $180K avg fully-loaded cost per FTE per year
  },
  {
    id: "regions",
    label: "Cloud Regions / Data Centers",
    min: 1,
    max: 5,
    step: 1,
    default: 2,
    unit: "regions",
    description: "Multi-region deployment for high availability and disaster recovery.",
    multiplier: 420, // $420K per region per year
  },
  {
    id: "border_posts",
    label: "Border Posts / Ports of Entry",
    min: 1,
    max: 30,
    step: 1,
    default: 8,
    unit: "locations",
    description: "Each border post requires hardware, connectivity, and local training.",
    multiplier: 95, // $95K per border post
  },
  {
    id: "months",
    label: "Implementation Timeline",
    min: 12,
    max: 36,
    step: 3,
    default: 24,
    unit: "months",
    description: "Longer timelines increase total project cost but reduce delivery risk.",
    multiplier: 120, // $120K per additional month
  },
];

// ─── PHASE COST MODEL ─────────────────────────────────────────────────────────

function computeCosts(values: Record<string, number>) {
  const { ogas, declarations, team, regions, border_posts, months } = values;

  // Base costs (USD thousands)
  const infraBase = regions * 420 + (declarations / 1000000) * 35;
  const teamBase = team * 180;
  const integrationBase = ogas * 85;
  const hardwareBase = border_posts * 95;

  // Phase weights (% of total)
  const totalMonths = months;
  const phase1Months = Math.min(6, totalMonths * 0.25);
  const phase2Months = Math.min(6, totalMonths * 0.25);
  const phase3Months = Math.min(6, totalMonths * 0.25);
  const phase4Months = totalMonths - phase1Months - phase2Months - phase3Months;

  const monthlyBurn = teamBase / 12 + infraBase / 12;

  const phase1Capex = phase1Months * monthlyBurn * 0.8 + hardwareBase * 0.4 + 800; // infra setup
  const phase2Capex = phase2Months * monthlyBurn * 1.1 + integrationBase * 0.3 + 600; // core customs
  const phase3Capex = phase3Months * monthlyBurn * 1.0 + integrationBase * 0.7 + 400; // full SW
  const phase4Capex = phase4Months * monthlyBurn * 0.9 + 500; // analytics

  const annualOpex = infraBase + (teamBase * 0.3) + (hardwareBase * 0.15); // 30% team for ops + 15% hardware maintenance

  return {
    phase1: Math.round(phase1Capex),
    phase2: Math.round(phase2Capex),
    phase3: Math.round(phase3Capex),
    phase4: Math.round(phase4Capex),
    totalCapex: Math.round(phase1Capex + phase2Capex + phase3Capex + phase4Capex),
    annualOpex: Math.round(annualOpex),
    fiveYearTCO: Math.round(phase1Capex + phase2Capex + phase3Capex + phase4Capex + annualOpex * 5),
  };
}

// ─── SLIDER COMPONENT ────────────────────────────────────────────────────────

function SliderInput({
  config,
  value,
  onChange,
}: {
  config: SliderConfig;
  value: number;
  onChange: (v: number) => void;
}) {
  const pct = ((value - config.min) / (config.max - config.min)) * 100;

  const formatValue = (v: number) => {
    if (v >= 1000000) return `${(v / 1000000).toFixed(1)}M`;
    if (v >= 1000) return `${(v / 1000).toFixed(0)}K`;
    return v.toString();
  };

  return (
    <div className="space-y-2">
      <div className="flex justify-between items-start">
        <div>
          <div className="text-sm font-medium text-white">{config.label}</div>
          <div className="text-xs text-slate-500 mt-0.5">{config.description}</div>
        </div>
        <div className="text-right shrink-0 ml-4">
          <div className="text-lg font-bold text-gold font-display">{formatValue(value)}</div>
          <div className="text-xs text-slate-500">{config.unit}</div>
        </div>
      </div>
      <div className="relative">
        <input
          type="range"
          min={config.min}
          max={config.max}
          step={config.step}
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          className="w-full h-1.5 rounded-full appearance-none cursor-pointer"
          style={{
            background: `linear-gradient(to right, oklch(0.72 0.14 75) 0%, oklch(0.72 0.14 75) ${pct}%, oklch(0.25 0.04 240) ${pct}%, oklch(0.25 0.04 240) 100%)`,
          }}
        />
      </div>
      <div className="flex justify-between text-xs text-slate-600">
        <span>{formatValue(config.min)}</span>
        <span>{formatValue(config.max)}</span>
      </div>
    </div>
  );
}

// ─── MAIN COMPONENT ──────────────────────────────────────────────────────────

export default function CostCalculator() {
  const [values, setValues] = useState<Record<string, number>>(
    Object.fromEntries(sliders.map((s) => [s.id, s.default]))
  );
  const [showBreakdown, setShowBreakdown] = useState(false);

  const costs = useMemo(() => computeCosts(values), [values]);

  const chartData = [
    { phase: "Phase 1\nFoundation", capex: costs.phase1, color: "#1E3A5F" },
    { phase: "Phase 2\nCore Customs", capex: costs.phase2, color: "#D4A017" },
    { phase: "Phase 3\nFull SW", capex: costs.phase3, color: "#0E6655" },
    { phase: "Phase 4\nIntelligence", capex: costs.phase4, color: "#6B21A8" },
  ];

  const formatUSD = (v: number) => {
    if (v >= 1000) return `$${(v / 1000).toFixed(1)}M`;
    return `$${v}K`;
  };

  const updateValue = (id: string, v: number) => {
    setValues((prev) => ({ ...prev, [id]: v }));
  };

  return (
    <div className="grid lg:grid-cols-2 gap-8">
      {/* Sliders */}
      <div className="space-y-6">
        <div className="text-xs font-mono tracking-widest text-gold uppercase mb-2">
          Adjust Parameters
        </div>
        {sliders.map((s) => (
          <SliderInput
            key={s.id}
            config={s}
            value={values[s.id]}
            onChange={(v) => updateValue(s.id, v)}
          />
        ))}

        {/* Disclaimer */}
        <div className="flex gap-2 p-3 rounded-lg bg-white/5 border border-white/10 text-xs text-slate-500">
          <Info size={14} className="shrink-0 mt-0.5 text-gold/50" />
          <span>
            Estimates are indicative ranges based on Ghana ICUMS, Rwanda ReSW, and Singapore NTP benchmark data. Actual costs depend on local labour rates, existing infrastructure, and procurement approach. Engage a qualified systems integrator for detailed costing.
          </span>
        </div>
      </div>

      {/* Results */}
      <div className="space-y-5">
        <div className="text-xs font-mono tracking-widest text-gold uppercase mb-2">
          Cost Estimate
        </div>

        {/* Summary Cards */}
        <div className="grid grid-cols-3 gap-3">
          {[
            { label: "Total CAPEX", value: formatUSD(costs.totalCapex), sub: "Implementation cost", color: "#D4A017" },
            { label: "Annual OPEX", value: formatUSD(costs.annualOpex), sub: "Ongoing operations", color: "#0E6655" },
            { label: "5-Year TCO", value: formatUSD(costs.fiveYearTCO), sub: "Total cost of ownership", color: "#6B21A8" },
          ].map((card) => (
            <div
              key={card.label}
              className="rounded-xl border border-white/10 p-4 text-center"
              style={{ backgroundColor: card.color + "20" }}
            >
              <div className="text-xs text-slate-400 mb-1">{card.label}</div>
              <div className="text-xl font-bold font-display" style={{ color: card.color }}>
                {card.value}
              </div>
              <div className="text-xs text-slate-500 mt-0.5">{card.sub}</div>
            </div>
          ))}
        </div>

        {/* Phase Bar Chart */}
        <div className="bg-navy-800/40 border border-white/10 rounded-xl p-4">
          <div className="text-xs text-slate-400 mb-3">CAPEX by Implementation Phase (USD thousands)</div>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={chartData} margin={{ top: 5, right: 10, left: 0, bottom: 20 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
              <XAxis
                dataKey="phase"
                tick={{ fill: "#94A3B8", fontSize: 10 }}
                angle={0}
                interval={0}
              />
              <YAxis tick={{ fill: "#94A3B8", fontSize: 10 }} tickFormatter={(v) => `$${v}K`} />
              <Tooltip
                contentStyle={{ backgroundColor: "#0A1628", border: "1px solid rgba(212,160,23,0.3)", borderRadius: 8 }}
                labelStyle={{ color: "#D4A017" }}
                formatter={(v: number) => [`$${v}K`, "CAPEX"]}
              />
              <Bar dataKey="capex" radius={[4, 4, 0, 0]}>
                {chartData.map((entry, i) => (
                  <Cell key={i} fill={entry.color} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Breakdown Toggle */}
        <button
          onClick={() => setShowBreakdown(!showBreakdown)}
          className="text-xs text-gold hover:text-gold/70 transition-colors flex items-center gap-1"
        >
          {showBreakdown ? "Hide" : "Show"} cost breakdown by category
        </button>

        {showBreakdown && (
          <div className="rounded-xl border border-white/10 overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-white/5">
                <tr>
                  <th className="text-left px-4 py-2 text-slate-400 font-normal text-xs">Category</th>
                  <th className="text-right px-4 py-2 text-slate-400 font-normal text-xs">Annual</th>
                  <th className="text-right px-4 py-2 text-slate-400 font-normal text-xs">5-Year</th>
                </tr>
              </thead>
              <tbody>
                {[
                  { cat: "Infrastructure (Cloud + DC)", annual: Math.round((values.regions * 420 + (values.declarations / 1000000) * 35)), pct: 35 },
                  { cat: "Team (Dev + Ops + PM)", annual: Math.round(values.team * 180 * 0.3), pct: 30 },
                  { cat: "OGA Integrations", annual: Math.round(values.ogas * 85 / values.months * 12), pct: 20 },
                  { cat: "Hardware (Border Posts)", annual: Math.round(values.border_posts * 95 * 0.15), pct: 10 },
                  { cat: "Security & Compliance", annual: Math.round(costs.annualOpex * 0.08), pct: 5 },
                ].map((row, i) => (
                  <tr key={row.cat} className={i % 2 === 0 ? "bg-white/2" : ""}>
                    <td className="px-4 py-2 text-slate-300 text-xs">{row.cat}</td>
                    <td className="px-4 py-2 text-right text-white text-xs font-medium">{formatUSD(row.annual)}</td>
                    <td className="px-4 py-2 text-right text-gold text-xs font-medium">{formatUSD(row.annual * 5)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Benchmark Comparison */}
        <div className="rounded-xl border border-white/10 p-4 bg-white/3">
          <div className="text-xs text-slate-400 mb-3">Benchmark Reference Points</div>
          <div className="space-y-2 text-xs text-slate-400">
            <div className="flex justify-between">
              <span>Ghana ICUMS (2020, nationwide)</span>
              <span className="text-white">~$45M total</span>
            </div>
            <div className="flex justify-between">
              <span>Rwanda ReSW (2012, 28 agencies)</span>
              <span className="text-white">~$12M total</span>
            </div>
            <div className="flex justify-between">
              <span>Singapore NTP (2018, full ecosystem)</span>
              <span className="text-white">~$250M+ total</span>
            </div>
            <div className="flex justify-between border-t border-white/10 pt-2 mt-2">
              <span className="text-gold">Your Estimate</span>
              <span className="text-gold font-bold">{formatUSD(costs.totalCapex)} CAPEX</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
