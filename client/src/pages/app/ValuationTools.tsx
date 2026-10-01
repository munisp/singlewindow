/**
 * Phase 22 — Customs Valuation Reference Database
 * UI for the previously orphaned `valuation` tRPC router:
 * search reference prices, look up by HS code, and run undervaluation checks.
 * Admin upsert/delete of references is available to admin users.
 */
import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { toast } from "sonner";
import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Search, Scale, AlertTriangle, CheckCircle, Database } from "lucide-react";

export default function ValuationTools() {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";

  const [query, setQuery] = useState("");
  const [submittedQuery, setSubmittedQuery] = useState<string | null>(null);

  const [checkHs, setCheckHs] = useState("");
  const [checkValue, setCheckValue] = useState("");
  const [checkCurrency, setCheckCurrency] = useState("USD");
  const [submittedCheck, setSubmittedCheck] = useState<{ hsCode: string; declaredValue: number; currency: string } | null>(null);

  const { data: listData, isLoading: listLoading, isError: listError } = trpc.valuation.list.useQuery({ limit: 50 });
  const { data: searchData, isLoading: searchLoading } = trpc.valuation.search.useQuery(
    { query: submittedQuery ?? "" },
    { enabled: submittedQuery !== null && submittedQuery.length >= 2 }
  );
  const { data: checkData, isLoading: checkLoading, isError: checkError } = trpc.valuation.checkUndervaluation.useQuery(
    submittedCheck ?? { hsCode: "0000", declaredValue: 1, currency: "USD" },
    { enabled: submittedCheck !== null }
  );

  return (
    <DashboardLayout>
      <div className="p-6 space-y-6">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Scale className="w-6 h-6 text-primary" />
            Customs Valuation Database
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            Reference prices used by NCS to verify declared values against market benchmarks (WTO Customs Valuation Agreement).
          </p>
        </div>

        {/* Search */}
        <Card>
          <CardHeader><CardTitle className="text-base">Search References</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <form
              className="flex gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                if (query.trim().length >= 2) setSubmittedQuery(query.trim());
                else toast.error("Enter at least 2 characters");
              }}
            >
              <Input placeholder="HS code or commodity description…" value={query} onChange={(e) => setQuery(e.target.value)} />
              <Button type="submit"><Search className="w-4 h-4 mr-1" />Search</Button>
            </form>
            {submittedQuery && (
              searchLoading ? (
                <p className="text-sm text-muted-foreground">Searching…</p>
              ) : !searchData || searchData.results.length === 0 ? (
                <p className="text-sm text-muted-foreground">No valuation references matched "{submittedQuery}".</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>HS Code</TableHead>
                      <TableHead>Description</TableHead>
                      <TableHead>Reference Price</TableHead>
                      <TableHead>Unit</TableHead>
                      <TableHead>Source</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {searchData.results.map((r: any) => (
                      <TableRow key={r.id}>
                        <TableCell className="font-mono text-xs">{r.hsCode}</TableCell>
                        <TableCell className="text-xs">{r.description}</TableCell>
                        <TableCell className="text-xs">{r.currency} {Number(r.referencePrice).toLocaleString()}</TableCell>
                        <TableCell className="text-xs">{r.unit}</TableCell>
                        <TableCell className="text-xs">{r.source ?? "—"}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )
            )}
          </CardContent>
        </Card>

        {/* Undervaluation check */}
        <Card>
          <CardHeader><CardTitle className="text-base">Undervaluation Check</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <form
              className="flex flex-wrap gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                const v = Number(checkValue);
                if (checkHs.trim().length < 4) return toast.error("HS code must be at least 4 digits");
                if (!Number.isFinite(v) || v <= 0) return toast.error("Enter a positive declared value");
                setSubmittedCheck({ hsCode: checkHs.trim(), declaredValue: v, currency: checkCurrency.trim() || "USD" });
              }}
            >
              <Input className="w-40" placeholder="HS code" value={checkHs} onChange={(e) => setCheckHs(e.target.value)} />
              <Input className="w-40" placeholder="Declared value" value={checkValue} onChange={(e) => setCheckValue(e.target.value)} />
              <Input className="w-24" placeholder="USD" value={checkCurrency} onChange={(e) => setCheckCurrency(e.target.value)} />
              <Button type="submit" variant="secondary">Check</Button>
            </form>
            {checkLoading && <p className="text-sm text-muted-foreground">Checking…</p>}
            {checkError && <p className="text-sm text-red-600">Check failed: {checkError.message}</p>}
            {submittedCheck && checkData && (
              <div className="p-4 rounded-lg border flex items-start gap-3">
                {checkData.flagged ? (
                  <AlertTriangle className="w-5 h-5 text-amber-500 mt-0.5 shrink-0" />
                ) : (
                  <CheckCircle className="w-5 h-5 text-green-500 mt-0.5 shrink-0" />
                )}
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <Badge className={checkData.flagged ? "bg-amber-500/20 text-amber-600" : "bg-green-500/20 text-green-600"}>
                      {checkData.flagged ? `Flagged${"riskLevel" in checkData && checkData.riskLevel ? ` — ${checkData.riskLevel}` : ""}` : "Not flagged"}
                    </Badge>
                  </div>
                  <p className="text-sm text-muted-foreground">{checkData.reason ?? "Declared value is within the acceptable range of the reference price."}</p>
                  {"referencePrice" in checkData && checkData.referencePrice != null && (
                    <p className="text-xs text-muted-foreground">
                      Reference: {submittedCheck.currency} {Number(checkData.referencePrice).toFixed(2)} · Declared: {submittedCheck.currency} {submittedCheck.declaredValue.toLocaleString()}
                      {"discrepancyPct" in checkData && checkData.discrepancyPct ? ` · Discrepancy: ${checkData.discrepancyPct}%` : ""}
                    </p>
                  )}
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Reference list */}
        <Card>
          <CardHeader><CardTitle className="text-base flex items-center gap-2"><Database className="w-4 h-4" />All References</CardTitle></CardHeader>
          <CardContent>
            {listError ? (
              <p className="text-sm text-red-600">Failed to load valuation references.</p>
            ) : listLoading ? (
              <p className="text-sm text-muted-foreground">Loading…</p>
            ) : !listData || listData.references.length === 0 ? (
              <p className="text-sm text-muted-foreground">The valuation reference database is empty.</p>
            ) : (
              <>
                <p className="text-xs text-muted-foreground mb-2">{listData.total} reference{listData.total !== 1 ? "s" : ""} in database{isAdmin ? " (admin: manage via API)" : ""}.</p>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>HS Code</TableHead>
                      <TableHead>Description</TableHead>
                      <TableHead>Reference Price</TableHead>
                      <TableHead>Unit</TableHead>
                      <TableHead>Source</TableHead>
                      <TableHead>Valid From</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {listData.references.map((r: any) => (
                      <TableRow key={r.id}>
                        <TableCell className="font-mono text-xs">{r.hsCode}</TableCell>
                        <TableCell className="text-xs">{r.description}</TableCell>
                        <TableCell className="text-xs">{r.currency} {Number(r.referencePrice).toLocaleString()}</TableCell>
                        <TableCell className="text-xs">{r.unit}</TableCell>
                        <TableCell className="text-xs">{r.source ?? "—"}</TableCell>
                        <TableCell className="text-xs">{r.validFrom ? new Date(r.validFrom).toLocaleDateString() : "—"}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}
