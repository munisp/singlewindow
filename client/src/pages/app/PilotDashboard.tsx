import { useState } from "react";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import {
  Anchor, Users, FileText, TrendingUp, Clock, CheckCircle,
  AlertTriangle, Plus, Target, RefreshCw, Database,
} from "lucide-react";

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
  const [showRegister, setShowRegister] = useState(false);
  const [showDemoConfirm, setShowDemoConfirm] = useState(false);
  const [newParticipant, setNewParticipant] = useState({
    pilotRole: "trader" as "trader" | "ncs_officer" | "oga_officer" | "port_operator",
    scope: "both" as "apapa_apmt" | "tin_can_island" | "both",
    organisation: "",
    contactEmail: "",
    notes: "",
  });

  const { data: kpi, refetch: refetchKpi } = trpc.pilot.getKpiSummary.useQuery();
  const { data: participants, refetch: refetchParticipants } = trpc.pilot.listParticipants.useQuery({ limit: 100, offset: 0 });
  const { data: reports, refetch: refetchReports } = trpc.pilot.getReports.useQuery({ limit: 10 });

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
                    </tr>
                  </thead>
                  <tbody>
                    {reports.map((r: Record<string, unknown>) => (
                      <tr key={r.id as number} className="border-b hover:bg-muted/30">
                        <td className="py-2 px-3">{new Date(r.reportDate as string).toLocaleDateString()}</td>
                        <td className="py-2 px-3">{r.totalDeclarations as number}</td>
                        <td className="py-2 px-3 text-green-700">{r.greenLane as number}</td>
                        <td className="py-2 px-3 text-yellow-700">{r.yellowLane as number}</td>
                        <td className="py-2 px-3 text-red-700">{r.redLane as number}</td>
                        <td className="py-2 px-3">{((r.avgClearanceHoursX100 as number) / 100).toFixed(1)}h</td>
                        <td className="py-2 px-3">₦{((r.totalDutyCollectedKobo as number) / 100).toLocaleString()}</td>
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
