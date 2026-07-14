/**
 * Schedule Analytics + Checklist Template Editor
 * Items: 5 (delivery success chart), 7 (deadline reminders), 8 (pause-on-failure),
 *        12 (clone schedule), 18 (dry-run), 22 (schedule analytics),
 *        24 (document expiry reminders), 25 (SLA monitoring), 27 (template editor), 28 (dependencies)
 */
import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell
} from "recharts";
import {
  BarChart3, Clock, AlertTriangle, CheckCircle, XCircle,
  Copy, Play, Plus, Trash2, GripVertical, ArrowRight
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";

// ─── Schedule Analytics Tab (Items 5, 8, 12, 18, 22, 25) ─────────────────────
function ScheduleAnalyticsTab() {
  const { toast } = useToast();
  const utils = trpc.useUtils();
  const [dryRunScheduleId, setDryRunScheduleId] = useState<number | null>(null);
  const [dryRunResult, setDryRunResult] = useState<{ estimatedRows: number; dateRange: any; cadence: string; filterPreset: string } | null>(null);

  const { data: allStats = [] } = trpc.scheduleStats.getAllStats.useQuery();
  const { data: schedules } = trpc.exportSchedules.list.useQuery();

  const retryMutation = trpc.scheduleStats.retryDelivery.useMutation({
    onSuccess: () => {
      utils.scheduleStats.getAllStats.invalidate();
      toast({ title: "Retry queued — schedule re-activated" });
    },
    onError: (e) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const cloneMutation = trpc.exportSchedules.upsert.useMutation({
    onSuccess: () => {
      utils.exportSchedules.list.invalidate();
      toast({ title: "Schedule cloned" });
    },
    onError: (e) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const dryRunQuery = trpc.scheduleStats.dryRun.useQuery(
    { scheduleId: dryRunScheduleId! },
    { enabled: !!dryRunScheduleId }
  );

  const scheduleMap = new Map((schedules ?? []).map(s => [s.id, s]));

  // SLA monitoring: flag schedules where last delivery is overdue
  const slaAlerts = allStats.filter(s => {
    const schedule = scheduleMap.get(s.scheduleId);
    if (!schedule) return false;
    const cadenceDays = schedule.cadence === "daily" ? 1 : schedule.cadence === "weekly" ? 7 : 30;
    const slaDays = cadenceDays * 2;
    const lastUpdated = new Date(s.lastUpdated).getTime();
    return (Date.now() - lastUpdated) > slaDays * 86400000;
  });

  // Chart data: success rate per schedule
  const chartData = allStats.map(s => {
    const schedule = scheduleMap.get(s.scheduleId);
    const total = s.successCount + s.failureCount;
    const rate = total > 0 ? Math.round((s.successCount / total) * 100) : 0;
    return {
      name: schedule ? `${schedule.exportType} (${schedule.cadence})` : `Schedule #${s.scheduleId}`,
      successRate: rate,
      totalRows: s.totalRowsExported,
      consecutiveFailures: s.consecutiveFailures,
    };
  });

  return (
    <div className="space-y-6">
      {/* SLA Alerts */}
      {slaAlerts.length > 0 && (
        <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg p-4">
          <div className="flex items-center gap-2 mb-2">
            <AlertTriangle className="w-4 h-4 text-amber-500" />
            <span className="text-sm font-medium text-amber-500">
              {slaAlerts.length} schedule{slaAlerts.length > 1 ? "s" : ""} overdue (SLA exceeded)
            </span>
          </div>
          <div className="space-y-1">
            {slaAlerts.map(s => {
              const schedule = scheduleMap.get(s.scheduleId);
              return (
                <div key={s.scheduleId} className="flex items-center justify-between text-xs">
                  <span>{schedule ? `${schedule.exportType} (${schedule.cadence})` : `#${s.scheduleId}`}</span>
                  <Button
                    size="sm"
                    className="h-5 text-xs px-2"
                    onClick={() => retryMutation.mutate({ scheduleId: s.scheduleId })}
                    disabled={retryMutation.isPending}
                  >
                    Retry
                  </Button>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Success Rate Chart */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center gap-2">
            <BarChart3 className="w-4 h-4 text-amber-500" />
            Delivery Success Rate by Schedule
          </CardTitle>
        </CardHeader>
        <CardContent>
          {chartData.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">No delivery data yet</p>
          ) : (
            <div style={{ height: 240 }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData} margin={{ top: 5, right: 20, left: 0, bottom: 40 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis dataKey="name" tick={{ fontSize: 10 }} angle={-30} textAnchor="end" />
                  <YAxis domain={[0, 100]} tickFormatter={v => `${v}%`} tick={{ fontSize: 10 }} />
                  <Tooltip formatter={(v: number) => [`${v}%`, "Success Rate"]} />
                  <Bar dataKey="successRate" radius={[4, 4, 0, 0]}>
                    {chartData.map((entry, i) => (
                      <Cell
                        key={i}
                        fill={entry.successRate >= 90 ? "#22c55e" : entry.successRate >= 70 ? "#f59e0b" : "#ef4444"}
                      />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Schedule table with clone + dry-run + retry */}
      <div className="border border-border rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted/50">
            <tr>
              <th className="p-3 text-left">Schedule</th>
              <th className="p-3 text-left">Cadence</th>
              <th className="p-3 text-left">Total Rows</th>
              <th className="p-3 text-left">Consec. Failures</th>
              <th className="p-3 text-left">Actions</th>
            </tr>
          </thead>
          <tbody>
            {allStats.length === 0 ? (
              <tr><td colSpan={5} className="p-6 text-center text-muted-foreground">No schedules</td></tr>
            ) : allStats.map(s => {
              const schedule = scheduleMap.get(s.scheduleId);
              return (
                <tr key={s.scheduleId} className="border-t border-border hover:bg-muted/20">
                  <td className="p-3 font-medium">{schedule ? `${schedule.exportType} (${schedule.cadence})` : `#${s.scheduleId}`}</td>
                  <td className="p-3">
                    <Badge variant="outline" className="text-xs">{schedule?.cadence ?? "—"}</Badge>
                  </td>
                  <td className="p-3 font-mono text-xs">{s.totalRowsExported.toLocaleString()}</td>
                  <td className="p-3">
                    {s.consecutiveFailures > 0 ? (
                      <Badge variant="destructive" className="text-xs">{s.consecutiveFailures}</Badge>
                    ) : (
                      <span className="text-muted-foreground">0</span>
                    )}
                  </td>
                  <td className="p-3">
                    <div className="flex gap-1">
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-6 text-xs px-2"
                        onClick={() => {
                          setDryRunScheduleId(s.scheduleId);
                          setDryRunResult(null);
                        }}
                      >
                        <Play className="w-3 h-3 mr-1" /> Dry Run
                      </Button>
                      {schedule && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-6 text-xs px-2"
                          onClick={() => {
                        const sched = scheduleMap.get(s.scheduleId);
                        if (sched) cloneMutation.mutate({ exportType: sched.exportType as any, cadence: sched.cadence as any, filterPreset: sched.filterPreset as any });
                      }}
                          disabled={cloneMutation.isPending}
                        >
                          <Copy className="w-3 h-3 mr-1" /> Clone
                        </Button>
                      )}
                      {s.consecutiveFailures > 0 && (
                        <Button
                          size="sm"
                          className="h-6 text-xs px-2 bg-amber-600 hover:bg-amber-700"
                          onClick={() => retryMutation.mutate({ scheduleId: s.scheduleId })}
                          disabled={retryMutation.isPending}
                        >
                          Retry
                        </Button>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Dry Run Dialog */}
      <Dialog open={!!dryRunScheduleId} onOpenChange={() => setDryRunScheduleId(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Dry Run Preview</DialogTitle>
          </DialogHeader>
          {dryRunQuery.isLoading ? (
            <p className="text-sm text-muted-foreground">Calculating…</p>
          ) : dryRunQuery.data ? (
            <div className="space-y-3 text-sm">
              <div className="grid grid-cols-2 gap-3">
                <div className="bg-muted/30 rounded-lg p-3">
                  <p className="text-xs text-muted-foreground">Estimated Rows</p>
                  <p className="text-2xl font-bold">{dryRunQuery.data.estimatedRows.toLocaleString()}</p>
                </div>
                <div className="bg-muted/30 rounded-lg p-3">
                  <p className="text-xs text-muted-foreground">Cadence</p>
                  <p className="text-2xl font-bold capitalize">{dryRunQuery.data.cadence}</p>
                </div>
              </div>
              {dryRunQuery.data.dateRange && (
                <div className="bg-muted/30 rounded-lg p-3">
                  <p className="text-xs text-muted-foreground mb-1">Date Range</p>
                  <p className="text-xs font-mono">
                    {new Date(dryRunQuery.data.dateRange.from).toLocaleString()}
                    {" → "}
                    {new Date(dryRunQuery.data.dateRange.to).toLocaleString()}
                  </p>
                </div>
              )}
              <p className="text-xs text-muted-foreground">
                This is an estimate based on the last successful delivery. No data will be exported.
              </p>
            </div>
          ) : null}
          <DialogFooter>
            <Button variant="outline" onClick={() => setDryRunScheduleId(null)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─── Checklist Template Editor Tab (Items 24, 27) ────────────────────────────
function ChecklistTemplateTab() {
  const { toast } = useToast();
  const utils = trpc.useUtils();
  const [editingDoc, setEditingDoc] = useState<{
    docType: string; label: string; required: boolean; sortOrder: number; expiryDays?: number;
  } | null>(null);
  const [isNew, setIsNew] = useState(false);

  const { data: templates = [], isLoading } = trpc.checklistTemplates.list.useQuery();

  const upsertMutation = trpc.checklistTemplates.upsert.useMutation({
    onSuccess: () => {
      setEditingDoc(null);
      setIsNew(false);
      utils.checklistTemplates.list.invalidate();
      toast({ title: "Template saved" });
    },
    onError: (e) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const deleteMutation = trpc.checklistTemplates.delete.useMutation({
    onSuccess: () => {
      utils.checklistTemplates.list.invalidate();
      toast({ title: "Template removed" });
    },
    onError: (e) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const reorderMutation = trpc.checklistTemplates.reorder.useMutation({
    onError: (e) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const handleMoveUp = (index: number) => {
    if (index === 0) return;
    const newOrder = [...templates];
    [newOrder[index - 1], newOrder[index]] = [newOrder[index], newOrder[index - 1]];
    reorderMutation.mutate({
      order: newOrder.map((t, i) => ({ docType: t.docType, sortOrder: i }))
    });
    utils.checklistTemplates.list.invalidate();
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <p className="text-sm text-muted-foreground">
          Define required and optional document types for AEO renewal applications.
          Documents with expiry days set will show a warning badge when approaching expiry.
        </p>
        <Button
          size="sm"
          className="bg-amber-600 hover:bg-amber-700"
          onClick={() => {
            setEditingDoc({ docType: "", label: "", required: true, sortOrder: templates.length, expiryDays: undefined });
            setIsNew(true);
          }}
        >
          <Plus className="w-3 h-3 mr-1" /> Add Document Type
        </Button>
      </div>

      <div className="border border-border rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted/50">
            <tr>
              <th className="p-3 text-left w-8"></th>
              <th className="p-3 text-left">Doc Type</th>
              <th className="p-3 text-left">Label</th>
              <th className="p-3 text-left">Required</th>
              <th className="p-3 text-left">Expiry (days)</th>
              <th className="p-3 text-left">Actions</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr><td colSpan={6} className="p-6 text-center text-muted-foreground">Loading…</td></tr>
            ) : templates.length === 0 ? (
              <tr><td colSpan={6} className="p-6 text-center text-muted-foreground">No templates defined</td></tr>
            ) : templates.map((t, i) => (
              <tr key={t.docType} className="border-t border-border hover:bg-muted/20">
                <td className="p-3">
                  <button onClick={() => handleMoveUp(i)} disabled={i === 0} className="text-muted-foreground hover:text-foreground disabled:opacity-30">
                    <GripVertical className="w-4 h-4" />
                  </button>
                </td>
                <td className="p-3 font-mono text-xs">{t.docType}</td>
                <td className="p-3">{t.label}</td>
                <td className="p-3">
                  <Badge variant={t.required ? "default" : "secondary"} className="text-xs">
                    {t.required ? "Required" : "Optional"}
                  </Badge>
                </td>
                <td className="p-3">
                  {t.expiryDays ? (
                    <span className="text-xs">{t.expiryDays}d</span>
                  ) : (
                    <span className="text-xs text-muted-foreground">—</span>
                  )}
                </td>
                <td className="p-3">
                  <div className="flex gap-1">
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-6 text-xs px-2"
                      onClick={() => { setEditingDoc({ ...t, expiryDays: t.expiryDays ?? undefined }); setIsNew(false); }}
                    >
                      Edit
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-6 w-6 p-0 text-destructive"
                      onClick={() => deleteMutation.mutate({ docType: t.docType })}
                      disabled={deleteMutation.isPending}
                    >
                      <Trash2 className="w-3 h-3" />
                    </Button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Edit/Add Dialog */}
      <Dialog open={!!editingDoc} onOpenChange={() => { setEditingDoc(null); setIsNew(false); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{isNew ? "Add Document Type" : "Edit Document Type"}</DialogTitle>
          </DialogHeader>
          {editingDoc && (
            <div className="space-y-4">
              <div className="space-y-2">
                <Label>Doc Type Key (unique identifier)</Label>
                <Input
                  value={editingDoc.docType}
                  onChange={(e) => setEditingDoc({ ...editingDoc, docType: e.target.value })}
                  disabled={!isNew}
                  placeholder="e.g. certificate_of_origin"
                  className="font-mono text-sm"
                />
              </div>
              <div className="space-y-2">
                <Label>Display Label</Label>
                <Input
                  value={editingDoc.label}
                  onChange={(e) => setEditingDoc({ ...editingDoc, label: e.target.value })}
                  placeholder="e.g. Certificate of Origin"
                />
              </div>
              <div className="flex items-center gap-3">
                <Switch
                  checked={editingDoc.required}
                  onCheckedChange={(v) => setEditingDoc({ ...editingDoc, required: v })}
                />
                <Label>Required document</Label>
              </div>
              <div className="space-y-2">
                <Label>Expiry warning (days before expiry)</Label>
                <Input
                  type="number"
                  value={editingDoc.expiryDays ?? ""}
                  onChange={(e) => setEditingDoc({ ...editingDoc, expiryDays: e.target.value ? Number(e.target.value) : undefined })}
                  placeholder="e.g. 30 (leave blank for no expiry)"
                />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => { setEditingDoc(null); setIsNew(false); }}>Cancel</Button>
            <Button
              className="bg-amber-600 hover:bg-amber-700"
              onClick={() => editingDoc && upsertMutation.mutate(editingDoc)}
              disabled={!editingDoc?.docType || !editingDoc?.label || upsertMutation.isPending}
            >
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─── Schedule Dependencies Tab (Item 28) ─────────────────────────────────────
function ScheduleDepsTab() {
  const { toast } = useToast();
  const utils = trpc.useUtils();
  const [selectedScheduleId, setSelectedScheduleId] = useState<number | null>(null);
  const [dependsOnId, setDependsOnId] = useState<number | null>(null);

  const { data: schedules = [] } = trpc.exportSchedules.list.useQuery();
  const { data: deps = [] } = trpc.scheduleDeps.list.useQuery(
    { scheduleId: selectedScheduleId! },
    { enabled: !!selectedScheduleId }
  );

  const addMutation = trpc.scheduleDeps.add.useMutation({
    onSuccess: () => {
      utils.scheduleDeps.list.invalidate({ scheduleId: selectedScheduleId! });
      setDependsOnId(null);
      toast({ title: "Dependency added" });
    },
    onError: (e) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const removeMutation = trpc.scheduleDeps.remove.useMutation({
    onSuccess: () => {
      utils.scheduleDeps.list.invalidate({ scheduleId: selectedScheduleId! });
      toast({ title: "Dependency removed" });
    },
    onError: (e) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const scheduleMap = new Map(schedules.map(s => [s.id, s]));

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Configure schedule dependency chains. A dependent schedule will only run after its dependency completes successfully.
      </p>

      <div className="flex gap-3 items-end">
        <div className="space-y-1 flex-1">
          <Label className="text-xs">Select Schedule</Label>
          <select
            className="w-full border border-border rounded-md px-3 py-2 text-sm bg-background"
            value={selectedScheduleId ?? ""}
            onChange={(e) => setSelectedScheduleId(Number(e.target.value) || null)}
          >
            <option value="">Choose a schedule…</option>
            {schedules.map(s => <option key={s.id} value={s.id}>{s.exportType} ({s.cadence})</option>)}
          </select>
        </div>
        <div className="space-y-1 flex-1">
          <Label className="text-xs">Depends On</Label>
          <select
            className="w-full border border-border rounded-md px-3 py-2 text-sm bg-background"
            value={dependsOnId ?? ""}
            onChange={(e) => setDependsOnId(Number(e.target.value) || null)}
            disabled={!selectedScheduleId}
          >
            <option value="">Choose dependency…</option>
            {schedules
              .filter(s => s.id !== selectedScheduleId)
              .map(s => <option key={s.id} value={s.id}>{s.exportType} ({s.cadence})</option>)}
          </select>
        </div>
        <Button
          className="bg-amber-600 hover:bg-amber-700"
          disabled={!selectedScheduleId || !dependsOnId || addMutation.isPending}
          onClick={() => addMutation.mutate({ scheduleId: selectedScheduleId!, dependsOnScheduleId: dependsOnId! })}
        >
          <Plus className="w-3 h-3 mr-1" /> Add
        </Button>
      </div>

      {selectedScheduleId && (
        <div className="border border-border rounded-lg overflow-hidden">
          <div className="bg-muted/50 px-4 py-2 text-xs font-medium">
            Dependencies for: {scheduleMap.get(selectedScheduleId) ? `${scheduleMap.get(selectedScheduleId)!.exportType} (${scheduleMap.get(selectedScheduleId)!.cadence})` : `#${selectedScheduleId}`}
          </div>
          {deps.length === 0 ? (
            <p className="p-4 text-sm text-muted-foreground">No dependencies configured</p>
          ) : (
            <div className="divide-y divide-border">
              {deps.map(dep => (
                <div key={dep.id} className="flex items-center justify-between p-3">
                  <div className="flex items-center gap-2 text-sm">
                    <span className="text-muted-foreground">{scheduleMap.get(selectedScheduleId)?.exportType}</span>
                    <ArrowRight className="w-3 h-3 text-amber-500" />
                    <span className="font-medium">{scheduleMap.get(dep.dependsOnScheduleId)?.exportType ?? `#${dep.dependsOnScheduleId}`}</span>
                  </div>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-6 w-6 p-0 text-destructive"
                    onClick={() => removeMutation.mutate({ id: dep.id })}
                    disabled={removeMutation.isPending}
                  >
                    <Trash2 className="w-3 h-3" />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────
export default function ScheduleAnalyticsPage() {
  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <BarChart3 className="w-6 h-6 text-amber-500" />
          Schedule Analytics & Configuration
        </h1>
        <p className="text-muted-foreground text-sm mt-1">
          Monitor delivery performance, configure templates, and manage schedule dependencies
        </p>
      </div>

      <Tabs defaultValue="analytics">
        <TabsList>
          <TabsTrigger value="analytics">Analytics</TabsTrigger>
          <TabsTrigger value="templates">Checklist Templates</TabsTrigger>
          <TabsTrigger value="dependencies">Dependencies</TabsTrigger>
        </TabsList>
        <TabsContent value="analytics" className="mt-4"><ScheduleAnalyticsTab /></TabsContent>
        <TabsContent value="templates" className="mt-4"><ChecklistTemplateTab /></TabsContent>
        <TabsContent value="dependencies" className="mt-4"><ScheduleDepsTab /></TabsContent>
      </Tabs>
    </div>
  );
}
