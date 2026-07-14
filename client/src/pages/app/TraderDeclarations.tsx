/**
 * Trader Declarations List — server-side search + status filter, debounced
 */
import { useState, useEffect } from "react";
import { toast } from "sonner";
import DashboardLayout from "@/components/DashboardLayout";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { FileText, Plus, RefreshCw, Download, Upload, Search, X, History, CheckCircle2, Clock, XCircle } from "lucide-react";
import { ExportDeclarationsDialog } from "@/components/ExportDeclarationsDialog";
import { BulkImportDialog } from "@/components/BulkImportDialog";
import { useLocation } from "wouter";

const LANE_STYLES: Record<string, string> = {
  green: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
  yellow: "bg-amber-500/10 text-amber-400 border-amber-500/20",
  red: "bg-red-500/10 text-red-400 border-red-500/20",
  blue: "bg-blue-500/10 text-blue-400 border-blue-500/20",
};

const STATUS_STYLES: Record<string, string> = {
  draft: "bg-gray-500/10 text-gray-400 border-gray-500/20",
  submitted: "bg-blue-500/10 text-blue-400 border-blue-500/20",
  under_review: "bg-amber-500/10 text-amber-400 border-amber-500/20",
  green_lane: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
  yellow_lane: "bg-amber-500/10 text-amber-400 border-amber-500/20",
  red_lane: "bg-red-500/10 text-red-400 border-red-500/20",
  cleared: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
  rejected: "bg-red-500/10 text-red-400 border-red-500/20",
  held: "bg-orange-500/10 text-orange-400 border-orange-500/20",
};

const STATUS_OPTIONS = [
  { value: "ALL", label: "All Statuses" },
  { value: "draft", label: "Draft" },
  { value: "submitted", label: "Submitted" },
  { value: "under_review", label: "Under Review" },
  { value: "green_lane", label: "Green Lane" },
  { value: "yellow_lane", label: "Yellow Lane" },
  { value: "red_lane", label: "Red Lane" },
  { value: "cleared", label: "Cleared" },
  { value: "rejected", label: "Rejected" },
  { value: "held", label: "Held" },
];

