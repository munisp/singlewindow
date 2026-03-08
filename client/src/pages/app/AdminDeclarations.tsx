/**
 * Admin Declarations — All declarations across all traders.
 * Wired to real tRPC declarations.list.
 */
import { useState } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { trpc } from "@/lib/trpc";
import { useLocation } from "wouter";
import { ClipboardList, Search, Eye, RefreshCw } from "lucide-react";

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
  const [, setLocation] = useLocation();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [page, setPage] = useState(0);
  const PAGE_SIZE = 25;

  const { data, isLoading, refetch } = trpc.declarations.all.useQuery({
    limit: PAGE_SIZE,
    offset: page * PAGE_SIZE,
  });

  type DeclarationItem = NonNullable<typeof data>[number];
  const filtered = (data ?? []).filter((d: DeclarationItem) =>
    (statusFilter === "ALL" || d.status.toUpperCase() === statusFilter) &&
    (!search || d.declarationNumber.toLowerCase().includes(search.toLowerCase()) ||
    (d.goodsDescription ?? "").toLowerCase().includes(search.toLowerCase()))
  );

  return (
    <DashboardLayout title="All Declarations">
      <div className="space-y-6 max-w-7xl">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
              <ClipboardList className="h-6 w-6 text-primary" />
              All Declarations
            </h1>
            <p className="text-muted-foreground text-sm mt-1">
              System-wide declaration management — {data?.length ?? 0} loaded
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={() => refetch()} className="gap-1.5">
            <RefreshCw className="h-4 w-4" />
            Refresh
          </Button>
        </div>

        {/* Filters */}
        <div className="flex gap-3">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search by declaration number or trader..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9"
            />
          </div>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
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
                <p>No declarations found</p>
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
                          <Badge variant="outline" className={STATUS_COLORS[d.status] ?? ""}>
                            {d.status.replace(/_/g, " ")}
                          </Badge>
                        </td>
                        <td className="p-3">
                          {d.riskLane ? (
                            <Badge variant="outline" className={RISK_COLORS[d.riskLane] ?? ""}>
                              {d.riskLane}
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
        {(data?.length ?? 0) >= PAGE_SIZE && (
          <div className="flex items-center justify-between text-sm text-muted-foreground">
            <span>Page {page + 1}</span>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0}>
                Previous
              </Button>
              <Button variant="outline" size="sm" onClick={() => setPage(p => p + 1)} disabled={(data?.length ?? 0) < PAGE_SIZE}>
                Next
              </Button>
            </div>
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}
