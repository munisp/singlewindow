/**
 * TransshipmentList.tsx — my transshipment declarations (Phase 16 Wave P1).
 * Entry point to the filing wizard and per-declaration bonded transfer
 * tracking. Honest empty state when none exist.
 */
import DashboardLayout from "@/components/DashboardLayout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { trpc } from "@/lib/trpc";
import { ChevronRight, Plus, RefreshCw, Ship } from "lucide-react";
import { useLocation } from "wouter";

export default function TransshipmentList() {
  const [, navigate] = useLocation();
  const query = trpc.transshipment.list.useQuery({});
  const items = query.data ?? [];

  return (
    <DashboardLayout>
      <div className="container mx-auto max-w-5xl space-y-6 py-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="flex items-center gap-2 text-2xl font-bold"><Ship className="h-6 w-6" /> Transshipment declarations</h1>
            <p className="text-sm text-slate-500">In/out manifest coupling with bonded transfer tracking.</p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => query.refetch()} disabled={query.isFetching}>
              <RefreshCw className={`mr-1.5 h-3.5 w-3.5 ${query.isFetching ? "animate-spin" : ""}`} /> Refresh
            </Button>
            <Button size="sm" onClick={() => navigate("/app/transshipment/new")}>
              <Plus className="mr-1.5 h-3.5 w-3.5" /> New transshipment
            </Button>
          </div>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Declarations</CardTitle>
            <CardDescription>Transshipment declarations with their coupled manifests.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {query.isLoading && <Skeleton className="h-24 w-full" />}
            {query.error && <p className="text-sm text-red-400">{query.error.message}</p>}
            {!query.isLoading && items.length === 0 && !query.error && (
              <div className="rounded-lg border border-dashed border-slate-600/50 py-10 text-center">
                <p className="font-medium text-slate-300">No transshipment declarations</p>
                <p className="mt-1 text-sm text-slate-500">File one to couple an inbound and outbound manifest through a bonded transfer.</p>
              </div>
            )}
            {items.map((t) => (
              <div
                key={t.linkId}
                className="flex cursor-pointer items-center justify-between rounded-md border border-slate-700/60 p-3 transition-colors hover:border-sky-500/40"
                onClick={() => navigate(`/app/transshipment/${t.linkId}`)}
              >
                <div>
                  <p className="font-mono text-sm">{t.declarationNumber}</p>
                  <p className="text-xs text-slate-500">
                    Port {t.transshipmentPort} · filed {new Date(t.createdAt).toLocaleString()}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant="outline">{t.declarationStatus}</Badge>
                  <ChevronRight className="h-4 w-4 text-slate-500" />
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}
