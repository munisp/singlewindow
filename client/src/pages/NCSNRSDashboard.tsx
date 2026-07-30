import React, { useState } from "react";
import { trpc } from "../utils/trpc";
import {
  BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ResponsiveContainer, PieChart, Pie, Cell,
} from "recharts";

const COLORS = ["#22c55e", "#f59e0b", "#ef4444", "#3b82f6", "#8b5cf6"];

const formatNGN = (v: number) =>
  v >= 1_000_000_000 ? `₦${(v / 1_000_000_000).toFixed(2)}B`
  : v >= 1_000_000    ? `₦${(v / 1_000_000).toFixed(1)}M`
  : `₦${v.toLocaleString()}`;

export default function NCSNRSDashboard() {
  const now = new Date();
  const [period, setPeriod] = useState(now.toISOString().slice(0, 7));
  const [activeTab, setActiveTab] = useState<"overview" | "exceptions" | "audit" | "tin">("overview");
  const [exceptionStatus, setExceptionStatus] = useState<"OPEN" | "RESOLVED">("OPEN");
  const [tinQuery, setTinQuery] = useState("");
  const [tinSearchType, setTinSearchType] = useState<"TIN" | "CAC" | "NIN" | "NAME">("NAME");
  const [resolveId, setResolveId] = useState<string | null>(null);
  const [resolveNote, setResolveNote] = useState("");

  const reconciliation = trpc.ncsNrs.getReconciliation.useQuery({ period });
  const pipelineStats = trpc.ncsNrs.getPipelineStats.useQuery({ period });
  const exceptions = trpc.ncsNrs.getExceptions.useQuery({ status: exceptionStatus });
  const cbnRate = trpc.ncsNrs.getCBNRate.useQuery();
  const tinSearch = trpc.ncsNrs.searchTINRegistry.useQuery(
    { query: tinQuery, searchType: tinSearchType },
    { enabled: tinQuery.length >= 3 }
  );
  const resolveException = trpc.ncsNrs.resolveException.useMutation({
    onSuccess: () => { setResolveId(null); setResolveNote(""); exceptions.refetch(); },
  });

  const stats = pipelineStats.data as any ?? {};
  const recon = reconciliation.data as any ?? {};

  const matchPieData = [
    { name: "TIN Matched", value: Number(stats.tin_matched ?? 0) },
    { name: "No Match", value: Number(stats.tin_unmatched ?? 0) },
  ];

  const slaData = [
    { name: "Within SLA (≤15 min)", value: Number(stats.prefills_sent ?? 0) - Number(stats.sla_breaches ?? 0) },
    { name: "SLA Breached (>15 min)", value: Number(stats.sla_breaches ?? 0) },
  ];

  return (
    <div className="p-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">NCS–NRS Integration Dashboard</h1>
          <p className="text-sm text-gray-500 mt-1">
            NSW Phase 1 — NCS/FIRS Joint Delivery · Import VAT-at-Border Pipeline
          </p>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-sm text-gray-500">CBN Rate:</span>
          <span className="font-semibold text-green-700">
            ₦{Number(cbnRate.data?.rate ?? 1580).toLocaleString()}/USD
          </span>
          <input
            type="month"
            value={period}
            onChange={e => setPeriod(e.target.value)}
            className="border rounded px-2 py-1 text-sm"
          />
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        {[
          { label: "Declarations Ingested", value: stats.total_declarations ?? 0, color: "blue" },
          { label: "Import VAT Computed", value: formatNGN(Number(stats.total_vat_ngn ?? 0)), color: "green" },
          { label: "TIN Match Rate", value: `${((Number(stats.tin_matched ?? 0) / Math.max(Number(stats.total_declarations ?? 1), 1)) * 100).toFixed(1)}%`, color: "purple" },
          { label: "SLA Breaches (>15 min)", value: stats.sla_breaches ?? 0, color: "red" },
        ].map(kpi => (
          <div key={kpi.label} className={`bg-white rounded-lg shadow p-4 border-l-4 border-${kpi.color}-500`}>
            <p className="text-xs text-gray-500">{kpi.label}</p>
            <p className="text-2xl font-bold text-gray-900 mt-1">{kpi.value}</p>
          </div>
        ))}
      </div>

      {/* Secondary KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        {[
          { label: "Landing Cost Total", value: formatNGN(Number(stats.total_landing_cost_ngn ?? 0)) },
          { label: "NRS Pre-fills Sent", value: stats.prefills_sent ?? 0 },
          { label: "Avg Visibility Time", value: `${Number(stats.avg_visibility_min ?? 0).toFixed(1)} min` },
          { label: "Open Exceptions", value: recon.exceptions_open ?? 0 },
        ].map(kpi => (
          <div key={kpi.label} className="bg-white rounded-lg shadow p-4">
            <p className="text-xs text-gray-500">{kpi.label}</p>
            <p className="text-xl font-semibold text-gray-800 mt-1">{kpi.value}</p>
          </div>
        ))}
      </div>

      {/* Tabs */}
      <div className="flex gap-2 mb-4 border-b">
        {(["overview", "exceptions", "audit", "tin"] as const).map(tab => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-4 py-2 text-sm font-medium capitalize border-b-2 transition-colors ${
              activeTab === tab ? "border-blue-600 text-blue-600" : "border-transparent text-gray-500 hover:text-gray-700"
            }`}
          >
            {tab === "tin" ? "TIN Registry" : tab.charAt(0).toUpperCase() + tab.slice(1)}
          </button>
        ))}
      </div>

      {/* Overview Tab */}
      {activeTab === "overview" && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* TIN Match Pie */}
          <div className="bg-white rounded-lg shadow p-4">
            <h3 className="font-semibold text-gray-700 mb-3">Importer TIN Match Status</h3>
            <ResponsiveContainer width="100%" height={220}>
              <PieChart>
                <Pie data={matchPieData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={80} label>
                  {matchPieData.map((_, i) => <Cell key={i} fill={COLORS[i]} />)}
                </Pie>
                <Tooltip />
                <Legend />
              </PieChart>
            </ResponsiveContainer>
          </div>

          {/* SLA Compliance Pie */}
          <div className="bg-white rounded-lg shadow p-4">
            <h3 className="font-semibold text-gray-700 mb-3">VAT Visibility SLA (≤15 min target)</h3>
            <ResponsiveContainer width="100%" height={220}>
              <PieChart>
                <Pie data={slaData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={80} label>
                  {slaData.map((_, i) => <Cell key={i} fill={i === 0 ? "#22c55e" : "#ef4444"} />)}
                </Pie>
                <Tooltip />
                <Legend />
              </PieChart>
            </ResponsiveContainer>
          </div>

          {/* Pipeline Flow Summary */}
          <div className="bg-white rounded-lg shadow p-4 md:col-span-2">
            <h3 className="font-semibold text-gray-700 mb-3">NCS→NRS Pipeline Flow</h3>
            <div className="flex items-center justify-between text-center text-sm">
              {[
                { label: "Declarations Ingested", value: stats.total_declarations ?? 0, color: "bg-blue-100 text-blue-800" },
                { label: "→" },
                { label: "Landing Costs Computed", value: stats.landing_costs_computed ?? 0, color: "bg-purple-100 text-purple-800" },
                { label: "→" },
                { label: "TIN Matched", value: stats.tin_matched ?? 0, color: "bg-green-100 text-green-800" },
                { label: "→" },
                { label: "NRS Pre-fills Sent", value: stats.prefills_sent ?? 0, color: "bg-yellow-100 text-yellow-800" },
              ].map((step, i) => (
                "label" in step && "value" in step ? (
                  <div key={i} className={`rounded-lg px-4 py-3 ${step.color}`}>
                    <div className="text-2xl font-bold">{step.value}</div>
                    <div className="text-xs mt-1">{step.label}</div>
                  </div>
                ) : (
                  <div key={i} className="text-gray-400 text-xl">→</div>
                )
              ))}
            </div>
          </div>

          {/* Data Model Summary */}
          <div className="bg-white rounded-lg shadow p-4 md:col-span-2">
            <h3 className="font-semibold text-gray-700 mb-3">NCS–NRS Data Model (NSW Phase 1 ICD)</h3>
            <div className="overflow-x-auto">
              <table className="min-w-full text-xs">
                <thead>
                  <tr className="bg-gray-50">
                    <th className="px-3 py-2 text-left">Data Field</th>
                    <th className="px-3 py-2 text-left">Source</th>
                    <th className="px-3 py-2 text-left">Standard</th>
                    <th className="px-3 py-2 text-left">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {[
                    ["Declaration Number (SAD)", "NCS", "WCO SAD", "✅ Live"],
                    ["UCR (Unique Consignment Ref)", "NCS", "WCO UCR", "✅ Live"],
                    ["HS Code (8-digit)", "NCS", "WCO HS 2022", "✅ Live"],
                    ["Importer TIN (12-digit FIRS)", "NCS/FIRS", "FIRS TIN", "✅ Live"],
                    ["Importer CAC-RC", "NCS/CAC", "CAC Registry", "✅ Live"],
                    ["CIF Value (USD)", "NCS", "WCO CVA", "✅ Live"],
                    ["Landing Cost (NGN)", "NCS-NRS Gateway", "NRS/FIRS", "✅ Live"],
                    ["Import Duty (NGN)", "NCS-NRS Gateway", "NCS CET 2024", "✅ Live"],
                    ["CISS Levy (1% of CIF)", "NCS-NRS Gateway", "CISS Act", "✅ Live"],
                    ["ETL Levy (0.5% of CIF)", "NCS-NRS Gateway", "ECOWAS ETL", "✅ Live"],
                    ["NTA Levy (0.5% of CIF)", "NCS-NRS Gateway", "NTA Act", "✅ Live"],
                    ["Import VAT (7.5% of Landing)", "NCS-NRS Gateway", "VATA 2023 s.10", "✅ Live"],
                    ["ISO 20022 Payment Ref", "NCS-NRS Gateway", "pain.001 EndToEndId", "✅ Live"],
                    ["CBN Exchange Rate", "CBN Official", "CBN Circular", "✅ Live"],
                    ["NRS Assessment Pre-fill", "NCS-NRS Gateway", "NSW ICD", "✅ Live"],
                  ].map(([field, source, standard, status]) => (
                    <tr key={field} className="hover:bg-gray-50">
                      <td className="px-3 py-2 font-medium">{field}</td>
                      <td className="px-3 py-2 text-gray-500">{source}</td>
                      <td className="px-3 py-2 text-gray-500">{standard}</td>
                      <td className="px-3 py-2 text-green-700 font-medium">{status}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* Exceptions Tab */}
      {activeTab === "exceptions" && (
        <div className="bg-white rounded-lg shadow p-4">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold text-gray-700">Exception Queue</h3>
            <div className="flex gap-2">
              {(["OPEN", "RESOLVED"] as const).map(s => (
                <button
                  key={s}
                  onClick={() => setExceptionStatus(s)}
                  className={`px-3 py-1 text-sm rounded-full ${
                    exceptionStatus === s ? "bg-blue-600 text-white" : "bg-gray-100 text-gray-600"
                  }`}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="bg-gray-50">
                  <th className="px-3 py-2 text-left">Type</th>
                  <th className="px-3 py-2 text-left">Severity</th>
                  <th className="px-3 py-2 text-left">Description</th>
                  <th className="px-3 py-2 text-left">Created</th>
                  <th className="px-3 py-2 text-left">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {((exceptions.data as any)?.exceptions ?? []).map((ex: any) => (
                  <tr key={ex.id} className="hover:bg-gray-50">
                    <td className="px-3 py-2">
                      <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                        ex.exception_type === "MISSING_TIN" ? "bg-red-100 text-red-700"
                        : ex.exception_type === "TIN_MISMATCH" ? "bg-yellow-100 text-yellow-700"
                        : ex.exception_type === "LATE_VISIBILITY" ? "bg-orange-100 text-orange-700"
                        : "bg-gray-100 text-gray-700"
                      }`}>
                        {ex.exception_type}
                      </span>
                    </td>
                    <td className="px-3 py-2">
                      <span className={`text-xs font-semibold ${
                        ex.severity === "HIGH" ? "text-red-600"
                        : ex.severity === "MEDIUM" ? "text-yellow-600"
                        : "text-gray-500"
                      }`}>{ex.severity}</span>
                    </td>
                    <td className="px-3 py-2 text-gray-700 max-w-xs truncate">{ex.description}</td>
                    <td className="px-3 py-2 text-gray-500 text-xs">
                      {new Date(ex.created_at).toLocaleString()}
                    </td>
                    <td className="px-3 py-2">
                      {ex.status === "OPEN" && (
                        <button
                          onClick={() => setResolveId(ex.id)}
                          className="text-xs text-blue-600 hover:underline"
                        >
                          Resolve
                        </button>
                      )}
                      {ex.status === "RESOLVED" && (
                        <span className="text-xs text-green-600">✓ Resolved</span>
                      )}
                    </td>
                  </tr>
                ))}
                {((exceptions.data as any)?.exceptions ?? []).length === 0 && (
                  <tr><td colSpan={5} className="px-3 py-8 text-center text-gray-400">No {exceptionStatus.toLowerCase()} exceptions</td></tr>
                )}
              </tbody>
            </table>
          </div>

          {/* Resolve Modal */}
          {resolveId && (
            <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
              <div className="bg-white rounded-lg shadow-xl p-6 w-full max-w-md">
                <h3 className="font-semibold text-gray-800 mb-3">Resolve Exception</h3>
                <textarea
                  value={resolveNote}
                  onChange={e => setResolveNote(e.target.value)}
                  placeholder="Resolution note (required)"
                  className="w-full border rounded p-2 text-sm h-24 mb-3"
                />
                <div className="flex gap-2 justify-end">
                  <button onClick={() => setResolveId(null)} className="px-4 py-2 text-sm text-gray-600 border rounded">Cancel</button>
                  <button
                    onClick={() => resolveException.mutate({ exceptionId: resolveId, resolutionNote: resolveNote })}
                    disabled={!resolveNote.trim() || resolveException.isPending}
                    className="px-4 py-2 text-sm bg-blue-600 text-white rounded disabled:opacity-50"
                  >
                    {resolveException.isPending ? "Resolving..." : "Resolve"}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* TIN Registry Tab */}
      {activeTab === "tin" && (
        <div className="bg-white rounded-lg shadow p-4">
          <h3 className="font-semibold text-gray-700 mb-4">FIRS TIN Registry Search</h3>
          <div className="flex gap-2 mb-4">
            <select
              value={tinSearchType}
              onChange={e => setTinSearchType(e.target.value as any)}
              className="border rounded px-3 py-2 text-sm"
            >
              <option value="NAME">Company Name</option>
              <option value="TIN">FIRS TIN</option>
              <option value="CAC">CAC-RC Number</option>
              <option value="NIN">NIN</option>
            </select>
            <input
              type="text"
              value={tinQuery}
              onChange={e => setTinQuery(e.target.value)}
              placeholder={`Search by ${tinSearchType}...`}
              className="flex-1 border rounded px-3 py-2 text-sm"
            />
          </div>
          {tinQuery.length >= 3 && (
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="bg-gray-50">
                    <th className="px-3 py-2 text-left">TIN</th>
                    <th className="px-3 py-2 text-left">Registered Name</th>
                    <th className="px-3 py-2 text-left">CAC-RC</th>
                    <th className="px-3 py-2 text-left">Type</th>
                    <th className="px-3 py-2 text-left">State</th>
                    <th className="px-3 py-2 text-left">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {((tinSearch.data as any[]) ?? []).map((row: any, i: number) => (
                    <tr key={i} className="hover:bg-gray-50">
                      <td className="px-3 py-2 font-mono text-xs">{row.tin}</td>
                      <td className="px-3 py-2 font-medium">{row.registered_name}</td>
                      <td className="px-3 py-2 text-gray-500">{row.cac_rc ?? "—"}</td>
                      <td className="px-3 py-2 text-gray-500">{row.entity_type}</td>
                      <td className="px-3 py-2 text-gray-500">{row.state ?? "—"}</td>
                      <td className="px-3 py-2">
                        <span className={`text-xs font-medium ${row.active ? "text-green-600" : "text-red-500"}`}>
                          {row.active ? "Active" : "Inactive"}
                        </span>
                      </td>
                    </tr>
                  ))}
                  {tinSearch.isFetching && (
                    <tr><td colSpan={6} className="px-3 py-4 text-center text-gray-400">Searching...</td></tr>
                  )}
                  {!tinSearch.isFetching && ((tinSearch.data as any[]) ?? []).length === 0 && (
                    <tr><td colSpan={6} className="px-3 py-4 text-center text-gray-400">No results found</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Audit Trail Tab */}
      {activeTab === "audit" && (
        <div className="bg-white rounded-lg shadow p-4">
          <h3 className="font-semibold text-gray-700 mb-4">Reconciliation Audit Trail</h3>
          <p className="text-sm text-gray-500 mb-4">
            100% audit trail of all NCS→NRS pipeline events per NSW Phase 1 ICD requirement.
            Enter a declaration number or ID to view its complete event history.
          </p>
          <div className="flex gap-2 mb-4">
            <input
              type="text"
              placeholder="Declaration number or ID..."
              className="flex-1 border rounded px-3 py-2 text-sm"
              id="audit-decl-input"
            />
            <button
              onClick={() => {
                const val = (document.getElementById("audit-decl-input") as HTMLInputElement)?.value;
                if (val) window.location.hash = `audit-${val}`;
              }}
              className="px-4 py-2 text-sm bg-blue-600 text-white rounded"
            >
              Search
            </button>
          </div>
          <div className="text-sm text-gray-400 italic">
            Audit events include: DECLARATION_INGESTED, LANDING_COST_COMPUTED, TIN_MATCHED,
            NRS_PREFILL_GENERATED, NRS_PREFILL_SENT, and exception events.
          </div>
        </div>
      )}
    </div>
  );
}
