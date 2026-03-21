/**
 * Admin Declarations — All declarations across all traders.
 * Wired to real tRPC declarations.all with server-side dateFrom/dateTo filtering.
 * Supports ?date=YYYY-MM-DD query param for drill-through from Pilot Dashboard trend chart.
 */
import { useState, useEffect, useMemo } from "react";
import { toast } from "sonner";
import DashboardLayout from "@/components/DashboardLayout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { trpc } from "@/lib/trpc";
import { useLocation } from "wouter";
import { ClipboardList, Search, Eye, RefreshCw, Download, CalendarDays, X } from "lucide-react";
import { ExportDeclarationsDialog } from "@/components/ExportDeclarationsDialog";

const RISK_COLORS: Record<string, string> = {
  GREEN: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
  YELLOW: "bg-amber-500/10 text-amber-400 border-amber-500/20",
  RED: "bg-red-500/10 text-red-400 border-red-500/20",
};

const STATUS_COLORS: Record<string, string> = {
  DRAFT: "bg-gray-500/10 text-gray-400 border-gray-500/20",
  SUBMITTED: "bg-blue-500/10 text-blue-400 border-blue-500/20",
  UNDER_REVIEW: "bg-amber-500/10 text-amber-400 border-amber-500/20",
  APPROVED: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
  REJECTED: "bg-red-500/10 text-red-400 border-red-500/20",
  CLEARED: "bg-teal-500/10 text-teal-400 border-teal-500/20",
};

