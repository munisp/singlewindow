import { toast } from "sonner";
import DashboardLayout from "@/components/DashboardLayout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { trpc } from "@/lib/trpc";
import {
  AlertTriangle,
  CheckCircle,
  Clock,
  Eye,
  FileText,
  Radio,
  Search,
  Shield,
  XCircle,
  Wifi,
  WifiOff,
  Users,
  CheckSquare,
  Square,
  Archive,
  Loader2,
  Download,
  History,
  ExternalLink,
  RefreshCw as RefreshCwIcon,
} from "lucide-react";
import { useEffect, useRef, useState, useMemo, useCallback } from "react";
import { useLocation } from "wouter";

// SLA thresholds in hours by risk lane
const SLA_HOURS: Record<string, number> = {
  green_lane: 4,
  yellow_lane: 24,
  red_lane: 72,
  submitted: 24,
};

function getSLAStatus(d: any): { label: string; hoursElapsed: number; isBreached: boolean; isWarning: boolean } {
  const submittedAt = d.submittedAt ? new Date(d.submittedAt).getTime() : d.createdAt ? new Date(d.createdAt).getTime() : null;
  if (!submittedAt) return { label: "—", hoursElapsed: 0, isBreached: false, isWarning: false };
  const hoursElapsed = (Date.now() - submittedAt) / 3_600_000;
  const threshold = SLA_HOURS[d.riskLane ?? d.status] ?? 24;
  const isBreached = hoursElapsed > threshold;
  const isWarning = !isBreached && hoursElapsed > threshold * 0.75;
  const h = Math.floor(hoursElapsed);
  const label = h < 1 ? "< 1h" : h < 24 ? `${h}h` : `${Math.floor(h / 24)}d ${h % 24}h`;
  return { label, hoursElapsed, isBreached, isWarning };
}

const LANE_CONFIG: Record<string, { label: string; color: string; bg: string; icon: React.ReactNode }> = {
  green_lane: { label: "Green", color: "text-emerald-700", bg: "bg-emerald-50 border-emerald-200", icon: <CheckCircle className="h-4 w-4 text-emerald-600" /> },
  yellow_lane: { label: "Yellow", color: "text-amber-700", bg: "bg-amber-50 border-amber-200", icon: <Clock className="h-4 w-4 text-amber-600" /> },
  red_lane: { label: "Red", color: "text-red-700", bg: "bg-red-50 border-red-200", icon: <AlertTriangle className="h-4 w-4 text-red-600" /> },
  submitted: { label: "Pending", color: "text-blue-700", bg: "bg-blue-50 border-blue-200", icon: <FileText className="h-4 w-4 text-blue-600" /> },
  under_review: { label: "In Review", color: "text-purple-700", bg: "bg-purple-50 border-purple-200", icon: <Eye className="h-4 w-4 text-purple-600" /> },
  cleared: { label: "Cleared", color: "text-emerald-700", bg: "bg-emerald-50 border-emerald-200", icon: <CheckCircle className="h-4 w-4 text-emerald-600" /> },
  rejected: { label: "Rejected", color: "text-red-700", bg: "bg-red-50 border-red-200", icon: <XCircle className="h-4 w-4 text-red-600" /> },
  held: { label: "Held", color: "text-orange-700", bg: "bg-orange-50 border-orange-200", icon: <Shield className="h-4 w-4 text-orange-600" /> },
};

