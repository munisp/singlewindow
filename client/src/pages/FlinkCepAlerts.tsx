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
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
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
  const [ackDialog, setAckDialog] = useState<{ alertId: string; patternName: string; mode: "investigate" | "resolve" } | null>(null);
  const [ackNotes, setAckNotes] = useState("");
  const [ackStatus, setAckStatus] = useState<"investigating" | "resolved" | "false_positive">("investigating");

  const statsQuery = trpc.cep.getStats.useQuery();
  const statusQuery = trpc.cep.getServiceStatus.useQuery();
  const patternsQuery = trpc.cep.getPatterns.useQuery();
  const alertsQuery = trpc.cep.getAlerts.useQuery({ status: activeTab as any, limit: 100 });

  const ackMutation = trpc.cep.acknowledgeAlert.useMutation({
    onSuccess: (_, vars) => {
      const isResolve = vars.status === "resolved" || vars.status === "false_positive";
      toast.success(isResolve ? "Alert resolved" : "Alert marked as investigating");
      alertsQuery.refetch();
      statsQuery.refetch();
      setAckDialog(null);
      setAckNotes("");
      setAckStatus("investigating");
    },
    onError: (err) => toast.error(err.message),
  });

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkDialog, setBulkDialog] = useState(false);
  const [bulkStatus, setBulkStatus] = useState<"resolved" | "false_positive">("resolved");
  const [bulkNotes, setBulkNotes] = useState("");

  const bulkAckMutation = trpc.cep.bulkAcknowledge.useMutation({
    onSuccess: (data) => {
      toast.success(`Resolved ${data.succeeded} alert${data.succeeded !== 1 ? "s" : ""}${data.failed > 0 ? ` (${data.failed} failed)` : ""}`);
      setSelectedIds(new Set());
      setBulkDialog(false);
      setBulkNotes("");
      alertsQuery.refetch();
      statsQuery.refetch();
    },
    onError: (err) => toast.error(err.message),
  });

  const stats = statsQuery.data;
  const alerts = (alertsQuery.data?.alerts ?? []) as any[];
  const openAlerts = alerts.filter((a: any) => a.status === "open" || a.status === "investigating");
  const allOpenSelected = openAlerts.length > 0 && openAlerts.every((a: any) => selectedIds.has(a.alert_id));
  const someSelected = selectedIds.size > 0;

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
              <>
                {/* Bulk action toolbar */}
                {activeTab === "open" && someSelected && (
                  <div className="flex items-center gap-3 mb-3 px-2 py-2 rounded-lg bg-muted/40 border border-border">
                    <span className="text-sm text-muted-foreground">{selectedIds.size} selected</span>
                    <Button
                      size="sm"
                      className="h-7 text-xs bg-green-600 hover:bg-green-700"
                      onClick={() => setBulkDialog(true)}
                    >
                      Resolve selected
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 text-xs"
                      onClick={() => setSelectedIds(new Set())}
                    >
                      Clear
                    </Button>
                  </div>
                )}
                <Table>
                  <TableHeader>
                    <TableRow>
                      {activeTab === "open" && (
                        <TableHead className="w-8">
                          <Checkbox
                            checked={allOpenSelected}
                            onCheckedChange={(checked) => {
                              if (checked) {
                                setSelectedIds(new Set(openAlerts.map((a: any) => a.alert_id)));
                              } else {
                                setSelectedIds(new Set());
                              }
                            }}
                          />
                        </TableHead>
                      )}
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
                    <TableRow key={alert.alert_id} className={selectedIds.has(alert.alert_id) ? "bg-muted/30" : ""}>
                      {activeTab === "open" && (
                        <TableCell className="w-8">
                          {(alert.status === "open" || alert.status === "investigating") && (
                            <Checkbox
                              checked={selectedIds.has(alert.alert_id)}
                              onCheckedChange={(checked) => {
                                setSelectedIds((prev) => {
                                  const next = new Set(prev);
                                  if (checked) next.add(alert.alert_id);
                                  else next.delete(alert.alert_id);
                                  return next;
                                });
                              }}
                            />
                          )}
                        </TableCell>
                      )}
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
                        {(alert.status === "open" || alert.status === "investigating") && (
                          <div className="flex items-center gap-1.5">
                            {alert.status === "open" && (
                              <Button
                                size="sm"
                                variant="outline"
                                className="text-xs h-7"
                                onClick={() => {
                                  setAckStatus("investigating");
                                  setAckDialog({ alertId: alert.alert_id, patternName: alert.pattern_name, mode: "investigate" });
                                }}
                              >
                                Investigate
                              </Button>
                            )}
                            <Button
                              size="sm"
                              variant="default"
                              className="text-xs h-7 bg-green-600 hover:bg-green-700"
                              onClick={() => {
                                setAckStatus("resolved");
                                setAckDialog({ alertId: alert.alert_id, patternName: alert.pattern_name, mode: "resolve" });
                              }}
                            >
                              Resolve
                            </Button>
                          </div>
                        )}
                        {alert.status === "investigating" && (
                          <span className="text-xs text-yellow-400 font-medium">⚑ Investigating</span>
                        )}
                        {(alert.status === "resolved" || alert.status === "false_positive") && (
                          <div className="flex flex-col gap-0.5">
                            <span className="text-xs text-green-400 font-medium">
                              {alert.status === "false_positive" ? "✗ False Positive" : "✓ Resolved"}
                            </span>
                            {alert.resolved_by && (
                              <span className="text-xs text-muted-foreground">{alert.resolved_by}</span>
                            )}
                          </div>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
                </Table>
              </>
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

      {/* Bulk Resolve Dialog */}
      <Dialog open={bulkDialog} onOpenChange={(open) => { if (!open) { setBulkDialog(false); setBulkNotes(""); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Bulk Resolve {selectedIds.size} Alert{selectedIds.size !== 1 ? "s" : ""}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              This will mark all {selectedIds.size} selected alert{selectedIds.size !== 1 ? "s" : ""} as resolved in parallel.
              Already-resolved alerts are automatically skipped.
            </p>
            <div className="space-y-2">
              <Label>Resolution status</Label>
              <Select value={bulkStatus} onValueChange={(v) => setBulkStatus(v as "resolved" | "false_positive")}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="resolved">Resolved</SelectItem>
                  <SelectItem value="false_positive">False Positive</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Resolution notes (optional)</Label>
              <Textarea
                value={bulkNotes}
                onChange={(e) => setBulkNotes(e.target.value)}
                placeholder="Describe the bulk resolution outcome…"
                rows={3}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setBulkDialog(false)}>Cancel</Button>
            <Button
              className="bg-green-600 hover:bg-green-700"
              disabled={bulkAckMutation.isPending}
              onClick={() => bulkAckMutation.mutate({
                alertIds: Array.from(selectedIds),
                status: bulkStatus,
                resolutionNote: bulkNotes || undefined,
              })}
            >
              {bulkAckMutation.isPending ? "Resolving…" : `Resolve ${selectedIds.size}`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Acknowledge / Resolve Dialog */}
      <Dialog open={!!ackDialog} onOpenChange={() => { setAckDialog(null); setAckNotes(""); setAckStatus("investigating"); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{ackDialog?.mode === "resolve" ? "Resolve Alert" : "Investigate Alert"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Alert: <strong className="text-foreground">{ackDialog?.patternName}</strong>
            </p>

            {/* Status selector — only shown in resolve mode */}
            {ackDialog?.mode === "resolve" && (
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Resolution Status</Label>
                <Select
                  value={ackStatus}
                  onValueChange={(v) => setAckStatus(v as typeof ackStatus)}
                >
                  <SelectTrigger className="h-9">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="resolved">✓ Resolved — confirmed fraud / actioned</SelectItem>
                    <SelectItem value="false_positive">✗ False Positive — no further action</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}

            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">
                {ackDialog?.mode === "resolve" ? "Resolution notes (required)" : "Investigation notes (optional)"}
              </Label>
              <Textarea
                placeholder={ackDialog?.mode === "resolve" ? "Describe the outcome and actions taken…" : "Add initial investigation notes…"}
                value={ackNotes}
                onChange={(e) => setAckNotes(e.target.value)}
                rows={3}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setAckDialog(null); setAckNotes(""); setAckStatus("investigating"); }}>Cancel</Button>
            <Button
              onClick={() => {
                if (!ackDialog) return;
                if (ackDialog.mode === "resolve" && !ackNotes.trim()) {
                  toast.error("Resolution notes are required when resolving an alert");
                  return;
                }
                ackMutation.mutate({
                  alertId: ackDialog.alertId,
                  status: ackDialog.mode === "resolve" ? ackStatus : "investigating",
                  resolutionNote: ackNotes.trim() || undefined,
                });
              }}
              disabled={ackMutation.isPending}
              className={ackDialog?.mode === "resolve" ? "bg-green-600 hover:bg-green-700" : ""}
            >
              {ackMutation.isPending
                ? "Saving…"
                : ackDialog?.mode === "resolve"
                  ? "Confirm Resolution"
                  : "Start Investigation"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </DashboardLayout>
  );
}
