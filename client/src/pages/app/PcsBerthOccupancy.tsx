/**
 * PcsBerthOccupancy.tsx — PCS berth occupancy board (Phase 16). Reads
 * GET /v1/berths through pcs.berths.occupancy. Authority terminal data only;
 * when the upstream is unconfigured or the endpoint is not deployed the page
 * shows an honest DEGRADED state — never fabricated berths.
 */
import { useState } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { LayoutGrid, RefreshCw } from "lucide-react";
import { PcsDegradedBanner, PcsEmptyState, PcsGapList, ProvenanceLine } from "./pcs/pcsUi";

const PORT_CODES = ["NGAPP", "NGTIN", "NGLOS", "NGPHC", "NGONN", "NGCAL", "NGWAR", "NGKOK"] as const;

interface BerthRow {
  berth_id: string;
  port_code: string;
  terminal_id?: string;
  status: string;
  call_id?: string;
  vessel_imo?: string;
  updated_at?: string;
}

function statusVariant(status: string): "default" | "secondary" | "destructive" | "outline" {
  const s = status.toUpperCase();
  if (s === "FREE" || s === "AVAILABLE") return "secondary";
  if (s === "OCCUPIED") return "default";
  if (s === "CLOSED" || s === "OUT_OF_SERVICE") return "destructive";
  return "outline";
}

export default function PcsBerthOccupancy() {
  const [portCode, setPortCode] = useState<string>("NGAPP");
  const query = trpc.pcs.berths.occupancy.useQuery({ portCode });
  const result = query.data;

  const berths = result?.status === "ok" ? (result.data.berths as BerthRow[]) : [];
  const occupied = berths.filter((b) => b.status.toUpperCase() === "OCCUPIED").length;

  return (
    <DashboardLayout>
      <div className="container mx-auto max-w-6xl space-y-6 py-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">Berth occupancy</h1>
            <p className="text-sm text-slate-500">
              Terminal berth state published by the port authority — never estimated.
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={() => query.refetch()} disabled={query.isFetching}>
            <RefreshCw className={`mr-1.5 h-3.5 w-3.5 ${query.isFetching ? "animate-spin" : ""}`} /> Refresh
          </Button>
        </div>

        <Select value={portCode} onValueChange={setPortCode}>
          <SelectTrigger className="w-56"><SelectValue placeholder="Port" /></SelectTrigger>
          <SelectContent>
            {PORT_CODES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
          </SelectContent>
        </Select>

        {result?.status === "ok" && berths.length > 0 && (
          <p className="text-sm text-slate-400">
            {occupied} of {berths.length} berth(s) occupied at {portCode}.
          </p>
        )}

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base"><LayoutGrid className="h-4 w-4" /> Berths · {portCode}</CardTitle>
            <CardDescription>Source: port-interop /v1/berths (terminal authority feed).</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {query.isLoading && <Skeleton className="h-24 w-full" />}
            {result?.status === "unavailable" && (
              <PcsDegradedBanner reason={result.reason} detail={result.detail} onRetry={() => query.refetch()} />
            )}
            {result?.status === "ok" && (
              <>
                {berths.length === 0 ? (
                  <PcsEmptyState
                    title="No berths reported"
                    hint="The port authority system is reachable and publishes no berth records for this port."
                  />
                ) : (
                  berths.map((b) => (
                    <div key={b.berth_id} className="flex items-center justify-between rounded-md border border-slate-700/60 p-3">
                      <div>
                        <p className="font-mono text-sm">{b.berth_id}{b.terminal_id ? ` · ${b.terminal_id}` : ""}</p>
                        <p className="text-xs text-slate-500">
                          {b.vessel_imo ? `IMO ${b.vessel_imo}` : "No vessel linked"}
                          {b.call_id ? ` · call ${b.call_id}` : ""}
                        </p>
                        <ProvenanceLine
                          source="port-interop /v1/berths"
                          detail={b.updated_at ? `updated ${new Date(b.updated_at).toLocaleString()}` : undefined}
                        />
                      </div>
                      <Badge variant={statusVariant(b.status)}>{b.status}</Badge>
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
