import React, { useState } from "react";
import { trpc } from "@/lib/trpc";
import {
  BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ResponsiveContainer, PieChart, Pie, Cell,
} from "recharts";

const COLORS = ["#22c55e", "#f59e0b", "#ef4444", "#3b82f6", "#8b5cf6"];

const formatNGN = (v: number) =>
  v >= 1_000_000_000
    ? `₦${(v / 1_000_000_000).toFixed(1)}B`
    : v >= 1_000_000
    ? `₦${(v / 1_000_000).toFixed(1)}M`
    : `₦${v.toLocaleString()}`;

const formatUSD = (v: number) =>
  v >= 1_000_000 ? `$${(v / 1_000_000).toFixed(1)}M` : `$${v.toLocaleString()}`;

export default function TradeAnalyticsDashboard() {
  const [dateRange, setDateRange] = useState({
    from: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(),
    to:   new Date().toISOString(),
  });

  const stats       = trpc.tradeAnalytics.getTradeStats.useQuery(dateRange);
  const forecast    = trpc.tradeAnalytics.getRevenueForecast.useQuery({ months: 3 });
  const trs         = trpc.tradeAnalytics.getTRSBenchmark.useQuery(dateRange);
  const commodities = trpc.tradeAnalytics.getTopCommodities.useQuery({ ...dateRange, limit: 10 });
  const corridors   = trpc.tradeAnalytics.getTradeCorridors.useQuery({ ...dateRange, limit: 10 });
  const ports       = trpc.tradeAnalytics.getPortPerformance.useQuery(dateRange);

  const s = stats.data;
  const f = forecast.data;

  // Combine historical + forecast for revenue chart
  const revenueChartData = [
    ...(f?.historicalMonths ?? []).map((m: any) => ({
      month: m.month,
      actual: m.dutyNgn,
      forecast: null,
    })),
    ...(f?.forecast ?? []).map((m: any) => ({
      month: m.month,
      actual: null,
      forecast: m.forecastDutyNgn,
    })),
  ];

  const riskPieData = s ? [
    { name: "Green", value: s.riskLanes.green },
    { name: "Yellow", value: s.riskLanes.yellow },
    { name: "Red",    value: s.riskLanes.red },
  ] : [];

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Trade Analytics Dashboard</h1>
          <p className="text-sm text-gray-500 mt-1">
            WCO Time Release Study (TRS) & IMF DOTS aligned statistics
          </p>
        </div>
        <div className="flex gap-3">
          <input
            type="date"
            className="border rounded px-3 py-1 text-sm"
            value={dateRange.from.slice(0, 10)}
            onChange={e => setDateRange(d => ({ ...d, from: new Date(e.target.value).toISOString() }))}
          />
          <span className="self-center text-gray-400">to</span>
          <input
            type="date"
            className="border rounded px-3 py-1 text-sm"
            value={dateRange.to.slice(0, 10)}
            onChange={e => setDateRange(d => ({ ...d, to: new Date(e.target.value).toISOString() }))}
          />
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: "Total Declarations", value: s?.declarations.total.toLocaleString() ?? "—", color: "blue" },
          { label: "Clearance Rate",     value: s ? `${(s.declarations.clearanceRate * 100).toFixed(1)}%` : "—", color: "green" },
          { label: "Total Trade Value",  value: s ? formatUSD(s.revenue.totalDeclaredValueUsd) : "—", color: "purple" },
          { label: "Duty Collected",     value: s ? formatNGN(s.revenue.totalDutyNgn) : "—", color: "amber" },
        ].map(card => (
          <div key={card.label} className="bg-white rounded-xl border p-4 shadow-sm">
            <p className="text-sm text-gray-500">{card.label}</p>
            <p className={`text-2xl font-bold mt-1 text-${card.color}-600`}>{card.value}</p>
          </div>
        ))}
      </div>

      {/* Revenue Trend + Forecast */}
      <div className="bg-white rounded-xl border p-5 shadow-sm">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-semibold text-gray-800">Duty Revenue Trend & Forecast</h2>
          <span className={`text-xs px-2 py-1 rounded-full font-medium ${
            f?.trend === "increasing" ? "bg-green-100 text-green-700" :
            f?.trend === "decreasing" ? "bg-red-100 text-red-700" :
            "bg-gray-100 text-gray-600"
          }`}>
            {f?.trend === "increasing" ? "↑ Growing" :
             f?.trend === "decreasing" ? "↓ Declining" : "→ Stable"}
          </span>
        </div>
        <ResponsiveContainer width="100%" height={260}>
          <LineChart data={revenueChartData}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="month" tick={{ fontSize: 11 }} />
            <YAxis tickFormatter={v => formatNGN(v)} tick={{ fontSize: 11 }} />
            <Tooltip formatter={(v: number) => formatNGN(v)} />
            <Legend />
            <Line type="monotone" dataKey="actual"   stroke="#3b82f6" strokeWidth={2} dot={false} name="Actual" />
            <Line type="monotone" dataKey="forecast" stroke="#f59e0b" strokeWidth={2} strokeDasharray="5 5" dot={false} name="Forecast" />
          </LineChart>
        </ResponsiveContainer>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Risk Lane Distribution */}
        <div className="bg-white rounded-xl border p-5 shadow-sm">
          <h2 className="font-semibold text-gray-800 mb-4">Risk Lane Distribution</h2>
          <ResponsiveContainer width="100%" height={220}>
            <PieChart>
              <Pie data={riskPieData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={80} label>
                {riskPieData.map((_, i) => (
                  <Cell key={i} fill={COLORS[i]} />
                ))}
              </Pie>
              <Tooltip />
              <Legend />
            </PieChart>
          </ResponsiveContainer>
        </div>

        {/* TRS Benchmarking */}
        <div className="bg-white rounded-xl border p-5 shadow-sm">
          <h2 className="font-semibold text-gray-800 mb-4">WCO Time Release Study (TRS)</h2>
          <div className="space-y-3">
            {(trs.data?.trsData ?? []).slice(0, 6).map((t: any) => (
              <div key={`${t.riskLane}-${t.port}`} className="flex items-center gap-3">
                <span className={`w-16 text-xs font-medium px-2 py-0.5 rounded-full text-center ${
                  t.riskLane === "green" ? "bg-green-100 text-green-700" :
                  t.riskLane === "yellow" ? "bg-yellow-100 text-yellow-700" :
                  "bg-red-100 text-red-700"
                }`}>
                  {t.riskLane}
                </span>
                <span className="text-xs text-gray-500 w-20">{t.port}</span>
                <div className="flex-1 bg-gray-100 rounded-full h-2">
                  <div
                    className={`h-2 rounded-full ${
                      t.performanceVsTarget ? "bg-green-500" : "bg-red-500"
                    }`}
                    style={{ width: `${Math.min(100, (t.benchmark?.target / Math.max(t.medianHours, 0.1)) * 100)}%` }}
                  />
                </div>
                <span className="text-xs font-mono text-gray-700 w-16 text-right">
                  {t.medianHours.toFixed(1)}h
                </span>
                <span className="text-xs text-gray-400 w-16 text-right">
                  target: {t.benchmark?.target}h
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Top Commodities */}
      <div className="bg-white rounded-xl border p-5 shadow-sm">
        <h2 className="font-semibold text-gray-800 mb-4">Top Commodities by Trade Value</h2>
        <ResponsiveContainer width="100%" height={260}>
          <BarChart data={(commodities.data ?? []).slice(0, 10)}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="hsHeading" tick={{ fontSize: 11 }} />
            <YAxis yAxisId="left"  tickFormatter={v => formatUSD(v)} tick={{ fontSize: 11 }} />
            <YAxis yAxisId="right" orientation="right" tickFormatter={v => formatNGN(v)} tick={{ fontSize: 11 }} />
            <Tooltip />
            <Legend />
            <Bar yAxisId="left"  dataKey="totalValueUsd" fill="#3b82f6" name="Trade Value (USD)" />
            <Bar yAxisId="right" dataKey="totalDutyNgn"  fill="#22c55e" name="Duty (NGN)" />
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Port Performance Table */}
      <div className="bg-white rounded-xl border p-5 shadow-sm">
        <h2 className="font-semibold text-gray-800 mb-4">Port Performance</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-gray-500">
                <th className="pb-2 pr-4">Port</th>
                <th className="pb-2 pr-4 text-right">Declarations</th>
                <th className="pb-2 pr-4 text-right">Clearance Rate</th>
                <th className="pb-2 pr-4 text-right">Avg. Clearance</th>
                <th className="pb-2 text-right">Duty Collected</th>
              </tr>
            </thead>
            <tbody>
              {(ports.data ?? []).map((p: any) => (
                <tr key={p.port} className="border-b last:border-0">
                  <td className="py-2 pr-4 font-medium">{p.port}</td>
                  <td className="py-2 pr-4 text-right">{p.totalDeclarations.toLocaleString()}</td>
                  <td className="py-2 pr-4 text-right">
                    <span className={`font-medium ${p.clearanceRate >= 0.9 ? "text-green-600" : p.clearanceRate >= 0.7 ? "text-yellow-600" : "text-red-600"}`}>
                      {(p.clearanceRate * 100).toFixed(1)}%
                    </span>
                  </td>
                  <td className="py-2 pr-4 text-right">{p.avgClearanceHours.toFixed(1)}h</td>
                  <td className="py-2 text-right">{formatNGN(p.dutyCollectedNgn)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
