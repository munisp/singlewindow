import React, { useState } from "react";
import { trpc } from "@/lib/trpc";
import {
  PieChart, Pie, Cell, Tooltip, Legend, ResponsiveContainer,
} from "recharts";
import { humanizeLabel } from "@/lib/formatters";

const formatNGN = (v: number) =>
  v >= 1_000_000_000 ? `₦${(v / 1_000_000_000).toFixed(2)}B`
  : v >= 1_000_000    ? `₦${(v / 1_000_000).toFixed(1)}M`
  : `₦${v.toLocaleString()}`;

// Static Tailwind classes (no dynamic interpolation — prevents purge issues)
const SEVERITY_CLASSES: Record<string, string> = {
  HIGH:   "text-red-600 font-semibold",
  MEDIUM: "text-yellow-600 font-semibold",
  LOW:    "text-gray-500",
};
const EXCEPTION_BADGE: Record<string, string> = {
  MISSING_TIN:    "bg-red-100 text-red-700",
  TIN_MISMATCH:   "bg-yellow-100 text-yellow-700",
  LATE_VISIBILITY:"bg-orange-100 text-orange-700",
  NRS_PUSH_FAILED:"bg-purple-100 text-purple-700",
  VAT_CALC_ERROR: "bg-red-100 text-red-800",
};
const KPI_BORDER: Record<string, string> = {
  blue:   "border-l-4 border-blue-500",
  green:  "border-l-4 border-green-500",
  purple: "border-l-4 border-purple-500",
  red:    "border-l-4 border-red-500",
};

