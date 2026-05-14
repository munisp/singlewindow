import DashboardLayout from "@/components/DashboardLayout";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { trpc } from "@/lib/trpc";
import {
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  RefreshCw,
  Search,
  X,
  Monitor,
  Globe,
  ArrowRight,
  Download,
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

type AuditRow = {
  id: number;
  entityType: string;
  entityId: number;
  action: string;
  actorId: number | null;
  actorType: string | null;
  ipAddress: string | null;
  userAgent: string | null;
  previousState: unknown;
  newState: unknown;
  metadata: unknown;
  createdAt: Date | string | null;
};

// ─── HELPERS ──────────────────────────────────────────────────────────────────

function fmtDate(d: Date | string | null | undefined): string {
  if (!d) return "—";
  return new Date(d).toLocaleString(undefined, {
    year: "numeric", month: "short", day: "numeric",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  });
}

function prettyJson(val: unknown): string {
  if (val === null || val === undefined) return "null";
  try {
    return JSON.stringify(val, null, 2);
  } catch {
    return String(val);
  }
}

// ─── JSON DIFF BLOCK ──────────────────────────────────────────────────────────

function JsonBlock({ label, value, color }: { label: string; value: unknown; color: string }) {
  const text = prettyJson(value);
  const isEmpty = value === null || value === undefined ||
    (typeof value === "object" && Object.keys(value as object).length === 0);

  return (
    <div className="flex-1 min-w-0">
      <div className={`text-xs font-semibold uppercase tracking-wide mb-1 ${color}`}>{label}</div>
      {isEmpty ? (
        <div className="text-xs text-muted-foreground italic bg-muted/40 rounded p-3">
          (empty)
        </div>
      ) : (
        <pre className="text-xs bg-muted/40 rounded p-3 overflow-auto max-h-64 whitespace-pre-wrap break-all font-mono leading-relaxed">
          {text}
        </pre>
      )}
    </div>
  );
}

// ─── DETAIL DRAWER ────────────────────────────────────────────────────────────

function AuditDetailDrawer({
  row,
  open,
  onClose,
}: {
  row: AuditRow | null;
  open: boolean;
  onClose: () => void;
}) {
  if (!row) return null;

  const hasDiff = row.previousState !== null || row.newState !== null;
  const hasMetadata = row.metadata !== null && row.metadata !== undefined &&
    typeof row.metadata === "object" && Object.keys(row.metadata as object).length > 0;

  return (
    <Sheet open={open} onOpenChange={(v) => !v && onClose()}>
      <SheetContent side="right" className="w-full sm:max-w-2xl overflow-y-auto">
        <SheetHeader className="pb-4 border-b">
          <SheetTitle className="flex items-center gap-2 text-base">
            <ClipboardList className="h-4 w-4 text-primary" />
            Audit Event #{row.id}
          </SheetTitle>
          <SheetDescription className="text-xs text-muted-foreground">
            {fmtDate(row.createdAt)}
          </SheetDescription>
        </SheetHeader>

        <div className="space-y-5 pt-5">
          {/* Core fields */}
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div>
              <div className="text-xs text-muted-foreground uppercase tracking-wide mb-1">Entity</div>
              <div className="flex items-center gap-2">
                <Badge
                  variant="secondary"
                  className={`text-xs ${ENTITY_COLORS[row.entityType as EntityType] ?? ""}`}
                >
                  {row.entityType.replace(/_/g, " ")}
                </Badge>
                <span className="font-mono text-xs text-muted-foreground">id:{row.entityId}</span>
              </div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground uppercase tracking-wide mb-1">Action</div>
              <span className="font-semibold">{row.action}</span>
            </div>
            <div>
              <div className="text-xs text-muted-foreground uppercase tracking-wide mb-1">Actor</div>
              {row.actorId ? (
                <span>
                  <span className="font-medium">#{row.actorId}</span>
                  {row.actorType && (
                    <span className="text-muted-foreground ml-1">({row.actorType})</span>
                  )}
                </span>
              ) : (
                <span className="text-muted-foreground italic">System</span>
              )}
            </div>
            <div>
              <div className="text-xs text-muted-foreground uppercase tracking-wide mb-1">Timestamp</div>
              <span className="text-xs">{fmtDate(row.createdAt)}</span>
            </div>
          </div>

          {/* Network info */}
          {(row.ipAddress || row.userAgent) && (
            <div className="border rounded-md p-3 space-y-2">
              <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Network
              </div>
              {row.ipAddress && (
                <div className="flex items-center gap-2 text-sm">
                  <Globe className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                  <span className="font-mono text-xs">{row.ipAddress}</span>
                </div>
              )}
              {row.userAgent && (
                <div className="flex items-start gap-2 text-sm">
                  <Monitor className="h-3.5 w-3.5 text-muted-foreground shrink-0 mt-0.5" />
                  <span className="text-xs text-muted-foreground break-all">{row.userAgent}</span>
                </div>
              )}
            </div>
          )}

          {/* State diff */}
          {hasDiff && (
            <div>
              <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-3">
                State Change
              </div>
              <div className="flex gap-3 items-start">
                <JsonBlock label="Before" value={row.previousState} color="text-red-600" />
                <div className="flex items-center pt-6 shrink-0">
                  <ArrowRight className="h-4 w-4 text-muted-foreground" />
                </div>
                <JsonBlock label="After" value={row.newState} color="text-emerald-600" />
              </div>
            </div>
          )}

          {/* Metadata */}
          {hasMetadata && (
            <div>
              <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
                Metadata
              </div>
              <pre className="text-xs bg-muted/40 rounded p-3 overflow-auto max-h-48 whitespace-pre-wrap break-all font-mono leading-relaxed">
                {prettyJson(row.metadata)}
              </pre>
            </div>
          )}

          {!hasDiff && !hasMetadata && (
            <div className="text-sm text-muted-foreground italic text-center py-4">
              No state change or metadata recorded for this event.
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

// ─── MAIN COMPONENT ───────────────────────────────────────────────────────────

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

  // Drawer state
  const [selectedRow, setSelectedRow] = useState<AuditRow | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);

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

  const openDrawer = useCallback((row: AuditRow) => {
    setSelectedRow(row);
    setDrawerOpen(true);
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
                Immutable record of all entity mutations — click any row to inspect the full state diff
              </p>
            </div>
          </div>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              className="gap-2"
              onClick={() => {
                const rows = data?.rows ?? [];
                if (rows.length === 0) { toast.error("No data to export"); return; }
                const headers = ["id","entityType","entityId","action","actorId","actorType","ipAddress","createdAt"];
                const csv = [
                  headers.join(","),
                  ...rows.map((r: any) => headers.map(h => JSON.stringify(r[h] ?? "")).join(",")),
                ].join("\n");
                const blob = new Blob([csv], { type: "text/csv" });
                const url = URL.createObjectURL(blob);
                const a = document.createElement("a");
                a.href = url;
                a.download = `audit-log-${new Date().toISOString().slice(0,10)}.csv`;
                a.click();
                URL.revokeObjectURL(url);
              }}
            >
              <Download className="h-4 w-4" />
              Export CSV
            </Button>
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

              <Input
                type="number"
                placeholder="Actor ID"
                value={actorIdFilter}
                onChange={(e) => setActorIdFilter(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && applyFilters()}
              />

              <Input
                type="datetime-local"
                placeholder="From date"
                value={fromDate}
                onChange={(e) => setFromDate(e.target.value)}
              />

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
                    <TableHead className="w-20 text-right">Details</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {isLoading ? (
                    Array.from({ length: 8 }).map((_, i) => (
                      <TableRow key={i}>
                        {Array.from({ length: 7 }).map((__, j) => (
                          <TableCell key={j}>
                            <Skeleton className="h-4 w-full" />
                          </TableCell>
                        ))}
                      </TableRow>
                    ))
                  ) : !data || data.rows.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={7} className="text-center py-12 text-muted-foreground">
                        {hasActiveFilters
                          ? "No audit events match the current filters."
                          : "No audit events recorded yet."}
                      </TableCell>
                    </TableRow>
                  ) : (
                    data.rows.map((row) => (
                      <TableRow
                        key={row.id}
                        className="hover:bg-muted/40 cursor-pointer"
                        onClick={() => openDrawer(row as AuditRow)}
                      >
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
                        <TableCell className="text-right">
                          {(row.previousState !== null || row.newState !== null || row.metadata !== null) ? (
                            <Badge variant="outline" className="text-xs cursor-pointer">
                              View diff
                            </Badge>
                          ) : (
                            <span className="text-xs text-muted-foreground">—</span>
                          )}
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

      {/* Detail drawer */}
      <AuditDetailDrawer
        row={selectedRow}
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
      />
    </DashboardLayout>
  );
}
