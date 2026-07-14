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
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue
} from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import {
  AlertTriangle, Search, Trash2, Shield, BarChart3,
  FileDown, RefreshCw, CheckCircle, Clock, XCircle
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";

// ─── Risk Score Badge ─────────────────────────────────────────────────────────
function RiskBadge({ score }: { score: number | null }) {
  const s = score ?? 5;
  const color = s >= 8 ? "destructive" : s >= 5 ? "default" : "secondary";
  return <Badge variant={color} className="text-xs font-mono">{s}/10</Badge>;
}

// ─── Entities Tab ─────────────────────────────────────────────────────────────
function EntitiesTab() {
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const [entityType, setEntityType] = useState("all");
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<number[]>([]);
  const [editingScore, setEditingScore] = useState<{ id: number; score: number } | null>(null);
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
