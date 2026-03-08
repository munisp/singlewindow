/**
 * Mojaloop Payment Flows — wired to real tRPC mojaloop router
 */
import DashboardLayout from "@/components/DashboardLayout";
import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { CreditCard, RefreshCw, CheckCircle, Clock, XCircle } from "lucide-react";

const STATUS_STYLES: Record<string, string> = {
  PENDING: "bg-amber-500/10 text-amber-400 border-amber-500/20",
  COMPLETED: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
  FAILED: "bg-red-500/10 text-red-400 border-red-500/20",
  PROCESSING: "bg-blue-500/10 text-blue-400 border-blue-500/20",
};

export default function MojaloopPayments() {
  const [page, setPage] = useState(0);
  const PAGE_SIZE = 20;
  const { data: mojaStatus } = trpc.mojaloop.getIntegrationStatus.useQuery();
  const { data, isLoading, refetch } = trpc.payments.listAll.useQuery({
    limit: PAGE_SIZE,
    offset: page * PAGE_SIZE,
  });

  const stats = data ? {
    total: data.total,
    completed: data.transactions.filter((t: any) => t.status === "COMPLETED").length,
    pending: data.transactions.filter((t: any) => t.status === "PENDING").length,
    failed: data.transactions.filter((t: any) => t.status === "FAILED").length,
    totalAmount: data.transactions.reduce((s: number, t: any) => s + Number(t.amount ?? 0), 0),
  } : null;

  return (
    <DashboardLayout title="Payment Flows">
      <div className="space-y-6 max-w-6xl">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
              <CreditCard className="h-6 w-6 text-primary" />Duty Payment Centre
            </h1>
            <p className="text-muted-foreground text-sm mt-1">
              Real-time duty and tax payment transactions across all financial institutions
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={() => refetch()} className="gap-1.5">
            <RefreshCw className="h-4 w-4" />Refresh
          </Button>
        </div>

        {/* Payment Gateway Status */}
        {mojaStatus && (
          <Card className={mojaStatus.connected ? "border-emerald-500/30" : "border-amber-500/30"}>
            <CardContent className="p-3 flex items-center gap-3">
              <div className={`h-2 w-2 rounded-full ${mojaStatus.connected ? "bg-emerald-400" : "bg-amber-400"}`} />
              <span className="text-sm font-medium">{mojaStatus.connected ? "Payment Gateway: Live" : "Payment Gateway: Simulation Mode"}</span>
              <span className="text-xs text-muted-foreground ml-auto">Protocol: {mojaStatus.ilpVersion} · Standard: {mojaStatus.isoStandard} · Banks supported: {mojaStatus.supportedFSPs}</span>
            </CardContent>
          </Card>
        )}

        {/* Stats */}
        <div className="grid grid-cols-4 gap-4">
          {[
            { label: "Total Transactions", value: stats?.total, icon: <CreditCard className="h-4 w-4 text-blue-400" /> },
            { label: "Completed", value: stats?.completed, icon: <CheckCircle className="h-4 w-4 text-emerald-400" /> },
            { label: "Pending", value: stats?.pending, icon: <Clock className="h-4 w-4 text-amber-400" /> },
            { label: "Failed", value: stats?.failed, icon: <XCircle className="h-4 w-4 text-red-400" /> },
          ].map(s => (
            <Card key={s.label}>
              <CardContent className="p-4 flex items-center gap-3">
                {s.icon}
                <div>
                  <p className="text-xl font-bold">{isLoading ? "—" : (s.value ?? 0)}</p>
                  <p className="text-xs text-muted-foreground">{s.label}</p>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Transactions Table */}
        <Card>
          <CardHeader><CardTitle className="text-base">Recent Transactions</CardTitle></CardHeader>
          <CardContent className="p-0">
            {isLoading ? (
              <div className="p-4 space-y-2">{Array.from({length:8}).map((_,i)=><Skeleton key={i} className="h-12 w-full"/>)}</div>
            ) : (data?.transactions?.length ?? 0) === 0 ? (
              <div className="p-12 text-center text-muted-foreground">
                <CreditCard className="h-12 w-12 mx-auto mb-3 opacity-30" />
                <p>No payment transactions yet</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead><tr className="border-b bg-muted/30">
                    <th className="text-left p-3 font-medium text-muted-foreground">Transaction ID</th>
                    <th className="text-left p-3 font-medium text-muted-foreground">Declaration</th>
                    <th className="text-left p-3 font-medium text-muted-foreground">Amount</th>
                    <th className="text-left p-3 font-medium text-muted-foreground">Currency</th>
                    <th className="text-left p-3 font-medium text-muted-foreground">Status</th>
                    <th className="text-left p-3 font-medium text-muted-foreground">Payment Method</th>
                    <th className="text-left p-3 font-medium text-muted-foreground">Created</th>
                  </tr></thead>
                  <tbody className="divide-y">
                    {data?.transactions.map((t: any) => (
                      <tr key={t.id} className="hover:bg-muted/20">
                        <td className="p-3 font-mono text-xs">{t.transactionId ?? t.id}</td>
                        <td className="p-3 font-mono text-xs">{t.declarationId ?? "—"}</td>
                        <td className="p-3 font-semibold">{Number(t.amount).toLocaleString()}</td>
                        <td className="p-3 text-muted-foreground">{t.currency}</td>
                        <td className="p-3"><Badge variant="outline" className={STATUS_STYLES[t.status] ?? ""}>{t.status}</Badge></td>
                        <td className="p-3 text-xs">{t.paymentMethod ?? "—"}</td>
                        <td className="p-3 text-xs text-muted-foreground">{t.createdAt ? new Date(t.createdAt).toLocaleString() : "—"}</td>
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
