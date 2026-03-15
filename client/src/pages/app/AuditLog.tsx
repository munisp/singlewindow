import DashboardLayout from "@/components/DashboardLayout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { trpc } from "@/lib/trpc";
import {
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  RefreshCw,
  Search,
  X,
} from "lucide-react";
import { useState, useCallback } from "react";

// ─── TYPES ────────────────────────────────────────────────────────────────────

const ENTITY_TYPES = [
  "declaration",
  "user",
  "payment",
  "permit",
  "document",
  "aeo_application",
  "kyc_verification",
] as const;

type EntityType = (typeof ENTITY_TYPES)[number];

const ENTITY_COLORS: Record<EntityType, string> = {
  declaration:      "bg-blue-100 text-blue-700",
  user:             "bg-purple-100 text-purple-700",
  payment:          "bg-emerald-100 text-emerald-700",
  permit:           "bg-amber-100 text-amber-700",
  document:         "bg-slate-100 text-slate-700",
  aeo_application:  "bg-indigo-100 text-indigo-700",
  kyc_verification: "bg-rose-100 text-rose-700",
};

// ─── HELPERS ──────────────────────────────────────────────────────────────────

function fmtDate(d: Date | string | null | undefined): string {
  if (!d) return "—";
  return new Date(d).toLocaleString(undefined, {
    year: "numeric", month: "short", day: "numeric",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  });
}

// ─── COMPONENT ────────────────────────────────────────────────────────────────

