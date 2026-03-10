/**
 * Sprint 83/84 — Certificate Revocation Audit Log
 * Route: /app/admin/cert-revocations (admin-only)
 * Lists all revoked AfCFTA certificates with search + date-range filter.
 */
import { useState, useCallback } from "react";
import { trpc } from "@/lib/trpc";
import DashboardLayout from "@/components/DashboardLayout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Card, CardContent, CardHeader, CardTitle, CardDescription,
} from "@/components/ui/card";
import { Loader2, ShieldOff, ChevronLeft, ChevronRight, AlertTriangle, Search, X, Download } from "lucide-react";
import { toast } from "sonner";

const CERT_TYPE_LABELS: Record<string, string> = {
  afcfta_co: "AfCFTA CO",
  form_a: "Form A (GSP)",
  eur1: "EUR.1 (EU)",
  comesa_co: "COMESA CO",
  ecowas_co: "ECOWAS CO",
  bilateral_co: "Bilateral CO",
};

export default function CertRevocationLog() {
  const [page, setPage] = useState(1);
  const PAGE_SIZE = 25;

  // Filter state
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState<string | undefined>(undefined);
  const [revokedFrom, setRevokedFrom] = useState("");
  const [revokedTo, setRevokedTo] = useState("");

  const applyFilters = useCallback(() => {
    setPage(1);
    setSearch(searchInput.trim() || undefined);
  }, [searchInput]);

  const clearFilters = useCallback(() => {
    setSearchInput("");
    setSearch(undefined);
    setRevokedFrom("");
    setRevokedTo("");
    setPage(1);
  }, []);

  const hasActiveFilters = !!(search || revokedFrom || revokedTo);

  const exportCsvMutation = trpc.rulesOfOrigin.exportRevokedCsv.useMutation({
    onSuccess: (result) => {
      const blob = new Blob([result.csv], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = result.filename;
      a.click();
      URL.revokeObjectURL(url);
      toast.success(`Exported ${result.rowCount} records to CSV`);
    },
    onError: (e) => toast.error(e.message),
  });

  const { data, isLoading, isError } = trpc.rulesOfOrigin.listRevoked.useQuery(
    {
      page,
      pageSize: PAGE_SIZE,
      search: search || undefined,
      revokedFrom: revokedFrom ? new Date(revokedFrom) : undefined,
      revokedTo: revokedTo ? new Date(revokedTo + "T23:59:59") : undefined,
    },
    {}
  );

  return (
    <DashboardLayout title="Certificate Revocation Log">
      <div className="p-6 space-y-6">
        {/* Header */}
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-red-100">
            <ShieldOff className="h-5 w-5 text-red-600" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-foreground">Certificate Revocation Log</h1>
            <p className="text-sm text-muted-foreground">
              All revoked AfCFTA certificates of origin — admin audit trail
            </p>
          </div>
          {data && (
            <Badge variant="outline" className="ml-auto border-red-300 text-red-700 bg-red-50">
              {data.total} revoked
            </Badge>
          )}
        </div>

        {/* Search + Date Filters */}
        <Card>
          <CardContent className="p-4">
            <div className="flex flex-wrap gap-3 items-end">
              {/* Search */}
              <div className="flex-1 min-w-[200px]">
                <label className="text-xs font-medium text-muted-foreground mb-1 block">
                  Search (cert number / exporter / importer)
                </label>
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    className="pl-9"
                    placeholder="e.g. CO-1234 or Dangote…"
                    value={searchInput}
                    onChange={e => setSearchInput(e.target.value)}
                    onKeyDown={e => e.key === "Enter" && applyFilters()}
                  />
                </div>
              </div>
              {/* Revoked From */}
              <div className="min-w-[160px]">
                <label className="text-xs font-medium text-muted-foreground mb-1 block">Revoked from</label>
                <Input
                  type="date"
                  value={revokedFrom}
                  onChange={e => { setRevokedFrom(e.target.value); setPage(1); }}
                />
              </div>
              {/* Revoked To */}
              <div className="min-w-[160px]">
                <label className="text-xs font-medium text-muted-foreground mb-1 block">Revoked to</label>
                <Input
                  type="date"
                  value={revokedTo}
                  onChange={e => { setRevokedTo(e.target.value); setPage(1); }}
                />
              </div>
              {/* Actions */}
              <div className="flex gap-2">
                <Button onClick={applyFilters} size="sm">
                  <Search className="h-4 w-4 mr-1" /> Search
                </Button>
                {hasActiveFilters && (
                  <Button variant="outline" size="sm" onClick={clearFilters}>
                    <X className="h-4 w-4 mr-1" /> Clear
                  </Button>
                )}
                <Button
                  variant="outline"
                  size="sm"
                  disabled={exportCsvMutation.isPending}
                  onClick={() => exportCsvMutation.mutate({
                    search: search || undefined,
                    revokedFrom: revokedFrom ? new Date(revokedFrom) : undefined,
                    revokedTo: revokedTo ? new Date(revokedTo + 'T23:59:59') : undefined,
                  })}
                >
                  {exportCsvMutation.isPending
                    ? <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                    : <Download className="h-4 w-4 mr-1" />}
                  Export CSV
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Loading */}
        {isLoading && (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        )}

        {/* Error */}
        {isError && (
          <Card className="border-red-200 bg-red-50">
            <CardContent className="p-6 flex items-center gap-3">
              <AlertTriangle className="h-5 w-5 text-red-500 shrink-0" />
              <p className="text-red-700 text-sm">Failed to load revocation log. Please try again.</p>
            </CardContent>
          </Card>
        )}

        {/* Empty state */}
        {!isLoading && !isError && data?.rows.length === 0 && (
          <Card>
            <CardContent className="p-12 text-center">
              <ShieldOff className="h-10 w-10 text-muted-foreground mx-auto mb-3 opacity-40" />
              <p className="text-muted-foreground font-medium">
                {hasActiveFilters ? "No matching revocations" : "No revoked certificates"}
              </p>
              <p className="text-sm text-muted-foreground mt-1">
                {hasActiveFilters
                  ? "Try adjusting your search or date filters."
                  : "Revoked certificates will appear here with their revocation reason and officer details."}
              </p>
              {hasActiveFilters && (
                <Button variant="outline" size="sm" className="mt-4" onClick={clearFilters}>
                  Clear filters
                </Button>
              )}
            </CardContent>
          </Card>
        )}

        {/* Table */}
        {!isLoading && !isError && data && data.rows.length > 0 && (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Revoked Certificates</CardTitle>
              <CardDescription>
                Showing {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, data.total)} of {data.total} records
                {hasActiveFilters && " (filtered)"}
              </CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b bg-muted/30">
                      <th className="text-left px-4 py-3 font-medium text-muted-foreground">Cert Number</th>
                      <th className="text-left px-4 py-3 font-medium text-muted-foreground">Type</th>
                      <th className="text-left px-4 py-3 font-medium text-muted-foreground">Exporter</th>
                      <th className="text-left px-4 py-3 font-medium text-muted-foreground">Origin</th>
                      <th className="text-left px-4 py-3 font-medium text-muted-foreground">Approved</th>
                      <th className="text-left px-4 py-3 font-medium text-muted-foreground">Revoked</th>
                      <th className="text-left px-4 py-3 font-medium text-muted-foreground">Officer ID</th>
                      <th className="text-left px-4 py-3 font-medium text-muted-foreground">Reason</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.rows.map((row, idx) => (
                      <tr
                        key={row.id}
                        className={`border-b last:border-0 ${idx % 2 === 0 ? "" : "bg-muted/10"}`}
                      >
                        <td className="px-4 py-3">
                          <span className="font-mono text-xs bg-red-50 text-red-800 px-2 py-0.5 rounded border border-red-200">
                            {row.certNumber}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <Badge variant="outline" className="text-xs">
                            {CERT_TYPE_LABELS[row.certType ?? ""] ?? row.certType}
                          </Badge>
                        </td>
                        <td className="px-4 py-3 max-w-[160px] truncate" title={row.exporterName ?? ""}>
                          {row.exporterName ?? "—"}
                        </td>
                        <td className="px-4 py-3 font-mono text-xs text-muted-foreground">
                          {row.originCountry ?? "—"}
                        </td>
                        <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">
                          {row.approvedAt ? new Date(row.approvedAt).toLocaleDateString() : "—"}
                        </td>
                        <td className="px-4 py-3 text-xs text-red-700 whitespace-nowrap">
                          {row.revokedAt ? new Date(row.revokedAt).toLocaleString() : "—"}
                        </td>
                        <td className="px-4 py-3 text-xs font-mono text-muted-foreground">
                          {row.revokedBy ?? "—"}
                        </td>
                        <td className="px-4 py-3 max-w-[220px]">
                          <p className="text-xs text-muted-foreground line-clamp-2" title={row.revocationReason ?? ""}>
                            {row.revocationReason ?? "—"}
                          </p>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Pagination */}
              {data.totalPages > 1 && (
                <div className="flex items-center justify-between px-4 py-3 border-t">
                  <p className="text-xs text-muted-foreground">
                    Page {data.page} of {data.totalPages}
                  </p>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={page === 1}
                      onClick={() => setPage(p => p - 1)}
                    >
                      <ChevronLeft className="h-4 w-4" />
                      Prev
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={page >= data.totalPages}
                      onClick={() => setPage(p => p + 1)}
                    >
                      Next
                      <ChevronRight className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        )}
      </div>
    </DashboardLayout>
  );
}
