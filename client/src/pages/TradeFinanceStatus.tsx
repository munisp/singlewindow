/**
 * TradeFinanceStatus.tsx — WP-6 trade-finance status tracking.
 * Lists the trader's applications and shows the lifecycle timeline with the
 * immutable approval trail returned by the financial-controls rail.
 */

import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { toast } from "sonner";
import { Activity, RefreshCw, CheckCircle, XCircle, Clock } from "lucide-react";

const STATE_ORDER = [
  "APPLICATION", "KYC_CONSENT_CHECK", "BANK_REVIEW", "REGULATORY_CLEARANCE",
  "APPROVED", "DISBURSEMENT_PENDING", "DISBURSED", "SETTLED",
];

const STATE_COLORS: Record<string, string> = {
  SETTLED: "bg-emerald-900/40 border-emerald-500/30",
  DECLINED: "bg-rose-900/40 border-rose-500/30",
  DISBURSED: "bg-blue-900/40 border-blue-500/30",
};

export default function TradeFinanceStatus() {
  const listQuery = trpc.tradeFinance.financeList.useQuery(undefined, { retry: false });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const detailQuery = trpc.tradeFinance.financeGet.useQuery(
    { applicationId: selectedId ?? "" },
    { enabled: !!selectedId, retry: false }
  );
  const decisionMutation = trpc.tradeFinance.financeDecision.useMutation({
    onSuccess: () => { toast.success("Decision recorded"); detailQuery.refetch(); listQuery.refetch(); },
    onError: (err) => toast.error(err.message),
  });

  const unavailable = listQuery.error?.data?.code === "SERVICE_UNAVAILABLE";
  const applications: any[] = (listQuery.data as any)?.applications ?? [];
  const detail: any = detailQuery.data;

  return (
    <div className="min-h-screen bg-[#0A1628] text-slate-100 p-6 space-y-6">
      <div className="flex items-center gap-3">
        <Activity className="w-7 h-7 text-[#D4A017]" />
        <div>
          <h1 className="text-2xl font-bold">Trade Finance — Status Tracking</h1>
          <p className="text-slate-400 text-sm">Lifecycle: APPLICATION → KYC/CONSENT → BANK REVIEW → APPROVED → DISBURSED → SETTLED.</p>
        </div>
        <Button variant="ghost" size="sm" className="ml-auto" onClick={() => listQuery.refetch()}><RefreshCw className="w-4 h-4" /></Button>
      </div>

      {unavailable ? (
        <Card className="bg-slate-900/60 border-slate-700">
          <CardContent className="p-6 text-slate-300">The trade-finance rail is not configured for this environment.</CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <Card className="bg-slate-900/60 border-slate-700">
            <CardHeader><CardTitle>My applications</CardTitle></CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow><TableHead>Application</TableHead><TableHead>Product</TableHead><TableHead>Amount</TableHead><TableHead>State</TableHead></TableRow>
                </TableHeader>
                <TableBody>
                  {applications.map((app) => (
                    <TableRow key={app.application_id} className="cursor-pointer" onClick={() => setSelectedId(app.application_id)}>
                      <TableCell className="font-mono text-xs">{app.application_id}</TableCell>
                      <TableCell className="text-xs">{app.product}</TableCell>
                      <TableCell>{(app.amount / 100).toLocaleString()} {app.currency}</TableCell>
                      <TableCell><Badge className={STATE_COLORS[app.state] ?? "bg-slate-800"}>{app.state}</Badge></TableCell>
                    </TableRow>
                  ))}
                  {applications.length === 0 && (
                    <TableRow><TableCell colSpan={4} className="text-center text-slate-400">No applications yet.</TableCell></TableRow>
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          <Card className="bg-slate-900/60 border-slate-700">
            <CardHeader><CardTitle>Lifecycle {selectedId ? `— ${selectedId}` : ""}</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              {!detail && <p className="text-slate-400 text-sm">Select an application to inspect its chain.</p>}
              {detail && (
                <>
                  <div className="space-y-1">
                    {STATE_ORDER.map((state) => {
                      const reached = STATE_ORDER.indexOf(detail.application.state) >= STATE_ORDER.indexOf(state) && detail.application.state !== "DECLINED";
                      const current = detail.application.state === state;
                      return (
                        <div key={state} className={`flex items-center gap-2 text-sm ${current ? "text-[#D4A017]" : reached ? "text-emerald-400" : "text-slate-500"}`}>
                          {reached ? <CheckCircle className="w-4 h-4" /> : <Clock className="w-4 h-4" />}
                          {state}
                          {current && <Badge className="bg-[#D4A017] text-[#0A1628]">current</Badge>}
                        </div>
                      );
                    })}
                    {detail.application.state === "DECLINED" && (
                      <div className="flex items-center gap-2 text-sm text-rose-400"><XCircle className="w-4 h-4" /> DECLINED</div>
                    )}
                  </div>
                  <div>
                    <h3 className="text-sm font-semibold text-slate-300 mb-2">Immutable approval trail</h3>
                    <Table>
                      <TableHeader><TableRow><TableHead>Role</TableHead><TableHead>Decision</TableHead><TableHead>From → To</TableHead></TableRow></TableHeader>
                      <TableBody>
                        {(detail.approvals ?? []).map((approval: any) => (
                          <TableRow key={approval.approval_id}>
                            <TableCell className="text-xs">{approval.role}</TableCell>
                            <TableCell><Badge className={approval.decision === "APPROVE" ? "bg-emerald-900/40" : "bg-rose-900/40"}>{approval.decision}</Badge></TableCell>
                            <TableCell className="text-xs">{approval.from_state} → {approval.to_state}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                  {["APPROVED", "DISBURSED"].includes(detail.application.state) && (
                    <div className="flex gap-2">
                      <Button className="bg-emerald-700 hover:bg-emerald-600" disabled={decisionMutation.isPending}
                        onClick={() => decisionMutation.mutate({ applicationId: detail.application.application_id, version: detail.application.version, decision: "APPROVE" })}>
                        {detail.application.state === "APPROVED" ? "Accept facility terms" : "Confirm settlement"}
                      </Button>
                      <Button variant="destructive" disabled={decisionMutation.isPending}
                        onClick={() => decisionMutation.mutate({ applicationId: detail.application.application_id, version: detail.application.version, decision: "REJECT" })}>
                        Decline
                      </Button>
                    </div>
                  )}
                </>
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
