/**
 * OGAPermitAuditTrail — Admin view of OGA permit state-change events.
 * Sprint v79 — OGA Permit audit trail UI.
 */

import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { RefreshCw, CheckCircle, XCircle, Clock, AlertCircle } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";

const AGENCIES = ["FDA", "EPA", "MOFEP", "CEPS", "NACOC", "GFZA", "GCAA", "NPA", "DVLA", "GSA"];
const EVENT_TYPES = ["REQUESTED", "SUBMITTED", "UNDER_REVIEW", "APPROVED", "REJECTED", "EXPIRED", "RENEWED", "REVOKED"] as const;

type EventType = typeof EVENT_TYPES[number];

const EVENT_COLORS: Record<EventType, string> = {
  REQUESTED: "bg-blue-100 text-blue-800 border-blue-200",
  SUBMITTED: "bg-indigo-100 text-indigo-800 border-indigo-200",
  UNDER_REVIEW: "bg-yellow-100 text-yellow-800 border-yellow-200",
  APPROVED: "bg-green-100 text-green-800 border-green-200",
  REJECTED: "bg-red-100 text-red-800 border-red-200",
  EXPIRED: "bg-gray-100 text-gray-600 border-gray-200",
  RENEWED: "bg-teal-100 text-teal-800 border-teal-200",
  REVOKED: "bg-orange-100 text-orange-800 border-orange-200",
};

const EVENT_ICONS: Record<EventType, React.ReactNode> = {
  REQUESTED: <Clock className="w-3 h-3" />,
  SUBMITTED: <Clock className="w-3 h-3" />,
  UNDER_REVIEW: <AlertCircle className="w-3 h-3" />,
  APPROVED: <CheckCircle className="w-3 h-3" />,
  REJECTED: <XCircle className="w-3 h-3" />,
  EXPIRED: <Clock className="w-3 h-3" />,
  RENEWED: <CheckCircle className="w-3 h-3" />,
  REVOKED: <XCircle className="w-3 h-3" />,
};