export default function TraderDeclarations() {
  const [, navigate] = useLocation();
  const [searchInput, setSearchInput] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [offset, setOffset] = useState(0);
  const PAGE_SIZE = 25;

  // 350ms debounce for search
  useEffect(() => {
    const t = setTimeout(() => {
      setDebouncedSearch(searchInput);
      setOffset(0); // reset pagination on new search
    }, 350);
    return () => clearTimeout(t);
  }, [searchInput]);

  // Reset offset when status filter changes
  useEffect(() => { setOffset(0); }, [statusFilter]);

  const { data, isLoading, refetch, isError, isFetching } = trpc.declarations.myDeclarations.useQuery({
    limit: PAGE_SIZE,
    offset,
    search: debouncedSearch || undefined,
    status: statusFilter !== "ALL" ? statusFilter : undefined,
  });

  const hasResults = (data?.length ?? 0) > 0;
  const hasMore = (data?.length ?? 0) === PAGE_SIZE;

  return (
    <DashboardLayout title="My Declarations">
      {isError && (
        <div className="mx-6 mt-4 p-3 bg-red-50 border border-red-200 rounded text-red-700 text-sm">
          Failed to load data. Please refresh the page.
        </div>
      )}
      <div className="space-y-4 max-w-6xl">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h1 className="text-xl sm:text-2xl font-bold tracking-tight flex items-center gap-2">
              <FileText className="h-5 w-5 sm:h-6 sm:w-6 text-primary" />My Declarations
            </h1>
            <p className="text-muted-foreground text-xs sm:text-sm mt-0.5">
              All your import and export declarations
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" onClick={() => refetch()} className="gap-1.5">
              <RefreshCw className={`h-4 w-4 ${isFetching ? "animate-spin" : ""}`} />
              <span className="hidden sm:inline">Refresh</span>
            </Button>
            <ExportDeclarationsDialog
              trigger={
                <Button variant="outline" size="sm" className="gap-1.5">
                  <Download className="h-4 w-4" /><span className="hidden sm:inline">Export</span>
                </Button>
              }
            />
            <BulkImportDialog
              trigger={
                <Button variant="outline" size="sm" className="gap-1.5">
                  <Upload className="h-4 w-4" /><span className="hidden sm:inline">Import CSV</span>
                </Button>
              }
              onSuccess={() => refetch()}
            />
            <Button size="sm" onClick={() => navigate("/app/trader/declarations/new")} className="gap-1.5">
              <Plus className="h-4 w-4" /><span className="hidden sm:inline">New Declaration</span>
            </Button>
          </div>
        </div>

        {/* Quick-filter status pills */}
        <div className="flex flex-wrap gap-2">
          {[
            { value: "ALL", label: "All", icon: null },
            { value: "submitted", label: "Submitted", icon: <Clock className="h-3 w-3" /> },
            { value: "under_review", label: "Under Review", icon: <Search className="h-3 w-3" /> },
            { value: "green_lane", label: "Green Lane", icon: <CheckCircle2 className="h-3 w-3" /> },
            { value: "yellow_lane", label: "Yellow Lane", icon: <Clock className="h-3 w-3" /> },
            { value: "red_lane", label: "Red Lane", icon: <XCircle className="h-3 w-3" /> },
            { value: "cleared", label: "Cleared", icon: <CheckCircle2 className="h-3 w-3" /> },
            { value: "rejected", label: "Rejected", icon: <XCircle className="h-3 w-3" /> },
          ].map(pill => (
            <button
              key={pill.value}
              onClick={() => setStatusFilter(pill.value)}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium border transition-all ${
                statusFilter === pill.value
                  ? "bg-primary text-primary-foreground border-primary shadow-sm"
                  : "bg-muted/40 text-muted-foreground border-border hover:bg-muted hover:text-foreground"
              }`}
            >
              {pill.icon}
              {pill.label}
              {statusFilter === pill.value && pill.value !== "ALL" && data && (
                <span className="ml-0.5 bg-primary-foreground/20 text-primary-foreground rounded-full px-1.5 py-0 text-[10px] font-bold">
                  {data.length}{hasMore ? "+" : ""}
                </span>
              )}
            </button>
          ))}
        </div>

        {/* Search + Filter bar */}
        <div className="flex flex-col sm:flex-row gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
            <Input
              placeholder="Search by declaration #, UCR, goods, or importer…"
              value={searchInput}
              onChange={e => setSearchInput(e.target.value)}
              className="pl-9 pr-8 h-9 text-sm"
            />
            {searchInput && (
              <button
                onClick={() => setSearchInput("")}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="h-9 w-full sm:w-44 text-sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {STATUS_OPTIONS.map(o => (
                <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Table */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              Declarations
              {isFetching && <span className="h-3.5 w-3.5 border-2 border-primary border-t-transparent rounded-full animate-spin" />}
              {!isFetching && <span className="text-muted-foreground font-normal text-sm">({data?.length ?? 0}{hasMore ? "+" : ""})</span>}
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {isLoading ? (
              <div className="p-4 space-y-2">{Array.from({length:8}).map((_,i)=><Skeleton key={i} className="h-12 w-full"/>)}</div>
            ) : !hasResults ? (
              <div className="p-12 text-center text-muted-foreground">
                <FileText className="h-12 w-12 mx-auto mb-3 opacity-30" />
                {debouncedSearch || statusFilter !== "ALL" ? (
                  <>
                    <p className="mb-2 font-medium">No declarations match your search</p>
                    <p className="text-xs mb-4">Try adjusting the search term or status filter</p>
                    <Button variant="outline" size="sm" onClick={() => { setSearchInput(""); setStatusFilter("ALL"); }}>
                      Clear filters
                    </Button>
                  </>
                ) : (
                  <>
                    <p className="mb-4">No declarations yet</p>
                    <Button onClick={() => navigate("/app/trader/declarations/new")} className="gap-1.5">
                      <Plus className="h-4 w-4" />Submit First Declaration
                    </Button>
                  </>
                )}
              </div>
            ) : (
              <>
                {/* Desktop table */}
                <div className="hidden sm:block overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead><tr className="border-b bg-muted/30">
                      <th className="text-left p-3 font-medium text-muted-foreground">Declaration #</th>
                      <th className="text-left p-3 font-medium text-muted-foreground">UCR</th>
                      <th className="text-left p-3 font-medium text-muted-foreground">Type</th>
                      <th className="text-left p-3 font-medium text-muted-foreground">HS Code</th>
                      <th className="text-left p-3 font-medium text-muted-foreground">Origin</th>
                      <th className="text-left p-3 font-medium text-muted-foreground">Value (USD)</th>
                      <th className="text-left p-3 font-medium text-muted-foreground">Status</th>
                      <th className="text-left p-3 font-medium text-muted-foreground">Lane</th>
                      <th className="text-left p-3 font-medium text-muted-foreground">Date</th>
                    </tr></thead>
                    <tbody className="divide-y">
                      {data?.map((d: any) => (
                        <tr
                          key={d.id}
                          className="hover:bg-muted/20 cursor-pointer"
                          onClick={() => navigate(`/app/trader/declarations/${d.id}`)}
                        >
                          <td className="p-3 font-mono text-xs font-semibold">{d.declarationNumber}</td>
                          <td className="p-3 font-mono text-xs text-muted-foreground">{d.ucr ?? "—"}</td>
                          <td className="p-3 text-xs capitalize">{d.declarationType}</td>
                          <td className="p-3 font-mono text-xs">{d.hsCode}</td>
                          <td className="p-3 text-xs">{d.countryOfOrigin}</td>
                          <td className="p-3 font-semibold">{Number(d.invoiceValue ?? 0).toLocaleString()}</td>
                          <td className="p-3"><Badge variant="outline" className={STATUS_STYLES[d.status] ?? ""}>{d.status?.replace(/_/g, " ")}</Badge></td>
                          <td className="p-3">{d.riskLane ? <Badge variant="outline" className={LANE_STYLES[d.riskLane] ?? ""}>{d.riskLane.toUpperCase()}</Badge> : "—"}</td>
                          <td className="p-3 text-xs text-muted-foreground">{d.createdAt ? new Date(d.createdAt).toLocaleDateString() : "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* Mobile card list */}
                <div className="sm:hidden divide-y">
                  {data?.map((d: any) => (
                    <div
                      key={d.id}
                      className="p-4 hover:bg-muted/20 cursor-pointer"
                      onClick={() => navigate(`/app/trader/declarations/${d.id}`)}
                    >
                      <div className="flex items-start justify-between gap-2 mb-1.5">
                        <span className="font-mono text-xs font-semibold">{d.declarationNumber}</span>
                        <div className="flex gap-1.5 shrink-0">
                          <Badge variant="outline" className={`text-[10px] px-1.5 py-0 ${STATUS_STYLES[d.status] ?? ""}`}>
                            {d.status?.replace(/_/g, " ")}
                          </Badge>
                          {d.riskLane && (
                            <Badge variant="outline" className={`text-[10px] px-1.5 py-0 ${LANE_STYLES[d.riskLane] ?? ""}`}>
                              {d.riskLane.toUpperCase()}
                            </Badge>
                          )}
                        </div>
                      </div>
                      <p className="text-xs text-muted-foreground truncate">{d.goodsDescription || d.hsCode}</p>
                      <div className="flex items-center justify-between mt-1.5">
                        <span className="text-xs text-muted-foreground">{d.countryOfOrigin} · {d.portOfEntry}</span>
                        <span className="text-xs font-medium">${Number(d.invoiceValue ?? 0).toLocaleString()}</span>
                      </div>
                    </div>
                  ))}
                </div>

                {/* Pagination */}
                <div className="p-4 border-t flex items-center justify-between text-sm text-muted-foreground">
                  <span>Showing {offset + 1}–{offset + (data?.length ?? 0)}</span>
                  <div className="flex gap-2">
                    <Button variant="outline" size="sm" onClick={() => setOffset(o => Math.max(0, o - PAGE_SIZE))} disabled={offset === 0}>
                      Previous
                    </Button>
                    <Button variant="outline" size="sm" onClick={() => setOffset(o => o + PAGE_SIZE)} disabled={!hasMore}>
                      Next
                    </Button>
                  </div>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Amendment History */}
      <AmendmentHistoryCard />
    </DashboardLayout>
  );
}

const AMENDMENT_STATUS_STYLES: Record<string, string> = {
  pending: "bg-amber-50 text-amber-700 border-amber-200",
  approved: "bg-emerald-50 text-emerald-700 border-emerald-200",
  rejected: "bg-red-50 text-red-700 border-red-200",
};

const AMENDMENT_STATUS_ICONS: Record<string, React.ReactNode> = {
  pending: <Clock className="h-3 w-3" />,
  approved: <CheckCircle2 className="h-3 w-3" />,
  rejected: <XCircle className="h-3 w-3" />,
};

function AmendmentHistoryCard() {
  const { data: amendments, isLoading } = trpc.declarationAmendments.listMine.useQuery();
  if (!isLoading && (!amendments || amendments.length === 0)) return null;
  return (
    <div className="max-w-6xl mt-2">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <History className="h-4 w-4 text-primary" />
            My Amendment Requests
            {amendments && amendments.length > 0 && (
              <span className="text-muted-foreground font-normal text-sm">({amendments.length})</span>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-4 space-y-2">{Array.from({length:3}).map((_,i)=><Skeleton key={i} className="h-10 w-full"/>)}</div>
          ) : (
            <div className="divide-y">
              {amendments?.map((a: any) => (
                <div key={a.id} className="px-4 py-3 flex items-start gap-3">
                  <Badge variant="outline" className={`text-[10px] px-1.5 py-0.5 flex items-center gap-1 shrink-0 ${AMENDMENT_STATUS_STYLES[a.status] ?? ""}`}>
                    {AMENDMENT_STATUS_ICONS[a.status]}
                    {a.status}
                  </Badge>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium">Declaration #{a.declarationId} — {a.reason}</p>
                    {a.reviewNotes && <p className="text-xs text-muted-foreground mt-0.5">Review notes: {a.reviewNotes}</p>}
                  </div>
                  <span className="text-xs text-muted-foreground shrink-0">{new Date(a.createdAt).toLocaleDateString()}</span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
