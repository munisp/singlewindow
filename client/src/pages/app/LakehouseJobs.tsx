/**
 * Lakehouse Jobs Status Panel — Sprint v81
 * Monitor Delta Lake batch jobs and trigger manual re-runs.
 */
import { useState, useEffect } from "react";
import { trpc } from "@/lib/trpc";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Loader2, RefreshCw, Play, CheckCircle2, XCircle, Clock, Database, Layers } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

const STATUS_COLORS: Record<string, string> = {
  pending: "bg-gray-500/10 text-gray-400 border-gray-500/30",
  running: "bg-blue-500/10 text-blue-400 border-blue-500/30",
  completed: "bg-green-500/10 text-green-400 border-green-500/30",
  failed: "bg-red-500/10 text-red-400 border-red-500/30",
  cancelled: "bg-amber-500/10 text-amber-400 border-amber-500/30",
};

function formatBytes(bytes: number | null) {
  if (!bytes) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1_048_576) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1_073_741_824) return `${(bytes / 1_048_576).toFixed(1)} MB`;
  return `${(bytes / 1_073_741_824).toFixed(2)} GB`;
}

function formatDuration(ms: number | null) {
  if (!ms) return "—";
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60_000).toFixed(1)}m`;
}

/** Compute next 02:00 UTC from now */
function getNextRollupTime(): Date {
  const now = new Date();
  const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 2, 0, 0, 0));
  if (next <= now) next.setUTCDate(next.getUTCDate() + 1);
  return next;
}

function useCountdown(target: Date) {
  const [remaining, setRemaining] = useState(() => target.getTime() - Date.now());
  useEffect(() => {
    const id = setInterval(() => setRemaining(target.getTime() - Date.now()), 1000);
    return () => clearInterval(id);
  }, [target]);
  const totalSecs = Math.max(0, Math.floor(remaining / 1000));
  const h = Math.floor(totalSecs / 3600);
  const m = Math.floor((totalSecs % 3600) / 60);
  const s = totalSecs % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

export default function LakehouseJobs() {
  const { toast } = useToast();
  const [statusFilter, setStatusFilter] = useState<string>("ALL");
  const [jobTypeFilter, setJobTypeFilter] = useState<string>("ALL");
  const [tableFilter, setTableFilter] = useState<string>("ALL");
  const [page, setPage] = useState(0);
  const [triggerDialog, setTriggerDialog] = useState(false);
  const [triggerJobType, setTriggerJobType] = useState<string>("");
  const [triggerTable, setTriggerTable] = useState<string>("");
  const [nextRollup] = useState(() => getNextRollupTime());
  const countdown = useCountdown(nextRollup);
  const PAGE_SIZE = 20;

  const statsQuery = trpc.lakehouse.getLakehouseStats.useQuery();
  const jobTypesQuery = trpc.lakehouse.getJobTypes.useQuery();
  const tablesQuery = trpc.lakehouse.getTargetTables.useQuery();
  const jobsQuery = trpc.lakehouse.getLakehouseJobs.useQuery({
    limit: PAGE_SIZE,
    offset: page * PAGE_SIZE,
    status: statusFilter !== "ALL" ? (statusFilter as any) : undefined,
    jobType: jobTypeFilter !== "ALL" ? jobTypeFilter : undefined,
    targetTable: tableFilter !== "ALL" ? tableFilter : undefined,
  });

  const triggerMutation = trpc.lakehouse.triggerLakehouseJob.useMutation({
    onSuccess: (data) => {
      toast({ title: "Job triggered", description: data.message });
      setTriggerDialog(false);
      jobsQuery.refetch();
      statsQuery.refetch();
    },
    onError: (err) => toast({ title: "Trigger failed", description: err.message, variant: "destructive" }),
  });

  const stats = statsQuery.data;
  const jobs = jobsQuery.data?.jobs ?? [];
  const total = jobsQuery.data?.total ?? 0;
  const totalPages = Math.ceil(total / PAGE_SIZE);

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <Layers className="w-6 h-6 text-purple-400" />
            Lakehouse Jobs
          </h1>
          <p className="text-sm text-muted-foreground mt-1">Delta Lake batch job monitoring and manual triggering</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => jobsQuery.refetch()} disabled={jobsQuery.isFetching}>
            <RefreshCw className={`w-4 h-4 mr-2 ${jobsQuery.isFetching ? "animate-spin" : ""}`} />
            Refresh
          </Button>
          <Button size="sm" onClick={() => setTriggerDialog(true)}>
            <Play className="w-4 h-4 mr-2" />
            Trigger Job
          </Button>
        </div>
      </div>

      {/* Nightly Rollup Countdown Banner */}
      <div className="flex items-center gap-3 bg-purple-500/10 border border-purple-500/30 rounded-lg px-4 py-2.5">
        <Clock className="w-4 h-4 text-purple-400 shrink-0" />
        <div className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-4 text-sm">
          <span className="text-purple-300 font-medium">Next nightly rollup (TRADE_STATS_ROLLUP)</span>
          <span className="font-mono text-purple-100 text-base">{countdown}</span>
          <span className="text-muted-foreground text-xs">Scheduled 02:00 UTC via Heartbeat cron</span>
        </div>
        {(() => {
          const lastRollup = (jobsQuery.data?.jobs ?? []).find(
            (j) => (j as any).jobType === "TRADE_STATS_ROLLUP" && (j as any).status === "completed"
          );
          return lastRollup ? (
            <span className="ml-auto text-xs text-muted-foreground">
              Last run: {new Date((lastRollup as any).completedAt).toLocaleString()}
            </span>
          ) : null;
        })()}
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        {[
          { label: "Pending", value: stats?.pending, cls: "text-gray-400" },
          { label: "Running", value: stats?.running, cls: "text-blue-400" },
          { label: "Completed", value: stats?.completed, cls: "text-green-400" },
          { label: "Failed", value: stats?.failed, cls: "text-red-400" },
          { label: "Cancelled", value: (stats as any)?.cancelled ?? 0, cls: "text-amber-400" },
        ].map((s) => (
          <Card key={s.label} className="bg-card border-border">
            <CardContent className="pt-3 pb-2">
              <p className="text-xs text-muted-foreground">{s.label}</p>
              <p className={`text-xl font-bold ${s.cls}`}>
                {statsQuery.isLoading ? "…" : (s.value ?? 0)}
              </p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Filters */}
      <div className="flex gap-3 flex-wrap items-center">
        <Select value={statusFilter} onValueChange={(v) => { setStatusFilter(v); setPage(0); }}>
          <SelectTrigger className="w-36">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All Statuses</SelectItem>
            {["pending", "running", "completed", "failed", "cancelled"].map((s) => (
              <SelectItem key={s} value={s}>{s.toUpperCase()}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={jobTypeFilter} onValueChange={(v) => { setJobTypeFilter(v); setPage(0); }}>
          <SelectTrigger className="w-52">
            <SelectValue placeholder="Job Type" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All Job Types</SelectItem>
            {(jobTypesQuery.data ?? []).map((t) => (
              <SelectItem key={t} value={t}>{t.replace(/_/g, " ")}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={tableFilter} onValueChange={(v) => { setTableFilter(v); setPage(0); }}>
          <SelectTrigger className="w-52">
            <SelectValue placeholder="Target Table" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All Tables</SelectItem>
            {(tablesQuery.data ?? []).map((t) => (
              <SelectItem key={t} value={t}>{t}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <span className="text-sm text-muted-foreground ml-auto">{total} job{total !== 1 ? "s" : ""}</span>
      </div>

      {/* Table */}
      <Card className="bg-card border-border">
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow className="border-border">
                <TableHead>Job ID</TableHead>
                <TableHead>Job Type</TableHead>
                <TableHead>Target Table</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Rows</TableHead>
                <TableHead>Bytes Written</TableHead>
                <TableHead>Duration</TableHead>
                <TableHead>Triggered By</TableHead>
                <TableHead>Created</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {jobsQuery.isLoading ? (
                <TableRow>
                  <TableCell colSpan={9} className="text-center py-8">
                    <Loader2 className="w-6 h-6 animate-spin mx-auto text-muted-foreground" />
                  </TableCell>
                </TableRow>
              ) : jobs.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={9} className="text-center py-8 text-muted-foreground">
                    No lakehouse jobs found
                  </TableCell>
                </TableRow>
              ) : (
                jobs.map((job) => (
                  <TableRow key={job.id} className="border-border hover:bg-muted/30">
                    <TableCell className="font-mono text-xs text-muted-foreground">{job.jobId}</TableCell>
                    <TableCell className="text-xs font-medium">{job.jobType.replace(/_/g, " ")}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{job.targetTable}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className={`text-xs ${STATUS_COLORS[job.status] ?? ""}`}>
                        {job.status.toUpperCase()}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {job.rowsProcessed != null ? job.rowsProcessed.toLocaleString() : "—"}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {formatBytes((job as any).bytesWritten ?? (job as any).rowsWritten ?? null)}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">{formatDuration(job.durationMs)}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className="text-xs">
                        {job.triggeredBy ?? "scheduler"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {new Date(job.createdAt).toLocaleString()}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex justify-center gap-2">
          <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage(p => p - 1)}>Previous</Button>
          <span className="text-sm text-muted-foreground self-center">Page {page + 1} of {totalPages}</span>
          <Button variant="outline" size="sm" disabled={page >= totalPages - 1} onClick={() => setPage(p => p + 1)}>Next</Button>
        </div>
      )}

      {/* Trigger Job Dialog */}
      <Dialog open={triggerDialog} onOpenChange={setTriggerDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Trigger Lakehouse Job</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <label className="text-sm font-medium">Job Type</label>
              <Select value={triggerJobType} onValueChange={setTriggerJobType}>
                <SelectTrigger>
                  <SelectValue placeholder="Select job type…" />
                </SelectTrigger>
                <SelectContent>
                  {(jobTypesQuery.data ?? []).map((t) => (
                    <SelectItem key={t} value={t}>{t.replace(/_/g, " ")}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Target Table</label>
              <Select value={triggerTable} onValueChange={setTriggerTable}>
                <SelectTrigger>
                  <SelectValue placeholder="Select target table…" />
                </SelectTrigger>
                <SelectContent>
                  {(tablesQuery.data ?? []).map((t) => (
                    <SelectItem key={t} value={t}>{t}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setTriggerDialog(false)}>Cancel</Button>
            <Button
              disabled={!triggerJobType || !triggerTable || triggerMutation.isPending}
              onClick={() => triggerMutation.mutate({
                jobType: triggerJobType as any,
                targetTable: triggerTable as any,
              })}
            >
              {triggerMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Play className="w-4 h-4 mr-2" />}
              Trigger
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
