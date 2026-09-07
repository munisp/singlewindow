/**
 * PcsVesselTracking.tsx — PCS vessel tracking (Phase 16). Vessels are derived
 * from authority-submitted port calls (GET /v1/port-calls) grouped by IMO.
 * There is NO live AIS feed: positions and predictive ETAs are disclosed as
 * GAP-PCS-AIS and never synthesized. Unconfigured/unavailable upstream shows
 * an honest DEGRADED state.
 */
import { useState } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Ship, RefreshCw } from "lucide-react";
import { PcsDegradedBanner, PcsEmptyState, PcsGapList, ProvenanceLine } from "./pcs/pcsUi";

const PORT_CODES = ["NGAPP", "NGTIN", "NGLOS", "NGPHC", "NGONN", "NGCAL", "NGWAR", "NGKOK"] as const;

interface TrackedVessel {
  vesselImo: string;
  latestStatus: string;
  latestUpdatedAt: string;
  portCalls: Array<{ call_id: string; status: string; updated_at: string; version: number }>;
}

export default function PcsVesselTracking() {
  const [portCode, setPortCode] = useState<string>("NGAPP");
  const query = trpc.pcs.vessels.track.useQuery({ portCode });
  const result = query.data;

  return (
    <DashboardLayout>
      <div className="container mx-auto max-w-6xl space-y-6 py-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">Vessel tracking</h1>
            <p className="text-sm text-slate-500">
              Vessels known to the port authority via port-call records. Live positions require an AIS feed (not integrated).
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

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base"><Ship className="h-4 w-4" /> Vessels · {portCode}</CardTitle>
            <CardDescription>Source: port-interop /v1/port-calls, grouped by vessel IMO.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {query.isLoading && <Skeleton className="h-24 w-full" />}
            {result?.status === "unavailable" && (
              <PcsDegradedBanner reason={result.reason} detail={result.detail} onRetry={() => query.refetch()} />
            )}
            {result?.status === "ok" && (
              <>
                {result.data.vessels.length === 0 ? (
                  <PcsEmptyState
                    title="No vessels reported"
                    hint="The port authority system is reachable and reports no port calls at this port."
                  />
                ) : (
                  (result.data.vessels as TrackedVessel[]).map((v) => (
                    <div key={v.vesselImo} className="rounded-md border border-slate-700/60 p-3">
                      <div className="flex items-center justify-between">
                        <p className="font-mono text-sm">IMO {v.vesselImo}</p>
                        <Badge variant="outline">{v.latestStatus}</Badge>
                      </div>
                      <div className="mt-2 space-y-1">
                        {v.portCalls.map((pc) => (
                          <div key={pc.call_id} className="flex items-center justify-between text-xs text-slate-400">
                            <span className="font-mono">{pc.call_id}</span>
                            <span>{pc.status} · {new Date(pc.updated_at).toLocaleString()}</span>
                          </div>
                        ))}
                      </div>
                      <ProvenanceLine
                        source="port-interop /v1/port-calls"
                        detail={`latest record updated ${new Date(v.latestUpdatedAt).toLocaleString()}`}
                      />
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