export default function OGAPermitAuditTrail() {
  const { toast } = useToast();
  const [agencyFilter, setAgencyFilter] = useState<string>("all");
  const [eventTypeFilter, setEventTypeFilter] = useState<EventType | "all">("all");
  const [selectedIds, setSelectedIds] = useState<number[]>([]);

  const { data, isLoading, refetch } = trpc.ogaPermitAudit.getRecentEvents.useQuery({
    limit: 100,
    agencyCode: agencyFilter === "all" ? undefined : agencyFilter,
    eventType: eventTypeFilter === "all" ? undefined : eventTypeFilter,
  });

  const { data: agencyStats } = trpc.ogaPermitAudit.getAgencyStats.useQuery();

  const events = data?.events ?? [];
  const pendingEvents = events.filter((e: any) => e.eventType === "SUBMITTED" || e.eventType === "UNDER_REVIEW");
  const allPendingSelected = pendingEvents.length > 0 && pendingEvents.every((e: any) => selectedIds.includes(e.id));

  const bulkApproveMutation = trpc.ogaPermitAudit.bulkApprovePermits.useMutation({
    onSuccess: (res) => {
      toast({ title: "Bulk approve complete", description: `${res.approvedCount} permit(s) approved.` });
      setSelectedIds([]);
      refetch();
    },
    onError: (err) => toast({ title: "Bulk approve failed", description: err.message, variant: "destructive" }),
  });

  const toggleSelect = (id: number) =>
    setSelectedIds((prev) => prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]);

  const toggleAll = () =>
    setSelectedIds(allPendingSelected ? [] : pendingEvents.map((e: any) => e.id));

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">OGA Permit Audit Trail</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Event sourcing log for all Other Government Agency permit state transitions
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => refetch()}>
          <RefreshCw className="w-4 h-4 mr-1" />
          Refresh
        </Button>
      </div>

      {/* Agency Stats */}
      {agencyStats && agencyStats.length > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
          {agencyStats.map((stat) => (
            <div key={stat.agencyCode} className="rounded-lg border bg-card p-3 space-y-1">
              <p className="text-xs font-bold text-foreground">{stat.agencyCode}</p>
              <div className="flex flex-col gap-0.5 text-xs">
                <span className="text-green-600 font-semibold">{stat.approved} approved</span>
                <span className="text-red-600 font-semibold">{stat.rejected} rejected</span>
                <span className="text-yellow-600 font-semibold">{stat.pending} pending</span>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Filters */}
      <div className="flex items-center gap-3 flex-wrap">
        <Select value={agencyFilter} onValueChange={setAgencyFilter}>
          <SelectTrigger className="w-36">
            <SelectValue placeholder="All agencies" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All agencies</SelectItem>
            {AGENCIES.map((a) => (
              <SelectItem key={a} value={a}>{a}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={eventTypeFilter} onValueChange={(v) => setEventTypeFilter(v as EventType | "all")}>
          <SelectTrigger className="w-44">
            <SelectValue placeholder="All event types" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All event types</SelectItem>
            {EVENT_TYPES.map((t) => (
              <SelectItem key={t} value={t}>{t}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <span className="text-sm text-muted-foreground">
          {events.length} event{events.length !== 1 ? "s" : ""}
        </span>
      </div>

      {/* Bulk Action Bar */}
      {selectedIds.length > 0 && (
        <div className="flex items-center gap-3 px-4 py-2 bg-primary/10 border border-primary/30 rounded-lg">
          <span className="text-sm font-medium text-primary">{selectedIds.length} selected</span>
          <Button size="sm" className="h-7 text-xs" onClick={() => bulkApproveMutation.mutate({ permitIds: selectedIds })} disabled={bulkApproveMutation.isPending}>
            {bulkApproveMutation.isPending ? <RefreshCw className="w-3 h-3 mr-1 animate-spin" /> : <CheckCircle className="w-3 h-3 mr-1" />}
            Bulk Approve
          </Button>
          <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setSelectedIds([])}>
            Clear
          </Button>
        </div>
      )}
      {/* Timeline Table */}
      <div className="rounded-lg border overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 border-b">
            <tr>
              <th className="px-4 py-3 text-left font-medium w-10">
                <Checkbox checked={allPendingSelected} onCheckedChange={toggleAll} aria-label="Select all pending" />
              </th>
              <th className="px-4 py-3 text-left font-medium">Agency</th>
              <th className="px-4 py-3 text-left font-medium">Event</th>
              <th className="px-4 py-3 text-left font-medium">Status Change</th>
              <th className="px-4 py-3 text-left font-medium">Actor</th>
              <th className="px-4 py-3 text-left font-medium">Permit ID</th>
              <th className="px-4 py-3 text-left font-medium">Declaration</th>
              <th className="px-4 py-3 text-left font-medium">Remarks</th>
              <th className="px-4 py-3 text-left font-medium">Timestamp</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr>
                <td colSpan={9} className="px-4 py-8 text-center text-muted-foreground">
                  Loading audit trail…
                </td>
              </tr>
            ) : events.length === 0 ? (
              <tr>
                <td colSpan={9} className="px-4 py-8 text-center text-muted-foreground">
                  No events found
                </td>
              </tr>
            ) : (
              events.map((event: any) => (
                <tr
                  key={event.id}
                  className={`border-b last:border-0 hover:bg-muted/30 transition-colors ${selectedIds.includes(event.id) ? "bg-primary/5" : ""}`}
                >
                  <td className="px-4 py-3">
                    {(event.eventType === "SUBMITTED" || event.eventType === "UNDER_REVIEW") && (
                      <Checkbox checked={selectedIds.includes(event.id)} onCheckedChange={() => toggleSelect(event.id)} />
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <span className="font-semibold text-xs bg-slate-100 dark:bg-slate-800 px-2 py-0.5 rounded">
                      {event.agencyCode}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <Badge
                      variant="outline"
                      className={`flex items-center gap-1 w-fit text-xs ${
                        EVENT_COLORS[event.eventType as EventType] ?? ""
                      }`}
                    >
                      {EVENT_ICONS[event.eventType as EventType]}
                      {event.eventType}
                    </Badge>
                  </td>
                  <td className="px-4 py-3 text-xs text-muted-foreground">
                    {event.previousStatus ? (
                      <span>
                        <span className="line-through">{event.previousStatus}</span>
                        {" → "}
                        <span className="font-medium text-foreground">{event.newStatus}</span>
                      </span>
                    ) : (
                      <span className="font-medium text-foreground">{event.newStatus}</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-xs">
                    <span className={event.actorType === "system" ? "text-muted-foreground italic" : ""}>
                      {event.actorType === "system" ? "System" : `Officer #${event.actorId}`}
                    </span>
                  </td>
                  <td className="px-4 py-3 font-mono text-xs">{event.permitId}</td>
                  <td className="px-4 py-3 font-mono text-xs text-muted-foreground">
                    {event.declarationId ?? "—"}
                  </td>
                  <td className="px-4 py-3 text-xs text-muted-foreground max-w-[160px] truncate">
                    {event.remarks ?? "—"}
                  </td>
                  <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">
                    {event.createdAt
                      ? new Date(event.createdAt).toLocaleString()
                      : "—"}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
