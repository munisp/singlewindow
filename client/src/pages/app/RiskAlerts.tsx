/**
 * Risk Alerts Page
 *
 * Features:
 *   - Manual trigger for nightly risk scan (admin only)
 *   - Scan history with result stats
 *   - Latest flagged declarations table
 *   - Quick "Open Case" action for high-risk declarations
 */

import { useState } from "react";
import { trpc } from "@/lib/trpc";
import DashboardLayout from "@/components/DashboardLayout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  AlertTriangle,
  Bell,
  CheckCircle2,
  Loader2,
  Play,
  RefreshCw,
  Shield,
  TrendingUp,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";

// ─── HELPERS ─────────────────────────────────────────────────────────────────

const LANE_COLORS = {
  red: "bg-red-500/20 text-red-300 border-red-500/30",
  yellow: "bg-yellow-500/20 text-yellow-300 border-yellow-500/30",
  green: "bg-emerald-500/20 text-emerald-300 border-emerald-500/30",
};

// ─── SCAN TRIGGER DIALOG ──────────────────────────────────────────────────────

function ScanTriggerDialog({ onComplete }: { onComplete: () => void }) {
  const [open, setOpen] = useState(false);
  const [threshold, setThreshold] = useState(0.8);
  const [periodHours, setPeriodHours] = useState(24);
  const [autoCreateCases, setAutoCreateCases] = useState(false);

  const utils = trpc.useUtils();
  const runScan = trpc.alerts.runNightlyRiskScan.useMutation({
    onSuccess: (data) => {
      toast.success(
        `Scan complete: ${data.highRiskCount} high-risk declaration${data.highRiskCount !== 1 ? "s" : ""} found${
          data.newCasesCreated > 0 ? `, ${data.newCasesCreated} cases created` : ""
        }${data.notificationSent ? " · Owner notified" : ""}`
      );
      utils.alerts.getRiskAlerts.invalidate();
      utils.alerts.getLatestFlaggedDeclarations.invalidate();
      setOpen(false);
      onComplete();
    },
    onError: (err) => toast.error(`Scan failed: ${err.message}`),
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" className="gap-2 bg-gold text-navy hover:bg-gold/90 font-semibold">
          <Play size={14} />
          Run Risk Scan
        </Button>
      </DialogTrigger>
      <DialogContent className="bg-navy-900 border-white/10 text-white max-w-md">
        <DialogHeader>
          <DialogTitle className="text-gold font-display">Configure Risk Scan</DialogTitle>
        </DialogHeader>
        <div className="space-y-6 pt-2">
          <div>
            <Label className="text-slate-300 text-xs mb-3 block">
              Risk Threshold: <span className="text-gold font-semibold">{threshold.toFixed(2)}</span>
            </Label>
            <Slider
              min={0.5}
              max={1}
              step={0.05}
              value={[threshold]}
              onValueChange={([v]) => setThreshold(v)}
              className="w-full"
            />
            <div className="flex justify-between text-xs text-slate-500 mt-1">
              <span>0.50 (moderate)</span>
              <span>1.00 (critical)</span>
            </div>
          </div>
          <div>
            <Label className="text-slate-300 text-xs mb-3 block">
              Scan Period: <span className="text-gold font-semibold">{periodHours}h</span>
            </Label>
            <Slider
              min={1}
              max={168}
              step={1}
              value={[periodHours]}
              onValueChange={([v]) => setPeriodHours(v)}
              className="w-full"
            />
            <div className="flex justify-between text-xs text-slate-500 mt-1">
              <span>1 hour</span>
              <span>7 days</span>
            </div>
          </div>
          <div className="flex items-center justify-between">
            <div>
              <Label className="text-slate-300 text-xs">Auto-create Fraud Cases</Label>
              <p className="text-xs text-slate-500 mt-0.5">
                Automatically open cases for red-lane declarations
              </p>
            </div>
            <Switch
              checked={autoCreateCases}
              onCheckedChange={setAutoCreateCases}
            />
          </div>
          <div className="flex justify-end gap-3 pt-2">
            <Button variant="ghost" onClick={() => setOpen(false)} className="text-slate-400">
              Cancel
            </Button>
            <Button
              onClick={() => runScan.mutate({ threshold, periodHours, autoCreateCases })}
              disabled={runScan.isPending}
              className="bg-gold text-navy hover:bg-gold/90 font-semibold"
            >
              {runScan.isPending ? (
                <Loader2 size={14} className="animate-spin mr-1" />
              ) : (
                <Play size={14} className="mr-1" />
              )}
              {runScan.isPending ? "Scanning..." : "Run Scan"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── MAIN PAGE ────────────────────────────────────────────────────────────────

export default function RiskAlerts() {
  const utils = trpc.useUtils();

  const { data: scanHistory, isLoading: historyLoading } = trpc.alerts.getRiskAlerts.useQuery({
    limit: 10,
  });

  const { data: flaggedData, isLoading: flaggedLoading } = trpc.alerts.getLatestFlaggedDeclarations.useQuery({
    limit: 50,
  });

  const createCase = trpc.fraudCases.createCase.useMutation({
    onSuccess: () => {
      toast.success("Fraud case opened");
      utils.fraudCases.listCases.invalidate();
    },
    onError: (err) => toast.error(`Failed to create case: ${err.message}`),
  });

  const latestScan = scanHistory?.[0];

  return (
    <DashboardLayout>
      <div className="flex flex-col h-full overflow-hidden">
        {/* Header */}
        <div className="px-6 py-5 border-b border-white/10 flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-white font-display flex items-center gap-2">
              <Bell size={20} className="text-gold" />
              Risk Alerts
            </h1>
            <p className="text-xs text-slate-400 mt-0.5">
              Automated nightly risk scan and high-risk declaration monitoring
            </p>
          </div>
          <ScanTriggerDialog
            onComplete={() => {
              utils.alerts.getRiskAlerts.invalidate();
              utils.alerts.getLatestFlaggedDeclarations.invalidate();
            }}
          />
        </div>

        <ScrollArea className="flex-1">
          <div className="p-6 space-y-6">
            {/* Latest scan summary */}
            {latestScan ? (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                {[
                  {
                    label: "High-Risk Found",
                    value: latestScan.highRiskCount,
                    icon: <AlertTriangle size={16} className="text-red-400" />,
                    color: "text-red-300",
                  },
                  {
                    label: "Cases Created",
                    value: latestScan.newCasesCreated,
                    icon: <Shield size={16} className="text-gold" />,
                    color: "text-gold",
                  },
                  {
                    label: "Threshold",
                    value: Number(latestScan.thresholdUsed).toFixed(2),
                    icon: <TrendingUp size={16} className="text-blue-400" />,
                    color: "text-blue-300",
                  },
                  {
                    label: "Owner Notified",
                    value: latestScan.notificationSent ? "Yes" : "No",
                    icon: latestScan.notificationSent ? (
                      <CheckCircle2 size={16} className="text-emerald-400" />
                    ) : (
                      <XCircle size={16} className="text-slate-500" />
                    ),
                    color: latestScan.notificationSent ? "text-emerald-300" : "text-slate-400",
                  },
                ].map((stat) => (
                  <Card key={stat.label} className="bg-navy-800/40 border-white/10">
                    <CardContent className="p-4">
                      <div className="flex items-center gap-2 mb-2">{stat.icon}</div>
                      <div className={`text-2xl font-bold font-display ${stat.color}`}>
                        {stat.value}
                      </div>
                      <div className="text-xs text-slate-400 mt-0.5">{stat.label}</div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            ) : (
              !historyLoading && (
                <div className="bg-navy-800/40 border border-white/10 rounded-xl p-8 text-center">
                  <Bell size={32} className="text-slate-600 mx-auto mb-3" />
                  <p className="text-slate-400 text-sm">No scans have been run yet.</p>
                  <p className="text-slate-500 text-xs mt-1">
                    Click "Run Risk Scan" to start the first scan.
                  </p>
                </div>
              )
            )}

            {/* Flagged declarations */}
            <Card className="bg-navy-800/40 border-white/10">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-mono tracking-widest text-gold uppercase flex items-center gap-2">
                  <AlertTriangle size={14} />
                  Latest Flagged Declarations
                  {latestScan && (
                    <span className="text-slate-500 font-normal normal-case tracking-normal ml-auto text-xs">
                      Scan: {latestScan.scanRunAt ? new Date(latestScan.scanRunAt).toLocaleString() : "—"}
                    </span>
                  )}
                </CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                {flaggedLoading ? (
                  <div className="flex items-center justify-center h-32">
                    <Loader2 className="animate-spin text-gold" size={20} />
                  </div>
                ) : !flaggedData?.declarations?.length ? (
                  <div className="text-center py-10 text-slate-500 text-sm">
                    No flagged declarations from the latest scan.
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="border-b border-white/10">
                          <th className="text-left px-4 py-2 text-slate-400 font-normal">Declaration</th>
                          <th className="text-left px-4 py-2 text-slate-400 font-normal">Trader</th>
                          <th className="text-left px-4 py-2 text-slate-400 font-normal">HS Code</th>
                          <th className="text-left px-4 py-2 text-slate-400 font-normal">Port</th>
                          <th className="text-left px-4 py-2 text-slate-400 font-normal">Risk</th>
                          <th className="text-left px-4 py-2 text-slate-400 font-normal">Lane</th>
                          <th className="text-left px-4 py-2 text-slate-400 font-normal">Date</th>
                          <th className="px-4 py-2" />
                        </tr>
                      </thead>
                      <tbody>
                        {flaggedData.declarations.map((d) => (
                          <tr
                            key={d.id}
                            className="border-b border-white/5 hover:bg-white/3 transition-colors"
                          >
                            <td className="px-4 py-2.5 font-mono text-white">{d.declarationNumber}</td>
                            <td className="px-4 py-2.5 text-slate-300">{d.traderId}</td>
                            <td className="px-4 py-2.5 font-mono text-slate-300">{d.hsCode || "—"}</td>
                            <td className="px-4 py-2.5 text-slate-300">{d.portOfEntry || "—"}</td>
                            <td className="px-4 py-2.5">
                              <span
                                className={`font-semibold ${
                                  d.riskScore >= 0.9
                                    ? "text-red-400"
                                    : d.riskScore >= 0.7
                                    ? "text-orange-400"
                                    : "text-yellow-400"
                                }`}
                              >
                                {d.riskScore.toFixed(2)}
                              </span>
                            </td>
                            <td className="px-4 py-2.5">
                              <Badge
                                className={`text-xs border capitalize ${
                                  LANE_COLORS[d.riskLane as keyof typeof LANE_COLORS] ??
                                  "bg-slate-700 text-slate-300"
                                }`}
                              >
                                {d.riskLane}
                              </Badge>
                            </td>
                            <td className="px-4 py-2.5 text-slate-400">
                              {d.createdAt ? new Date(d.createdAt).toLocaleDateString() : "—"}
                            </td>
                            <td className="px-4 py-2.5">
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() =>
                                  createCase.mutate({
                                    traderId: d.traderId,
                                    title: `High-risk declaration ${d.declarationNumber}`,
                                    description: `Risk score: ${d.riskScore.toFixed(2)} | Lane: ${d.riskLane} | HS: ${d.hsCode} | Port: ${d.portOfEntry}`,
                                    priority: d.riskScore >= 0.9 ? "critical" : "high",
                                    linkedDeclarationIds: [d.id],
                                    riskScore: d.riskScore,
                                  })
                                }
                                disabled={createCase.isPending}
                                className="text-xs text-gold hover:text-gold/80 hover:bg-gold/10 h-6 px-2"
                              >
                                Open Case
                              </Button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Scan history */}
            {scanHistory && scanHistory.length > 0 && (
              <Card className="bg-navy-800/40 border-white/10">
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm font-mono tracking-widest text-gold uppercase flex items-center gap-2">
                    <RefreshCw size={14} />
                    Scan History
                  </CardTitle>
                </CardHeader>
                <CardContent className="p-0">
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="border-b border-white/10">
                          <th className="text-left px-4 py-2 text-slate-400 font-normal">Run At</th>
                          <th className="text-left px-4 py-2 text-slate-400 font-normal">Period</th>
                          <th className="text-left px-4 py-2 text-slate-400 font-normal">Threshold</th>
                          <th className="text-left px-4 py-2 text-slate-400 font-normal">High-Risk</th>
                          <th className="text-left px-4 py-2 text-slate-400 font-normal">Cases Created</th>
                          <th className="text-left px-4 py-2 text-slate-400 font-normal">Notified</th>
                        </tr>
                      </thead>
                      <tbody>
                        {scanHistory.map((scan) => (
                          <tr
                            key={scan.id}
                            className="border-b border-white/5 hover:bg-white/3 transition-colors"
                          >
                            <td className="px-4 py-2.5 text-white">
                              {scan.scanRunAt ? new Date(scan.scanRunAt).toLocaleString() : "—"}
                            </td>
                            <td className="px-4 py-2.5 text-slate-300">{scan.scanPeriodHours}h</td>
                            <td className="px-4 py-2.5 font-mono text-slate-300">
                              {Number(scan.thresholdUsed).toFixed(2)}
                            </td>
                            <td className="px-4 py-2.5">
                              <span
                                className={
                                  scan.highRiskCount > 0 ? "text-red-400 font-semibold" : "text-slate-400"
                                }
                              >
                                {scan.highRiskCount}
                              </span>
                            </td>
                            <td className="px-4 py-2.5 text-slate-300">{scan.newCasesCreated}</td>
                            <td className="px-4 py-2.5">
                              {scan.notificationSent ? (
                                <CheckCircle2 size={14} className="text-emerald-400" />
                              ) : (
                                <XCircle size={14} className="text-slate-600" />
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </CardContent>
              </Card>
            )}
          </div>
        </ScrollArea>
      </div>
    </DashboardLayout>
  );
}
