/**
 * Officer Workload Dashboard
 *
 * Gives customs supervisors visibility into:
 *   - Each officer's current case queue depth
 *   - Average declaration review time
 *   - SLA compliance rate (% reviewed within target time)
 *   - Team-level summary statistics
 */

import { useEffect, useState } from "react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import DashboardLayout from "@/components/DashboardLayout";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Slider } from "@/components/ui/slider";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  Loader2,
  TrendingUp,
  Users,
  FileText,
  Shield,
  Wifi,
  WifiOff,
  RefreshCw,
  Activity,
  UserCog,
  Shuffle,
} from "lucide-react";

// ─── HELPERS ─────────────────────────────────────────────────────────────────

function SlaBar({ rate }: { rate: number | null }) {
  if (rate == null) return <span className="text-slate-500 text-xs">No data</span>;
  const color =
    rate >= 90
      ? "bg-emerald-500"
      : rate >= 70
      ? "bg-yellow-500"
      : "bg-red-500";
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 bg-white/10 rounded-full h-1.5 overflow-hidden">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${rate}%` }} />
      </div>
      <span
        className={`text-xs font-semibold w-10 text-right ${
          rate >= 90 ? "text-emerald-400" : rate >= 70 ? "text-yellow-400" : "text-red-400"
        }`}
      >
        {rate.toFixed(0)}%
      </span>
    </div>
  );
}

function StatCard({
  label,
  value,
  sub,
  icon,
  color,
}: {
  label: string;
  value: string | number;
  sub?: string;
  icon: React.ReactNode;
  color: string;
}) {
  return (
    <Card className="bg-navy-800/40 border-white/10">
      <CardContent className="p-4">
        <div className="flex items-center gap-2 mb-2">{icon}</div>
        <div className={`text-2xl font-bold font-display ${color}`}>{value}</div>
        <div className="text-xs text-slate-400 mt-0.5">{label}</div>
        {sub && <div className="text-xs text-slate-500 mt-0.5">{sub}</div>}
      </CardContent>
    </Card>
  );
}

// ─── MAIN PAGE ────────────────────────────────────────────────────────────────

