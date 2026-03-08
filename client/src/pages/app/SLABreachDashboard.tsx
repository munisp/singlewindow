/**
 * SLA Breach Escalation Dashboard — Sprint 15
 * For customs officers and admins to monitor and escalate SLA breaches.
 *
 * SLA thresholds:
 *   Green lane  → 4 hours
 *   Yellow lane → 24 hours
 *   Red lane    → 72 hours
 *   Blue lane   → 48 hours (AEO)
 */
import { useState } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  AlertTriangle, RefreshCw, Bell, Clock, Shield, CheckCircle, Play, Loader2
} from "lucide-react";
import { toast } from "sonner";

const LANE_COLORS: Record<string, string> = {
  green: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300",
  yellow: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300",
  red: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300",
  blue: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300",
};

const SLA_LABELS: Record<string, string> = {
  green: "4h SLA",
  yellow: "24h SLA",
  red: "72h SLA",
  blue: "48h SLA",
};

function SeverityBadge({ severity }: { severity: "warning" | "critical" }) {
  return severity === "critical" ? (
    <Badge variant="destructive" className="gap-1">
      <AlertTriangle className="h-3 w-3" /> Critical
    </Badge>
  ) : (
    <Badge variant="outline" className="gap-1 text-amber-600 border-amber-400">
      <Clock className="h-3 w-3" /> Warning
    </Badge>
  );
}

