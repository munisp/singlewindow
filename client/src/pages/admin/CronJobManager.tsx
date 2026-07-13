/**
 * CronJobManager — /app/admin/cron-jobs
 * Protected admin page: list, toggle (enable/disable), and manually trigger
 * Heartbeat cron jobs registered on the Manus platform.
 */
import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  CalendarClock,
  Play,
  RefreshCw,
  CheckCircle2,
  XCircle,
  Clock,
  Loader2,
  AlertTriangle,
  Info,
  Zap,
} from "lucide-react";
import { toast } from "sonner";

// ─── Types ────────────────────────────────────────────────────────────────────

type JobName =
  | "bond-expiry-digest"
  | "post-audit-reminder"
  | "sla-breach-escalation"
  | "document-vault-expiry";

interface TriggerResult {
  jobName: string;
  durationMs: number;
  triggeredAt: string;
  result: unknown;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatCron(expr: string): string {
  const map: Record<string, string> = {
    "0 */30 * * * *": "Every 30 minutes",
    "0 0 6 * * *": "Daily at 06:00 UTC",
    "0 0 8 * * *": "Daily at 08:00 UTC",
    "0 0 9 * * *": "Daily at 09:00 UTC",
    "0 0 6 * * 1": "Every Monday at 06:00 UTC",
    "0 0 * * * *": "Every hour",
  };
  return map[expr] ?? expr;
}

function formatDate(iso?: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function jobLabel(name: string): string {
  const labels: Record<string, string> = {
    "bond-expiry-digest": "Bond Expiry Digest",
    "post-audit-reminder": "Post-Audit Reminder",
    "sla-breach-escalation": "SLA Breach Escalation",
    "document-vault-expiry": "Document Vault Expiry",
  };
  return labels[name] ?? name;
}

function jobDescription(name: string): string {
  const descs: Record<string, string> = {
    "bond-expiry-digest": "Scans bonds expiring within 30 days and sends a digest to the owner.",
    "post-audit-reminder": "Lists upcoming post-clearance audits due within 7 days.",
    "sla-breach-escalation": "Promotes overdue SLA escalations to the next tier and notifies the owner.",
    "document-vault-expiry": "Notifies document owners of documents expiring within 30 days.",
  };
  return descs[name] ?? "";
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function CronJobManager() {
  const { user } = useAuth();
  const utils = trpc.useUtils();

  // State
  const [triggerTarget, setTriggerTarget] = useState<JobName | null>(null);
  const [triggerResult, setTriggerResult] = useState<TriggerResult | null>(null);
  const [triggerError, setTriggerError] = useState<string | null>(null);
  const [togglingUid, setTogglingUid] = useState<string | null>(null);

  // Queries
  const { data: jobsData, isLoading: jobsLoading, refetch: refetchJobs } =
    trpc.heartbeatJobs.listJobs.useQuery(undefined, {
      refetchInterval: 30_000,
    });

  const { data: definitions } = trpc.heartbeatJobs.getJobDefinitions.useQuery();

  // Mutations
  const toggleMutation = trpc.heartbeatJobs.toggleJob.useMutation({
    onSuccess: (data) => {
      toast.success(
        `Job ${data.enabled ? "enabled" : "paused"} — next run: ${formatDate(data.nextExecutionAt)}`
      );
      setTogglingUid(null);
      utils.heartbeatJobs.listJobs.invalidate();
    },
    onError: (err) => {
      toast.error(`Toggle failed: ${err.message}`);
      setTogglingUid(null);
    },
  });

  const triggerMutation = trpc.heartbeatJobs.manualTrigger.useMutation({
    onSuccess: (data) => {
      setTriggerResult(data as TriggerResult);
      setTriggerError(null);
      toast.success(`${jobLabel(data.jobName)} completed in ${data.durationMs}ms`);
      utils.heartbeatJobs.listJobs.invalidate();
    },
    onError: (err) => {
      setTriggerError(err.message);
      setTriggerResult(null);
      toast.error(`Trigger failed: ${err.message}`);
    },
  });

  // Access guard
  if (!user || !["admin", "customs_officer"].includes(user.role)) {
    return (
      <div className="flex items-center justify-center h-64">
        <Alert className="max-w-md">
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription>
            You do not have permission to access the Cron Job Manager.
            Admin or customs officer role is required.
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  const jobs = jobsData?.jobs ?? [];
  const total = jobsData?.total ?? 0;

  // Build enriched job list by merging platform state with local definitions
  const enrichedJobs = jobs.map((job) => {
    const def = definitions?.find((d) => d.name === job.name);
    return { ...job, description: def?.description ?? jobDescription(job.name) };
  });

  // Jobs defined locally but not yet registered on the platform
  const unregisteredDefs = (definitions ?? []).filter(
    (d) => !jobs.some((j) => j.name === d.name)
  );

  function handleToggle(taskUid: string, currentlyEnabled: boolean) {
    setTogglingUid(taskUid);
    toggleMutation.mutate({ taskUid, enable: !currentlyEnabled });
  }

  function handleTrigger(jobName: JobName) {
    setTriggerTarget(jobName);
    setTriggerResult(null);
    setTriggerError(null);
  }

  function confirmTrigger() {
    if (!triggerTarget) return;
    triggerMutation.mutate({ jobName: triggerTarget });
  }

  function closeTriggerDialog() {
    if (triggerMutation.isPending) return;
    setTriggerTarget(null);
    setTriggerResult(null);
    setTriggerError(null);
  }

  return (
    <div className="p-6 space-y-6 max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <CalendarClock className="h-7 w-7 text-primary" />
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Cron Job Manager</h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              Manage Heartbeat platform cron jobs — view schedules, toggle enable/disable, and
              manually trigger runs.
            </p>
          </div>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => refetchJobs()}
          disabled={jobsLoading}
          className="gap-2"
        >
          <RefreshCw className={`h-4 w-4 ${jobsLoading ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Registered Jobs</CardDescription>
            <CardTitle className="text-3xl">{total}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Active Jobs</CardDescription>
            <CardTitle className="text-3xl text-green-600">
              {jobs.filter((j) => j.is_enable).length}
            </CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Paused Jobs</CardDescription>
            <CardTitle className="text-3xl text-amber-600">
              {jobs.filter((j) => !j.is_enable).length}
            </CardTitle>
          </CardHeader>
        </Card>
      </div>

      {/* Jobs table */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Registered Platform Jobs</CardTitle>
          <CardDescription>
            These jobs are registered on the Manus Heartbeat platform and fire automatically
            regardless of sandbox state. Auto-refreshes every 30 seconds.
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {jobsLoading ? (
            <div className="flex items-center justify-center py-16 gap-3 text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin" />
              <span>Loading cron jobs…</span>
            </div>
          ) : jobs.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 gap-3 text-muted-foreground">
              <CalendarClock className="h-10 w-10 opacity-30" />
              <p className="text-sm">No jobs registered on the platform yet.</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Job Name</TableHead>
                  <TableHead>Schedule</TableHead>
                  <TableHead>Next Run</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-center">Enabled</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {enrichedJobs.map((job) => (
                  <TableRow key={job.task_uid}>
                    <TableCell>
                      <div>
                        <p className="font-medium text-sm">{jobLabel(job.name)}</p>
                        <p className="text-xs text-muted-foreground mt-0.5 max-w-xs">
                          {job.description}
                        </p>
                        <p className="text-xs text-muted-foreground/60 mt-0.5 font-mono">
                          {job.task_uid}
                        </p>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1.5">
                        <Clock className="h-3.5 w-3.5 text-muted-foreground" />
                        <span className="text-sm">{formatCron(job.cron_expression)}</span>
                      </div>
                      <p className="text-xs text-muted-foreground font-mono mt-0.5">
                        {job.cron_expression}
                      </p>
                    </TableCell>
                    <TableCell className="text-sm">
                      {formatDate(job.next_execution_at)}
                    </TableCell>
                    <TableCell>
                      {job.is_enable ? (
                        <Badge className="bg-green-100 text-green-800 border-green-200 gap-1">
                          <CheckCircle2 className="h-3 w-3" />
                          Active
                        </Badge>
                      ) : (
                        <Badge variant="secondary" className="gap-1">
                          <XCircle className="h-3 w-3" />
                          Paused
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-center">
                      {togglingUid === job.task_uid ? (
                        <Loader2 className="h-4 w-4 animate-spin mx-auto text-muted-foreground" />
                      ) : (
                        <Switch
                          checked={job.is_enable}
                          onCheckedChange={() => handleToggle(job.task_uid, job.is_enable)}
                          aria-label={`Toggle ${jobLabel(job.name)}`}
                        />
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        size="sm"
                        variant="outline"
                        className="gap-1.5"
                        onClick={() => handleTrigger(job.name as JobName)}
                        disabled={triggerMutation.isPending}
                      >
                        <Play className="h-3.5 w-3.5" />
                        Run Now
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Unregistered definitions */}
      {unregisteredDefs.length > 0 && (
        <Card className="border-amber-200 bg-amber-50/30">
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2 text-amber-800">
              <Info className="h-4 w-4" />
              Defined but Not Registered ({unregisteredDefs.length})
            </CardTitle>
            <CardDescription>
              These job definitions exist in code but are not yet registered on the Heartbeat
              platform. Use the Heartbeat CLI to register them.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {unregisteredDefs.map((def) => (
                <div
                  key={def.key}
                  className="flex items-center justify-between p-3 rounded-md bg-background border"
                >
                  <div>
                    <p className="text-sm font-medium">{jobLabel(def.name)}</p>
                    <p className="text-xs text-muted-foreground">{def.description}</p>
                  </div>
                  <Badge variant="outline" className="text-amber-700 border-amber-300 shrink-0 ml-4">
                    <Clock className="h-3 w-3 mr-1" />
                    {formatCron(def.cron)}
                  </Badge>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Manual Trigger Confirmation Dialog */}
      <Dialog open={!!triggerTarget} onOpenChange={(open) => !open && closeTriggerDialog()}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Zap className="h-5 w-5 text-amber-500" />
              Manual Trigger: {triggerTarget ? jobLabel(triggerTarget) : ""}
            </DialogTitle>
            <DialogDescription>
              This will immediately execute the job handler — the same code path as the scheduled
              cron run. The result will be shown below.
            </DialogDescription>
          </DialogHeader>

          <Separator />

          {/* Pre-trigger info */}
          {!triggerMutation.isPending && !triggerResult && !triggerError && (
            <div className="py-2 space-y-2">
              <p className="text-sm text-muted-foreground">
                <strong>Job:</strong> {triggerTarget ? jobLabel(triggerTarget) : ""}
              </p>
              <p className="text-sm text-muted-foreground">
                <strong>Description:</strong>{" "}
                {triggerTarget ? jobDescription(triggerTarget) : ""}
              </p>
              <Alert>
                <Info className="h-4 w-4" />
                <AlertDescription className="text-xs">
                  Manual triggers run against the live database. Bond expiry and post-audit
                  handlers will process real records and send real owner notifications.
                </AlertDescription>
              </Alert>
            </div>
          )}

          {/* Loading state */}
          {triggerMutation.isPending && (
            <div className="flex flex-col items-center justify-center py-8 gap-3">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
              <p className="text-sm text-muted-foreground">Running job handler…</p>
              <p className="text-xs text-muted-foreground/60">This may take up to 30 seconds</p>
            </div>
          )}

          {/* Success result */}
          {triggerResult && (
            <div className="space-y-3">
              <div className="flex items-center gap-2 text-green-700">
                <CheckCircle2 className="h-5 w-5" />
                <span className="font-medium text-sm">Job completed successfully</span>
              </div>
              <div className="grid grid-cols-2 gap-2 text-sm">
                <div className="p-2 rounded bg-muted/50">
                  <p className="text-xs text-muted-foreground">Duration</p>
                  <p className="font-mono font-medium">{triggerResult.durationMs}ms</p>
                </div>
                <div className="p-2 rounded bg-muted/50">
                  <p className="text-xs text-muted-foreground">Triggered At</p>
                  <p className="font-mono font-medium text-xs">
                    {new Date(triggerResult.triggeredAt).toLocaleTimeString()}
                  </p>
                </div>
              </div>
              {triggerResult.result && (
                <div className="rounded-md bg-muted/50 p-3">
                  <p className="text-xs text-muted-foreground mb-1">Handler Response</p>
                  <pre className="text-xs font-mono overflow-auto max-h-32 whitespace-pre-wrap">
                    {JSON.stringify(triggerResult.result, null, 2)}
                  </pre>
                </div>
              )}
            </div>
          )}

          {/* Error state */}
          {triggerError && (
            <Alert variant="destructive">
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription className="text-xs">{triggerError}</AlertDescription>
            </Alert>
          )}

          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={closeTriggerDialog} disabled={triggerMutation.isPending}>
              {triggerResult || triggerError ? "Close" : "Cancel"}
            </Button>
            {!triggerResult && !triggerError && (
              <Button
                onClick={confirmTrigger}
                disabled={triggerMutation.isPending}
                className="gap-2"
              >
                {triggerMutation.isPending ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Running…
                  </>
                ) : (
                  <>
                    <Play className="h-4 w-4" />
                    Run Now
                  </>
                )}
              </Button>
            )}
            {(triggerResult || triggerError) && (
              <Button
                variant="outline"
                onClick={() => {
                  setTriggerResult(null);
                  setTriggerError(null);
                }}
                className="gap-2"
              >
                <RefreshCw className="h-4 w-4" />
                Run Again
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