export default function CustomsDashboard() {
  const [, setLocation] = useLocation();
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [laneFilter, setLaneFilter] = useState("all");
  // Bulk selection state
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [bulkOfficerId, setBulkOfficerId] = useState<string>("");
  const [isBulkAssigning, setIsBulkAssigning] = useState(false);
  const [isBulkExporting, setIsBulkExporting] = useState(false);
  const [bulkExportLabel, setBulkExportLabel] = useState("");  // Sprint 117: optional label for ZIP archive
  // Sprint 114: SLA breach real-time alert banner state
  const [slaBreachCount, setSlaBreachCount] = useState<number | null>(null);
  const [slaBannerDismissed, setSlaBannerDismissed] = useState(false);
  const [slaLastUpdated, setSlaLastUpdated] = useState<Date | null>(null);
  const utils = trpc.useUtils();

  // Debounce search input by 350ms to avoid excessive queries
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search), 350);
    return () => clearTimeout(timer);
  }, [search]);

  // Sprint 112: cursor-based pagination state
  const [cursor, setCursor] = useState<number | undefined>(undefined);
  const [allItems, setAllItems] = useState<any[]>([]);

  // Reset pagination when filters change
  useEffect(() => {
    setCursor(undefined);
    setAllItems([]);
  }, [statusFilter, laneFilter, debouncedSearch]);

  // Sprint 115: __sla_breached__ is a client-side virtual filter; don't pass it to the server
  const isSlaBreachedFilter = statusFilter === "__sla_breached__";
  const { data: pageData, isLoading, isError, isFetching } = trpc.declarations.all.useQuery({
    limit: 50,
    lastId: cursor,
    // When SLA breach filter is active, fetch all active statuses so we can filter client-side
    status: !isSlaBreachedFilter && statusFilter !== "all" ? statusFilter : undefined,
    riskLane: laneFilter !== "all" ? laneFilter : undefined,
    search: debouncedSearch.trim() || undefined,
  });

  // Accumulate pages
  useEffect(() => {
    if (!pageData?.items) return;
    if (!cursor) {
      // First page (or after filter reset)
      setAllItems(pageData.items);
    } else {
      // Append next page
      setAllItems(prev => {
        const existingIds = new Set(prev.map((d: any) => d.id));
        const newItems = pageData.items.filter((d: any) => !existingIds.has(d.id));
        return [...prev, ...newItems];
      });
    }
  }, [pageData]);

  const hasMore = pageData?.hasMore ?? false;
  const nextCursor = pageData?.nextCursor;

  const { data: stats } = trpc.declarations.stats.useQuery();
  const { data: officerList } = trpc.declarations.listOfficers.useQuery();
  const assignOfficerMutation = trpc.declarations.assignOfficer.useMutation();

  // Bulk assign handler
  const handleBulkAssign = useCallback(async () => {
    if (!bulkOfficerId || selectedIds.size === 0) return;
    setIsBulkAssigning(true);
    try {
      await Promise.all(
        Array.from(selectedIds).map(id =>
          assignOfficerMutation.mutateAsync({ declarationId: id, officerId: parseInt(bulkOfficerId) })
        )
      );
      toast.success(`Assigned ${selectedIds.size} declaration${selectedIds.size > 1 ? 's' : ''} to officer`);
      setSelectedIds(new Set());
      setBulkOfficerId("");
      utils.declarations.all.invalidate();
    } catch {
      toast.error("Bulk assignment failed — please try again");
    } finally {
      setIsBulkAssigning(false);
    }
  }, [bulkOfficerId, selectedIds, assignOfficerMutation, utils]);

  const bulkExportZipMutation = trpc.declarations.bulkExportZip.useMutation({
    onSuccess: (result) => {
      setIsBulkExporting(false);
      window.open(result.url, "_blank");
      toast.success(
        `ZIP ready — ${result.count} declaration${result.count !== 1 ? "s" : ""} exported` +
        (result.failed > 0 ? ` (${result.failed} failed)` : "")
      );
    },
    onError: (err) => {
      setIsBulkExporting(false);
      toast.error("Bulk export failed", { description: err.message });
    },
  });

  const handleBulkExportZip = useCallback(() => {
    if (selectedIds.size === 0) return;
    setIsBulkExporting(true);
    bulkExportZipMutation.mutate({ ids: Array.from(selectedIds), label: bulkExportLabel.trim() || undefined });
  }, [selectedIds, bulkExportZipMutation]);

  // Sprint 114: WebSocket listener for SLA breach workload_update events
  useEffect(() => {
    if (typeof window === "undefined") return;
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const ws = new WebSocket(`${protocol}//${window.location.host}/api/ws`);
    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === "workload_update") {
          const breached = msg.payload?.slaBreached ?? 0;
          setSlaBreachCount(breached);
          setSlaLastUpdated(new Date());
          if (breached > 0) {
            // Reset dismiss so the banner re-appears when new breaches arrive
            setSlaBannerDismissed(false);
          }
          utils.declarations.stats.invalidate();
        }
      } catch { /* ignore */ }
    };
    return () => ws.close();
  }, [utils]);

  // Sprint 115: when SLA breach filter is active, filter client-side by elapsed time vs threshold
  // Sprint 116: when SLA breach filter is active, sort by hoursElapsed descending
  const filtered = useMemo(() => {
    const base = isSlaBreachedFilter
      ? allItems.filter((d: any) => getSLAStatus(d).isBreached)
      : allItems;
    if (isSlaBreachedFilter) {
      return [...base].sort((a: any, b: any) => {
        const aElapsed = getSLAStatus(a).hoursElapsed;
        const bElapsed = getSLAStatus(b).hoursElapsed;
        return bElapsed - aElapsed; // Most overdue first
      });
    }
    return base;
  }, [allItems, isSlaBreachedFilter]);

  const laneGroups = {
    red: (stats as any)?.redLane ?? filtered.filter((d: any) => d.riskLane === "red_lane" || d.riskLane === "red").length,
    yellow: (stats as any)?.yellowLane ?? filtered.filter((d: any) => d.riskLane === "yellow_lane" || d.riskLane === "yellow").length,
    green: (stats as any)?.greenLane ?? filtered.filter((d: any) => d.riskLane === "green_lane" || d.riskLane === "green").length,
    pending: filtered.filter((d: any) => d.status === "submitted" || d.status === "under_review").length,
  };

  return (
    <DashboardLayout title="Customs Dashboard">
      {isError && (
        <div className="mx-6 mt-4 p-3 bg-red-50 border border-red-200 rounded text-red-700 text-sm">
          Failed to load data. Please refresh the page.
        </div>
      )}
      <div className="space-y-6 max-w-7xl">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Customs Officer Dashboard</h1>
          <p className="text-muted-foreground text-sm mt-1">Declaration queue with AI risk assessment</p>
        </div>

        {/* Sprint 114: SLA Breach Alert Banner */}
        {slaBreachCount !== null && slaBreachCount > 0 && !slaBannerDismissed && (
          <div className="flex items-start gap-3 p-4 rounded-lg border border-red-300 bg-red-50 text-red-800">
            <AlertTriangle className="h-5 w-5 text-red-600 shrink-0 mt-0.5" />
            <div className="flex-1">
              <p className="font-semibold text-sm">
                {slaBreachCount} Declaration{slaBreachCount !== 1 ? "s" : ""} Breached SLA
              </p>
              <p className="text-xs text-red-700 mt-0.5">
                {slaBreachCount} active declaration{slaBreachCount !== 1 ? "s have" : " has"} exceeded their clearance time target.
                {slaLastUpdated && ` Last checked: ${slaLastUpdated.toLocaleTimeString()}.`}
                {" "}Review and prioritise these declarations immediately.
              </p>
            </div>
            <button
              onClick={() => setSlaBannerDismissed(true)}
              className="text-red-500 hover:text-red-700 text-lg leading-none font-bold shrink-0"
              aria-label="Dismiss SLA alert"
            >
              ×
            </button>
          </div>
        )}

        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Card className="border-l-4 border-l-red-500">
            <CardContent className="p-4">
              <p className="text-2xl font-bold text-red-600">{laneGroups.red}</p>
              <p className="text-xs text-muted-foreground mt-1">Red Lane — Physical Inspection</p>
            </CardContent>
          </Card>
          <Card className="border-l-4 border-l-amber-500">
            <CardContent className="p-4">
              <p className="text-2xl font-bold text-amber-600">{laneGroups.yellow}</p>
              <p className="text-xs text-muted-foreground mt-1">Yellow Lane — Doc Review</p>
            </CardContent>
          </Card>
          <Card className="border-l-4 border-l-emerald-500">
            <CardContent className="p-4">
              <p className="text-2xl font-bold text-emerald-600">{laneGroups.green}</p>
              <p className="text-xs text-muted-foreground mt-1">Green Lane — Auto-Approve</p>
            </CardContent>
          </Card>
          <Card className="border-l-4 border-l-blue-500">
            <CardContent className="p-4">
              <p className="text-2xl font-bold text-blue-600">{stats?.total ?? 0}</p>
              <p className="text-xs text-muted-foreground mt-1">Total Declarations</p>
            </CardContent>
          </Card>
        </div>

        {/* Filters */}
        <div className="flex flex-wrap gap-3">
          <div className="relative flex-1 min-w-48">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search by reference, importer, HS code..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="pl-9"
            />
          </div>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-40">
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Statuses</SelectItem>
              <SelectItem value="submitted">Submitted</SelectItem>
              <SelectItem value="under_review">Under Review</SelectItem>
              <SelectItem value="green_lane">Green Lane</SelectItem>
              <SelectItem value="yellow_lane">Yellow Lane</SelectItem>
              <SelectItem value="red_lane">Red Lane</SelectItem>
              <SelectItem value="held">Held</SelectItem>
              <SelectItem value="cleared">Cleared</SelectItem>
            </SelectContent>
          </Select>
          <Select value={laneFilter} onValueChange={setLaneFilter}>
            <SelectTrigger className="w-36">
              <SelectValue placeholder="Lane" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Lanes</SelectItem>
              <SelectItem value="green_lane">Green</SelectItem>
              <SelectItem value="yellow_lane">Yellow</SelectItem>
              <SelectItem value="red_lane">Red</SelectItem>
            </SelectContent>
          </Select>
          {/* Sprint 115: SLA breach filter shortcut */}
          <Button
            size="sm"
            variant={statusFilter === "__sla_breached__" ? "default" : "outline"}
            className="h-10 gap-1.5 text-xs shrink-0"
            onClick={() => {
              if (statusFilter === "__sla_breached__") {
                setStatusFilter("all");
              } else {
                setStatusFilter("__sla_breached__");
              }
            }}
            title="Show only declarations that have exceeded their SLA clearance target"
          >
            <AlertTriangle className="h-3.5 w-3.5" />
            SLA Breached
            {slaBreachCount !== null && slaBreachCount > 0 && (
              <span className="ml-1 bg-red-500 text-white text-[10px] font-bold rounded-full px-1.5 py-0.5 leading-none">
                {slaBreachCount}
              </span>
            )}
          </Button>
        </div>

        {/* Bulk Action Bar — appears when rows are selected */}
        {selectedIds.size > 0 && (
          <div className="flex flex-wrap items-center gap-3 p-3 bg-primary/5 border border-primary/20 rounded-lg">
            <span className="text-sm font-medium text-primary">
              <CheckSquare className="h-4 w-4 inline mr-1" />
              {selectedIds.size} selected
            </span>
            <Select value={bulkOfficerId} onValueChange={setBulkOfficerId}>
              <SelectTrigger className="w-52 h-8 text-xs">
                <SelectValue placeholder="Assign to officer..." />
              </SelectTrigger>
              <SelectContent>
                {(officerList ?? []).map((o: any) => (
                  <SelectItem key={o.id} value={String(o.id)}>{o.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              size="sm"
              className="h-8 gap-1.5 text-xs"
              disabled={!bulkOfficerId || isBulkAssigning}
              onClick={handleBulkAssign}
            >
              {isBulkAssigning ? <span className="h-3 w-3 border-2 border-white border-t-transparent rounded-full animate-spin" /> : <Users className="h-3.5 w-3.5" />}
              Assign Selected
            </Button>
<input
              type="text"
              placeholder="Archive label (optional)"
              value={bulkExportLabel}
              onChange={e => setBulkExportLabel(e.target.value)}
              maxLength={256}
              className="h-8 w-44 rounded-md border border-input bg-background px-2 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
              title="Optional label for this ZIP archive — shown in Export History"
            />
            <Button
              size="sm"
              variant="outline"
              className="h-8 gap-1.5 text-xs"
              disabled={isBulkExporting}
              onClick={handleBulkExportZip}
              title="Download selected declarations as a ZIP of HTML summaries"
            >
              {isBulkExporting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Archive className="h-3.5 w-3.5" />}
              Export ZIP
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="h-8 text-xs ml-auto"
              onClick={() => setSelectedIds(new Set())}
            >
              Clear selection
            </Button>
          </div>
        )}

        {/* Declaration table */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-semibold">
              Declaration Queue ({filtered.length}{hasMore ? "+" : ""})
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {isLoading ? (
              <div className="p-4 space-y-3">
                {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-14 w-full" />)}
              </div>
            ) : filtered.length === 0 ? (
              <div className="p-12 text-center">
                <FileText className="h-12 w-12 text-muted-foreground/30 mx-auto mb-3" />
                <p className="text-muted-foreground">No declarations found</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="border-b bg-muted/30">
                    <tr>
                      <th className="px-4 py-3 w-8">
                        <button
                          onClick={() => {
                            if (selectedIds.size === filtered.length) {
                              setSelectedIds(new Set());
                            } else {
                              setSelectedIds(new Set(filtered.map((d: any) => d.id)));
                            }
                          }}
                          className="text-muted-foreground hover:text-foreground"
                        >
                          {selectedIds.size === filtered.length && filtered.length > 0
                            ? <CheckSquare className="h-4 w-4" />
                            : <Square className="h-4 w-4" />}
                        </button>
                      </th>
                      <th className="text-left px-4 py-3 font-medium text-muted-foreground">Reference</th>
                      <th className="text-left px-4 py-3 font-medium text-muted-foreground">Importer</th>
                      <th className="text-left px-4 py-3 font-medium text-muted-foreground">HS Code</th>
                      <th className="text-left px-4 py-3 font-medium text-muted-foreground">Value</th>
                      <th className="text-left px-4 py-3 font-medium text-muted-foreground">Risk Score</th>
                      <th className="text-left px-4 py-3 font-medium text-muted-foreground">Lane / Status</th>
                      <th className="text-left px-4 py-3 font-medium text-muted-foreground">SLA</th>
                      <th className="text-left px-4 py-3 font-medium text-muted-foreground">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {filtered.map((d: any) => {
                      const lane = LANE_CONFIG[d.status] ?? LANE_CONFIG.submitted;
                      const riskScore = d.riskScore ? Number(d.riskScore) : null;
                      const isSelected = selectedIds.has(d.id);
                      return (
                        <tr key={d.id} className={`hover:bg-muted/30 transition-colors ${isSelected ? 'bg-primary/5' : ''}`}>
                          <td className="px-4 py-3">
                            <button
                              onClick={() => {
                                setSelectedIds(prev => {
                                  const next = new Set(prev);
                                  if (next.has(d.id)) next.delete(d.id);
                                  else next.add(d.id);
                                  return next;
                                });
                              }}
                              className="text-muted-foreground hover:text-foreground"
                            >
                              {isSelected ? <CheckSquare className="h-4 w-4 text-primary" /> : <Square className="h-4 w-4" />}
                            </button>
                          </td>
                          <td className="px-4 py-3">
                            <span className="font-mono text-xs font-medium">{d.declarationNumber}</span>
                          </td>
                          <td className="px-4 py-3">
                            <div>
                              <p className="font-medium truncate max-w-32">{d.traderName || "—"}</p>
                              <p className="text-xs text-muted-foreground">{d.declarationType?.toUpperCase()}</p>
                            </div>
                          </td>
                          <td className="px-4 py-3">
                            <span className="font-mono text-xs">{d.hsCode}</span>
                          </td>
                          <td className="px-4 py-3">
                            <span className="text-xs">{d.invoiceCurrency} {Number(d.invoiceValue || 0).toLocaleString()}</span>
                          </td>
                          <td className="px-4 py-3">
                            {riskScore !== null ? (
                              <div className="flex items-center gap-2">
                                <div className="h-1.5 w-16 bg-muted rounded-full overflow-hidden">
                                  <div
                                    className={`h-full rounded-full ${riskScore >= 70 ? "bg-red-500" : riskScore >= 40 ? "bg-amber-500" : "bg-emerald-500"}`}
                                    style={{ width: `${riskScore}%` }}
                                  />
                                </div>
                                <span className={`text-xs font-medium ${riskScore >= 70 ? "text-red-600" : riskScore >= 40 ? "text-amber-600" : "text-emerald-600"}`}>
                                  {riskScore}
                                </span>
                              </div>
                            ) : (
                              <span className="text-xs text-muted-foreground">Pending</span>
                            )}
                          </td>
                          <td className="px-4 py-3">
                            <div className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-md border text-xs font-medium ${lane.bg} ${lane.color}`}>
                              {lane.icon}
                              {lane.label}
                            </div>
                          </td>
                          <td className="px-4 py-3">
                            {(() => {
                              const sla = getSLAStatus(d);
                              if (sla.label === "—") return <span className="text-xs text-muted-foreground">—</span>;
                              const lane = d.riskLane ?? d.status;
                              const threshold = SLA_HOURS[lane] ?? 24;
                              const hoursOver = sla.isBreached ? (sla.hoursElapsed - threshold).toFixed(1) : null;
                              const tooltipText = sla.isBreached
                                ? `${sla.label} elapsed — ${hoursOver}h over SLA (limit: ${threshold}h for ${lane?.replace(/_/g, ' ')})`
                                : sla.isWarning
                                ? `${sla.label} elapsed — approaching SLA limit of ${threshold}h for ${lane?.replace(/_/g, ' ')}`
                                : `${sla.label} elapsed — within SLA limit of ${threshold}h`;
                              return (
                                <span
                                  title={tooltipText}
                                  className={`inline-flex items-center gap-1 text-xs font-medium px-1.5 py-0.5 rounded cursor-help ${
                                    sla.isBreached ? "bg-red-100 text-red-700 ring-1 ring-red-300" :
                                    sla.isWarning ? "bg-amber-100 text-amber-700 ring-1 ring-amber-300" :
                                    "bg-muted text-muted-foreground"
                                  }`}
                                >
                                  {sla.isBreached && <AlertTriangle className="h-3 w-3" />}
                                  {sla.label}
                                  {sla.isBreached && " OVERDUE"}
                                  {sla.isWarning && <Clock className="h-3 w-3" />}
                                </span>
                              );
                            })()}
                          </td>
                          <td className="px-4 py-3">
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => setLocation(`/app/customs/declarations/${d.id}`)}
                              className="h-7 text-xs gap-1"
                            >
                              <Eye className="h-3 w-3" /> Review
                            </Button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
            {/* Load More button */}
            {hasMore && !isLoading && (
              <div className="p-4 border-t text-center">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => nextCursor && setCursor(nextCursor)}
                  disabled={isFetching}
                  className="gap-2"
                >
                  {isFetching ? (
                    <><span className="h-3.5 w-3.5 border-2 border-current border-t-transparent rounded-full animate-spin" />Loading...</>
                  ) : (
                    <>Load more declarations</>
                  )}
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* ── Bulk Export History ──────────────────────────────────────── */}
      <ExportHistoryPanel />

      {/* ── Fluvio Live Cargo Event Stream ─────────────────────────────── */}
      <LiveCargoStream />
    </DashboardLayout>
  );
}

// ─── Live Cargo Stream Panel ──────────────────────────────────────────────────
const SEVERITY_STYLE: Record<string, string> = {
  INFO:     "bg-blue-50 border-blue-200 text-blue-800",
  WARNING:  "bg-amber-50 border-amber-200 text-amber-800",
  CRITICAL: "bg-red-50 border-red-200 text-red-800",
};

function LiveCargoStream() {
  const { data: wsInfo } = trpc.stream.getWebSocketUrl.useQuery({});
  const { data: initialEvents, isLoading } = trpc.stream.getRecentEvents.useQuery({ limit: 20 });
  const [events, setEvents] = useState<any[]>([]);
  const [connected, setConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Seed with initial events from ring buffer
  useEffect(() => {
    if (initialEvents?.events) {
      setEvents(initialEvents.events.slice(0, 20));
    }
  }, [initialEvents]);

  // Open WebSocket when URL is available
  useEffect(() => {
    if (!wsInfo?.wsUrl) return;
    const ws = new WebSocket(wsInfo.wsUrl);
    wsRef.current = ws;
    ws.onopen = () => setConnected(true);
    ws.onclose = () => setConnected(false);
    ws.onerror = () => setConnected(false);
    ws.onmessage = (msg) => {
      try {
        const e = JSON.parse(msg.data);
        setEvents(prev => [e, ...prev].slice(0, 50));
        // Auto-scroll to top
        if (listRef.current) listRef.current.scrollTop = 0;
      } catch {}
    };
    return () => ws.close();
  }, [wsInfo?.wsUrl]);

  // Polling fallback when WebSocket is unavailable
  const { data: polled } = trpc.stream.getRecentEvents.useQuery(
    { limit: 10 },
    { refetchInterval: wsInfo?.pollingIntervalMs ?? false, enabled: !wsInfo?.wsUrl }
  );
  useEffect(() => {
    if (!wsInfo?.wsUrl && polled?.events) {
      setEvents(polled.events.slice(0, 20));
    }
  }, [polled, wsInfo?.wsUrl]);

  return (
    <Card className="mt-6">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2">
            <Radio className="h-4 w-4 text-primary" />
            Live Cargo Event Stream
          </CardTitle>
          <div className="flex items-center gap-1.5 text-xs">
            {connected ? (
              <><Wifi className="h-3.5 w-3.5 text-emerald-500" /><span className="text-emerald-600 font-medium">Live</span></>
            ) : (
              <><WifiOff className="h-3.5 w-3.5 text-muted-foreground" /><span className="text-muted-foreground">{wsInfo?.wsUrl ? "Connecting…" : "Polling"}</span></>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        <div ref={listRef} className="max-h-72 overflow-y-auto divide-y">
          {isLoading ? (
            Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-10 mx-4 my-1" />)
          ) : events.length === 0 ? (
            <p className="p-4 text-sm text-muted-foreground text-center">No events yet — waiting for stream…</p>
          ) : (
            events.map((e: any, i: number) => (
              <div key={e.event_id ?? i} className="flex items-start gap-3 px-4 py-2.5 hover:bg-muted/30 transition-colors">
                <span className={`mt-0.5 shrink-0 text-xs font-medium px-1.5 py-0.5 rounded border ${SEVERITY_STYLE[e.severity] ?? SEVERITY_STYLE.INFO}`}>
                  {e.severity ?? "INFO"}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-semibold text-foreground">{e.event_type}</span>
                    {e.port_code && <span className="text-xs text-muted-foreground">{e.port_code}</span>}
                    {e.declaration_id && <Badge variant="outline" className="text-xs h-4 px-1">Decl #{e.declaration_id}</Badge>}
                  </div>
                  <p className="text-xs text-muted-foreground truncate mt-0.5">{e.message}</p>
                </div>
                <span className="text-xs text-muted-foreground shrink-0">
                  {e.timestamp ? new Date(e.timestamp).toLocaleTimeString() : "—"}
                </span>
              </div>
            ))
          )}
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Bulk Export History Panel ────────────────────────────────────────────────
function ExportHistoryPanel() {
  const { data: exports, isLoading, refetch } = trpc.declarations.listBulkExports.useQuery({ limit: 20 });
  const [regeneratingId, setRegeneratingId] = useState<number | null>(null);
  const bulkExportMutation = trpc.declarations.bulkExportZip.useMutation({
    onSuccess: (data) => {
      toast.success("Archive regenerated", { description: "New ZIP ready for download." });
      window.open(data.url, "_blank");
      refetch();
      setRegeneratingId(null);
    },
    onError: (err) => {
      toast.error("Regeneration failed", { description: err.message });
      setRegeneratingId(null);
    },
  });

  const handleRegenerate = (row: any) => {
    if (!row.declarationIds?.length) {
      toast.error("Cannot regenerate", { description: "Declaration IDs not stored for this export." });
      return;
    }
    setRegeneratingId(row.id);
    bulkExportMutation.mutate({ ids: row.declarationIds, label: row.label ? `${row.label} (regenerated)` : undefined });
  };

  if (!isLoading && (!exports || exports.length === 0)) return null;

  return (
    <Card className="mt-6">
      <CardHeader className="pb-3">
        <CardTitle className="text-base font-semibold flex items-center gap-2">
          <History className="h-4 w-4 text-primary" />
          Bulk Export History
          {exports && exports.length > 0 && (
            <span className="ml-1 text-sm font-normal text-muted-foreground">({exports.length})</span>
          )}
          <Button
            variant="ghost"
            size="sm"
            className="ml-auto h-7 w-7 p-0"
            onClick={() => refetch()}
            title="Refresh export history"
          >
            <Download className="h-3.5 w-3.5" />
          </Button>
        </CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        {isLoading ? (
          <div className="p-4 space-y-2">
            {[...Array(3)].map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b bg-muted/30">
                <tr>
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground">Date</th>
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground">Label</th>
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground">Declarations</th>
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground">Failed</th>
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground">Size</th>
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground">Expires</th>
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground">Download</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {(exports ?? []).map((row: any) => {
                  const isExpired = row.expiresAt && new Date(row.expiresAt) < new Date();
                  const sizeLabel = row.fileSizeBytes
                    ? row.fileSizeBytes > 1024 * 1024
                      ? `${(row.fileSizeBytes / 1024 / 1024).toFixed(1)} MB`
                      : `${Math.round(row.fileSizeBytes / 1024)} KB`
                    : "—";
                  return (
                    <tr key={row.id} className={`hover:bg-muted/30 transition-colors ${isExpired ? "opacity-50" : ""}`}>
                      <td className="px-4 py-3 text-xs text-muted-foreground">
                        {new Date(row.createdAt).toLocaleString()}
                      </td>
                      <td className="px-4 py-3 text-xs max-w-[160px]">
                        {row.label ? (
                          <span className="font-medium text-foreground truncate block" title={row.label}>{row.label}</span>
                        ) : (
                          <span className="text-muted-foreground italic">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3 font-medium">{row.declarationCount}</td>
                      <td className="px-4 py-3">
                        {row.failedCount > 0 ? (
                          <span className="text-xs text-red-600 font-medium">{row.failedCount} failed</span>
                        ) : (
                          <span className="text-xs text-emerald-600">✓ All ok</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-xs text-muted-foreground">{sizeLabel}</td>
                      <td className="px-4 py-3 text-xs">
                        {row.expiresAt ? (
                          <span className={isExpired ? "text-red-500" : "text-muted-foreground"}>
                            {isExpired ? "Expired" : new Date(row.expiresAt).toLocaleDateString()}
                          </span>
                        ) : "—"}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1">
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 text-xs gap-1"
                            disabled={isExpired}
                            onClick={() => window.open(row.s3Url, "_blank")}
                            title={isExpired ? "This archive has expired" : "Re-download ZIP archive"}
                          >
                            <ExternalLink className="h-3 w-3" />
                            {isExpired ? "Expired" : "Download"}
                          </Button>
                          {isExpired && row.declarationIds?.length > 0 && (
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-7 text-xs gap-1 text-primary"
                              disabled={regeneratingId === row.id}
                              onClick={() => handleRegenerate(row)}
                              title="Re-generate this archive with the same declarations"
                            >
                              {regeneratingId === row.id ? (
                                <Loader2 className="h-3 w-3 animate-spin" />
                              ) : (
                                <RefreshCwIcon className="h-3 w-3" />
                              )}
                              Regen
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
        )}
      </CardContent>
    </Card>
  );
}