export default function AdminDeclarations() {
  const [location, setLocation] = useLocation();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [page, setPage] = useState(0);
  const PAGE_SIZE = 25;

  // Date filter state — initialised from ?date= query param for drill-through
  const [dateFromStr, setDateFromStr] = useState<string>(() => {
    const params = new URLSearchParams(window.location.search);
    const d = params.get("date");
    return d ?? "";
  });
  const [dateToStr, setDateToStr] = useState<string>(() => {
    const params = new URLSearchParams(window.location.search);
    const d = params.get("date");
    return d ?? "";
  });

  // Sync date filter if URL changes (e.g., back navigation from drill-through)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const d = params.get("date");
    if (d) {
      setDateFromStr(d);
      setDateToStr(d);
    }
  }, [location]);

  // Convert string dates to Date objects for the tRPC query
  const dateFrom = useMemo(() => {
    if (!dateFromStr) return undefined;
    const d = new Date(dateFromStr + "T00:00:00.000Z");
    return isNaN(d.getTime()) ? undefined : d;
  }, [dateFromStr]);

  const dateTo = useMemo(() => {
    if (!dateToStr) return undefined;
    const d = new Date(dateToStr + "T23:59:59.999Z");
    return isNaN(d.getTime()) ? undefined : d;
  }, [dateToStr]);

  const isDrillThrough = !!(new URLSearchParams(window.location.search).get("date"));
  const hasDateFilter = !!(dateFromStr || dateToStr);

  const clearDateFilter = () => {
    setDateFromStr("");
    setDateToStr("");
    setPage(0);
    setLocation("/app/admin/declarations");
  };

  const { data: pageData, isLoading, refetch, isError } = trpc.declarations.all.useQuery({
    limit: PAGE_SIZE,
    status: statusFilter !== "ALL" ? statusFilter.toLowerCase() : undefined,
    dateFrom,
    dateTo,
  });

  const data = pageData?.items ?? [];
  const hasMore = pageData?.hasMore ?? false;

  type DeclarationItem = (typeof data)[number];

  // Client-side text search only (date/status filter is server-side)
  const filtered = data.filter((d: DeclarationItem) =>
    !search ||
    d.declarationNumber.toLowerCase().includes(search.toLowerCase()) ||
    (d.goodsDescription ?? "").toLowerCase().includes(search.toLowerCase())
  );

  return (
    <DashboardLayout title="All Declarations">
      {isError && (
        <div className="mx-6 mt-4 p-3 bg-red-50 border border-red-200 rounded text-red-700 text-sm">
          Failed to load data. Please refresh the page.
        </div>
      )}
      <div className="space-y-6 max-w-7xl">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
              <ClipboardList className="h-6 w-6 text-primary" />
              All Declarations
            </h1>
            <p className="text-muted-foreground text-sm mt-1">
              System-wide declaration management — {data.length} loaded
            </p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => refetch()} className="gap-1.5">
              <RefreshCw className="h-4 w-4" />
              Refresh
            </Button>
            <ExportDeclarationsDialog
              trigger={
                <Button variant="outline" size="sm" className="gap-1.5">
                  <Download className="h-4 w-4" />Export CSV/JSON
                </Button>
              }
            />
          </div>
        </div>

        {/* Date drill-through banner */}
        {isDrillThrough && (
          <div className="flex items-center gap-3 p-3 rounded-lg border border-blue-200 bg-blue-50/60 text-sm">
            <CalendarDays className="h-4 w-4 text-blue-600 shrink-0" />
            <span className="text-blue-800 font-medium">
              Filtered to declarations submitted on <strong>{dateFromStr}</strong>
            </span>
            <span className="text-blue-600 text-xs">
              — {filtered.length} result{filtered.length !== 1 ? "s" : ""} shown (server-side)
            </span>
            <Button
              variant="ghost"
              size="sm"
              className="ml-auto h-6 px-2 text-blue-700 hover:bg-blue-100"
              onClick={clearDateFilter}
            >
              <X className="h-3.5 w-3.5 mr-1" /> Clear filter
            </Button>
          </div>
        )}

        {/* Filters */}
        <div className="flex flex-wrap gap-3">
          <div className="relative flex-1 min-w-[200px] max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search by declaration number or goods..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9"
            />
          </div>
          <Select value={statusFilter} onValueChange={(v) => { setStatusFilter(v); setPage(0); }}>
            <SelectTrigger className="w-44">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">All Statuses</SelectItem>
              <SelectItem value="SUBMITTED">Submitted</SelectItem>
              <SelectItem value="UNDER_REVIEW">Under Review</SelectItem>
              <SelectItem value="APPROVED">Approved</SelectItem>
              <SelectItem value="REJECTED">Rejected</SelectItem>
              <SelectItem value="CLEARED">Cleared</SelectItem>
            </SelectContent>
          </Select>
          {/* Server-side date range pickers */}
          <div className="flex items-center gap-2">
            <CalendarDays className="h-4 w-4 text-muted-foreground shrink-0" />
            <Input
              type="date"
              value={dateFromStr}
              onChange={(e) => { setDateFromStr(e.target.value); setPage(0); }}
              className="w-36 text-sm"
              title="From date (submitted)"
            />
            <span className="text-muted-foreground text-xs">to</span>
            <Input
              type="date"
              value={dateToStr}
              onChange={(e) => { setDateToStr(e.target.value); setPage(0); }}
              className="w-36 text-sm"
              title="To date (submitted)"
            />
            {hasDateFilter && !isDrillThrough && (
              <Button variant="ghost" size="sm" className="h-8 px-2 text-muted-foreground" onClick={clearDateFilter}>
                <X className="h-3.5 w-3.5" />
              </Button>
            )}
          </div>
        </div>

        {/* Table */}
        <Card>
          <CardContent className="p-0">
            {isLoading ? (
              <div className="p-4 space-y-3">
                {Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}
              </div>
            ) : filtered.length === 0 ? (
              <div className="p-12 text-center text-muted-foreground">
                <ClipboardList className="h-12 w-12 mx-auto mb-3 opacity-30" />
                <p>No declarations found{hasDateFilter ? ` for the selected date range` : ""}</p>
                {hasDateFilter && (
                  <Button variant="link" size="sm" onClick={clearDateFilter} className="mt-2">
                    Clear date filter
                  </Button>
                )}
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b bg-muted/30">
                      <th className="text-left p-3 font-medium text-muted-foreground">Declaration #</th>
                      <th className="text-left p-3 font-medium text-muted-foreground">Origin</th>
                      <th className="text-left p-3 font-medium text-muted-foreground">HS Code</th>
                      <th className="text-left p-3 font-medium text-muted-foreground">Status</th>
                      <th className="text-left p-3 font-medium text-muted-foreground">Risk Lane</th>
                      <th className="text-left p-3 font-medium text-muted-foreground">Invoice Value</th>
                      <th className="text-left p-3 font-medium text-muted-foreground">Submitted</th>
                      <th className="p-3"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {filtered.map((d) => (
                      <tr key={d.id} className="hover:bg-muted/20 transition-colors">
                        <td className="p-3 font-mono text-xs font-medium">{d.declarationNumber}</td>
                        <td className="p-3 text-sm">{d.countryOfOrigin ?? "—"}</td>
                        <td className="p-3 font-mono text-xs">{d.hsCode ?? "—"}</td>
                        <td className="p-3">
                          <Badge variant="outline" className={STATUS_COLORS[d.status?.toUpperCase()] ?? ""}>
                            {d.status?.replace(/_/g, " ") ?? "—"}
                          </Badge>
                        </td>
                        <td className="p-3">
                          {d.riskLane ? (
                            <Badge variant="outline" className={RISK_COLORS[d.riskLane?.toUpperCase()] ?? ""}>
                              {d.riskLane?.toUpperCase()}
                            </Badge>
                          ) : "—"}
                        </td>
                        <td className="p-3 text-right font-mono text-xs">
                          {d.invoiceValue ? `$${Number(d.invoiceValue).toLocaleString()}` : "—"}
                        </td>
                        <td className="p-3 text-xs text-muted-foreground">
                          {d.submittedAt ? new Date(d.submittedAt).toLocaleDateString() : "—"}
                        </td>
                        <td className="p-3">
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => setLocation(`/app/customs/declarations/${d.id}`)}
                            className="gap-1"
                          >
                            <Eye className="h-3.5 w-3.5" />
                            View
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Pagination */}
        {hasMore && (
          <div className="flex items-center justify-between text-sm text-muted-foreground">
            <span>Showing {data.length} declarations</span>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0}>
                Previous
              </Button>
              <Button variant="outline" size="sm" onClick={() => setPage(p => p + 1)}>
                Next
              </Button>
            </div>
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}
