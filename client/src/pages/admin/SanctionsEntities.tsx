/**
 * Sanctions Entities Admin Page
 * Covers: Item 10 (entity search), Item 13 (bulk delete), Item 20 (entity type filter),
 *         Item 23 (watchlist alerts), Item 26 (conflict stats dashboard),
 *         Item 29 (batch validation report), Item 30 (entity risk scoring)
 */
import { useState, useMemo } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue
} from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import {
  AlertTriangle, Search, Trash2, Shield, BarChart3,
  FileDown, RefreshCw, CheckCircle, Clock, XCircle, Merge
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";

// ─── Risk Score Badge ─────────────────────────────────────────────────────────
function RiskBadge({ score }: { score: number | null }) {
  const s = score ?? 5;
  const color = s >= 8 ? "destructive" : s >= 5 ? "default" : "secondary";
  return <Badge variant={color} className="text-xs font-mono">{s}/10</Badge>;
}


// ─── Merge Dialog ─────────────────────────────────────────────────────────────
const MERGE_FIELDS = ['entityName', 'country', 'entityType', 'riskScore'] as const;
type MergeField = typeof MERGE_FIELDS[number];

interface MergeDialogProps { primaryId: number; duplicateId: number; onClose: () => void; }

function MergeDialog({ primaryId, duplicateId, onClose }: MergeDialogProps) {
  const { toast } = useToast();
  const utils = trpc.useUtils();
  const { data: allData } = trpc.sanctionsEntities.list.useQuery({ pageSize: 1000 });
  const primary = allData?.items?.find((e: any) => e.id === primaryId);
  const duplicate = allData?.items?.find((e: any) => e.id === duplicateId);
  const [choices, setChoices] = useState<Record<MergeField, 'primary' | 'duplicate'>>(
    Object.fromEntries(MERGE_FIELDS.map(f => [f, 'primary' as const])) as Record<MergeField, 'primary' | 'duplicate'>
  );

  const mergeMutation = trpc.sanctionsEntities.mergeEntities.useMutation({
    onSuccess: () => {
      utils.sanctionsEntities.list.invalidate();
      toast({ title: `Entity #${duplicateId} merged into #${primaryId} and archived` });
      onClose();
    },
    onError: (e) => toast({ title: 'Merge failed', description: e.message, variant: 'destructive' }),
  });

  const handleMerge = () => {
    if (!primary || !duplicate) return;
    const mergedFields: Record<string, unknown> = {};
    MERGE_FIELDS.forEach(f => {
      mergedFields[f] = choices[f] === 'primary' ? (primary as any)[f] : (duplicate as any)[f];
    });
    mergeMutation.mutate({ primaryId, duplicateId, mergedFields });
  };

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Merge className="w-4 h-4 text-amber-500" />
            Merge Duplicate Entities
          </DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          Choose which value to keep for each field. The duplicate entity will be archived after merging.
        </p>
        {(!primary || !duplicate) ? (
          <p className="text-sm text-muted-foreground py-4 text-center">Loading entity data…</p>
        ) : (
          <div className="border border-border rounded-lg overflow-hidden">
            <div className="grid grid-cols-3 bg-muted/50 px-4 py-2 text-xs font-medium">
              <span>Field</span>
              <span className="text-amber-400">Primary #{primaryId}</span>
              <span>Duplicate #{duplicateId}</span>
            </div>
            {MERGE_FIELDS.map(field => {
              const pVal = String((primary as any)[field] ?? '—');
              const dVal = String((duplicate as any)[field] ?? '—');
              const isDiff = pVal !== dVal;
              return (
                <div key={field} className={`grid grid-cols-3 px-4 py-3 border-t border-border text-sm ${isDiff ? 'bg-amber-500/5' : ''}`}>
                  <span className="font-medium text-xs capitalize self-center">{field.replace(/([A-Z])/g, ' $1')}</span>
                  <button
                    className={`text-left px-2 py-1 rounded transition-colors ${
                      choices[field] === 'primary'
                        ? 'bg-amber-500/20 border border-amber-500/50 font-semibold'
                        : 'hover:bg-muted/50 text-muted-foreground'
                    }`}
                    onClick={() => setChoices(c => ({ ...c, [field]: 'primary' }))}
                  >{pVal}</button>
                  <button
                    className={`text-left px-2 py-1 rounded transition-colors ${
                      choices[field] === 'duplicate'
                        ? 'bg-amber-500/20 border border-amber-500/50 font-semibold'
                        : 'hover:bg-muted/50 text-muted-foreground'
                    }`}
                    onClick={() => setChoices(c => ({ ...c, [field]: 'duplicate' }))}
                  >{dVal}</button>
                </div>
              );
            })}
          </div>
        )}
        <p className="text-xs text-muted-foreground">Click a cell to select it. Highlighted = chosen value.</p>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button
            className="bg-amber-600 hover:bg-amber-700"
            onClick={handleMerge}
            disabled={mergeMutation.isPending || !primary || !duplicate}
          >
            <Merge className="w-3 h-3 mr-1" /> Merge & Archive Duplicate
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Entities Tab ─────────────────────────────────────────────────────────────
function EntitiesTab() {
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const [entityType, setEntityType] = useState("all");
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<number[]>([]);
  const [editingScore, setEditingScore] = useState<{ id: number; score: number } | null>(null);
  const [mergeState, setMergeState] = useState<{ primaryId: number; duplicateId: number } | null>(null);
  const utils = trpc.useUtils();

  const { data: entityTypes = [] } = trpc.sanctionsEntities.getEntityTypes.useQuery();
  const { data, isLoading, refetch } = trpc.sanctionsEntities.list.useQuery({
    search: search || undefined,
    entityType: entityType === "all" ? undefined : entityType,
    page,
    pageSize: 20,
  });

  const bulkDeleteMutation = trpc.sanctionsEntities.bulkDelete.useMutation({
    onSuccess: (res) => {
      toast({ title: `${res.deleted} entities deactivated` });
      setSelected([]);
      utils.sanctionsEntities.list.invalidate();
    },
    onError: (e) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const updateScoreMutation = trpc.sanctionsEntities.updateRiskScore.useMutation({
    onSuccess: () => {
      setEditingScore(null);
      utils.sanctionsEntities.list.invalidate();
      toast({ title: "Risk score updated" });
    },
    onError: (e) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const items = data?.items ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.ceil(total / 20);

  const toggleSelect = (id: number) => {
    setSelected(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  };

  const toggleAll = () => {
    if (selected.length === items.length) setSelected([]);
    else setSelected(items.map(i => i.id));
  };

  return (
    <div className="space-y-4">
      {/* Search + Filter bar */}
      <div className="flex flex-wrap gap-3 items-center">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Search by entity name…"
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            className="pl-9"
          />
        </div>
        <Select value={entityType} onValueChange={(v) => { setEntityType(v); setPage(1); }}>
          <SelectTrigger className="w-44">
            <SelectValue placeholder="Entity type" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All types</SelectItem>
            {entityTypes.map(t => (
              <SelectItem key={t} value={t}>{t}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button size="sm" variant="outline" onClick={() => refetch()}>
          <RefreshCw className="w-3 h-3 mr-1" /> Refresh
        </Button>
        {selected.length > 0 && (
          <Button
            size="sm"
            variant="destructive"
            onClick={() => bulkDeleteMutation.mutate({ ids: selected })}
            disabled={bulkDeleteMutation.isPending}
          >
            <Trash2 className="w-3 h-3 mr-1" /> Deactivate {selected.length}
          </Button>
        )}
        {selected.length === 2 && (
          <Button
            size="sm"
            className="bg-amber-600 hover:bg-amber-700"
            onClick={() => setMergeState({ primaryId: selected[0], duplicateId: selected[1] })}
          >
            <Merge className="w-3 h-3 mr-1" /> Merge 2 Selected
          </Button>
        )}
      </div>

      {/* Table */}
      <div className="border border-border rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted/50">
            <tr>
              <th className="p-3 text-left w-10">
                <Checkbox
                  checked={selected.length === items.length && items.length > 0}
                  onCheckedChange={toggleAll}
                />
              </th>
              <th className="p-3 text-left">Entity Name</th>
              <th className="p-3 text-left">Type</th>
              <th className="p-3 text-left">Country</th>
              <th className="p-3 text-left">Risk Score</th>
              <th className="p-3 text-left">Added</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr><td colSpan={6} className="p-6 text-center text-muted-foreground">Loading…</td></tr>
            ) : items.length === 0 ? (
              <tr><td colSpan={6} className="p-6 text-center text-muted-foreground">No entities found</td></tr>
            ) : items.map((entity) => (
              <tr key={entity.id} className="border-t border-border hover:bg-muted/20 transition-colors">
                <td className="p-3">
                  <Checkbox
                    checked={selected.includes(entity.id)}
                    onCheckedChange={() => toggleSelect(entity.id)}
                  />
                </td>
                <td className="p-3 font-medium">{entity.entityName}</td>
                <td className="p-3">
                  <Badge variant="outline" className="text-xs">{entity.entityType ?? "—"}</Badge>
                </td>
                <td className="p-3 text-muted-foreground">{entity.country ?? "—"}</td>
                <td className="p-3">
                  {editingScore?.id === entity.id ? (
                    <div className="flex items-center gap-1">
                      <Input
                        type="number"
                        min={1}
                        max={10}
                        value={editingScore.score}
                        onChange={(e) => setEditingScore({ id: entity.id, score: Number(e.target.value) })}
                        className="w-16 h-6 text-xs"
                      />
                      <Button
                        size="sm"
                        className="h-6 text-xs px-2"
                        onClick={() => updateScoreMutation.mutate({ id: entity.id, riskScore: editingScore.score })}
                        disabled={updateScoreMutation.isPending}
                      >
                        Save
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-6 text-xs px-2"
                        onClick={() => setEditingScore(null)}
                      >
                        Cancel
                      </Button>
                    </div>
                  ) : (
                    <button onClick={() => setEditingScore({ id: entity.id, score: entity.riskScore ?? 5 })}>
                      <RiskBadge score={entity.riskScore} />
                    </button>
                  )}
                </td>
                <td className="p-3 text-xs text-muted-foreground">
                  {new Date(entity.createdAt).toLocaleDateString()}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {mergeState && (
        <MergeDialog
          primaryId={mergeState.primaryId}
          duplicateId={mergeState.duplicateId}
          onClose={() => setMergeState(null)}
        />
      )}

      {/* Pagination */}
      <div className="flex items-center justify-between text-sm text-muted-foreground">
        <span>{total} total entities</span>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>Prev</Button>
          <span className="self-center">Page {page} of {totalPages || 1}</span>
          <Button size="sm" variant="outline" disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}>Next</Button>
        </div>
      </div>
    </div>
  );
}

// ─── Watchlist Alerts Tab ─────────────────────────────────────────────────────
function WatchlistAlertsTab() {
  const { toast } = useToast();
  const [status, setStatus] = useState<"open" | "reviewed" | "dismissed" | "all">("open");
  const [page, setPage] = useState(1);
  const utils = trpc.useUtils();

  const { data: summary } = trpc.watchlistAlerts.getSummary.useQuery();
  const { data, isLoading } = trpc.watchlistAlerts.list.useQuery({ status, page, pageSize: 20 });

  const reviewMutation = trpc.watchlistAlerts.review.useMutation({
    onSuccess: () => {
      utils.watchlistAlerts.list.invalidate();
      utils.watchlistAlerts.getSummary.invalidate();
      toast({ title: "Alert updated" });
    },
    onError: (e) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const items = data?.items ?? [];
  const total = data?.total ?? 0;

  return (
    <div className="space-y-4">
      {/* Summary cards */}
      {summary && (
        <div className="grid grid-cols-4 gap-3">
          {[
            { label: "Total", value: summary.total, icon: <Shield className="w-4 h-4" />, color: "text-foreground" },
            { label: "Open", value: summary.open, icon: <AlertTriangle className="w-4 h-4" />, color: "text-destructive" },
            { label: "Reviewed", value: summary.reviewed, icon: <CheckCircle className="w-4 h-4" />, color: "text-green-500" },
            { label: "Dismissed", value: summary.dismissed, icon: <XCircle className="w-4 h-4" />, color: "text-muted-foreground" },
          ].map(({ label, value, icon, color }) => (
            <Card key={label} className="p-3">
              <div className={`flex items-center gap-2 ${color}`}>
                {icon}
                <span className="text-xs font-medium">{label}</span>
              </div>
              <p className="text-2xl font-bold mt-1">{value}</p>
            </Card>
          ))}
        </div>
      )}

      {/* Status filter */}
      <div className="flex gap-2">
        {(["open", "reviewed", "dismissed", "all"] as const).map(s => (
          <Button
            key={s}
            size="sm"
            variant={status === s ? "default" : "outline"}
            onClick={() => { setStatus(s); setPage(1); }}
            className={status === s ? "bg-amber-600 hover:bg-amber-700" : ""}
          >
            {s.charAt(0).toUpperCase() + s.slice(1)}
          </Button>
        ))}
      </div>

      {/* Alerts table */}
      <div className="border border-border rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted/50">
            <tr>
              <th className="p-3 text-left">Declaration</th>
              <th className="p-3 text-left">Matched Field</th>
              <th className="p-3 text-left">Matched Value</th>
              <th className="p-3 text-left">Risk</th>
              <th className="p-3 text-left">Status</th>
              <th className="p-3 text-left">Actions</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr><td colSpan={6} className="p-6 text-center text-muted-foreground">Loading…</td></tr>
            ) : items.length === 0 ? (
              <tr><td colSpan={6} className="p-6 text-center text-muted-foreground">No alerts</td></tr>
            ) : items.map((alert) => (
              <tr key={alert.id} className="border-t border-border hover:bg-muted/20">
                <td className="p-3 font-mono text-xs">#{alert.declarationId}</td>
                <td className="p-3">{alert.matchedField}</td>
                <td className="p-3 font-medium">{alert.matchedValue}</td>
                <td className="p-3"><RiskBadge score={alert.riskScore} /></td>
                <td className="p-3">
                  <Badge variant={alert.status === "open" ? "destructive" : "secondary"} className="text-xs">
                    {alert.status}
                  </Badge>
                </td>
                <td className="p-3">
                  {alert.status === "open" && (
                    <div className="flex gap-1">
                      <Button
                        size="sm"
                        className="h-6 text-xs px-2 bg-green-600 hover:bg-green-700"
                        onClick={() => reviewMutation.mutate({ alertId: alert.id, status: "reviewed" })}
                        disabled={reviewMutation.isPending}
                      >
                        Review
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-6 text-xs px-2"
                        onClick={() => reviewMutation.mutate({ alertId: alert.id, status: "dismissed" })}
                        disabled={reviewMutation.isPending}
                      >
                        Dismiss
                      </Button>
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-muted-foreground">{total} total alerts</p>
    </div>
  );
}

// ─── Conflict Stats Tab ───────────────────────────────────────────────────────
function ConflictStatsTab() {
  const { toast } = useToast();
  const { data: summary, isLoading } = trpc.conflictStats.globalSummary.useQuery();

  if (isLoading) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (!summary) return null;

  const pct = (n: number) => summary.total > 0 ? Math.round((n / summary.total) * 100) : 0;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-3 gap-4">
        {[
          { label: "Total Conflicts", value: summary.total, color: "text-foreground" },
          { label: "Resolved", value: summary.resolved, color: "text-green-500" },
          { label: "Pending", value: summary.pending, color: "text-amber-500" },
        ].map(({ label, value, color }) => (
          <Card key={label} className="p-4 text-center">
            <p className="text-xs text-muted-foreground mb-1">{label}</p>
            <p className={`text-3xl font-bold ${color}`}>{value}</p>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">Resolution Breakdown</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {[
            { label: "Overwritten", value: summary.overwritten, color: "bg-red-500" },
            { label: "Skipped", value: summary.skipped, color: "bg-slate-400" },
            { label: "Merged", value: summary.merged, color: "bg-amber-500" },
          ].map(({ label, value, color }) => (
            <div key={label} className="space-y-1">
              <div className="flex justify-between text-xs">
                <span>{label}</span>
                <span>{value} ({pct(value)}%)</span>
              </div>
              <div className="h-2 bg-muted rounded-full overflow-hidden">
                <div
                  className={`h-full ${color} rounded-full transition-all`}
                  style={{ width: `${pct(value)}%` }}
                />
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────
export default function SanctionsEntitiesPage() {
  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Shield className="w-6 h-6 text-amber-500" />
          Sanctions & Watchlist Management
        </h1>
        <p className="text-muted-foreground text-sm mt-1">
          Manage sanctioned entities, watchlist alerts, and conflict resolution statistics
        </p>
      </div>

      <Tabs defaultValue="entities">
        <TabsList>
          <TabsTrigger value="entities">Entities</TabsTrigger>
          <TabsTrigger value="alerts">Watchlist Alerts</TabsTrigger>
          <TabsTrigger value="conflicts">Conflict Stats</TabsTrigger>
        </TabsList>
        <TabsContent value="entities" className="mt-4"><EntitiesTab /></TabsContent>
        <TabsContent value="alerts" className="mt-4"><WatchlistAlertsTab /></TabsContent>
        <TabsContent value="conflicts" className="mt-4"><ConflictStatsTab /></TabsContent>
      </Tabs>
    </div>
  );
}