export default function AuditLog() {
  const [page, setPage] = useState(1);
  const PAGE_SIZE = 25;

  // Filter state
  const [entityType, setEntityType] = useState<EntityType | "all">("all");
  const [actionFilter, setActionFilter] = useState("");
  const [actorIdFilter, setActorIdFilter] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");

  // Committed (applied) filters — only sent to the server when user clicks Apply
  const [committed, setCommitted] = useState({
    entityType: "all" as EntityType | "all",
    action: "",
    actorId: "",
    fromDate: "",
    toDate: "",
  });

  const applyFilters = useCallback(() => {
    setCommitted({ entityType, action: actionFilter, actorId: actorIdFilter, fromDate, toDate });
    setPage(1);
  }, [entityType, actionFilter, actorIdFilter, fromDate, toDate]);

  const clearFilters = useCallback(() => {
    setEntityType("all");
    setActionFilter("");
    setActorIdFilter("");
    setFromDate("");
    setToDate("");
    setCommitted({ entityType: "all", action: "", actorId: "", fromDate: "", toDate: "" });
    setPage(1);
  }, []);

  const { data, isLoading, isFetching, refetch } = trpc.system.auditLog.useQuery(
    {
      page,
      pageSize: PAGE_SIZE,
      entityType: committed.entityType !== "all" ? committed.entityType : undefined,
      action: committed.action || undefined,
      actorId: committed.actorId ? parseInt(committed.actorId, 10) : undefined,
      fromDate: committed.fromDate ? new Date(committed.fromDate).getTime() : undefined,
      toDate: committed.toDate ? new Date(committed.toDate).getTime() : undefined,
    },
    { refetchInterval: false }
  );

  const totalPages = data ? Math.max(1, Math.ceil(data.total / PAGE_SIZE)) : 1;
  const hasActiveFilters =
    committed.entityType !== "all" ||
    committed.action ||
    committed.actorId ||
    committed.fromDate ||
    committed.toDate;

  return (
    <DashboardLayout>
      <div className="space-y-6 p-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <ClipboardList className="h-6 w-6 text-primary" />
            <div>
              <h1 className="text-2xl font-bold tracking-tight">Audit Log</h1>
              <p className="text-sm text-muted-foreground">
                Immutable record of all entity mutations across the platform
              </p>
            </div>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => refetch()}
            disabled={isFetching}
            className="gap-2"
          >
            <RefreshCw className={`h-4 w-4 ${isFetching ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        </div>

        {/* Filters */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium text-muted-foreground uppercase tracking-wide">
              Filters
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
              {/* Entity Type */}
              <Select
                value={entityType}
                onValueChange={(v) => setEntityType(v as EntityType | "all")}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Entity type" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All entity types</SelectItem>
                  {ENTITY_TYPES.map((et) => (
                    <SelectItem key={et} value={et}>
                      {et.replace(/_/g, " ")}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              {/* Action keyword */}
              <div className="relative">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  className="pl-8"
                  placeholder="Action keyword"
                  value={actionFilter}
                  onChange={(e) => setActionFilter(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && applyFilters()}
                />
              </div>

              {/* Actor ID */}
              <Input
                type="number"
                placeholder="Actor ID"
                value={actorIdFilter}
                onChange={(e) => setActorIdFilter(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && applyFilters()}
              />

              {/* From date */}
              <Input
                type="datetime-local"
                placeholder="From date"
                value={fromDate}
                onChange={(e) => setFromDate(e.target.value)}
              />

              {/* To date */}
              <Input
                type="datetime-local"
                placeholder="To date"
                value={toDate}
                onChange={(e) => setToDate(e.target.value)}
              />
            </div>

            <div className="flex items-center gap-2 mt-3">
              <Button size="sm" onClick={applyFilters} className="gap-2">
                <Search className="h-4 w-4" />
                Apply Filters
              </Button>
              {hasActiveFilters && (
                <Button size="sm" variant="ghost" onClick={clearFilters} className="gap-2">
                  <X className="h-4 w-4" />
                  Clear
                </Button>
              )}
              {data && (
                <span className="ml-auto text-sm text-muted-foreground">
                  {data.total.toLocaleString()} event{data.total !== 1 ? "s" : ""} found
                </span>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Table */}
        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-16">ID</TableHead>
                    <TableHead>Entity</TableHead>
                    <TableHead>Action</TableHead>
                    <TableHead>Actor</TableHead>
                    <TableHead>IP Address</TableHead>
                    <TableHead>Timestamp</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {isLoading ? (
                    Array.from({ length: 8 }).map((_, i) => (
                      <TableRow key={i}>
                        {Array.from({ length: 6 }).map((__, j) => (
                          <TableCell key={j}>
                            <Skeleton className="h-4 w-full" />
                          </TableCell>
                        ))}
                      </TableRow>
                    ))
                  ) : !data || data.rows.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={6} className="text-center py-12 text-muted-foreground">
                        {hasActiveFilters
                          ? "No audit events match the current filters."
                          : "No audit events recorded yet."}
                      </TableCell>
                    </TableRow>
                  ) : (
                    data.rows.map((row) => (
                      <TableRow key={row.id} className="hover:bg-muted/40">
                        <TableCell className="font-mono text-xs text-muted-foreground">
                          #{row.id}
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-col gap-1">
                            <Badge
                              variant="secondary"
                              className={`text-xs w-fit ${ENTITY_COLORS[row.entityType as EntityType] ?? ""}`}
                            >
                              {row.entityType.replace(/_/g, " ")}
                            </Badge>
                            <span className="font-mono text-xs text-muted-foreground">
                              id:{row.entityId}
                            </span>
                          </div>
                        </TableCell>
                        <TableCell>
                          <span className="font-medium text-sm">{row.action}</span>
                        </TableCell>
                        <TableCell>
                          {row.actorId ? (
                            <div className="text-sm">
                              <span className="font-medium">#{row.actorId}</span>
                              {row.actorType && (
                                <span className="text-muted-foreground ml-1">
                                  ({row.actorType})
                                </span>
                              )}
                            </div>
                          ) : (
                            <span className="text-muted-foreground text-sm">System</span>
                          )}
                        </TableCell>
                        <TableCell>
                          <span className="font-mono text-xs text-muted-foreground">
                            {row.ipAddress ?? "—"}
                          </span>
                        </TableCell>
                        <TableCell>
                          <span className="text-xs text-muted-foreground whitespace-nowrap">
                            {fmtDate(row.createdAt)}
                          </span>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>

        {/* Pagination */}
        {data && data.total > PAGE_SIZE && (
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">
              Page {page} of {totalPages}
            </span>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page <= 1 || isFetching}
              >
                <ChevronLeft className="h-4 w-4" />
                Previous
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page >= totalPages || isFetching}
              >
                Next
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}
