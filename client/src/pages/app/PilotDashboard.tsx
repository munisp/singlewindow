import { useState } from "react";
import { useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import DashboardLayout from "@/components/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Card, CardContent, CardHeader, CardTitle, CardDescription,
} from "@/components/ui/card";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription,
} from "@/components/ui/sheet";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import {
  Anchor, Users, FileText, TrendingUp, Clock, CheckCircle,
  AlertTriangle, Plus, Target, RefreshCw, Database, ChevronRight,
  ShieldCheck, DollarSign, Activity,
} from "lucide-react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from "recharts";

const ROLE_LABELS: Record<string, string> = {
  trader: "Trader",
  customs_officer: "Customs Officer",
  oga_officer: "OGA Officer",
  admin: "Admin",
  port_operator: "Port Operator",
  finance_officer: "Finance Officer",
  auditor: "Auditor",
};

const PILOT_ROLE_LABELS: Record<string, string> = {
  trader: "Trader",
  ncs_officer: "NCS Officer",
  oga_officer: "OGA Officer",
  port_operator: "Port Operator",
};

export default function PilotDashboard() {
  const [, setLocation] = useLocation();
  const [showRegister, setShowRegister] = useState(false);
  const [showDemoConfirm, setShowDemoConfirm] = useState(false);
  const [selectedReportId, setSelectedReportId] = useState<number | null>(null);
  const [newParticipant, setNewParticipant] = useState({
    pilotRole: "trader" as "trader" | "ncs_officer" | "oga_officer" | "port_operator",
    scope: "both" as "apapa_apmt" | "tin_can_island" | "both",
    organisation: "",
    contactEmail: "",
    notes: "",
  });

  const { data: kpi, refetch: refetchKpi } = trpc.pilot.getKpiSummary.useQuery();
  const { data: participantsRaw, refetch: refetchParticipants } = trpc.pilot.listParticipants.useQuery({ limit: 100, offset: 0 });
  const participants = Array.isArray(participantsRaw) ? participantsRaw : (participantsRaw as any)?.participants ?? [];
  const { data: reportsRaw, refetch: refetchReports } = trpc.pilot.getReports.useQuery({ limit: 10 });
  const reports = Array.isArray(reportsRaw) ? reportsRaw : (reportsRaw as any)?.reports ?? [];
  const { data: reportDetail, isLoading: detailLoading } = trpc.pilot.getReportDetail.useQuery(
    { reportId: selectedReportId! },
    { enabled: selectedReportId !== null }
  );
  const { data: officerTrend } = trpc.pilot.getOfficerTrend.useQuery(
    { reportId: selectedReportId! },
    { enabled: selectedReportId !== null }
  );

  const registerMutation = trpc.pilot.registerParticipant.useMutation({
    onSuccess: () => {
      toast.success("Pilot participant registered");
      setShowRegister(false);
      setNewParticipant({ pilotRole: "trader", scope: "both", organisation: "", contactEmail: "", notes: "" });
      refetchParticipants();
      refetchKpi();
    },
    onError: (e) => toast.error(e.message),
  });

  const generateReportMutation = trpc.pilot.generateDailyReport.useMutation({
    onSuccess: () => {
      toast.success("Daily report generated and emailed to Technical Secretariat");
      refetchKpi();
    },
    onError: (e) => toast.error(e.message),
  });

  const loadDemoMutation = trpc.pilot.loadDemoData.useMutation({
    onSuccess: (data) => {
      setShowDemoConfirm(false);
      const parts = [
        data.officersCreated > 0 ? `${data.officersCreated} officers` : null,
        data.tradersCreated > 0 ? `${data.tradersCreated} traders` : null,
        data.reportsCreated > 0 ? `${data.reportsCreated} reports` : null,
        data.declarationsCreated > 0 ? `${data.declarationsCreated} declarations` : null,
        data.paymentsCreated > 0 ? `${data.paymentsCreated} payments` : null,
      ].filter(Boolean);
      const summary = parts.length > 0 ? parts.join(", ") : "All data already present (idempotent)";
      toast.success(`Demo data loaded — ${summary}`);
      refetchKpi();
      refetchParticipants();
      refetchReports();
    },
    onError: (e) => toast.error(`Demo load failed: ${e.message}`),
  });

  const config = kpi?.config;
  const startDate = config?.startDate ? new Date(config.startDate) : new Date("2026-04-01");
  const daysElapsed = Math.max(0, Math.floor((Date.now() - startDate.getTime()) / (1000 * 60 * 60 * 24)));
  const daysRemaining = Math.max(0, 90 - daysElapsed);
  const progressPct = Math.min(100, Math.round((daysElapsed / 90) * 100));

  return (
    <DashboardLayout>
      <div className="p-6 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
              <Anchor className="h-6 w-6 text-blue-600" />
              Apapa Port — 90-Day Pilot Dashboard
            </h1>
            <p className="text-muted-foreground text-sm mt-1">
              Restricted pilot: Apapa Port (APMT + Tin Can Island). Monitoring live declarations, trader accounts, and clearance KPIs.
            </p>
          </div>
          <div className="flex gap-2 flex-wrap">
            <Button variant="outline" onClick={() => { refetchKpi(); refetchParticipants(); }}>
              <RefreshCw className="h-4 w-4 mr-2" /> Refresh
            </Button>
            <Button variant="outline" onClick={() => generateReportMutation.mutate()} disabled={generateReportMutation.isPending}>
              <FileText className="h-4 w-4 mr-2" />
              {generateReportMutation.isPending ? "Generating..." : "Generate Daily Report"}
            </Button>
            <Button
              variant="outline"
              className="border-amber-400 text-amber-700 hover:bg-amber-50"
              onClick={() => setShowDemoConfirm(true)}
            >
              <Database className="h-4 w-4 mr-2" /> Load Demo Data
            </Button>
            <Button onClick={() => setShowRegister(true)}>
              <Plus className="h-4 w-4 mr-2" /> Register Participant
            </Button>
          </div>
        </div>

        {/* Pilot Progress Bar */}
        <Card className="border-blue-200 bg-blue-50/40">
          <CardContent className="pt-4">
            <div className="flex items-center justify-between mb-2">
              <span className="font-semibold text-blue-800">Pilot Progress</span>
              <span className="text-sm text-blue-700">{daysElapsed} / 90 days elapsed — {daysRemaining} days remaining</span>
            </div>
            <div className="w-full bg-blue-100 rounded-full h-3">
              <div
                className="bg-blue-600 h-3 rounded-full transition-all"
                style={{ width: `${progressPct}%` }}
              />
            </div>
            <div className="flex justify-between text-xs text-blue-600 mt-1">
              <span>Day 0 — Kickoff</span>
              <span>Day 30 — Mid-Review</span>
              <span>Day 90 — Full Evaluation</span>
            </div>
          </CardContent>
        </Card>

        {/* KPI Cards */}
        {kpi && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {[
              { label: "Total Declarations", value: kpi.totalDeclarations, icon: <FileText className="h-5 w-5 text-blue-500" />, color: "text-blue-700" },
              { label: "Green Lane %", value: `${kpi.greenLanePct}%`, icon: <CheckCircle className="h-5 w-5 text-green-500" />, color: "text-green-700" },
              { label: "Avg Clearance (hrs)", value: kpi.avgClearanceHours?.toFixed(1) ?? "—", icon: <Clock className="h-5 w-5 text-yellow-500" />, color: "text-yellow-700" },
              { label: "Duty Collected (₦)", value: kpi.totalDutyNaira ? `₦${(kpi.totalDutyNaira / 1_000_000).toFixed(1)}M` : "—", icon: <TrendingUp className="h-5 w-5 text-emerald-500" />, color: "text-emerald-700" },
              { label: "Active Participants", value: kpi.activeParticipants, icon: <Users className="h-5 w-5 text-purple-500" />, color: "text-purple-700" },
              { label: "Reports Generated", value: kpi.reportCount, icon: <FileText className="h-5 w-5 text-teal-500" />, color: "text-teal-700" },
              { label: "Target Green Lane", value: `${kpi.targetGreenLanePct}%`, icon: <Target className="h-5 w-5 text-orange-500" />, color: "text-orange-700" },
              { label: "Target Clearance (hrs)", value: `${kpi.targetClearanceHours}h`, icon: <AlertTriangle className="h-5 w-5 text-gray-500" />, color: "text-gray-700" },
            ].map(kpiItem => (
              <Card key={kpiItem.label}>
                <CardContent className="pt-4">
                  <div className="flex items-center gap-2 mb-1">
                    {kpiItem.icon}
                    <span className="text-xs text-muted-foreground">{kpiItem.label}</span>
                  </div>
                  <div className={`text-2xl font-bold ${kpiItem.color}`}>{kpiItem.value}</div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        {/* Recent Reports */}
        {reports && reports.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <FileText className="h-4 w-4" /> Recent Daily Reports
              </CardTitle>
              <CardDescription className="text-xs">Click any row to view per-officer KPI breakdown</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-muted-foreground text-xs">
                      <th className="text-left py-2 px-3">Date</th>
                      <th className="text-left py-2 px-3">Declarations</th>
                      <th className="text-left py-2 px-3">Green Lane</th>
                      <th className="text-left py-2 px-3">Yellow Lane</th>
                      <th className="text-left py-2 px-3">Red Lane</th>
                      <th className="text-left py-2 px-3">Avg Clearance</th>
                      <th className="text-left py-2 px-3">Duty (₦)</th>
                      <th className="text-left py-2 px-3"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {reports.map((r: Record<string, unknown>) => (
                      <tr
                        key={r.id as number}
                        className="border-b hover:bg-muted/30 cursor-pointer"
                        onClick={() => setSelectedReportId(r.id as number)}
                      >
                        <td className="py-2 px-3">{new Date(r.reportDate as string).toLocaleDateString()}</td>
                        <td className="py-2 px-3">{r.totalDeclarations as number}</td>
                        <td className="py-2 px-3 text-green-700">{r.greenLane as number}</td>
                        <td className="py-2 px-3 text-yellow-700">{r.yellowLane as number}</td>
                        <td className="py-2 px-3 text-red-700">{r.redLane as number}</td>
                        <td className="py-2 px-3">{((r.avgClearanceHoursX100 as number) / 100).toFixed(1)}h</td>
                        <td className="py-2 px-3">₦{((r.totalDutyCollectedKobo as number) / 100).toLocaleString()}</td>
                        <td className="py-2 px-3">
                          <Button size="sm" variant="ghost" className="h-6 text-xs gap-1 text-primary hover:text-primary" onClick={(e) => { e.stopPropagation(); setSelectedReportId(r.id as number); }}>
                            Details <ChevronRight className="h-3 w-3" />
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Participants Table */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Users className="h-4 w-4" /> Pilot Participants
            </CardTitle>
            <CardDescription>{participants?.length ?? 0} participants registered</CardDescription>
          </CardHeader>
          <CardContent>
            {!participants?.length ? (
              <div className="text-center py-8 text-muted-foreground">
                <Users className="h-10 w-10 mx-auto mb-2 opacity-30" />
                <p>No participants yet. Register NCS officers and trader accounts to begin.</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-muted-foreground text-xs">
                      <th className="text-left py-2 px-3">Name</th>
                      <th className="text-left py-2 px-3">Email</th>
                      <th className="text-left py-2 px-3">Pilot Role</th>
                      <th className="text-left py-2 px-3">Organisation</th>
                      <th className="text-left py-2 px-3">Status</th>
                      <th className="text-left py-2 px-3">Joined</th>
                    </tr>
                  </thead>
                  <tbody>
                    {participants.map((p: Record<string, unknown>) => (
                      <tr key={p.id as number} className="border-b hover:bg-muted/30">
                        <td className="py-2 px-3">{(p.userName as string) ?? "—"}</td>
                        <td className="py-2 px-3">{(p.userEmail as string) ?? (p.contactEmail as string) ?? "—"}</td>
                        <td className="py-2 px-3">
                          <Badge variant="outline" className="text-xs">
                            {PILOT_ROLE_LABELS[p.pilotRole as string] ?? (p.pilotRole as string)}
                          </Badge>
                        </td>
                        <td className="py-2 px-3 text-xs">{(p.organisation as string) ?? "—"}</td>
                        <td className="py-2 px-3">
                          <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                            p.isActive ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-600"
                          }`}>
                            {p.isActive ? "Active" : "Inactive"}
                          </span>
                        </td>
                        <td className="py-2 px-3 text-muted-foreground text-xs">
                          {new Date(p.joinedAt as string).toLocaleDateString()}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>

        {/* ── KPI Drill-Down Slide-Over ─────────────────────────────────────── */}
        <Sheet open={selectedReportId !== null} onOpenChange={(open) => { if (!open) setSelectedReportId(null); }}>
          <SheetContent side="right" className="w-full sm:max-w-2xl overflow-y-auto">
            <SheetHeader className="mb-4">
              <SheetTitle className="flex items-center gap-2">
                <Activity className="h-5 w-5 text-blue-600" />
                Daily Report — KPI Drill-Down
              </SheetTitle>
              <SheetDescription>
                {reportDetail
                  ? `${new Date(reportDetail.reportDate as unknown as string).toLocaleDateString("en-NG", { weekday: "long", year: "numeric", month: "long", day: "numeric" })} · Apapa Port Pilot`
                  : "Loading report details…"}
              </SheetDescription>
            </SheetHeader>

            {detailLoading ? (
              <div className="space-y-3">
                {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-16 w-full" />)}
              </div>
            ) : reportDetail ? (
              <div className="space-y-6">
                {/* Summary KPI row */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  {[
                    { label: "Total Declarations", value: reportDetail.totalDeclarations, color: "text-blue-700", icon: <FileText className="h-4 w-4 text-blue-500" /> },
                    { label: "Avg Clearance", value: `${reportDetail.avgClearanceHours.toFixed(1)}h`, color: "text-yellow-700", icon: <Clock className="h-4 w-4 text-yellow-500" /> },
                    { label: "Duty Collected", value: `₦${(reportDetail.totalDutyNaira / 1_000_000).toFixed(2)}M`, color: "text-emerald-700", icon: <DollarSign className="h-4 w-4 text-emerald-500" /> },
                    { label: "System Uptime", value: `${reportDetail.systemUptimePct.toFixed(2)}%`, color: "text-purple-700", icon: <Activity className="h-4 w-4 text-purple-500" /> },
                  ].map(item => (
                    <div key={item.label} className="bg-muted/50 rounded-lg p-3">
                      <div className="flex items-center gap-1.5 mb-1">{item.icon}<span className="text-xs text-muted-foreground">{item.label}</span></div>
                      <p className={`text-lg font-bold ${item.color}`}>{item.value}</p>
                    </div>
                  ))}
                </div>

                {/* Lane breakdown */}
                <div>
                  <h3 className="text-sm font-semibold mb-2 flex items-center gap-2">
                    <ShieldCheck className="h-4 w-4 text-primary" /> Risk Lane Breakdown
                  </h3>
                  <div className="grid grid-cols-3 gap-3">
                    <div className="bg-green-50 border border-green-200 rounded-lg p-3 text-center">
                      <p className="text-2xl font-bold text-green-700">{reportDetail.greenLane}</p>
                      <p className="text-xs text-green-600 mt-0.5">Green Lane</p>
                      <p className="text-xs text-muted-foreground">
                        {reportDetail.totalDeclarations > 0
                          ? `${Math.round((reportDetail.greenLane / reportDetail.totalDeclarations) * 100)}%`
                          : "—"}
                      </p>
                    </div>
                    <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3 text-center">
                      <p className="text-2xl font-bold text-yellow-700">{reportDetail.yellowLane}</p>
                      <p className="text-xs text-yellow-600 mt-0.5">Yellow Lane</p>
                      <p className="text-xs text-muted-foreground">
                        {reportDetail.totalDeclarations > 0
                          ? `${Math.round((reportDetail.yellowLane / reportDetail.totalDeclarations) * 100)}%`
                          : "—"}
                      </p>
                    </div>
                    <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-center">
                      <p className="text-2xl font-bold text-red-700">{reportDetail.redLane}</p>
                      <p className="text-xs text-red-600 mt-0.5">Red Lane</p>
                      <p className="text-xs text-muted-foreground">
                        {reportDetail.totalDeclarations > 0
                          ? `${Math.round((reportDetail.redLane / reportDetail.totalDeclarations) * 100)}%`
                          : "—"}
                      </p>
                    </div>
                  </div>
                </div>

                <Separator />

                {/* 7-day per-officer trend chart */}
                {officerTrend && !Array.isArray(officerTrend) && (officerTrend as any).officers?.length > 0 && (() => {
                  const _trend = officerTrend as { days: string[]; officers: { officerName: string; dailyValues: number[] }[] };
                  const OFFICER_COLORS = ["#3b82f6", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6"];
                  const chartData = _trend.days.map((day: string, di: number) => {
                    const row: Record<string, string | number> = { day };
                    _trend.officers.forEach((o: { officerName: string; dailyValues: number[] }) => {
                      row[o.officerName] = o.dailyValues[di];
                    });
                    return row;
                  });
                  // Build ISO date labels for drill-through navigation
                  const reportDate = reportDetail?.report?.reportDate
                    ? new Date(reportDetail.report.reportDate)
                    : new Date();
                  const dayIsoLabels = Array.from({ length: 7 }, (_, i) => {
                    const d = new Date(reportDate);
                    d.setDate(d.getDate() - (6 - i));
                    return d.toISOString().slice(0, 10);
                  });
                  return (
                    <div>
                      <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
                        <TrendingUp className="h-4 w-4 text-primary" /> 7-Day Declaration Volume per Officer
                        <span className="text-xs font-normal text-muted-foreground">(click a bar to view declarations)</span>
                      </h3>
                      <div style={{ height: 200 }}>
                        <ResponsiveContainer width="100%" height="100%">
                          <BarChart
                            data={chartData}
                            margin={{ top: 4, right: 8, left: -16, bottom: 0 }}
                            onClick={(payload) => {
                              if (!payload?.activeLabel) return;
                              const dayIndex = officerTrend.days.indexOf(payload.activeLabel as string);
                              if (dayIndex < 0) return;
                              const isoDate = dayIsoLabels[dayIndex];
                              setLocation(`/app/admin/declarations?date=${isoDate}`);
                            }}
                            style={{ cursor: "pointer" }}
                          >
                            <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                            <XAxis dataKey="day" tick={{ fontSize: 10 }} />
                            <YAxis tick={{ fontSize: 10 }} allowDecimals={false} />
                            <Tooltip
                              contentStyle={{ fontSize: 11 }}
                              labelFormatter={(label) => {
                                const idx = _trend.days.indexOf(label as string);
                                return idx >= 0
                                  ? `${label} (${dayIsoLabels[idx]}) — click to view declarations`
                                  : label;
                              }}
                            />
                            <Legend wrapperStyle={{ fontSize: 10 }} />
                            {_trend.officers.map((o: { officerName: string; dailyValues: number[] }, i: number) => (
                              <Bar key={o.officerName} dataKey={o.officerName} stackId="a" fill={OFFICER_COLORS[i % OFFICER_COLORS.length]} />
                            ))}
                          </BarChart>
                        </ResponsiveContainer>
                      </div>
                    </div>
                  );
                })()}

                <Separator />

                {/* Per-officer breakdown */}
                <div>
                  <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
                    <Users className="h-4 w-4 text-primary" /> Per-Officer Performance
                  </h3>
                  {reportDetail.officerStats.length === 0 ? (
                    <p className="text-sm text-muted-foreground text-center py-4">
                      No NCS officers registered for this pilot yet.
                    </p>
                  ) : (
                    <div className="space-y-3">
                      {reportDetail.officerStats.map((officer: any) => (
                        <div key={officer.officerId} className="border rounded-lg p-3 space-y-2">
                          <div className="flex items-start justify-between">
                            <div>
                              <p className="font-medium text-sm">{officer.officerName}</p>
                              <p className="text-xs text-muted-foreground">{officer.organisation}</p>
                            </div>
                            <div className="text-right">
                              <p className="text-sm font-bold text-blue-700">{officer.declarationsHandled}</p>
                              <p className="text-xs text-muted-foreground">declarations</p>
                            </div>
                          </div>
                          <div className="grid grid-cols-4 gap-2 text-xs">
                            <div className="text-center">
                              <p className="font-semibold text-green-700">{officer.greenLane}</p>
                              <p className="text-muted-foreground">Green</p>
                            </div>
                            <div className="text-center">
                              <p className="font-semibold text-yellow-700">{officer.yellowLane}</p>
                              <p className="text-muted-foreground">Yellow</p>
                            </div>
                            <div className="text-center">
                              <p className="font-semibold text-red-700">{officer.redLane}</p>
                              <p className="text-muted-foreground">Red</p>
                            </div>
                            <div className="text-center">
                              <p className="font-semibold text-emerald-700">₦{(officer.dutyCollectedNaira / 1000).toFixed(0)}K</p>
                              <p className="text-muted-foreground">Duty</p>
                            </div>
                          </div>
                          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                            <Clock className="h-3 w-3" />
                            Avg clearance: <span className="font-medium text-foreground">{officer.avgClearanceHours}h</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            ) : null}
          </SheetContent>
        </Sheet>

        {/* Register Participant Dialog */}
        <Dialog open={showRegister} onOpenChange={setShowRegister}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>Register Pilot Participant</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 py-2">
              <div className="space-y-1">
                <Label>Pilot Role *</Label>
                <Select value={newParticipant.pilotRole} onValueChange={v => setNewParticipant(a => ({ ...a, pilotRole: v as "trader" | "ncs_officer" | "oga_officer" | "port_operator" }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {Object.entries(PILOT_ROLE_LABELS).map(([k, v]) => (
                      <SelectItem key={k} value={k}>{v}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label>Scope</Label>
                <Select value={newParticipant.scope} onValueChange={v => setNewParticipant(a => ({ ...a, scope: v as "apapa_apmt" | "tin_can_island" | "both" }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="apapa_apmt">Apapa APMT</SelectItem>
                    <SelectItem value="tin_can_island">Tin Can Island</SelectItem>
                    <SelectItem value="both">Both Terminals</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label>Organisation</Label>
                <Input
                  placeholder="e.g. Dangote Industries"
                  value={newParticipant.organisation}
                  onChange={e => setNewParticipant(a => ({ ...a, organisation: e.target.value }))}
                />
              </div>
              <div className="space-y-1">
                <Label>Contact Email</Label>
                <Input
                  type="email"
                  placeholder="contact@organisation.ng"
                  value={newParticipant.contactEmail}
                  onChange={e => setNewParticipant(a => ({ ...a, contactEmail: e.target.value }))}
                />
              </div>
              <div className="space-y-1">
                <Label>Notes</Label>
                <Input
                  placeholder="Optional notes"
                  value={newParticipant.notes}
                  onChange={e => setNewParticipant(a => ({ ...a, notes: e.target.value }))}
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setShowRegister(false)}>Cancel</Button>
              <Button
                onClick={() => registerMutation.mutate({
                  pilotRole: newParticipant.pilotRole as "trader" | "ncs_officer" | "oga_officer" | "port_operator",
                  scope: newParticipant.scope as "apapa_apmt" | "tin_can_island" | "both",
                  organisation: newParticipant.organisation || undefined,
                  contactEmail: newParticipant.contactEmail || undefined,
                  notes: newParticipant.notes || undefined,
                })}
                disabled={registerMutation.isPending}
              >
                {registerMutation.isPending ? "Registering..." : "Register"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Load Demo Data Confirmation Dialog */}
        <Dialog open={showDemoConfirm} onOpenChange={setShowDemoConfirm}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Database className="h-5 w-5 text-amber-600" />
                Load Apapa Port Demo Data
              </DialogTitle>
              <DialogDescription>
                This will seed the database with 5 NCS officers, 20 traders, 30 days of pilot
                reports, 15 sample declarations, and up to 10 confirmed payments.
                The operation is <strong>idempotent</strong> — running it multiple times is safe;
                existing records will not be duplicated.
              </DialogDescription>
            </DialogHeader>
            <div className="py-2 space-y-2">
              <div className="rounded-md bg-amber-50 border border-amber-200 p-3 text-sm text-amber-800">
                <strong>Admin-only action.</strong> Demo participants will appear in the
                Participants table and KPI counters will update immediately after loading.
              </div>
              <ul className="text-sm text-muted-foreground space-y-1 pl-4 list-disc">
                <li>5 NCS officer accounts (Apapa APMT scope)</li>
                <li>20 trader accounts (major Nigerian corporates)</li>
                <li>30 days of pilot reports with realistic KPI progression</li>
                <li>15 sample declarations across corridors</li>
                <li>Up to 10 confirmed duty payments</li>
              </ul>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setShowDemoConfirm(false)}
                disabled={loadDemoMutation.isPending}>
                Cancel
              </Button>
              <Button
                className="bg-amber-600 hover:bg-amber-700 text-white"
                onClick={() => loadDemoMutation.mutate()}
                disabled={loadDemoMutation.isPending}
              >
                <Database className="h-4 w-4 mr-2" />
                {loadDemoMutation.isPending ? "Loading demo data…" : "Load Demo Data"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </DashboardLayout>
  );
}
