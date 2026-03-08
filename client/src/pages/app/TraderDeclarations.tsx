/**
 * Trader Declarations List — wired to real tRPC declarations router
 */
import DashboardLayout from "@/components/DashboardLayout";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { FileText, Plus, RefreshCw } from "lucide-react";
import { Link, useLocation } from "wouter";

const LANE_STYLES: Record<string, string> = {
  green: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
  yellow: "bg-amber-500/10 text-amber-400 border-amber-500/20",
  red: "bg-red-500/10 text-red-400 border-red-500/20",
};

const STATUS_STYLES: Record<string, string> = {
  draft: "bg-gray-500/10 text-gray-400 border-gray-500/20",
  submitted: "bg-blue-500/10 text-blue-400 border-blue-500/20",
  under_review: "bg-amber-500/10 text-amber-400 border-amber-500/20",
  cleared: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
  rejected: "bg-red-500/10 text-red-400 border-red-500/20",
  held: "bg-orange-500/10 text-orange-400 border-orange-500/20",
};

export default function TraderDeclarations() {
  const [, navigate] = useLocation();
  const { data, isLoading, refetch } = trpc.declarations.myDeclarations.useQuery({ limit: 50, offset: 0 });

  return (
    <DashboardLayout title="My Declarations">
      <div className="space-y-6 max-w-6xl">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
              <FileText className="h-6 w-6 text-primary" />My Declarations
            </h1>
            <p className="text-muted-foreground text-sm mt-1">
              All your import and export declarations
            </p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => refetch()} className="gap-1.5">
              <RefreshCw className="h-4 w-4" />Refresh
            </Button>
            <Button size="sm" onClick={() => navigate("/app/trader/declarations/new")} className="gap-1.5">
              <Plus className="h-4 w-4" />New Declaration
            </Button>
          </div>
        </div>

        <Card>
          <CardHeader><CardTitle className="text-base">All Declarations ({data?.length ?? 0})</CardTitle></CardHeader>
          <CardContent className="p-0">
            {isLoading ? (
              <div className="p-4 space-y-2">{Array.from({length:8}).map((_,i)=><Skeleton key={i} className="h-12 w-full"/>)}</div>
            ) : (data?.length ?? 0) === 0 ? (
              <div className="p-12 text-center text-muted-foreground">
                <FileText className="h-12 w-12 mx-auto mb-3 opacity-30" />
                <p className="mb-4">No declarations yet</p>
                <Button onClick={() => navigate("/app/trader/declarations/new")} className="gap-1.5">
                  <Plus className="h-4 w-4" />Submit First Declaration
                </Button>
              </div>
            ) : (
              <div className="overflow-x-auto">
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
                    <th className="text-left p-3 font-medium text-muted-foreground">Submitted</th>
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
                        <td className="p-3"><Badge variant="outline" className={STATUS_STYLES[d.status] ?? ""}>{d.status}</Badge></td>
                        <td className="p-3">{d.riskLane ? <Badge variant="outline" className={LANE_STYLES[d.riskLane] ?? ""}>{d.riskLane.toUpperCase()}</Badge> : "—"}</td>
                        <td className="p-3 text-xs text-muted-foreground">{d.createdAt ? new Date(d.createdAt).toLocaleDateString() : "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}
