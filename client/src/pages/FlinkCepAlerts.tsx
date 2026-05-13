import { useState } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { trpc } from "@/lib/trpc";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { useAuth } from "@/_core/hooks/useAuth";
import {
  AlertTriangle,
  CheckCircle2,
  RefreshCw,
  ShieldAlert,
  Activity,
  TrendingDown,
  Route,
  Package,
  Zap,
} from "lucide-react";

const SEVERITY_COLORS: Record<string, string> = {
  critical: "bg-red-600 text-white",
  high: "bg-orange-500 text-white",
  medium: "bg-yellow-500 text-black",
  low: "bg-blue-500 text-white",
};

const PATTERN_ICONS: Record<string, React.ReactNode> = {
  CAROUSEL_FRAUD: <RefreshCw className="h-4 w-4" />,
  SPLIT_CONSIGNMENT: <Package className="h-4 w-4" />,
  VALUATION_ANOMALY: <TrendingDown className="h-4 w-4" />,
  SUSPICIOUS_ROUTING: <Route className="h-4 w-4" />,
};

export default function FlinkCepAlerts() {
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState<"open" | "resolved">("open");
  const [ackDialog, setAckDialog] = useState<{ alertId: string; patternName: string } | null>(null);
  const [ackNotes, setAckNotes] = useState("");

  const statsQuery = trpc.cep.getStats.useQuery();
  const statusQuery = trpc.cep.getServiceStatus.useQuery();
  const patternsQuery = trpc.cep.getPatterns.useQuery();
  const alertsQuery = trpc.cep.getAlerts.useQuery({ status: activeTab as any, limit: 100 });

  const ackMutation = trpc.cep.acknowledgeAlert.useMutation({
    onSuccess: () => {
      toast.success("Alert acknowledged");
      alertsQuery.refetch();
      statsQuery.refetch();
      setAckDialog(null);
      setAckNotes("");
    },
    onError: (err) => toast.error(err.message),
  });

  const stats = statsQuery.data;
  const alerts = (alertsQuery.data?.alerts ?? []) as any[];

  return (
    <DashboardLayout title="Trade Pattern Alerts (Flink CEP)">
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-foreground">Trade Pattern Alerts</h1>
            <p className="text-muted-foreground text-sm mt-1">
              Apache Flink Complex Event Processing — real-time fraud and anomaly detection
            </p>
          </div>
          <div className="flex items-center gap-2">
              {statusQuery.data && (
              <Badge variant="outline" className={statusQuery.data.service === 'online' ? "border-green-500 text-green-400" : "border-yellow-500 text-yellow-400"}>
                <Zap className="h-3 w-3 mr-1" />
                {statusQuery.data.service === 'online' ? "CEP Engine Online" : "DB Fallback Mode"}
              </Badge>
            )}
            <Button variant="outline" size="sm" onClick={() => alertsQuery.refetch()}>
              <RefreshCw className="h-4 w-4 mr-1" /> Refresh
            </Button>
          </div>
        </div>

        {/* Stats Cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Card className="bg-card border-border">
            <CardContent className="pt-4">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-red-500/10">
                  <AlertTriangle className="h-5 w-5 text-red-400" />
                </div>
                <div>
                  <p className="text-2xl font-bold text-foreground">{stats?.open_alerts ?? 0}</p>
                  <p className="text-xs text-muted-foreground">Open Alerts</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card className="bg-card border-border">
            <CardContent className="pt-4">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-orange-500/10">
                  <ShieldAlert className="h-5 w-5 text-orange-400" />
                </div>
                <div>
                  <p className="text-2xl font-bold text-foreground">{stats?.total_alerts ?? 0}</p>
                  <p className="text-xs text-muted-foreground">Total Alerts</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card className="bg-card border-border">
            <CardContent className="pt-4">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-blue-500/10">
                  <Activity className="h-5 w-5 text-blue-400" />
                </div>
                <div>
                  <p className="text-2xl font-bold text-foreground">{stats?.declarations_processed?.toLocaleString() ?? 0}</p>
                  <p className="text-xs text-muted-foreground">Declarations Scanned</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card className="bg-card border-border">
            <CardContent className="pt-4">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-green-500/10">
                  <CheckCircle2 className="h-5 w-5 text-green-400" />
                </div>
                <div>
                  <p className="text-2xl font-bold text-foreground">{stats?.patterns_registered ?? 0}</p>
                  <p className="text-xs text-muted-foreground">Active Patterns</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Pattern Breakdown */}
        {stats?.by_pattern && (
          <Card className="bg-card border-border">
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Alert Distribution by Pattern</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                {Object.entries(stats.by_pattern).map(([patternId, count]) => {
                  const pattern = (patternsQuery.data as any[])?.find((p: any) => p.pattern_id === patternId) as any;
                  return (
                    <div key={patternId} className="flex items-center gap-2 p-3 rounded-lg bg-muted/30">
                      <div className="text-muted-foreground">{PATTERN_ICONS[patternId] ?? <AlertTriangle className="h-4 w-4" />}</div>
                      <div>
                        <p className="text-sm font-medium text-foreground">{count}</p>
                        <p className="text-xs text-muted-foreground">{(pattern as any)?.name ?? patternId}</p>
                      </div>
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Alerts Table */}
        <Card className="bg-card border-border">
          <CardHeader className="pb-3">
            <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as "open" | "resolved")}>
              <TabsList>
                <TabsTrigger value="open">
                  Open Alerts
                  {(stats?.open_alerts ?? 0) > 0 && (
                    <Badge className="ml-2 bg-red-500 text-white text-xs">{stats?.open_alerts}</Badge>
                  )}
                </TabsTrigger>
                <TabsTrigger value="resolved">Resolved</TabsTrigger>
              </TabsList>
            </Tabs>
          </CardHeader>
          <CardContent>
            {alertsQuery.isLoading ? (
              <div className="text-center py-8 text-muted-foreground">Loading alerts…</div>
            ) : alerts.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                <CheckCircle2 className="h-8 w-8 mx-auto mb-2 text-green-400" />
                No {activeTab} alerts
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Pattern</TableHead>
                    <TableHead>Severity</TableHead>
                    <TableHead>Trader</TableHead>
                    <TableHead>Declarations</TableHead>
                    <TableHead>Fired At</TableHead>
                    <TableHead>Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {alerts.map((alert) => (
                    <TableRow key={alert.alert_id}>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <span className="text-muted-foreground">
                            {PATTERN_ICONS[alert.pattern_id] ?? <AlertTriangle className="h-4 w-4" />}
                          </span>
                          <span className="text-sm font-medium text-foreground">{alert.pattern_name}</span>
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge className={SEVERITY_COLORS[alert.severity] ?? "bg-gray-500 text-white"}>
                          {alert.severity.toUpperCase()}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground font-mono">{alert.trader_id}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {alert.declaration_ids.length} declaration{alert.declaration_ids.length !== 1 ? "s" : ""}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {new Date(alert.fired_at).toLocaleString()}
                      </TableCell>
                      <TableCell>
                        {alert.status === "open" && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => setAckDialog({ alertId: alert.alert_id, patternName: alert.pattern_name })}
                          >
                            Acknowledge
                          </Button>
                        )}
                        {alert.status === "acknowledged" && (
                          <span className="text-xs text-green-400">✓ Reviewed</span>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        {/* Active Patterns */}
        <Card className="bg-card border-border">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Registered CEP Patterns</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {(patternsQuery.data ?? []).map((pattern) => {
                const p = pattern as any;
                return (
                <div key={p.pattern_id} className="p-3 rounded-lg border border-border bg-muted/20">
                  <div className="flex items-center justify-between mb-1">
                    <div className="flex items-center gap-2">
                      <span className="text-muted-foreground">{PATTERN_ICONS[p.pattern_id] ?? <AlertTriangle className="h-4 w-4" />}</span>
                      <span className="text-sm font-medium text-foreground">{p.name}</span>
                    </div>
                    <Badge variant={p.status === 'enabled' ? "default" : "secondary"} className="text-xs">
                      {p.status === 'enabled' ? "Active" : "Disabled"}
                    </Badge>
                  </div>
                  <p className="text-xs text-muted-foreground">{p.description}</p>
                </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Acknowledge Dialog */}
      <Dialog open={!!ackDialog} onOpenChange={() => setAckDialog(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Acknowledge Alert</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Acknowledging: <strong>{ackDialog?.patternName}</strong>
            </p>
            <Textarea
              placeholder="Add investigation notes (optional)…"
              value={ackNotes}
              onChange={(e) => setAckNotes(e.target.value)}
              rows={3}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAckDialog(null)}>Cancel</Button>
            <Button
              onClick={() => {
                if (!ackDialog) return;
                ackMutation.mutate({
                  alertId: ackDialog.alertId,
                  status: "investigating" as const,
                  resolutionNote: ackNotes || undefined,
                });
              }}
              disabled={ackMutation.isPending}
            >
              {ackMutation.isPending ? "Saving…" : "Acknowledge"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </DashboardLayout>
  );
}