export default function NCSNRSDashboard() {
  const now = new Date();
  const [period, setPeriod] = useState(now.toISOString().slice(0, 7));
  const [activeTab, setActiveTab] = useState<"overview" | "exceptions" | "audit" | "tin">("overview");
  const [exceptionStatus, setExceptionStatus] = useState<"OPEN" | "RESOLVED">("OPEN");
  const [tinQuery, setTinQuery] = useState("");
  const [tinSearchType, setTinSearchType] = useState<"TIN" | "CAC" | "NIN" | "NAME">("NAME");
  const [resolveId, setResolveId] = useState<string | null>(null);
  const [resolveNote, setResolveNote] = useState("");
  const [auditDeclId, setAuditDeclId] = useState("");
  const [auditSearched, setAuditSearched] = useState("");

  const reconciliation = trpc.ncsNrs.getReconciliation.useQuery({ period });
  const pipelineStats = trpc.ncsNrs.getPipelineStats.useQuery({ period });
  const exceptions = trpc.ncsNrs.getExceptions.useQuery({ status: exceptionStatus });
  const cbnRate = trpc.ncsNrs.getCBNRate.useQuery();
  const tinSearch = trpc.ncsNrs.searchTINRegistry.useQuery(
    { query: tinQuery, searchType: tinSearchType },
    { enabled: tinQuery.length >= 3 }
  );
  // Audit trail — only fires when user explicitly searches
  const auditTrail = trpc.ncsNrs.getAuditTrail.useQuery(
    { declarationId: auditSearched },
    { enabled: auditSearched.length > 0 }
  );
  const resolveException = trpc.ncsNrs.resolveException.useMutation({
    onSuccess: () => { setResolveId(null); setResolveNote(""); exceptions.refetch(); },
  });

  const stats = (pipelineStats.data as any) ?? {};
  const totalDecl = Number(stats.total_declarations ?? 0);
  const tinMatched = Number(stats.tin_matched ?? 0);
  const tinMatchRate = totalDecl > 0 ? ((tinMatched / totalDecl) * 100).toFixed(1) : "0.0";

  const matchPieData = [
    { name: "TIN Matched", value: tinMatched },
    { name: "No Match",    value: Number(stats.tin_unmatched ?? 0) },
  ];
  const slaData = [
    { name: "Within SLA (≤15 min)", value: Number(stats.prefills_sent ?? 0) - Number(stats.sla_breaches ?? 0) },
    { name: "SLA Breached (>15 min)", value: Number(stats.sla_breaches ?? 0) },
  ];

  const kpis = [
    { label: "Declarations Ingested", value: totalDecl,                                 colorKey: "blue"   },
    { label: "Import VAT Computed",   value: formatNGN(Number(stats.total_vat_ngn ?? 0)), colorKey: "green"  },
    { label: "TIN Match Rate",        value: `${tinMatchRate}%`,                          colorKey: "purple" },
    { label: "SLA Breaches (>15 min)",value: Number(stats.sla_breaches ?? 0),             colorKey: "red"    },
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
        {kpis.map(kpi => (
          <div key={kpi.label} className={`bg-white rounded-lg shadow p-4 ${KPI_BORDER[kpi.colorKey]}`}>
            <p className="text-xs text-gray-500">{kpi.label}</p>
            <p className="text-2xl font-bold text-gray-900 mt-1">{String(kpi.value)}</p>
          </div>
        ))}
      </div>

      {/* Secondary KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        {[
          { label: "Landing Cost Total",  value: formatNGN(Number(stats.total_landing_cost_ngn ?? 0)) },
          { label: "NRS Pre-fills Sent",  value: stats.prefills_sent ?? 0 },
          { label: "Avg Visibility Time", value: `${Number(stats.avg_visibility_min ?? 0).toFixed(1)} min` },
          { label: "Open Exceptions",     value: (reconciliation.data as any)?.exceptions_open ?? 0 },
        ].map(kpi => (
          <div key={kpi.label} className="bg-white rounded-lg shadow p-4">
            <p className="text-xs text-gray-500">{kpi.label}</p>
            <p className="text-xl font-semibold text-gray-800 mt-1">{String(kpi.value)}</p>
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
              activeTab === tab
                ? "border-blue-600 text-blue-600"
                : "border-transparent text-gray-500 hover:text-gray-700"
            }`}
          >
            {tab === "tin" ? "TIN Registry" : tab.charAt(0).toUpperCase() + tab.slice(1)}
          </button>
        ))}
      </div>

      {/* ── Overview Tab ── */}
      {activeTab === "overview" && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="bg-white rounded-lg shadow p-4">
            <h3 className="font-semibold text-gray-700 mb-3">Importer TIN Match Status</h3>
            <ResponsiveContainer width="100%" height={220}>
              <PieChart>
                <Pie data={matchPieData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={80} label>
                  <Cell fill="#22c55e" />
                  <Cell fill="#ef4444" />
                </Pie>
                <Tooltip />
                <Legend />
              </PieChart>
            </ResponsiveContainer>
          </div>

          <div className="bg-white rounded-lg shadow p-4">
            <h3 className="font-semibold text-gray-700 mb-3">VAT Visibility SLA (≤15 min target)</h3>
            <ResponsiveContainer width="100%" height={220}>
              <PieChart>
                <Pie data={slaData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={80} label>
                  <Cell fill="#22c55e" />
                  <Cell fill="#ef4444" />
                </Pie>
                <Tooltip />
                <Legend />
              </PieChart>
            </ResponsiveContainer>
          </div>

          {/* Pipeline Flow */}
          <div className="bg-white rounded-lg shadow p-4 md:col-span-2">
            <h3 className="font-semibold text-gray-700 mb-3">NCS→NRS Pipeline Flow</h3>
            <div className="flex items-center justify-between text-center text-sm flex-wrap gap-2">
              {[
                { label: "Declarations Ingested",  value: stats.total_declarations ?? 0,  cls: "bg-blue-100 text-blue-800"   },
                { label: "→" },
                { label: "Landing Costs Computed", value: stats.landing_costs_computed ?? 0, cls: "bg-purple-100 text-purple-800" },
                { label: "→" },
                { label: "TIN Matched",            value: stats.tin_matched ?? 0,           cls: "bg-green-100 text-green-800"  },
                { label: "→" },
                { label: "NRS Pre-fills Sent",     value: stats.prefills_sent ?? 0,         cls: "bg-yellow-100 text-yellow-800"},
              ].map((step, i) =>
                "cls" in step ? (
                  <div key={i} className={`rounded-lg px-4 py-3 ${step.cls}`}>
                    <div className="text-2xl font-bold">{String(step.value)}</div>
                    <div className="text-xs mt-1">{step.label}</div>
                  </div>
                ) : (
                  <div key={i} className="text-gray-400 text-xl">{step.label}</div>
                )
              )}
            </div>
          </div>

          {/* Data Model */}
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

      {/* ── Exceptions Tab ── */}
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
                        EXCEPTION_BADGE[ex.exception_type] ?? "bg-gray-100 text-gray-700"
                      }`}>
                        <span title={ex.exception_type}>{humanizeLabel(ex.exception_type)}</span>
                      </span>
                    </td>
                    <td className="px-3 py-2">
                      <span className={`text-xs ${SEVERITY_CLASSES[ex.severity] ?? "text-gray-500"}`}>
                        <span title={ex.severity}>{humanizeLabel(ex.severity)}</span>
                      </span>
                    </td>
                    <td className="px-3 py-2 text-gray-700 max-w-xs truncate">{ex.description}</td>
                    <td className="px-3 py-2 text-gray-500 text-xs">
                      {new Date(ex.created_at).toLocaleString()}
                    </td>
                    <td className="px-3 py-2">
                      {ex.status === "OPEN" ? (
                        <button
                          onClick={() => setResolveId(ex.id)}
                          className="text-xs text-blue-600 hover:underline"
                        >
                          Resolve
                        </button>
                      ) : (
                        <span className="text-xs text-green-600">✓ Resolved</span>
                      )}
                    </td>
                  </tr>
                ))}
                {((exceptions.data as any)?.exceptions ?? []).length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-3 py-8 text-center text-gray-400">
                      No {exceptionStatus.toLowerCase()} exceptions
                    </td>
                  </tr>
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
                  <button
                    onClick={() => setResolveId(null)}
                    className="px-4 py-2 text-sm text-gray-600 border rounded"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={() => resolveException.mutate({
                      exceptionId: resolveId,
                      resolutionNote: resolveNote,
                    })}
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

      {/* ── Audit Trail Tab (fully wired to tRPC) ── */}
      {activeTab === "audit" && (
        <div className="bg-white rounded-lg shadow p-4">
          <h3 className="font-semibold text-gray-700 mb-2">Reconciliation Audit Trail</h3>
          <p className="text-sm text-gray-500 mb-4">
            100% audit trail of all NCS→NRS pipeline events per NSW Phase 1 ICD.
            Enter a declaration number or UUID to view its complete event history.
          </p>
          <div className="flex gap-2 mb-6">
            <input
              type="text"
              value={auditDeclId}
              onChange={e => setAuditDeclId(e.target.value)}
              placeholder="Declaration number (e.g. NCS-2026-001) or UUID..."
              className="flex-1 border rounded px-3 py-2 text-sm"
              onKeyDown={e => { if (e.key === "Enter") setAuditSearched(auditDeclId); }}
            />
            <button
              onClick={() => setAuditSearched(auditDeclId)}
              disabled={!auditDeclId.trim()}
              className="px-4 py-2 text-sm bg-blue-600 text-white rounded disabled:opacity-50"
            >
              Search
            </button>
          </div>

          {auditTrail.isFetching && (
            <div className="text-center text-gray-400 py-8">Loading audit trail...</div>
          )}

          {auditSearched && !auditTrail.isFetching && (
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="bg-gray-50">
                    <th className="px-3 py-2 text-left">Timestamp</th>
                    <th className="px-3 py-2 text-left">Event Type</th>
                    <th className="px-3 py-2 text-left">Declaration</th>
                    <th className="px-3 py-2 text-left">Importer</th>
                    <th className="px-3 py-2 text-left">Event Data (preview)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {((auditTrail.data as any[]) ?? []).map((row: any, i: number) => (
                    <tr key={i} className="hover:bg-gray-50">
                      <td className="px-3 py-2 text-xs text-gray-500 whitespace-nowrap">
                        {new Date(row.created_at).toLocaleString()}
                      </td>
                      <td className="px-3 py-2">
                        <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                          row.event_type === "DECLARATION_INGESTED"   ? "bg-blue-100 text-blue-700"
                          : row.event_type === "LANDING_COST_COMPUTED" ? "bg-purple-100 text-purple-700"
                          : row.event_type === "TIN_MATCHED"           ? "bg-green-100 text-green-700"
                          : row.event_type === "NRS_PREFILL_GENERATED" ? "bg-yellow-100 text-yellow-700"
                          : row.event_type === "NRS_PREFILL_SENT"      ? "bg-teal-100 text-teal-700"
                          : "bg-gray-100 text-gray-700"
                        }`}>
                          {row.event_type}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-xs font-mono">{row.declaration_number ?? "—"}</td>
                      <td className="px-3 py-2 text-xs">{row.importer_name ?? "—"}</td>
                      <td className="px-3 py-2 text-xs text-gray-500 max-w-xs truncate">
                        {typeof row.event_data === "object"
                          ? JSON.stringify(row.event_data).slice(0, 120) + "…"
                          : String(row.event_data ?? "").slice(0, 120)}
                      </td>
                    </tr>
                  ))}
                  {((auditTrail.data as any[]) ?? []).length === 0 && (
                    <tr>
                      <td colSpan={5} className="px-3 py-8 text-center text-gray-400">
                        No audit events found for "{auditSearched}"
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ── TIN Registry Tab ── */}
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
                    <tr>
                      <td colSpan={6} className="px-3 py-4 text-center text-gray-400">Searching...</td>
                    </tr>
                  )}
                  {!tinSearch.isFetching && ((tinSearch.data as any[]) ?? []).length === 0 && (
                    <tr>
                      <td colSpan={6} className="px-3 py-4 text-center text-gray-400">No results found</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
