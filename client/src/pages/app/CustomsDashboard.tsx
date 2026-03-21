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
} from "lucide-react";
import { useEffect, useRef, useState, useMemo } from "react";
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

  // Debounce search input by 350ms to avoid excessive queries
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search), 350);
    return () => clearTimeout(timer);
  }, [search]);

  const { data: declarations, isLoading, isError} = trpc.declarations.all.useQuery({
    limit: 100,
    status: statusFilter !== "all" ? statusFilter : undefined,
    riskLane: laneFilter !== "all" ? laneFilter : undefined,
    search: debouncedSearch.trim() || undefined,
  });

  const { data: stats } = trpc.declarations.stats.useQuery();

  // Server-side search is now applied; client-side filter is a no-op passthrough
  const filtered = declarations ?? [];

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
        </div>

        {/* Declaration table */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-semibold">
              Declaration Queue ({filtered.length})
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
                      return (
                        <tr key={d.id} className="hover:bg-muted/30 transition-colors">
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
          </CardContent>
        </Card>
      </div>

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