export default function OfficerWorkload() {
  const [periodDays, setPeriodDays] = useState(30);
  const [slaTargetHours, setSlaTargetHours] = useState(24);
  const [wsConnected, setWsConnected] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [reassignOfficer, setReassignOfficer] = useState<{ id: number; name: string } | null>(null);
  const [reassignDeclId, setReassignDeclId] = useState("");

  const utils = trpc.useUtils();

  const assignOfficerMutation = trpc.declarations.assignOfficer.useMutation({
    onSuccess: () => {
      toast.success("Declaration assigned successfully");
      setReassignOfficer(null);
      setReassignDeclId("");
      utils.declarations.workload.invalidate();
    },
    onError: (err) => toast.error("Assignment failed", { description: err.message }),
  });

  // Use the new declarations.workload procedure
  const { data, isLoading, error, isError, refetch } = trpc.declarations.workload.useQuery(undefined, {
    refetchInterval: 60_000,
  });

  // Sprint 110: WebSocket live updates
  useEffect(() => {
    if (typeof window === "undefined") return;
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const ws = new WebSocket(`${protocol}//${window.location.host}/api/ws`);
    ws.onopen = () => setWsConnected(true);
    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === "workload_update") {
          setLastUpdated(new Date());
          utils.declarations.workload.invalidate();
        }
      } catch { /* ignore */ }
    };
    ws.onclose = () => setWsConnected(false);
    ws.onerror = () => setWsConnected(false);
    return () => ws.close();
  }, [utils]);

  // Map new data shape to the UI
  const officerQueues = data?.officerQueues ?? [];
  const maxQueue = Math.max(...officerQueues.map((o) => o.queueCount), 1);

  // Build team summary from new data
  const team = data ? {
    totalOfficers: officerQueues.length,
    totalQueueDepth: data.totalPending,
    avgReviewTimeHours: null as number | null, // not available in new procedure
    slaComplianceRate: data.slaBreached > 0
      ? Math.max(0, Math.round((1 - data.slaBreached / Math.max(data.totalPending, 1)) * 100))
      : 100,
  } : null;

  // Map officerQueues to the old officers shape for the table
  const officers = officerQueues.map((o) => ({
    id: o.officerId ?? 0,
    name: o.officerName,
    email: o.officerEmail,
    queueDepth: o.queueCount,
    openFraudCases: o.redCount, // red lane = high risk / potential fraud
    declarationsReviewedInPeriod: o.clearedCount,
    avgReviewTimeHours: null as number | null,
    slaComplianceRate: o.queueCount > 0
      ? Math.round((o.clearedCount / Math.max(o.queueCount + o.clearedCount, 1)) * 100)
      : null,
  }));

  return (
    <DashboardLayout title="Officer Workload Dashboard">
      {isError && (
        <div className="mx-6 mt-4 p-3 bg-red-50 border border-red-200 rounded text-red-700 text-sm">
          Failed to load data. Please refresh the page.
        </div>
      )}
      <div className="flex flex-col h-full overflow-hidden">
        {/* Header */}
        <div className="px-6 py-5 border-b border-white/10 flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-white font-display flex items-center gap-2">
              <Activity size={20} className="text-gold" />
              Officer Workload Dashboard
            </h1>
            <p className="text-xs text-slate-400 mt-0.5 flex items-center gap-1.5">
              Queue depth, review times, and SLA compliance for each customs officer
              {wsConnected
                ? <><Wifi className="h-3 w-3 text-green-400 ml-2" /> <span className="text-green-400">Live</span></>
                : <><WifiOff className="h-3 w-3 text-slate-500 ml-2" /> Polling</>}
              {lastUpdated && <span className="text-slate-500 ml-1">· Updated {lastUpdated.toLocaleTimeString()}</span>}
            </p>
          </div>
          {/* Controls */}
          <div className="flex items-center gap-6">
            <div className="flex flex-col gap-1 min-w-[140px]">
              <Label className="text-xs text-slate-400">
                Period: last {periodDays} days
              </Label>
              <Slider
                min={7}
                max={90}
                step={7}
                value={[periodDays]}
                onValueChange={([v]) => setPeriodDays(v)}
                className="w-36"
              />
            </div>
            <div className="flex flex-col gap-1 min-w-[140px]">
              <Label className="text-xs text-slate-400">
                SLA target: {slaTargetHours}h
              </Label>
              <Slider
                min={4}
                max={72}
                step={4}
                value={[slaTargetHours]}
                onValueChange={([v]) => setSlaTargetHours(v)}
                className="w-36"
              />
            </div>
          </div>
        </div>

        <ScrollArea className="flex-1">
          <div className="p-6 space-y-6">
            {/* Team summary KPIs */}
            {team && (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <StatCard
                  label="Active Officers"
                  value={team.totalOfficers}
                  icon={<Users size={16} className="text-blue-400" />}
                  color="text-blue-300"
                />
                <StatCard
                  label="Total Queue Depth"
                  value={team.totalQueueDepth}
                  sub="Declarations awaiting review"
                  icon={<FileText size={16} className="text-gold" />}
                  color="text-gold"
                />
                <StatCard
                  label="Avg Review Time"
                  value={
                    team.avgReviewTimeHours != null
                      ? `${team.avgReviewTimeHours}h`
                      : "—"
                  }
                  sub={`Target: ≤ ${slaTargetHours}h`}
                  icon={<Clock size={16} className="text-purple-400" />}
                  color={
                    team.avgReviewTimeHours == null
                      ? "text-slate-400"
                      : team.avgReviewTimeHours <= slaTargetHours
                      ? "text-emerald-300"
                      : "text-red-300"
                  }
                />
                <StatCard
                  label="Team SLA Compliance"
                  value={
                    team.slaComplianceRate != null
                      ? `${team.slaComplianceRate.toFixed(0)}%`
                      : "—"
                  }
                  sub={`Last ${periodDays} days`}
                  icon={
                    team.slaComplianceRate != null && team.slaComplianceRate >= 90 ? (
                      <CheckCircle2 size={16} className="text-emerald-400" />
                    ) : (
                      <AlertTriangle size={16} className="text-red-400" />
                    )
                  }
                  color={
                    team.slaComplianceRate == null
                      ? "text-slate-400"
                      : team.slaComplianceRate >= 90
                      ? "text-emerald-300"
                      : team.slaComplianceRate >= 70
                      ? "text-yellow-300"
                      : "text-red-300"
                  }
                />
              </div>
            )}

            {/* Per-officer table */}
            <Card className="bg-navy-800/40 border-white/10">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-mono tracking-widest text-gold uppercase flex items-center gap-2">
                  <TrendingUp size={14} />
                  Officer Performance — Last {periodDays} Days
                </CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                {isLoading ? (
                  <div className="flex items-center justify-center h-40">
                    <Loader2 className="animate-spin text-gold" size={22} />
                  </div>
                ) : error ? (
                  <div className="text-center py-10 text-red-400 text-sm">
                    Failed to load workload data.
                  </div>
                ) : officers.length === 0 ? (
                  <div className="text-center py-12 text-slate-500 text-sm">
                    <Users size={32} className="mx-auto mb-3 text-slate-600" />
                    No customs officers found. Promote users to the customs officer role to see
                    their workload here.
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="border-b border-white/10">
                          <th className="text-left px-4 py-2.5 text-slate-400 font-normal">
                            Officer
                          </th>
                          <th className="text-right px-4 py-2.5 text-slate-400 font-normal">
                            Queue
                          </th>
                          <th className="text-right px-4 py-2.5 text-slate-400 font-normal">
                            Open Cases
                          </th>
                          <th className="text-right px-4 py-2.5 text-slate-400 font-normal">
                            Reviewed
                          </th>
                          <th className="text-right px-4 py-2.5 text-slate-400 font-normal">
                            Avg Review Time
                          </th>
                          <th className="text-left px-4 py-2.5 text-slate-400 font-normal w-40">
                            SLA Compliance
                          </th>
                          <th className="text-left px-4 py-2.5 text-slate-400 font-normal">
                            Status
                          </th>
                          <th className="text-left px-4 py-2.5 text-slate-400 font-normal">
                            Actions
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {officers.map((o) => {
                          const overloaded = o.queueDepth > 20;
                          const slaOk =
                            o.slaComplianceRate == null || o.slaComplianceRate >= 90;
                          return (
                            <tr
                              key={o.id}
                              className="border-b border-white/5 hover:bg-white/3 transition-colors"
                            >
                              <td className="px-4 py-3">
                                <div className="font-medium text-white">{o.name}</div>
                                {o.email && (
                                  <div className="text-slate-500 text-xs mt-0.5">{o.email}</div>
                                )}
                              </td>
                              <td className="px-4 py-3 text-right">
                                <span
                                  className={`font-semibold ${
                                    overloaded ? "text-red-400" : "text-white"
                                  }`}
                                >
                                  {o.queueDepth}
                                </span>
                              </td>
                              <td className="px-4 py-3 text-right">
                                <span
                                  className={
                                    o.openFraudCases > 5 ? "text-orange-400 font-semibold" : "text-slate-300"
                                  }
                                >
                                  {o.openFraudCases}
                                </span>
                              </td>
                              <td className="px-4 py-3 text-right text-slate-300">
                                {o.declarationsReviewedInPeriod}
                              </td>
                              <td className="px-4 py-3 text-right">
                                {o.avgReviewTimeHours != null ? (
                                  <span
                                    className={
                                      o.avgReviewTimeHours <= slaTargetHours
                                        ? "text-emerald-400"
                                        : "text-red-400"
                                    }
                                  >
                                    {o.avgReviewTimeHours}h
                                  </span>
                                ) : (
                                  <span className="text-slate-500">—</span>
                                )}
                              </td>
                              <td className="px-4 py-3 w-40">
                                <SlaBar rate={o.slaComplianceRate} />
                              </td>
                              <td className="px-4 py-3">
                                {overloaded ? (
                                  <Badge className="bg-red-500/20 text-red-300 border-red-500/30 text-xs">
                                    Overloaded
                                  </Badge>
                                ) : !slaOk ? (
                                  <Badge className="bg-yellow-500/20 text-yellow-300 border-yellow-500/30 text-xs">
                                    SLA Risk
                                  </Badge>
                                ) : o.declarationsReviewedInPeriod === 0 ? (
                                  <Badge className="bg-slate-700/50 text-slate-400 border-slate-600 text-xs">
                                    No Activity
                                  </Badge>
                                ) : (
                                  <Badge className="bg-emerald-500/20 text-emerald-300 border-emerald-500/30 text-xs">
                                    On Track
                                  </Badge>
                                )}
                              </td>
                              <td className="px-4 py-3">
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="gap-1 text-xs h-7 px-2"
                                  onClick={() => setReassignOfficer({ id: o.id, name: o.name })}
                                >
                                  <UserCog className="w-3 h-3" /> Assign Decl.
                                </Button>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Legend */}
            <div className="flex flex-wrap gap-4 text-xs text-slate-500 px-1">
              <span className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-emerald-500 inline-block" />
                On Track: SLA ≥ 90%, queue ≤ 20
              </span>
              <span className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-yellow-500 inline-block" />
                SLA Risk: compliance 70–89%
              </span>
              <span className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-red-500 inline-block" />
                Overloaded: queue &gt; 20 declarations
              </span>
            </div>
          </div>
        </ScrollArea>
      </div>
      {/* Assign Declaration Dialog */}
      <Dialog open={!!reassignOfficer} onOpenChange={(open) => { if (!open) { setReassignOfficer(null); setReassignDeclId(""); } }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <UserCog className="w-5 h-5" />
              Assign Declaration to {reassignOfficer?.name}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="space-y-1.5">
              <Label className="text-xs">Declaration ID</Label>
              <Input
                placeholder="Enter declaration ID (e.g. 1001)"
                value={reassignDeclId}
                onChange={(e) => setReassignDeclId(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && reassignOfficer && reassignDeclId) {
                    const declId = parseInt(reassignDeclId);
                    if (!isNaN(declId)) assignOfficerMutation.mutate({ declarationId: declId, officerId: reassignOfficer.id });
                  }
                }}
              />
            </div>
            <p className="text-xs text-muted-foreground">This will assign the declaration to {reassignOfficer?.name} and add an audit log entry.</p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setReassignOfficer(null); setReassignDeclId(""); }}>Cancel</Button>
            <Button
              disabled={!reassignDeclId || assignOfficerMutation.isPending}
              onClick={() => {
                if (!reassignOfficer) return;
                const declId = parseInt(reassignDeclId);
                if (isNaN(declId)) { toast.error("Invalid declaration ID"); return; }
                assignOfficerMutation.mutate({ declarationId: declId, officerId: reassignOfficer.id });
              }}
            >
              {assignOfficerMutation.isPending ? <><Loader2 className="w-4 h-4 animate-spin mr-2" />Assigning…</> : "Assign"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </DashboardLayout>
  );
}
