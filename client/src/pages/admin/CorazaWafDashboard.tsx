/**
 * CorazaWafDashboard.tsx — Coraza WAF Rule Tuning Dashboard
 *
 * Provides admins with:
 *   - Live stats: total rules, enabled/disabled counts by severity/category
 *   - Rule table with toggle controls and audit trail
 *   - Bulk enable/disable by category
 *   - Caddy admin API connectivity status
 *   - Recent rule change audit log
 */

import { useState, useMemo, useEffect } from "react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import {
  Shield,
  ShieldOff,
  ShieldCheck,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  RefreshCw,
  Server,
  Search,
  ChevronLeft,
  ChevronRight,
  Clock,
  TrendingUp,
  Activity,
  Eye,
  Download,
} from "lucide-react";

// ─── Severity helpers ─────────────────────────────────────────────────────────

const SEVERITY_COLORS: Record<string, string> = {
  critical: "bg-red-900/40 text-red-300 border-red-700",
  high:     "bg-orange-900/40 text-orange-300 border-orange-700",
  medium:   "bg-yellow-900/40 text-yellow-300 border-yellow-700",
  low:      "bg-blue-900/40 text-blue-300 border-blue-700",
};

const SEVERITY_ORDER: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };

function SeverityBadge({ severity }: { severity: string }) {
  return (
    <span className={`px-2 py-0.5 rounded text-xs font-semibold border ${SEVERITY_COLORS[severity] ?? "bg-gray-800 text-gray-300 border-gray-600"}`}>
      {severity.toUpperCase()}
    </span>
  );
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function CorazaWafDashboard() {
  const { toast } = useToast();

  // Filters
  const [search, setSearch] = useState("");
  const [filterCategory, setFilterCategory] = useState<string>("ALL");
  const [filterSeverity, setFilterSeverity] = useState<string>("ALL");
  const [filterEnabled, setFilterEnabled] = useState<string>("ALL");
  const [page, setPage] = useState(1);
  const PAGE_SIZE = 25;

  // Toggle dialog state
  const [pendingToggle, setPendingToggle] = useState<{
    ruleId: string;
    enabled: boolean;
    description: string;
  } | null>(null);
  const [toggleReason, setToggleReason] = useState("");

  // Bulk dialog state
  const [bulkCategory, setBulkCategory] = useState<string | null>(null);
  const [bulkEnabled, setBulkEnabled] = useState(true);
  const [bulkReason, setBulkReason] = useState("");
  const [showBulkDialog, setShowBulkDialog] = useState(false);

  // Event correlation state
  const [activeTab, setActiveTab] = useState("rules");
  const [selectedRuleId, setSelectedRuleId] = useState<string | null>(null);
  const [correlationDays, setCorrelationDays] = useState(7);

  // CSV export state
  const [csvExportEnabled, setCsvExportEnabled] = useState(false);

  // Data queries
  const { data: stats, refetch: refetchStats } = trpc.corazaWaf.getRuleStats.useQuery();
  const { data: caddyStatus, refetch: refetchCaddy } = trpc.corazaWaf.getCaddyAdminStatus.useQuery();
  const { data: rulesData, refetch: refetchRules, isLoading } = trpc.corazaWaf.listRules.useQuery({
    category: filterCategory !== "ALL" ? filterCategory : undefined,
    severity: filterSeverity !== "ALL" ? (filterSeverity as any) : undefined,
    enabled: filterEnabled !== "ALL" ? filterEnabled === "true" : undefined,
    page,
    pageSize: PAGE_SIZE,
  });
  const { data: recentChanges, refetch: refetchChanges } = trpc.corazaWaf.getRecentChanges.useQuery({ limit: 10 });

  // Event correlation queries
  const { data: topFiringRules, refetch: refetchTopFiring } = trpc.corazaWaf.getTopFiringRules.useQuery({ limit: 10 });
  const { data: correlationSummary, refetch: refetchCorrelation } = trpc.corazaWaf.getEventCorrelationSummary.useQuery({ days: correlationDays });
  const { data: ruleEvents } = trpc.corazaWaf.getEventsForRule.useQuery(
    { ruleId: selectedRuleId!, limit: 20 },
    { enabled: !!selectedRuleId }
  );

  // CSV export query (lazy — only fires when csvExportEnabled is true)
  const { data: csvData, isFetching: csvFetching, error: csvError } = trpc.corazaWaf.exportEventsCSV.useQuery(
    { days: correlationDays, ruleId: selectedRuleId ?? undefined },
    { enabled: csvExportEnabled }
  );

  // Trigger file download when data arrives
  useEffect(() => {
    if (!csvData || !csvExportEnabled || csvFetching) return;
    setCsvExportEnabled(false);
    if (!csvData.csv) return;
    const blob = new Blob([csvData.csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    const dateStr = new Date().toISOString().slice(0, 10);
    const suffix = selectedRuleId ? `-rule-${selectedRuleId}` : "";
    a.download = `waf-events-${correlationDays}d${suffix}-${dateStr}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    toast({
      title: "CSV Exported",
      description: `${csvData.rowCount} events exported (${correlationDays}d window${selectedRuleId ? `, rule ${selectedRuleId}` : ""}).`,
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [csvData, csvFetching]);

  useEffect(() => {
    if (!csvError || !csvExportEnabled) return;
    setCsvExportEnabled(false);
    toast({ title: "Export Failed", description: csvError.message, variant: "destructive" });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [csvError]);

  const handleExportCSV = () => setCsvExportEnabled(true);

  // Mutations
  const toggleMutation = trpc.corazaWaf.toggleRule.useMutation({
    onSuccess: (data) => {
      toast({
        title: data.enabled ? "Rule Enabled" : "Rule Disabled",
        description: `Rule ${data.ruleId} ${data.enabled ? "enabled" : "disabled"}. ${data.caddyReloaded ? "Caddy reloaded." : "Caddy reload pending."}`,
      });
      setPendingToggle(null);
      setToggleReason("");
      refetchRules();
      refetchStats();
      refetchChanges();
    },
    onError: (err) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const acknowledgeEventMutation = trpc.openAppSec.acknowledgeEvent.useMutation({
    onSuccess: (data) => {
      toast({ title: "Event Acknowledged", description: `WAF event #${data.id} marked as reviewed.` });
      // Refetch the current rule's events to reflect the updated state
      refetchTopFiring();
    },
    onError: (err) => {
      toast({ title: "Acknowledge Failed", description: err.message, variant: "destructive" });
    },
  });

  const crsImportMutation = trpc.crsImport.bulkImportRules.useMutation({
    onSuccess: (data) => {
      toast({
        title: "CRS Import Complete",
        description: `CRS ${data.crsVersion}: ${data.inserted} inserted, ${data.updated} updated, ${data.skipped} skipped (${data.uniqueRules} total unique rules).`,
      });
      refetchRules();
      refetchStats();
    },
    onError: (err) => {
      toast({ title: "CRS Import Failed", description: err.message, variant: "destructive" });
    },
  });

  const bulkMutation = trpc.corazaWaf.bulkToggleRules.useMutation({
    onSuccess: (data) => {
      toast({
        title: "Bulk Update Complete",
        description: `${data.affectedCount} rules ${data.enabled ? "enabled" : "disabled"}.`,
      });
      setShowBulkDialog(false);
      setBulkReason("");
      refetchRules();
      refetchStats();
      refetchChanges();
    },
    onError: (err) => {
      toast({ title: "Bulk Error", description: err.message, variant: "destructive" });
    },
  });

  // Client-side search filter (on top of server-side category/severity/enabled filters)
  const filteredRules = useMemo(() => {
    if (!rulesData?.rules) return [];
    if (!search.trim()) return rulesData.rules;
    const q = search.toLowerCase();
    return rulesData.rules.filter(
      r =>
        r.ruleId.toLowerCase().includes(q) ||
        (r.description ?? "").toLowerCase().includes(q)
    );
  }, [rulesData?.rules, search]);

  const categories = useMemo(() => {
    if (!stats?.byCategory) return [];
    return Object.keys(stats.byCategory).sort();
  }, [stats?.byCategory]);

  const totalPages = Math.ceil((rulesData?.total ?? 0) / PAGE_SIZE);

  function handleRefreshAll() {
    refetchRules();
    refetchStats();
    refetchCaddy();
    refetchChanges();
    refetchTopFiring();
    refetchCorrelation();
  }

  return (
    <div className="p-6 space-y-6 bg-[#0A1628] min-h-screen text-gray-100">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Shield className="w-7 h-7 text-[#D4A017]" />
          <div>
            <h1 className="text-2xl font-bold text-white">Coraza WAF Rule Tuning</h1>
            <p className="text-sm text-gray-400">Manage OWASP CRS and custom NGSWTP rules — changes hot-reload Caddy</p>
          </div>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => crsImportMutation.mutate({ dryRun: false })}
            disabled={crsImportMutation.isPending}
            className="border-[#D4A017] text-[#D4A017] hover:bg-[#D4A017]/10"
          >
            {crsImportMutation.isPending
              ? <><RefreshCw className="w-4 h-4 mr-1 animate-spin" />Importing…</>
              : <><Download className="w-4 h-4 mr-1" />Import CRS</>}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={handleRefreshAll}
            className="border-gray-600 text-gray-300 hover:bg-gray-800"
          >
            <RefreshCw className="w-4 h-4 mr-1" />
            Refresh
          </Button>
        </div>
      </div>

      {/* Caddy Status Bar */}
      <div className={`flex items-center gap-3 px-4 py-2 rounded-lg border text-sm ${
        caddyStatus?.reachable
          ? "bg-green-900/20 border-green-700 text-green-300"
          : "bg-yellow-900/20 border-yellow-700 text-yellow-300"
      }`}>
        <Server className="w-4 h-4 flex-shrink-0" />
        <span className="font-medium">Caddy Admin API:</span>
        {caddyStatus?.reachable ? (
          <span className="flex items-center gap-1">
            <CheckCircle2 className="w-3.5 h-3.5" />
            Reachable at <code className="font-mono text-xs">{caddyStatus.adminUrl}</code>
            — rule changes will hot-reload automatically
          </span>
        ) : (
          <span className="flex items-center gap-1">
            <AlertTriangle className="w-3.5 h-3.5" />
            Not reachable ({caddyStatus?.error ?? "connecting…"}) — changes saved to DB, apply manually on next Caddy restart
          </span>
        )}
      </div>

      {/* Stats Row */}
      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <StatCard label="Total Rules" value={stats.total} icon={<Shield className="w-5 h-5 text-[#D4A017]" />} />
          <StatCard label="Enabled" value={stats.enabled} icon={<ShieldCheck className="w-5 h-5 text-green-400" />} color="text-green-400" />
          <StatCard label="Disabled" value={stats.disabled} icon={<ShieldOff className="w-5 h-5 text-red-400" />} color="text-red-400" />
          <div className="bg-[#0E1E35] border border-gray-700 rounded-lg p-4">
            <p className="text-xs text-gray-400 mb-2">By Severity</p>
            <div className="space-y-1">
              {["critical", "high", "medium", "low"].map(sev => (
                <div key={sev} className="flex justify-between text-xs">
                  <SeverityBadge severity={sev} />
                  <span className="text-gray-300">{stats.bySeverity?.[sev] ?? 0}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Main Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="bg-[#0E1E35] border border-gray-700">
          <TabsTrigger value="rules" className="data-[state=active]:bg-[#D4A017] data-[state=active]:text-black text-gray-300">
            <Shield className="w-3.5 h-3.5 mr-1.5" /> Rules
          </TabsTrigger>
          <TabsTrigger value="events" className="data-[state=active]:bg-[#D4A017] data-[state=active]:text-black text-gray-300">
            <Activity className="w-3.5 h-3.5 mr-1.5" /> Event Correlation
          </TabsTrigger>
        </TabsList>

        <TabsContent value="rules" className="mt-4 space-y-4">

      {/* Filters */}
      <div className="flex flex-wrap gap-3 items-center">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <Input
            placeholder="Search rule ID or description…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="pl-9 bg-[#0E1E35] border-gray-600 text-gray-100 placeholder-gray-500"
          />
        </div>
        <Select value={filterCategory} onValueChange={v => { setFilterCategory(v); setPage(1); }}>
          <SelectTrigger className="w-40 bg-[#0E1E35] border-gray-600 text-gray-100">
            <SelectValue placeholder="Category" />
          </SelectTrigger>
          <SelectContent className="bg-[#0E1E35] border-gray-600">
            <SelectItem value="ALL">All Categories</SelectItem>
            {categories.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={filterSeverity} onValueChange={v => { setFilterSeverity(v); setPage(1); }}>
          <SelectTrigger className="w-36 bg-[#0E1E35] border-gray-600 text-gray-100">
            <SelectValue placeholder="Severity" />
          </SelectTrigger>
          <SelectContent className="bg-[#0E1E35] border-gray-600">
            <SelectItem value="ALL">All Severities</SelectItem>
            {["critical", "high", "medium", "low"].map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={filterEnabled} onValueChange={v => { setFilterEnabled(v); setPage(1); }}>
          <SelectTrigger className="w-32 bg-[#0E1E35] border-gray-600 text-gray-100">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent className="bg-[#0E1E35] border-gray-600">
            <SelectItem value="ALL">All Status</SelectItem>
            <SelectItem value="true">Enabled</SelectItem>
            <SelectItem value="false">Disabled</SelectItem>
          </SelectContent>
        </Select>
        {filterCategory !== "ALL" && (
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="outline"
              className="border-red-700 text-red-300 hover:bg-red-900/20"
              onClick={() => { setBulkCategory(filterCategory); setBulkEnabled(false); setShowBulkDialog(true); }}
            >
              <ShieldOff className="w-3.5 h-3.5 mr-1" />
              Disable All in {filterCategory}
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="border-green-700 text-green-300 hover:bg-green-900/20"
              onClick={() => { setBulkCategory(filterCategory); setBulkEnabled(true); setShowBulkDialog(true); }}
            >
              <ShieldCheck className="w-3.5 h-3.5 mr-1" />
              Enable All in {filterCategory}
            </Button>
          </div>
        )}
      </div>

      {/* Rules Table */}
      <div className="bg-[#0E1E35] border border-gray-700 rounded-lg overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-700 bg-[#0A1628]">
                <th className="text-left px-4 py-3 text-gray-400 font-medium">Rule ID</th>
                <th className="text-left px-4 py-3 text-gray-400 font-medium">Severity</th>
                <th className="text-left px-4 py-3 text-gray-400 font-medium">Category</th>
                <th className="text-left px-4 py-3 text-gray-400 font-medium w-1/3">Description</th>
                <th className="text-left px-4 py-3 text-gray-400 font-medium">Status</th>
                <th className="text-left px-4 py-3 text-gray-400 font-medium">Action</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr>
                  <td colSpan={6} className="text-center py-12 text-gray-500">
                    <RefreshCw className="w-5 h-5 animate-spin mx-auto mb-2" />
                    Loading rules…
                  </td>
                </tr>
              ) : filteredRules.length === 0 ? (
                <tr>
                  <td colSpan={6} className="text-center py-12 text-gray-500">No rules match the current filters.</td>
                </tr>
              ) : (
                filteredRules.map(rule => (
                  <tr key={rule.ruleId} className="border-b border-gray-800 hover:bg-[#0A1628]/50">
                    <td className="px-4 py-3 font-mono text-[#D4A017] text-xs">{rule.ruleId}</td>
                    <td className="px-4 py-3"><SeverityBadge severity={rule.severity} /></td>
                    <td className="px-4 py-3 text-gray-300 text-xs">{rule.category}</td>
                    <td className="px-4 py-3 text-gray-300 text-xs max-w-xs truncate" title={rule.description ?? ""}>{rule.description}</td>
                    <td className="px-4 py-3">
                      {rule.enabled ? (
                        <span className="flex items-center gap-1 text-green-400 text-xs">
                          <CheckCircle2 className="w-3.5 h-3.5" /> Enabled
                        </span>
                      ) : (
                        <span className="flex items-center gap-1 text-red-400 text-xs">
                          <XCircle className="w-3.5 h-3.5" /> Disabled
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <Button
                        size="sm"
                        variant="outline"
                        className={rule.enabled
                          ? "border-red-700 text-red-300 hover:bg-red-900/20 text-xs h-7"
                          : "border-green-700 text-green-300 hover:bg-green-900/20 text-xs h-7"
                        }
                        onClick={() => setPendingToggle({
                          ruleId: rule.ruleId,
                          enabled: !rule.enabled,
                          description: rule.description ?? rule.ruleId,
                        })}
                      >
                        {rule.enabled ? "Disable" : "Enable"}
                      </Button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-gray-700">
            <span className="text-xs text-gray-400">
              Page {page} of {totalPages} ({rulesData?.total} rules)
            </span>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" className="border-gray-600 text-gray-300 h-7" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>
                <ChevronLeft className="w-3.5 h-3.5" />
              </Button>
              <Button size="sm" variant="outline" className="border-gray-600 text-gray-300 h-7" disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}>
                <ChevronRight className="w-3.5 h-3.5" />
              </Button>
            </div>
          </div>
        )}
      </div>

      {/* Recent Changes Audit Log */}
      {recentChanges && recentChanges.length > 0 && (
        <div className="bg-[#0E1E35] border border-gray-700 rounded-lg p-4">
          <h3 className="text-sm font-semibold text-gray-300 mb-3 flex items-center gap-2">
            <Clock className="w-4 h-4 text-[#D4A017]" />
            Recent Rule Changes
          </h3>
          <div className="space-y-2">
            {recentChanges.map(r => (
              <div key={r.id} className="flex items-center gap-3 text-xs text-gray-400 border-b border-gray-800 pb-2">
                {r.enabled ? (
                  <CheckCircle2 className="w-3.5 h-3.5 text-green-400 flex-shrink-0" />
                ) : (
                  <XCircle className="w-3.5 h-3.5 text-red-400 flex-shrink-0" />
                )}
                <span className="font-mono text-[#D4A017]">{r.ruleId}</span>
                <span>{r.enabled ? "enabled" : "disabled"}</span>
                {r.changeReason && <span className="text-gray-500 italic">— {r.changeReason}</span>}
                <span className="ml-auto text-gray-600">{r.updatedAt ? new Date(r.updatedAt).toLocaleString() : ""}</span>
              </div>
            ))}
          </div>
        </div>
      )}

        </TabsContent>

        {/* ── Event Correlation Tab ─────────────────────────────────────────── */}
        <TabsContent value="events" className="mt-4 space-y-4">

          {/* Controls */}
          <div className="flex items-center gap-3">
            <span className="text-sm text-gray-400">Time window:</span>
            <Select value={String(correlationDays)} onValueChange={v => setCorrelationDays(Number(v))}>
              <SelectTrigger className="w-32 bg-[#0E1E35] border-gray-600 text-gray-100">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="bg-[#0E1E35] border-gray-600">
                <SelectItem value="1">Last 24h</SelectItem>
                <SelectItem value="7">Last 7 days</SelectItem>
                <SelectItem value="30">Last 30 days</SelectItem>
                <SelectItem value="90">Last 90 days</SelectItem>
              </SelectContent>
            </Select>
            <Button variant="outline" size="sm" className="border-gray-600 text-gray-300" onClick={() => { refetchTopFiring(); refetchCorrelation(); }}>
              <RefreshCw className="w-3.5 h-3.5 mr-1" /> Refresh
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="border-[#D4A017]/50 text-[#D4A017] hover:bg-[#D4A017]/10 ml-auto"
              onClick={handleExportCSV}
              disabled={csvFetching}
            >
              {csvFetching ? (
                <><RefreshCw className="w-3.5 h-3.5 mr-1 animate-spin" /> Exporting…</>
              ) : (
                <><Download className="w-3.5 h-3.5 mr-1" /> Export CSV{selectedRuleId ? ` (Rule ${selectedRuleId})` : ""}</>
              )}
            </Button>
          </div>

          {/* Top Firing Rules */}
          <div className="bg-[#0E1E35] border border-gray-700 rounded-lg p-4">
            <h3 className="text-sm font-semibold text-gray-300 mb-3 flex items-center gap-2">
              <TrendingUp className="w-4 h-4 text-[#D4A017]" />
              Top Firing Rules
              <span className="text-xs text-gray-500 font-normal ml-1">(click a rule to see its events)</span>
            </h3>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-700">
                    <th className="text-left px-3 py-2 text-gray-400 font-medium text-xs">Rule ID</th>
                    <th className="text-left px-3 py-2 text-gray-400 font-medium text-xs">Description</th>
                    <th className="text-left px-3 py-2 text-gray-400 font-medium text-xs">Severity</th>
                    <th className="text-left px-3 py-2 text-gray-400 font-medium text-xs">Status</th>
                    <th className="text-right px-3 py-2 text-gray-400 font-medium text-xs">Events</th>
                    <th className="text-left px-3 py-2 text-gray-400 font-medium text-xs">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {(topFiringRules ?? []).map(rule => (
                    <tr
                      key={rule.ruleId}
                      className={`border-b border-gray-800 cursor-pointer ${
                        selectedRuleId === rule.ruleId ? "bg-[#D4A017]/10" : "hover:bg-[#0A1628]/50"
                      }`}
                      onClick={() => setSelectedRuleId(selectedRuleId === rule.ruleId ? null : rule.ruleId)}
                    >
                      <td className="px-3 py-2 font-mono text-[#D4A017] text-xs">{rule.ruleId}</td>
                      <td className="px-3 py-2 text-gray-300 text-xs max-w-xs truncate" title={rule.description}>{rule.description}</td>
                      <td className="px-3 py-2"><SeverityBadge severity={rule.severity} /></td>
                      <td className="px-3 py-2">
                        {rule.enabled ? (
                          <span className="flex items-center gap-1 text-green-400 text-xs"><CheckCircle2 className="w-3 h-3" /> On</span>
                        ) : (
                          <span className="flex items-center gap-1 text-red-400 text-xs"><XCircle className="w-3 h-3" /> Off</span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-right">
                        <span className="text-white font-bold text-sm">{rule.eventCount.toLocaleString()}</span>
                      </td>
                      <td className="px-3 py-2">
                        <Button
                          size="sm"
                          variant="outline"
                          className="border-gray-600 text-gray-300 text-xs h-6"
                          onClick={e => { e.stopPropagation(); setSelectedRuleId(rule.ruleId); }}
                        >
                          <Eye className="w-3 h-3 mr-1" /> Events
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Correlation Summary Heatmap */}
          {correlationSummary && correlationSummary.length > 0 && (
            <div className="bg-[#0E1E35] border border-gray-700 rounded-lg p-4">
              <h3 className="text-sm font-semibold text-gray-300 mb-3 flex items-center gap-2">
                <Activity className="w-4 h-4 text-[#D4A017]" />
                Event Volume by Rule — Last {correlationDays} day{correlationDays !== 1 ? "s" : ""}
              </h3>
              <div className="space-y-2">
                {correlationSummary.map(r => {
                  const maxEvents = Math.max(...correlationSummary.map(x => x.totalEvents));
                  const pct = maxEvents > 0 ? (r.totalEvents / maxEvents) * 100 : 0;
                  return (
                    <div key={r.ruleId} className="flex items-center gap-3">
                      <span className="font-mono text-[#D4A017] text-xs w-20 flex-shrink-0">{r.ruleId}</span>
                      <div className="flex-1 bg-gray-800 rounded-full h-3 overflow-hidden">
                        <div
                          className="h-full bg-gradient-to-r from-[#D4A017] to-orange-500 rounded-full"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                      <span className="text-gray-300 text-xs w-12 text-right">{r.totalEvents.toLocaleString()}</span>
                      <span className="text-red-400 text-xs w-16 text-right">{r.blockedEvents} blocked</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Events for Selected Rule */}
          {selectedRuleId && (
            <div className="bg-[#0E1E35] border border-[#D4A017]/40 rounded-lg p-4">
              <h3 className="text-sm font-semibold text-gray-300 mb-3 flex items-center gap-2">
                <Eye className="w-4 h-4 text-[#D4A017]" />
                Recent Events — Rule <span className="font-mono text-[#D4A017]">{selectedRuleId}</span>
                <Button
                  variant="outline"
                  size="sm"
                  className="ml-auto border-gray-600 text-gray-400 h-6 text-xs"
                  onClick={() => setSelectedRuleId(null)}
                >
                  Clear
                </Button>
              </h3>
              {!ruleEvents || ruleEvents.length === 0 ? (
                <p className="text-sm text-gray-500 py-4 text-center">No events found for this rule.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-gray-700">
                        <th className="text-left px-3 py-2 text-gray-400">Attack Type</th>
                        <th className="text-left px-3 py-2 text-gray-400">Severity</th>
                        <th className="text-left px-3 py-2 text-gray-400">Source IP</th>
                        <th className="text-left px-3 py-2 text-gray-400">Target Path</th>
                        <th className="text-left px-3 py-2 text-gray-400">Action</th>
                        <th className="text-left px-3 py-2 text-gray-400">Ack</th>
                        <th className="text-left px-3 py-2 text-gray-400">Time</th>
                      </tr>
                    </thead>
                    <tbody>
                      {ruleEvents.map((ev: any) => (
                        <tr key={ev.id ?? ev.eventId} className="border-b border-gray-800 hover:bg-[#0A1628]/50">
                          <td className="px-3 py-2 text-orange-300">{ev.attackType}</td>
                          <td className="px-3 py-2"><SeverityBadge severity={ev.severity ?? "low"} /></td>
                          <td className="px-3 py-2 font-mono text-gray-300">{ev.sourceIp}</td>
                          <td className="px-3 py-2 text-gray-400 max-w-[160px] truncate" title={ev.targetPath}>{ev.targetPath}</td>
                          <td className="px-3 py-2">
                            <span className={ev.action === "BLOCK" ? "text-red-400" : "text-yellow-400"}>{ev.action}</span>
                          </td>
                          <td className="px-3 py-2">
                            {ev.isAcknowledged ? (
                              <span className="flex items-center gap-1 text-green-400 text-xs">
                                <CheckCircle2 className="w-3.5 h-3.5" /> Acked
                              </span>
                            ) : (
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-6 px-2 text-xs border-gray-600 text-gray-300 hover:text-white hover:border-gold-500"
                                disabled={acknowledgeEventMutation.isPending}
                                onClick={() => acknowledgeEventMutation.mutate({ id: ev.id ?? ev.eventId })}
                              >
                                Ack
                              </Button>
                            )}
                          </td>
                          <td className="px-3 py-2 text-gray-500">
                            {ev.createdAt ? new Date(ev.createdAt).toLocaleString() : ""}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

        </TabsContent>
      </Tabs>

      {/* Toggle Confirmation Dialog */}
      <Dialog open={!!pendingToggle} onOpenChange={() => { setPendingToggle(null); setToggleReason(""); }}>
        <DialogContent className="bg-[#0E1E35] border-gray-700 text-gray-100">
          <DialogHeader>
            <DialogTitle className="text-white">
              {pendingToggle?.enabled ? "Enable" : "Disable"} Rule {pendingToggle?.ruleId}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <p className="text-sm text-gray-300">{pendingToggle?.description}</p>
            {!pendingToggle?.enabled && (
              <div className="flex items-start gap-2 bg-yellow-900/20 border border-yellow-700 rounded p-3 text-xs text-yellow-300">
                <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                Disabling this rule may expose the platform to attacks. Provide a reason for the audit trail.
              </div>
            )}
            <div>
              <label className="text-xs text-gray-400 mb-1 block">Reason (optional)</label>
              <Input
                placeholder="e.g. False positive on trader registration endpoint"
                value={toggleReason}
                onChange={e => setToggleReason(e.target.value)}
                className="bg-[#0A1628] border-gray-600 text-gray-100 placeholder-gray-500"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" className="border-gray-600 text-gray-300" onClick={() => { setPendingToggle(null); setToggleReason(""); }}>
              Cancel
            </Button>
            <Button
              className={pendingToggle?.enabled ? "bg-green-700 hover:bg-green-600" : "bg-red-700 hover:bg-red-600"}
              disabled={toggleMutation.isPending}
              onClick={() => {
                if (!pendingToggle) return;
                toggleMutation.mutate({
                  ruleId: pendingToggle.ruleId,
                  enabled: pendingToggle.enabled,
                  reason: toggleReason || undefined,
                });
              }}
            >
              {toggleMutation.isPending ? <RefreshCw className="w-4 h-4 animate-spin" /> : (pendingToggle?.enabled ? "Enable Rule" : "Disable Rule")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Bulk Toggle Dialog */}
      <Dialog open={showBulkDialog} onOpenChange={() => { setShowBulkDialog(false); setBulkReason(""); }}>
        <DialogContent className="bg-[#0E1E35] border-gray-700 text-gray-100">
          <DialogHeader>
            <DialogTitle className="text-white">
              Bulk {bulkEnabled ? "Enable" : "Disable"} — {bulkCategory}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <p className="text-sm text-gray-300">
              This will {bulkEnabled ? "enable" : "disable"} all rules in the <strong>{bulkCategory}</strong> category.
            </p>
            <div>
              <label className="text-xs text-gray-400 mb-1 block">Reason</label>
              <Input
                placeholder="Reason for bulk change"
                value={bulkReason}
                onChange={e => setBulkReason(e.target.value)}
                className="bg-[#0A1628] border-gray-600 text-gray-100 placeholder-gray-500"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" className="border-gray-600 text-gray-300" onClick={() => { setShowBulkDialog(false); setBulkReason(""); }}>
              Cancel
            </Button>
            <Button
              className={bulkEnabled ? "bg-green-700 hover:bg-green-600" : "bg-red-700 hover:bg-red-600"}
              disabled={bulkMutation.isPending}
              onClick={() => {
                if (!bulkCategory) return;
                bulkMutation.mutate({ category: bulkCategory, enabled: bulkEnabled, reason: bulkReason || undefined });
              }}
            >
              {bulkMutation.isPending ? <RefreshCw className="w-4 h-4 animate-spin" /> : `Confirm Bulk ${bulkEnabled ? "Enable" : "Disable"}`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─── Stat Card ────────────────────────────────────────────────────────────────

function StatCard({ label, value, icon, color = "text-white" }: {
  label: string;
  value: number;
  icon: React.ReactNode;
  color?: string;
}) {
  return (
    <div className="bg-[#0E1E35] border border-gray-700 rounded-lg p-4 flex items-center gap-3">
      {icon}
      <div>
        <p className="text-xs text-gray-400">{label}</p>
        <p className={`text-2xl font-bold ${color}`}>{value.toLocaleString()}</p>
      </div>
    </div>
  );
}
