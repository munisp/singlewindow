/**
 * Officer Workload Auto-Rebalancer — /app/admin/workload-rebalancer
 *
 * Provides an interactive view of current declaration queue distribution
 * across customs officers, with one-click auto-rebalance and dry-run preview.
 *
 * Wired to:
 *   trpc.officerWorkload.getWorkloadDistribution — live queue depth per officer
 *   trpc.officerWorkload.getTeamSummary          — team KPIs (SLA, avg review time)
 *   trpc.officerWorkload.autoRebalanceWorkload    — rebalance unassigned declarations
 */

import { useState, useMemo, useRef, useEffect } from "react";
import { trpc } from "@/lib/trpc";
import DashboardLayout from "@/components/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Progress } from "@/components/ui/progress";
import {
  Users,
  RefreshCw,
  Zap,
  BarChart2,
  Clock,
  CheckCircle,
  AlertTriangle,
  TrendingUp,
  ArrowRightLeft,
  Eye,
  Play,
  Loader2,
  Info,
} from "lucide-react";
import { toast } from "sonner";

// ── Helpers ───────────────────────────────────────────────────────────────────

function LoadBar({ value, max, overloaded }: { value: number; max: number; overloaded: boolean }) {
  const pct = max > 0 ? Math.min((value / max) * 100, 100) : 0;
  return (
    <div className="flex items-center gap-2 min-w-0">
      <div className="flex-1 h-2 rounded-full bg-muted overflow-hidden">
        <div
          className={`h-full rounded-full transition-all ${
            overloaded ? "bg-red-500" : pct > 60 ? "bg-amber-500" : "bg-emerald-500"
          }`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="text-xs tabular-nums w-8 text-right text-muted-foreground">{value}</span>
    </div>
  );
}

function StatCard({
  icon,
  label,
  value,
  sub,
  color = "text-primary",
}: {
  icon: React.ReactNode;
  label: string;
  value: string | number | null | undefined;
  sub?: string;
  color?: string;
}) {
  return (
    <Card>
      <CardContent className="pt-4 pb-4 px-4">
        <div className="flex items-start justify-between">
          <div className="space-y-1">
            <p className="text-xs text-muted-foreground">{label}</p>
            <p className={`text-2xl font-bold ${color}`}>
              {value == null ? "—" : value}
            </p>
            {sub && <p className="text-[11px] text-muted-foreground">{sub}</p>}
          </div>
          <div className={`p-2 rounded-md bg-muted ${color}`}>{icon}</div>
        </div>
      </CardContent>
    </Card>
  );
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function OfficerWorkloadRebalancer() {
  const [maxPerOfficer, setMaxPerOfficer] = useState(50);
  const [dryRun, setDryRun] = useState(true);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [lastResult, setLastResult] = useState<{
    assigned: number;
    dryRun: boolean;
    officerCount?: number;
    assignments?: Array<{ declarationId: number; officerId: number; officerName: string | null }>;
    message?: string;
    reason?: string;
  } | null>(null);

  // Live-assignment progress state
  const [liveProgress, setLiveProgress] = useState(0);
  const [liveStatusMsg, setLiveStatusMsg] = useState("");
  const liveProgressRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const utils = trpc.useUtils();

  // Live queue distribution
  const distQuery = trpc.officerWorkload.getWorkloadDistribution.useQuery(undefined, {
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
  });

  // Team summary (last 30 days)
  const summaryQuery = trpc.officerWorkload.getTeamSummary.useQuery(
    { periodDays: 30, slaTargetHours: 24 },
    { refetchOnWindowFocus: false }
  );

  // Auto-rebalance mutation
  const rebalanceMutation = trpc.officerWorkload.autoRebalanceWorkload.useMutation({
    onSuccess: (result) => {
      if (liveProgressRef.current) clearInterval(liveProgressRef.current);
      setLiveProgress(100);
      setLiveStatusMsg(result.dryRun ? "Preview ready" : "All assignments applied ✓");
      setTimeout(() => { setLiveProgress(0); setLiveStatusMsg(""); }, 1800);
      setLastResult(result);
      if (result.dryRun) {
        toast.info("Dry-run complete", {
          description: result.message ?? `Would assign ${result.assigned} declarations`,
        });
      } else {
        toast.success("Workload rebalanced", {
          description: result.message ?? `Assigned ${result.assigned} declarations`,
        });
        // Refresh distribution after live rebalance
        utils.officerWorkload.getWorkloadDistribution.invalidate();
        utils.officerWorkload.getTeamSummary.invalidate();
      }
    },
    onError: (err: { message: string }) => {
      if (liveProgressRef.current) clearInterval(liveProgressRef.current);
      setLiveProgress(0);
      setLiveStatusMsg("");
      toast.error("Rebalance failed", { description: err.message });
    },
  });

  // Simulated live-progress ticker (runs while mutation is pending in live mode)
  useEffect(() => {
    if (rebalanceMutation.isPending && !dryRun) {
      setLiveProgress(0);
      setLiveStatusMsg("Scanning unassigned declarations…");
      const steps = [
        { pct: 15, msg: "Scanning unassigned declarations…" },
        { pct: 35, msg: "Calculating officer capacity…" },
        { pct: 55, msg: "Scoring workload balance…" },
        { pct: 72, msg: "Generating assignment plan…" },
        { pct: 88, msg: "Applying assignments to queue…" },
        { pct: 95, msg: "Finalising and refreshing data…" },
      ];
      let idx = 0;
      liveProgressRef.current = setInterval(() => {
        if (idx < steps.length) {
          setLiveProgress(steps[idx].pct);
          setLiveStatusMsg(steps[idx].msg);
          idx++;
        } else {
          if (liveProgressRef.current) clearInterval(liveProgressRef.current);
        }
      }, 420);
    } else {
      if (liveProgressRef.current) clearInterval(liveProgressRef.current);
      if (!rebalanceMutation.isPending) {
        setLiveProgress(0);
        setLiveStatusMsg("");
      }
    }
    return () => { if (liveProgressRef.current) clearInterval(liveProgressRef.current); };
  }, [rebalanceMutation.isPending, dryRun]);

  const dist = distQuery.data;
  const summary = summaryQuery.data;

  // Sort officers: overloaded first, then by queue depth desc
  const sortedOfficers = useMemo(() => {
    if (!dist?.officers) return [];
    return [...dist.officers].sort((a, b) => {
      if (a.overloaded && !b.overloaded) return -1;
      if (!a.overloaded && b.overloaded) return 1;
      return b.queueDepth - a.queueDepth;
    });
  }, [dist?.officers]);

  const maxQueueDepth = useMemo(
    () => Math.max(...(sortedOfficers.map((o) => o.queueDepth) ?? [1]), 1),
    [sortedOfficers]
  );

  const overloadedCount = sortedOfficers.filter((o) => o.overloaded).length;

  function handleRebalanceClick() {
    if (!dryRun) {
      setConfirmOpen(true);
    } else {
      rebalanceMutation.mutate({ maxAssignmentsPerOfficer: maxPerOfficer, dryRun: true });
    }
  }

  function handleConfirmedRebalance() {
    setConfirmOpen(false);
    rebalanceMutation.mutate({ maxAssignmentsPerOfficer: maxPerOfficer, dryRun: false });
  }

  return (
    <DashboardLayout>
      <div className="flex flex-col gap-6 p-6 max-w-6xl">
        {/* Header */}
        <div className="flex items-start justify-between flex-wrap gap-4">
          <div>
            <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
              <ArrowRightLeft size={24} className="text-primary" />
              Officer Workload Rebalancer
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              Monitor declaration queue distribution and auto-assign unassigned declarations
              to balance officer workloads.
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              distQuery.refetch();
              summaryQuery.refetch();
            }}
            disabled={distQuery.isFetching}
            className="gap-2"
          >
            <RefreshCw size={14} className={distQuery.isFetching ? "animate-spin" : ""} />
            Refresh
          </Button>
        </div>

        {/* KPI row */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard
            icon={<Users size={18} />}
            label="Active Officers"
            value={summary?.teamStats.totalOfficers ?? dist?.officers.length ?? "—"}
            sub="customs officers"
          />
          <StatCard
            icon={<BarChart2 size={18} />}
            label="Total Queue"
            value={dist?.totalAssigned ?? "—"}
            sub={`+${dist?.totalUnassigned ?? 0} unassigned`}
            color={dist?.totalUnassigned && dist.totalUnassigned > 0 ? "text-amber-500" : "text-primary"}
          />
          <StatCard
            icon={<Clock size={18} />}
            label="Avg Review Time"
            value={
              summary?.teamStats.avgReviewTimeHours != null
                ? `${summary.teamStats.avgReviewTimeHours.toFixed(1)}h`
                : "—"
            }
            sub="last 30 days"
            color={
              summary?.teamStats.avgReviewTimeHours != null &&
              summary.teamStats.avgReviewTimeHours > 24
                ? "text-red-500"
                : "text-primary"
            }
          />
          <StatCard
            icon={<TrendingUp size={18} />}
            label="SLA Compliance"
            value={
              summary?.teamStats.slaComplianceRate != null
                ? `${(summary.teamStats.slaComplianceRate * 100).toFixed(1)}%`
                : "—"
            }
            sub="target: 24h"
            color={
              summary?.teamStats.slaComplianceRate != null &&
              summary.teamStats.slaComplianceRate < 0.9
                ? "text-red-500"
                : "text-emerald-500"
            }
          />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* ── Queue distribution table ── */}
          <div className="lg:col-span-2 space-y-4">
            <Card>
              <CardHeader className="pb-3 pt-4 px-4">
                <CardTitle className="text-sm flex items-center justify-between">
                  <span className="flex items-center gap-2">
                    <BarChart2 size={15} className="text-primary" />
                    Queue Distribution
                    {overloadedCount > 0 && (
                      <Badge variant="destructive" className="text-[10px] px-1.5 py-0 ml-1">
                        {overloadedCount} overloaded
                      </Badge>
                    )}
                  </span>
                  <span className="text-xs font-normal text-muted-foreground">
                    Avg depth: {dist?.avgDepth ?? "—"}
                  </span>
                </CardTitle>
              </CardHeader>
              <CardContent className="px-4 pb-4">
                {distQuery.isLoading ? (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground py-6 justify-center">
                    <RefreshCw size={14} className="animate-spin" /> Loading distribution…
                  </div>
                ) : sortedOfficers.length === 0 ? (
                  <div className="text-sm text-muted-foreground py-6 text-center">
                    No customs officers found in the system.
                  </div>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="text-xs">Officer</TableHead>
                        <TableHead className="text-xs">Queue Depth</TableHead>
                        <TableHead className="text-xs w-24">Status</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {sortedOfficers.map((officer) => (
                        <TableRow key={officer.officerId}>
                          <TableCell className="text-sm py-2">
                            <div className="flex items-center gap-2">
                              <div className="w-7 h-7 rounded-full bg-muted flex items-center justify-center text-xs font-medium text-muted-foreground">
                                {(officer.officerName ?? "?").charAt(0).toUpperCase()}
                              </div>
                              <span className="truncate max-w-[140px]">
                                {officer.officerName ?? `Officer #${officer.officerId}`}
                              </span>
                            </div>
                          </TableCell>
                          <TableCell className="py-2">
                            <LoadBar
                              value={officer.queueDepth}
                              max={maxQueueDepth}
                              overloaded={officer.overloaded}
                            />
                          </TableCell>
                          <TableCell className="py-2">
                            {officer.overloaded ? (
                              <Badge variant="destructive" className="text-[10px] px-1.5 py-0 gap-1">
                                <AlertTriangle size={10} />
                                Overloaded
                              </Badge>
                            ) : officer.queueDepth === 0 ? (
                              <Badge variant="outline" className="text-[10px] px-1.5 py-0 text-muted-foreground">
                                Idle
                              </Badge>
                            ) : (
                              <Badge variant="outline" className="text-[10px] px-1.5 py-0 text-emerald-500 border-emerald-500/50">
                                <CheckCircle size={10} className="mr-0.5" />
                                Normal
                              </Badge>
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}

                {/* Unassigned declarations banner */}
                {dist && dist.totalUnassigned > 0 && (
                  <div className="mt-3 flex items-center gap-2 p-2 rounded-md bg-amber-500/10 border border-amber-500/30">
                    <AlertTriangle size={14} className="text-amber-500 shrink-0" />
                    <span className="text-xs text-amber-600 dark:text-amber-400">
                      <strong>{dist.totalUnassigned}</strong> unassigned declarations are waiting
                      in the queue. Use the rebalancer to distribute them.
                    </span>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          {/* ── Rebalancer controls ── */}
          <div className="space-y-4">
            <Card>
              <CardHeader className="pb-3 pt-4 px-4">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Zap size={15} className="text-primary" />
                  Auto-Rebalancer
                </CardTitle>
              </CardHeader>
              <CardContent className="px-4 pb-4 space-y-5">
                {/* Max per officer */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label className="text-xs">Max per Officer</Label>
                    <span className="text-xs font-mono font-semibold text-primary">
                      {maxPerOfficer}
                    </span>
                  </div>
                  <Slider
                    min={5}
                    max={200}
                    step={5}
                    value={[maxPerOfficer]}
                    onValueChange={([v]) => setMaxPerOfficer(v)}
                  />
                  <p className="text-[11px] text-muted-foreground">
                    Maximum declarations assigned to any single officer during this rebalance.
                  </p>
                </div>

                <Separator />

                {/* Dry run toggle */}
                <div className="flex items-center justify-between">
                  <div className="space-y-0.5">
                    <Label className="text-xs flex items-center gap-1">
                      <Eye size={12} />
                      Dry Run Mode
                    </Label>
                    <p className="text-[11px] text-muted-foreground">
                      Preview assignments without applying them.
                    </p>
                  </div>
                  <Switch
                    checked={dryRun}
                    onCheckedChange={setDryRun}
                  />
                </div>

                <Separator />

                {/* Run button */}
                <Button
                  className="w-full gap-2"
                  onClick={handleRebalanceClick}
                  disabled={rebalanceMutation.isPending}
                  variant={dryRun ? "outline" : "default"}
                >
                  {rebalanceMutation.isPending ? (
                    <Loader2 size={14} className="animate-spin" />
                  ) : dryRun ? (
                    <Eye size={14} />
                  ) : (
                    <Play size={14} />
                  )}
                  {rebalanceMutation.isPending
                    ? dryRun ? "Previewing…" : "Applying…"
                    : dryRun
                    ? "Preview Rebalance"
                    : "Apply Rebalance"}
                </Button>

                {/* Live-mode progress banner */}
                {rebalanceMutation.isPending && !dryRun && liveProgress > 0 && (
                  <div className="rounded-md border border-primary/30 bg-primary/5 p-3 space-y-2">
                    <div className="flex items-center gap-2">
                      <Loader2 size={13} className="animate-spin text-primary shrink-0" />
                      <span className="text-xs text-primary font-medium">{liveStatusMsg}</span>
                    </div>
                    <Progress value={liveProgress} className="h-1.5" />
                    <p className="text-[10px] text-muted-foreground text-right">{liveProgress}%</p>
                  </div>
                )}

                {/* Dry-run in-progress indicator */}
                {rebalanceMutation.isPending && dryRun && (
                  <div className="flex items-center gap-2 rounded-md border border-blue-500/30 bg-blue-500/5 p-2.5">
                    <Loader2 size={13} className="animate-spin text-blue-400 shrink-0" />
                    <span className="text-xs text-blue-400">Simulating assignment plan…</span>
                  </div>
                )}

                {dryRun && !rebalanceMutation.isPending && (
                  <p className="text-[11px] text-muted-foreground text-center">
                    Dry run — no declarations will be reassigned.
                  </p>
                )}
                {!dryRun && !rebalanceMutation.isPending && (
                  <div className="flex items-center gap-1.5 rounded-md border border-amber-500/30 bg-amber-500/5 p-2">
                    <Info size={12} className="text-amber-500 shrink-0" />
                    <p className="text-[11px] text-amber-500">
                      Live mode — declarations will be reassigned immediately.
                    </p>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Last result card */}
            {lastResult && (
              <Card className={lastResult.dryRun ? "border-blue-500/30" : "border-emerald-500/30"}>
                <CardHeader className="pb-2 pt-3 px-4">
                  <CardTitle className="text-xs flex items-center gap-2">
                    {lastResult.dryRun ? (
                      <>
                        <Eye size={13} className="text-blue-500" />
                        <span className="text-blue-500">Dry-Run Result</span>
                      </>
                    ) : (
                      <>
                        <CheckCircle size={13} className="text-emerald-500" />
                        <span className="text-emerald-500">Rebalance Applied</span>
                      </>
                    )}
                  </CardTitle>
                </CardHeader>
                <CardContent className="px-4 pb-3 space-y-2">
                  <p className="text-sm font-medium">
                    {lastResult.message ?? lastResult.reason ?? "Complete"}
                  </p>
                  {lastResult.officerCount != null && (
                    <p className="text-xs text-muted-foreground">
                      Across {lastResult.officerCount} officer{lastResult.officerCount !== 1 ? "s" : ""}
                    </p>
                  )}

                  {/* Dry-run preview table */}
                  {lastResult.dryRun && lastResult.assignments && lastResult.assignments.length > 0 && (
                    <div className="mt-2 space-y-1">
                      <p className="text-[11px] text-muted-foreground font-medium">
                        Preview (first {lastResult.assignments.length}):
                      </p>
                      <div className="max-h-48 overflow-y-auto rounded border border-border">
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead className="text-[10px] py-1 px-2">Decl. ID</TableHead>
                              <TableHead className="text-[10px] py-1 px-2">→ Officer</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {lastResult.assignments.map((a) => (
                              <TableRow key={a.declarationId}>
                                <TableCell className="text-xs py-1 px-2 font-mono">
                                  #{a.declarationId}
                                </TableCell>
                                <TableCell className="text-xs py-1 px-2 truncate max-w-[120px]">
                                  {a.officerName ?? `Officer #${a.officerId}`}
                                </TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            )}
          </div>
        </div>
      </div>

      {/* Live-mode confirmation dialog */}
      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Apply Workload Rebalance?</AlertDialogTitle>
            <AlertDialogDescription>
              This will immediately reassign unassigned declarations to customs officers
              (up to <strong>{maxPerOfficer}</strong> per officer). Officers will see new
              declarations in their queues right away. This action cannot be undone automatically.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirmedRebalance}>
              Apply Rebalance
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </DashboardLayout>
  );
}
