/**
 * PcsPortCallStatus.tsx — PCS port-call status board (Phase 16). Reads
 * GET /v1/port-calls through pcs.portCalls.status. Authority-sourced only:
 * when port-interop is unconfigured or the endpoint is not deployed, an
 * honest DEGRADED state is shown — never fabricated port calls.
 */
import { useState } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Anchor, RefreshCw } from "lucide-react";
import { PcsDegradedBanner, PcsEmptyState, PcsGapList, ProvenanceLine } from "./pcs/pcsUi";

const PORT_CODES = ["NGAPP", "NGTIN", "NGLOS", "NGPHC", "NGONN", "NGCAL", "NGWAR", "NGKOK"] as const;
const STATUSES = ["DRAFT", "SUBMITTED", "ACCEPTED", "REJECTED"] as const;

export default function PcsPortCallStatus() {
  const [portCode, setPortCode] = useState<string>("NGAPP");
  const [status, setStatus] = useState<string>("all");
  const query = trpc.pcs.portCalls.status.useQuery({
    portCode,
    status: status === "all" ? undefined : (status as (typeof STATUSES)[number]),
  });
  const result = query.data;

  return (
    <DashboardLayout>
      <div className="container mx-auto max-w-6xl space-y-6 py-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">Port-call status</h1>
            <p className="text-sm text-slate-500">
              Live port-call records from the port authority system — never simulated.
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={() => query.refetch()} disabled={query.isFetching}>
            <RefreshCw className={`mr-1.5 h-3.5 w-3.5 ${query.isFetching ? "animate-spin" : ""}`} /> Refresh
          </Button>
        </div>

        <div className="flex flex-wrap gap-3">
          <Select value={portCode} onValueChange={setPortCode}>
            <SelectTrigger className="w-56"><SelectValue placeholder="Port" /></SelectTrigger>
            <SelectContent>
              {PORT_CODES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={status} onValueChange={setStatus}>
            <SelectTrigger className="w-44"><SelectValue placeholder="Status" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              {STATUSES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base"><Anchor className="h-4 w-4" /> Port calls · {portCode}</CardTitle>
            <CardDescription>Source: port-interop /v1/port-calls (authority system of record).</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {query.isLoading && <Skeleton className="h-24 w-full" />}
            {result?.status === "unavailable" && (
              <PcsDegradedBanner reason={result.reason} detail={result.detail} onRetry={() => query.refetch()} />
            )}
            {result?.status === "ok" && (
              <>
                {result.data.portCalls.length === 0 ? (
                  <PcsEmptyState
                    title="No port calls"
                    hint="The port authority system is reachable and reports no port calls matching these filters."
                  />
                ) : (
                  (result.data.portCalls as Array<{
                    call_id: string; vessel_imo: string; port_code: string;
                    declaration_reference: string; status: string; updated_at: string; version: number;
                  }>).map((pc) => (
                    <div key={pc.call_id} className="flex items-center justify-between rounded-md border border-slate-700/60 p-3">
                      <div>
                        <p className="font-mono text-sm">{pc.call_id}</p>
                        <p className="text-xs text-slate-500">
                          IMO {pc.vessel_imo} · {pc.port_code} · decl {pc.declaration_reference}
                        </p>
                        <ProvenanceLine
                          source="port-interop /v1/port-calls"
                          detail={`record v${pc.version} · updated ${new Date(pc.updated_at).toLocaleString()}`}
                        />
                      </div>
                      <Badge variant="outline">{pc.status}</Badge>
                    </div>
                  ))
                )}
                <PcsGapList gaps={result.gaps} />
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}