function StatCard({
  label, value, sub, icon: Icon, color,
}: {
  label: string; value: number; sub?: string; icon: React.ElementType; color: string;
}) {
  return (
    <Card>
      <CardContent className="pt-6">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-sm text-muted-foreground">{label}</p>
            <p className={`text-3xl font-bold mt-1 ${color}`}>{value}</p>
            {sub && <p className="text-xs text-muted-foreground mt-1">{sub}</p>}
          </div>
          <div className={`p-2 rounded-lg bg-muted ${color}`}>
            <Icon className="h-5 w-5" />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export default function SLABreachDashboard() {
  const utils = trpc.useUtils();
  const [severityFilter, setSeverityFilter] = useState<"all" | "warning" | "critical">("all");
  const [laneFilter, setLaneFilter] = useState<"all" | "green" | "yellow" | "red" | "blue">("all");

  const { data: stats, isLoading: statsLoading, refetch: refetchStats } =
    trpc.slaEscalation.stats.useQuery(undefined, { refetchInterval: 60000 });

  const { data: breaches, isLoading: breachesLoading, refetch: refetchBreaches } =
    trpc.slaEscalation.list.useQuery(
      { severity: severityFilter, lane: laneFilter, limit: 100 },
      { refetchInterval: 60000 }
    );

  const scan = trpc.slaEscalation.scan.useMutation({
    onSuccess: (result) => {
      if (result.dryRun) {
        toast.info(`Dry run: found ${result.breachCount} breaches (${result.criticalCount} critical)`);
      } else {
        toast.success(
          `Scan complete: ${result.breachCount} breaches found, ${result.notificationsSent} trader notifications sent`
        );
      }
      utils.slaEscalation.stats.invalidate();
      utils.slaEscalation.list.invalidate();
    },
    onError: (err) => toast.error(`Scan failed: ${err.message}`),
  });

  const handleRefresh = () => {
    refetchStats();
    refetchBreaches();
  };

  return (
    <DashboardLayout title="SLA Breach Escalation">
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
              <AlertTriangle className="h-6 w-6 text-amber-500" />
              SLA Breach Escalation
            </h1>
            <p className="text-muted-foreground text-sm mt-1">
              Monitor declarations exceeding processing time targets and escalate to traders
            </p>
          </div>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={handleRefresh}
              className="gap-1.5"
            >
              <RefreshCw className="h-4 w-4" />
              Refresh
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => scan.mutate({ notifyTraders: false, dryRun: true })}
              disabled={scan.isPending}
              className="gap-1.5"
            >
              {scan.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Shield className="h-4 w-4" />}
              Dry Run
            </Button>
            <Button
              size="sm"
              onClick={() => scan.mutate({ notifyTraders: true, dryRun: false })}
              disabled={scan.isPending}
              className="gap-1.5 bg-amber-600 hover:bg-amber-700 text-white"
            >
              {scan.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Bell className="h-4 w-4" />}
              Run & Notify Traders
            </Button>
          </div>
        </div>

        {/* SLA Reference */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[
            { lane: "green", label: "Green Lane", threshold: "4 hours", icon: CheckCircle, color: "text-green-600" },
            { lane: "yellow", label: "Yellow Lane", threshold: "24 hours", icon: Clock, color: "text-yellow-600" },
            { lane: "red", label: "Red Lane", threshold: "72 hours", icon: AlertTriangle, color: "text-red-600" },
            { lane: "blue", label: "Blue Lane (AEO)", threshold: "48 hours", icon: Shield, color: "text-blue-600" },
          ].map(({ lane, label, threshold, icon: Icon, color }) => (
            <Card key={lane} className="bg-muted/30">
              <CardContent className="pt-4 pb-3">
                <div className="flex items-center gap-2">
                  <Icon className={`h-4 w-4 ${color}`} />
                  <span className="text-sm font-medium">{label}</span>
                </div>
                <p className="text-xs text-muted-foreground mt-1">Target: {threshold}</p>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Stats */}
        {statsLoading ? (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-28" />
            ))}
          </div>
        ) : stats ? (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <StatCard
              label="In Processing"
              value={stats.totalInProcessing}
              sub="Active declarations"
              icon={Clock}
              color="text-blue-600"
            />
            <StatCard
              label="Total Breaches"
              value={stats.totalBreaches}
              sub="Exceeding SLA"
              icon={AlertTriangle}
              color="text-amber-600"
            />
            <StatCard
              label="Critical Breaches"
              value={stats.criticalBreaches}
              sub=">2× SLA threshold"
              icon={AlertTriangle}
              color="text-red-600"
            />
            <StatCard
              label="Warning Breaches"
              value={stats.warningBreaches}
              sub="1–2× SLA threshold"
              icon={Clock}
              color="text-yellow-600"
            />
          </div>
        ) : null}

        {/* Lane breakdown */}
        {stats && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {(["green", "yellow", "red", "blue"] as const).map((lane) => {
              const laneStats = stats.byLane[lane] ?? { total: 0, breached: 0 };
              const breachRate = laneStats.total > 0
                ? Math.round((laneStats.breached / laneStats.total) * 100)
                : 0;
              return (
                <Card key={lane}>
                  <CardContent className="pt-4 pb-3">
                    <div className="flex items-center justify-between mb-2">
                      <Badge className={LANE_COLORS[lane]}>
                        {lane.charAt(0).toUpperCase() + lane.slice(1)} Lane
                      </Badge>
                      <span className="text-xs text-muted-foreground">{SLA_LABELS[lane]}</span>
                    </div>
                    <p className="text-2xl font-bold">{laneStats.breached}</p>
                    <p className="text-xs text-muted-foreground">
                      {laneStats.breached} / {laneStats.total} breached ({breachRate}%)
                    </p>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}

        {/* Breach Table */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-base">
                  Current SLA Breaches
                  {breaches && (
                    <Badge variant="secondary" className="ml-2">{breaches.total}</Badge>
                  )}
                </CardTitle>
                <CardDescription>
                  Declarations currently exceeding their processing time target
                </CardDescription>
              </div>
              <div className="flex gap-2">
                <Select value={laneFilter} onValueChange={(v) => setLaneFilter(v as any)}>
                  <SelectTrigger className="w-32 h-8 text-xs">
                    <SelectValue placeholder="All lanes" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Lanes</SelectItem>
                    <SelectItem value="green">Green</SelectItem>
                    <SelectItem value="yellow">Yellow</SelectItem>
                    <SelectItem value="red">Red</SelectItem>
                    <SelectItem value="blue">Blue (AEO)</SelectItem>
                  </SelectContent>
                </Select>
                <Select value={severityFilter} onValueChange={(v) => setSeverityFilter(v as any)}>
                  <SelectTrigger className="w-32 h-8 text-xs">
                    <SelectValue placeholder="All severity" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Severity</SelectItem>
                    <SelectItem value="warning">Warning</SelectItem>
                    <SelectItem value="critical">Critical</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            {breachesLoading ? (
              <div className="p-4 space-y-2">
                {Array.from({ length: 5 }).map((_, i) => (
                  <Skeleton key={i} className="h-12 w-full" />
                ))}
              </div>
            ) : (breaches?.items.length ?? 0) === 0 ? (
              <div className="p-12 text-center text-muted-foreground">
                <CheckCircle className="h-12 w-12 mx-auto mb-3 text-green-500 opacity-60" />
                <p className="font-medium">No SLA breaches detected</p>
                <p className="text-sm mt-1">All declarations are within their processing time targets.</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Declaration</TableHead>
                      <TableHead>Trader</TableHead>
                      <TableHead>Lane</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Elapsed</TableHead>
                      <TableHead>SLA Target</TableHead>
                      <TableHead>Overage</TableHead>
                      <TableHead>Severity</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {breaches?.items.map((b) => (
                      <TableRow key={b.declarationId} className={b.breachSeverity === "critical" ? "bg-red-50/50 dark:bg-red-950/20" : ""}>
                        <TableCell className="font-mono text-sm font-medium">
                          {b.declarationNumber}
                        </TableCell>
                        <TableCell className="text-sm">{b.traderName}</TableCell>
                        <TableCell>
                          <Badge className={`text-xs ${LANE_COLORS[b.riskLane]}`}>
                            {b.riskLane}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className="text-xs">
                            {b.status.replace(/_/g, " ")}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-sm font-medium">
                          {b.hoursElapsed}h
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {b.slaThresholdHours}h
                        </TableCell>
                        <TableCell className={`text-sm font-medium ${b.breachSeverity === "critical" ? "text-red-600" : "text-amber-600"}`}>
                          +{b.overageHours}h
                        </TableCell>
                        <TableCell>
                          <SeverityBadge severity={b.breachSeverity} />
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}
