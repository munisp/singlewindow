/**
 * OpenAppSec WAF Events Security Page — Sprint v81
 * Triage and acknowledge WAF security events from OpenAppSec.
 */
import { useState } from "react";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from "recharts";
import { trpc } from "@/lib/trpc";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Checkbox } from "@/components/ui/checkbox";
import { Loader2, RefreshCw, ShieldAlert, ShieldCheck, Eye, EyeOff, AlertTriangle, MapPin, Network, Globe, Info, Download, TrendingUp } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";

const SEVERITY_COLORS: Record<string, string> = {
  critical: "bg-red-600/20 text-red-400 border-red-600/40",
  high: "bg-orange-500/20 text-orange-400 border-orange-500/40",
  medium: "bg-amber-500/20 text-amber-400 border-amber-500/40",
  low: "bg-blue-500/20 text-blue-400 border-blue-500/40",
};

const ACTION_COLORS: Record<string, string> = {
  BLOCK: "bg-red-500/10 text-red-400",
  LOG: "bg-gray-500/10 text-gray-400",
};

export default function WafEvents() {
  const { toast } = useToast();
  const [severityFilter, setSeverityFilter] = useState<string>("ALL");
  const [attackTypeFilter, setAttackTypeFilter] = useState<string>("ALL");
  const [ackedFilter, setAckedFilter] = useState<string>("ALL");
  const [page, setPage] = useState(0);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [detailEvent, setDetailEvent] = useState<(typeof events)[0] | null>(null);
  const PAGE_SIZE = 25;

  const geoLookupQuery = trpc.geoip.lookupIp.useQuery(
    { ip: detailEvent?.sourceIp ?? "" },
    { enabled: !!detailEvent?.sourceIp }
  );

  const statsQuery = trpc.openAppSec.getWafStats.useQuery();
  const trendQuery = trpc.openAppSec.getWafTrend.useQuery({ days: 30 });
  const attackTypesQuery = trpc.openAppSec.getAttackTypes.useQuery();
  const eventsQuery = trpc.openAppSec.getWafEvents.useQuery({
    limit: PAGE_SIZE,
    offset: page * PAGE_SIZE,
    severity: severityFilter !== "ALL" ? (severityFilter as any) : undefined,
    attackType: attackTypeFilter !== "ALL" ? attackTypeFilter : undefined,
    isAcknowledged: ackedFilter === "ALL" ? undefined : ackedFilter === "unacked" ? false : true,
  });

  const utils = trpc.useUtils();

  const ackMutation = trpc.openAppSec.acknowledgeEvent.useMutation({
    onSuccess: () => {
      utils.openAppSec.getWafEvents.invalidate();
      utils.openAppSec.getWafStats.invalidate();
      toast({ title: "Event acknowledged" });
    },
    onError: (err) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const bulkAckMutation = trpc.openAppSec.bulkAcknowledge.useMutation({
    onSuccess: (data) => {
      utils.openAppSec.getWafEvents.invalidate();
      utils.openAppSec.getWafStats.invalidate();
      setSelectedIds(new Set());
      toast({ title: `${data.acknowledged} events acknowledged` });
    },
    onError: (err) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const events = eventsQuery.data?.events ?? [];
  const total = eventsQuery.data?.total ?? 0;
  const totalPages = Math.ceil(total / PAGE_SIZE);
  const stats = statsQuery.data;

  const toggleSelect = (id: number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const handleExportCsv = () => {
    if (events.length === 0) return;
    const headers = ["ID", "Attack Type", "Severity", "Source IP", "Country", "City", "ASN", "Target Path", "HTTP Method", "Action", "Rule ID", "Acknowledged", "Created At"];
    const rows = events.map((evt) => [
      evt.id,
      evt.attackType,
      evt.severity,
      evt.sourceIp,
      (evt as any).country ?? "",
      (evt as any).city ?? "",
      (evt as any).asn ?? "",
      evt.targetPath ?? "",
      (evt as any).httpMethod ?? "",
      evt.action,
      (evt as any).ruleId ?? "",
      evt.isAcknowledged ? "yes" : "no",
      new Date(evt.createdAt).toISOString(),
    ]);
    const csvContent = [headers, ...rows]
      .map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(","))
      .join("\n");
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `waf-events-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
    toast({ title: "CSV exported", description: `${events.length} events downloaded.` });
  };

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <ShieldAlert className="w-6 h-6 text-red-400" />
            WAF Security Events
          </h1>
          <p className="text-sm text-muted-foreground mt-1">OpenAppSec AI WAF — attack detection and triage</p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={handleExportCsv}
            disabled={events.length === 0}
          >
            <Download className="w-4 h-4 mr-2" />
            Export CSV
          </Button>
          <Button variant="outline" size="sm" onClick={() => eventsQuery.refetch()} disabled={eventsQuery.isFetching}>
            <RefreshCw className={`w-4 h-4 mr-2 ${eventsQuery.isFetching ? "animate-spin" : ""}`} />
            Refresh
          </Button>
          <Button variant="outline" size="sm" onClick={() => trendQuery.refetch()} disabled={trendQuery.isFetching}>
            <TrendingUp className="w-4 h-4 mr-2" />
            Refresh GeoIP
          </Button>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        {[
          { label: "Critical", value: stats?.critical, cls: "text-red-400" },
          { label: "High", value: stats?.high, cls: "text-orange-400" },
          { label: "Medium", value: stats?.medium, cls: "text-amber-400" },
          { label: "Low", value: stats?.low, cls: "text-blue-400" },
          { label: "Unacknowledged", value: stats?.unacknowledged, cls: "text-yellow-400" },
        ].map((s) => (
          <Card key={s.label} className="bg-card border-border">
            <CardContent className="pt-3 pb-2">
              <p className="text-xs text-muted-foreground">{s.label}</p>
              <p className={`text-xl font-bold ${s.cls}`}>
                {statsQuery.isLoading ? "…" : (s.value ?? 0)}
              </p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* WAF Severity Trend Chart */}
      {(trendQuery.data ?? []).length > 0 && (
        <Card className="bg-card border-border">
          <CardContent className="pt-4">
            <p className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
              <TrendingUp className="w-4 h-4 text-muted-foreground" />
              30-Day Severity Trend
            </p>
            <div style={{ height: 220 }}>
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={trendQuery.data} margin={{ top: 4, right: 16, left: -20, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.07)" />
                  <XAxis dataKey="date" tick={{ fontSize: 10 }} tickFormatter={(v: string) => v.slice(5)} />
                  <YAxis tick={{ fontSize: 10 }} />
                  <Tooltip contentStyle={{ background: "#1e293b", border: "1px solid #334155", borderRadius: 6, fontSize: 12 }} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Line type="monotone" dataKey="critical" stroke="#ef4444" strokeWidth={2} dot={false} />
                  <Line type="monotone" dataKey="high" stroke="#f97316" strokeWidth={2} dot={false} />
                  <Line type="monotone" dataKey="medium" stroke="#f59e0b" strokeWidth={2} dot={false} />
                  <Line type="monotone" dataKey="low" stroke="#60a5fa" strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      )}
      {/* Filters + Bulk Action */}
      <div className="flex gap-3 flex-wrap items-center">
        <Select value={severityFilter} onValueChange={(v) => { setSeverityFilter(v); setPage(0); }}>
          <SelectTrigger className="w-36">
            <SelectValue placeholder="Severity" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All Severities</SelectItem>
            {["critical", "high", "medium", "low"].map((s) => (
              <SelectItem key={s} value={s}>{s.toUpperCase()}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={attackTypeFilter} onValueChange={(v) => { setAttackTypeFilter(v); setPage(0); }}>
          <SelectTrigger className="w-52">
            <SelectValue placeholder="Attack Type" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All Attack Types</SelectItem>
            {(attackTypesQuery.data ?? []).map((t) => (
              <SelectItem key={t} value={t}>{t.replace(/_/g, " ")}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={ackedFilter} onValueChange={(v) => { setAckedFilter(v); setPage(0); }}>
          <SelectTrigger className="w-40">
            <SelectValue placeholder="Ack Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All</SelectItem>
            <SelectItem value="unacked">Unacknowledged</SelectItem>
            <SelectItem value="acked">Acknowledged</SelectItem>
          </SelectContent>
        </Select>

        {selectedIds.size > 0 && (
          <Button
            size="sm"
            variant="outline"
            className="border-green-500/30 text-green-400 hover:bg-green-500/10"
            onClick={() => bulkAckMutation.mutate({ ids: Array.from(selectedIds) })}
            disabled={bulkAckMutation.isPending}
          >
            {bulkAckMutation.isPending
              ? <Loader2 className="w-4 h-4 animate-spin mr-2" />
              : <ShieldCheck className="w-4 h-4 mr-2" />}
            Acknowledge {selectedIds.size} selected
          </Button>
        )}

        <span className="text-sm text-muted-foreground ml-auto">{total} event{total !== 1 ? "s" : ""}</span>
      </div>

      {/* Table */}
      <Card className="bg-card border-border">
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow className="border-border">
                <TableHead className="w-10"></TableHead>
                <TableHead>Attack Type</TableHead>
                <TableHead>Severity</TableHead>
                <TableHead>Source IP</TableHead>
                <TableHead>Target Path</TableHead>
                <TableHead>Action</TableHead>
                <TableHead>Rule</TableHead>
                <TableHead>Time</TableHead>
                <TableHead className="text-right">Ack</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {eventsQuery.isLoading ? (
                <TableRow>
                  <TableCell colSpan={9} className="text-center py-8">
                    <Loader2 className="w-6 h-6 animate-spin mx-auto text-muted-foreground" />
                  </TableCell>
                </TableRow>
              ) : events.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={9} className="text-center py-8 text-muted-foreground">
                    No WAF events found
                  </TableCell>
                </TableRow>
              ) : (
                events.map((evt) => (
                  <TableRow
                    key={evt.id}
                    className={`border-border hover:bg-muted/30 cursor-pointer ${evt.isAcknowledged ? "opacity-50" : ""}`}
                    onClick={() => setDetailEvent(evt)}
                  >
                    <TableCell>
                      {!evt.isAcknowledged && (
                        <Checkbox
                          checked={selectedIds.has(evt.id)}
                          onCheckedChange={() => toggleSelect(evt.id)}
                        />
                      )}
                    </TableCell>
                    <TableCell className="text-xs font-medium">{evt.attackType.replace(/_/g, " ")}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className={`text-xs ${SEVERITY_COLORS[evt.severity] ?? ""}`}>
                        {evt.severity.toUpperCase()}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-xs">
                      <div className="flex flex-col gap-0.5">
                        <div className="flex items-center gap-1.5">
                          <span className="text-base leading-none" title={(evt as any).country ?? undefined}>
                            {(evt as any).countryFlag ?? "🌐"}
                          </span>
                          <span className="font-mono text-muted-foreground">{evt.sourceIp}</span>
                        </div>
                        {(evt as any).asn && (
                          <span
                            className="inline-block font-mono text-[10px] bg-muted text-muted-foreground px-1 py-0.5 rounded"
                            title={(evt as any).asnOrg ?? undefined}
                          >
                            {(evt as any).asn}
                          </span>
                        )}
                        {(evt as any).city && (
                          <span className="text-[10px] text-muted-foreground">
                            {(evt as any).city}{(evt as any).country ? `, ${(evt as any).country}` : ""}
                          </span>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground truncate max-w-[160px]" title={evt.targetPath ?? undefined}>
                      {evt.targetPath}
                    </TableCell>
                    <TableCell>
                      <span className={`text-xs font-medium px-1.5 py-0.5 rounded ${ACTION_COLORS[evt.action] ?? ""}`}>
                        {evt.action}
                      </span>
                    </TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">{(evt as any).ruleId ?? "—"}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {new Date(evt.createdAt).toLocaleString()}
                    </TableCell>
                    <TableCell className="text-right">
                      {evt.isAcknowledged ? (
                        <Eye className="w-4 h-4 text-green-400 inline" />
                      ) : (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 text-xs"
                          onClick={() => ackMutation.mutate({ id: evt.id })}
                          disabled={ackMutation.isPending}
                        >
                          <EyeOff className="w-3 h-3 mr-1" />
                          Ack
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex justify-center gap-2">
          <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage(p => p - 1)}>Previous</Button>
          <span className="text-sm text-muted-foreground self-center">Page {page + 1} of {totalPages}</span>
          <Button variant="outline" size="sm" disabled={page >= totalPages - 1} onClick={() => setPage(p => p + 1)}>Next</Button>
        </div>
      )}
      {/* WAF Event Detail Sheet */}
      <Sheet open={!!detailEvent} onOpenChange={(open) => { if (!open) setDetailEvent(null); }}>
        <SheetContent className="w-[420px] sm:w-[480px] overflow-y-auto">
          <SheetHeader>
            <SheetTitle className="flex items-center gap-2">
              <ShieldAlert className="w-5 h-5 text-red-400" />
              WAF Event Detail
            </SheetTitle>
            <SheetDescription>
              Full geolocation and attack metadata for this event.
            </SheetDescription>
          </SheetHeader>

          {detailEvent && (
            <div className="mt-6 space-y-6">
              {/* Attack Info */}
              <div className="space-y-3">
                <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 text-amber-400" /> Attack Details
                </h3>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  {[
                    { label: "Attack Type", value: detailEvent.attackType.replace(/_/g, " ") },
                    { label: "Severity", value: (
                      <Badge variant="outline" className={`text-xs ${SEVERITY_COLORS[detailEvent.severity] ?? ""}`}>
                        {detailEvent.severity.toUpperCase()}
                      </Badge>
                    )},
                    { label: "Action", value: (
                      <span className={`font-medium px-1.5 py-0.5 rounded ${ACTION_COLORS[detailEvent.action] ?? ""}`}>
                        {detailEvent.action}
                      </span>
                    )},
                    { label: "Rule ID", value: <span className="font-mono">{(detailEvent as any).ruleId ?? "—"}</span> },
                    { label: "Target Path", value: <span className="font-mono break-all">{detailEvent.targetPath ?? "—"}</span> },
                    { label: "Timestamp", value: new Date(detailEvent.createdAt).toLocaleString() },
                    { label: "Acknowledged", value: detailEvent.isAcknowledged ? "Yes" : "No" },
                  ].map(({ label, value }) => (
                    <div key={label}>
                      <p className="text-muted-foreground">{label}</p>
                      <div className="font-medium text-foreground mt-0.5">{value}</div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Source IP */}
              <div className="space-y-3">
                <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
                  <Network className="w-4 h-4 text-blue-400" /> Source IP
                </h3>
                <p className="font-mono text-sm text-foreground">{detailEvent.sourceIp}</p>
              </div>

              {/* Geolocation */}
              <div className="space-y-3">
                <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
                  <Globe className="w-4 h-4 text-green-400" /> Geolocation
                  {geoLookupQuery.isFetching && <Loader2 className="w-3 h-3 animate-spin text-muted-foreground" />}
                </h3>
                {geoLookupQuery.data ? (
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    {[
                      { label: "Country", value: geoLookupQuery.data.country
                        ? `${(geoLookupQuery.data as any).countryFlag ?? ""} ${geoLookupQuery.data.country}`
                        : "Unknown" },
                      { label: "Country Code", value: geoLookupQuery.data.countryCode ?? "—" },
                      { label: "City", value: geoLookupQuery.data.city ?? "—" },
                      { label: "ASN", value: geoLookupQuery.data.asn
                        ? <span className="font-mono">{geoLookupQuery.data.asn}</span>
                        : "—" },
                      { label: "ASN Org", value: geoLookupQuery.data.asnOrg ?? "—" },
                      { label: "Last Updated", value: (geoLookupQuery.data as any).updatedAt
                        ? new Date((geoLookupQuery.data as any).updatedAt).toLocaleDateString()
                        : "—" },
                    ].map(({ label, value }) => (
                      <div key={label}>
                        <p className="text-muted-foreground">{label}</p>
                        <div className="font-medium text-foreground mt-0.5">{value}</div>
                      </div>
                    ))}
                  </div>
                ) : geoLookupQuery.isLoading ? (
                  <p className="text-xs text-muted-foreground">Loading geolocation…</p>
                ) : (
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Info className="w-3.5 h-3.5" />
                    No geolocation data cached for this IP. Seed the GeoIP database to enable lookups.
                  </div>
                )}
              </div>

              {/* Actions */}
              {!detailEvent.isAcknowledged && (
                <Button
                  className="w-full"
                  variant="outline"
                  onClick={() => {
                    ackMutation.mutate({ id: detailEvent.id });
                    setDetailEvent(null);
                  }}
                  disabled={ackMutation.isPending}
                >
                  <ShieldCheck className="w-4 h-4 mr-2" />
                  Acknowledge Event
                </Button>
              )}
            </div>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}
