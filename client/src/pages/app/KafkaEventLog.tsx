/**
 * KafkaEventLog — Admin panel for viewing and retrying Kafka event log entries.
 * Sprint v79 — Kafka Event Log UI
 */

import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { RefreshCw, RotateCcw, AlertCircle, CheckCircle, Clock } from "lucide-react";

type EventStatus = "pending" | "published" | "failed";

const STATUS_COLORS: Record<EventStatus, string> = {
  pending: "bg-yellow-100 text-yellow-800 border-yellow-200",
  published: "bg-green-100 text-green-800 border-green-200",
  failed: "bg-red-100 text-red-800 border-red-200",
};

const STATUS_ICONS: Record<EventStatus, React.ReactNode> = {
  pending: <Clock className="w-3 h-3" />,
  published: <CheckCircle className="w-3 h-3" />,
  failed: <AlertCircle className="w-3 h-3" />,
};

export default function KafkaEventLog() {
  const { toast } = useToast();
  const [statusFilter, setStatusFilter] = useState<EventStatus | "all">("all");
  const [selectedIds, setSelectedIds] = useState<number[]>([]);

  const { data, isLoading, refetch } = trpc.kafkaEvents.getKafkaEventLog.useQuery({
    limit: 100,
    offset: 0,
    status: statusFilter === "all" ? undefined : statusFilter,
  });

  const { data: topicStats } = trpc.kafkaEvents.getKafkaTopicStats.useQuery();

  const retryMutation = trpc.kafkaEvents.retryFailedKafkaEvents.useMutation({
    onSuccess: (result) => {
      toast({
        title: "Retry enqueued",
        description: `${result.retried} event(s) reset to pending.`,
      });
      setSelectedIds([]);
      refetch();
    },
    onError: (err) => {
      toast({ title: "Retry failed", description: err.message, variant: "destructive" });
    },
  });

  const events = data?.events ?? [];
  const failedCount = events.filter((e) => e.status === "failed").length;

  const toggleSelect = (id: number) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  };

  const handleRetry = () => {
    retryMutation.mutate(
      selectedIds.length > 0 ? { ids: selectedIds } : undefined
    );
  };

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Kafka Event Log</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Monitor and retry domain events in the outbox queue
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            <RefreshCw className="w-4 h-4 mr-1" />
            Refresh
          </Button>
          {(failedCount > 0 || selectedIds.length > 0) && (
            <Button
              size="sm"
              variant="destructive"
              onClick={handleRetry}
              disabled={retryMutation.isPending}
            >
              <RotateCcw className="w-4 h-4 mr-1" />
              {selectedIds.length > 0
                ? `Retry Selected (${selectedIds.length})`
                : `Retry All Failed (${failedCount})`}
            </Button>
          )}
        </div>
      </div>

      {/* Topic Stats */}
      {topicStats && topicStats.length > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
          {topicStats.slice(0, 5).map((stat: any) => (
            <div key={stat.topic} className="rounded-lg border bg-card p-3 space-y-1">
              <p className="text-xs font-medium text-muted-foreground truncate">{stat.topic}</p>
              <div className="flex gap-2 text-xs">
                <span className="text-green-600 font-semibold">{stat.published} ok</span>
                <span className="text-yellow-600 font-semibold">{stat.pending} pend</span>
                {stat.failed > 0 && (
                  <span className="text-red-600 font-semibold">{stat.failed} fail</span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Filters */}
      <div className="flex items-center gap-3">
        <Select
          value={statusFilter}
          onValueChange={(v) => setStatusFilter(v as EventStatus | "all")}
        >
          <SelectTrigger className="w-40">
            <SelectValue placeholder="All statuses" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            <SelectItem value="pending">Pending</SelectItem>
            <SelectItem value="published">Published</SelectItem>
            <SelectItem value="failed">Failed</SelectItem>
          </SelectContent>
        </Select>
        <span className="text-sm text-muted-foreground">
          {events.length} event{events.length !== 1 ? "s" : ""}
        </span>
      </div>

      {/* Table */}
      <div className="rounded-lg border overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 border-b">
            <tr>
              <th className="px-4 py-3 text-left font-medium w-8">
                <input
                  type="checkbox"
                  checked={selectedIds.length === events.filter((e) => e.status === "failed").length && events.filter((e) => e.status === "failed").length > 0}
                  onChange={(e) => {
                    if (e.target.checked) {
                      setSelectedIds(events.filter((ev) => ev.status === "failed").map((ev) => ev.id));
                    } else {
                      setSelectedIds([]);
                    }
                  }}
                  className="rounded"
                />
              </th>
              <th className="px-4 py-3 text-left font-medium">Topic</th>
              <th className="px-4 py-3 text-left font-medium">Aggregate ID</th>
              <th className="px-4 py-3 text-left font-medium">Status</th>
              <th className="px-4 py-3 text-left font-medium">Attempts</th>
              <th className="px-4 py-3 text-left font-medium">Error</th>
              <th className="px-4 py-3 text-left font-medium">Created</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-muted-foreground">
                  Loading events…
                </td>
              </tr>
            ) : events.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-muted-foreground">
                  No events found
                </td>
              </tr>
            ) : (
              events.map((event: any) => (
                <tr
                  key={event.id}
                  className={`border-b last:border-0 hover:bg-muted/30 transition-colors ${
                    selectedIds.includes(event.id) ? "bg-blue-50 dark:bg-blue-950/20" : ""
                  }`}
                >
                  <td className="px-4 py-3">
                    {event.status === "failed" && (
                      <input
                        type="checkbox"
                        checked={selectedIds.includes(event.id)}
                        onChange={() => toggleSelect(event.id)}
                        className="rounded"
                      />
                    )}
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-muted-foreground max-w-[180px] truncate">
                    {event.topic}
                  </td>
                  <td className="px-4 py-3 font-mono text-xs max-w-[140px] truncate">
                    {event.aggregateId}
                  </td>
                  <td className="px-4 py-3">
                    <Badge
                      variant="outline"
                      className={`flex items-center gap-1 w-fit ${STATUS_COLORS[event.status as EventStatus] ?? ""}`}
                    >
                      {STATUS_ICONS[event.status as EventStatus]}
                      {event.status}
                    </Badge>
                  </td>
                  <td className="px-4 py-3 text-center">{event.attempts}</td>
                  <td className="px-4 py-3 text-xs text-red-600 max-w-[160px] truncate">
                    {event.errorMessage ?? "—"}
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
