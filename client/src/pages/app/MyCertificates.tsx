import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { Award, Download, Search, FileText, RefreshCw, ExternalLink } from "lucide-react";
import { toast } from "sonner";

export default function MyCertificates() {
  const { user } = useAuth();
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const PAGE_SIZE = 20;

  const { data, isLoading, refetch } = trpc.declarations.listMyCertificates.useQuery({
    limit: PAGE_SIZE,
    offset: page * PAGE_SIZE,
  });

  const certificates = data?.certificates ?? [];

  const filtered = certificates.filter((c) =>
    !search ||
    c.declarationRef.toLowerCase().includes(search.toLowerCase()) ||
    (c.goodsDescription ?? "").toLowerCase().includes(search.toLowerCase())
  );

  function formatDate(ts: Date | string | null | undefined) {
    if (!ts) return "—";
    return new Date(ts).toLocaleDateString("en-GB", {
      day: "2-digit", month: "short", year: "numeric",
    });
  }

  function formatCurrency(amount: string | null | undefined, currency: string | null | undefined) {
    if (!amount) return "—";
    const num = parseFloat(amount);
    return `${currency ?? "USD"} ${num.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }

  function handleDownload(cert: typeof certificates[0]) {
    window.open(cert.fileUrl, "_blank");
    toast.success(`Opening certificate for ${cert.declarationRef}`);
  }

  return (
    <DashboardLayout>
      <div className="p-6 space-y-6 max-w-6xl mx-auto">
        {/* Header */}
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <div className="flex items-center gap-3 mb-1">
              <div className="p-2 bg-amber-500/10 rounded-lg">
                <Award className="h-6 w-6 text-amber-500" />
              </div>
              <h1 className="text-2xl font-bold text-foreground">Clearance Certificates</h1>
            </div>
            <p className="text-muted-foreground text-sm ml-14">
              Download official customs clearance certificates for your released shipments.
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={() => refetch()} className="gap-2">
            <RefreshCw className="h-4 w-4" />
            Refresh
          </Button>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <Card className="border-border/50">
            <CardContent className="pt-5">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-green-500/10 rounded-lg">
                  <Award className="h-5 w-5 text-green-500" />
                </div>
                <div>
                  <p className="text-2xl font-bold">{data?.total ?? 0}</p>
                  <p className="text-xs text-muted-foreground">Total Certificates</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card className="border-border/50">
            <CardContent className="pt-5">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-blue-500/10 rounded-lg">
                  <FileText className="h-5 w-5 text-blue-500" />
                </div>
                <div>
                  <p className="text-2xl font-bold">
                    {certificates.filter((c) => {
                      const d = new Date(c.generatedAt);
                      const now = new Date();
                      return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
                    }).length}
                  </p>
                  <p className="text-xs text-muted-foreground">Issued This Month</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card className="border-border/50">
            <CardContent className="pt-5">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-purple-500/10 rounded-lg">
                  <Download className="h-5 w-5 text-purple-500" />
                </div>
                <div>
                  <p className="text-2xl font-bold">{filtered.length}</p>
                  <p className="text-xs text-muted-foreground">Matching Filter</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Search & Table */}
        <Card className="border-border/50">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between gap-4 flex-wrap">
              <div>
                <CardTitle className="text-base">Certificate Archive</CardTitle>
                <CardDescription>All clearance certificates issued for your shipments</CardDescription>
              </div>
              <div className="relative w-64">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search by reference or goods…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="pl-9 h-8 text-sm"
                />
              </div>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            {isLoading ? (
              <div className="p-6 space-y-3">
                {Array.from({ length: 5 }).map((_, i) => (
                  <Skeleton key={i} className="h-10 w-full" />
                ))}
              </div>
            ) : filtered.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-center">
                <Award className="h-12 w-12 text-muted-foreground/30 mb-4" />
                <p className="text-muted-foreground font-medium">No certificates found</p>
                <p className="text-sm text-muted-foreground/70 mt-1">
                  {search
                    ? "Try a different search term."
                    : "Certificates are issued automatically when a shipment is cleared by customs."}
                </p>
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead>Declaration Ref</TableHead>
                    <TableHead>Goods Description</TableHead>
                    <TableHead>Total Duties Paid</TableHead>
                    <TableHead>Date Cleared</TableHead>
                    <TableHead>Certificate Issued</TableHead>
                    <TableHead>Format</TableHead>
                    <TableHead className="text-right">Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((cert) => {
                    const isPdf = cert.fileUrl.endsWith(".pdf");
                    return (
                      <TableRow key={cert.id} className="hover:bg-muted/30">
                        <TableCell className="font-mono text-sm font-medium text-primary">
                          {cert.declarationRef}
                        </TableCell>
                        <TableCell className="max-w-[200px] truncate text-sm text-muted-foreground">
                          {cert.goodsDescription ?? "—"}
                        </TableCell>
                        <TableCell className="text-sm font-medium">
                          {formatCurrency(cert.totalDutyPaid, cert.currency)}
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {formatDate(cert.clearedAt)}
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {formatDate(cert.generatedAt)}
                        </TableCell>
                        <TableCell>
                          <Badge
                            variant="outline"
                            className={isPdf
                              ? "border-red-500/30 text-red-400 bg-red-500/5"
                              : "border-blue-500/30 text-blue-400 bg-blue-500/5"}
                          >
                            {isPdf ? "PDF" : "HTML"}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right">
                          <Button
                            size="sm"
                            variant="outline"
                            className="gap-1.5 h-7 text-xs"
                            onClick={() => handleDownload(cert)}
                          >
                            <ExternalLink className="h-3 w-3" />
                            Open
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        {/* Pagination */}
        {(data?.total ?? 0) > PAGE_SIZE && (
          <div className="flex items-center justify-between text-sm text-muted-foreground">
            <span>
              Showing {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, data?.total ?? 0)} of {data?.total ?? 0}
            </span>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPage((p) => Math.max(0, p - 1))}
                disabled={page === 0}
              >
                Previous
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPage((p) => p + 1)}
                disabled={(page + 1) * PAGE_SIZE >= (data?.total ?? 0)}
              >
                Next
              </Button>
            </div>
          </div>
        )}

        {/* Help note */}
        <Card className="border-amber-500/20 bg-amber-500/5">
          <CardContent className="pt-4 pb-4">
            <div className="flex gap-3">
              <Award className="h-5 w-5 text-amber-500 flex-shrink-0 mt-0.5" />
              <div className="text-sm">
                <p className="font-medium text-foreground mb-1">About Clearance Certificates</p>
                <p className="text-muted-foreground">
                  Clearance certificates are official documents confirming that your goods have been assessed,
                  all applicable duties paid, and the shipment released by the National Customs Authority.
                  They are accepted by port operators, banks, and buyers as proof of customs clearance.
                  Certificates are generated automatically when a declaration reaches "Goods Released" status.
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}
