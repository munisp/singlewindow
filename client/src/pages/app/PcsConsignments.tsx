/**
 * PcsConsignments.tsx — PCS trader portal landing: my consignments with
 * last-milestone status (Phase 8, R1/R2). Data is the verified ports.*.v1
 * read-model projection — never the simulated AIS feed (spec §5.1).
 */
import { useState } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Ship, CalendarCheck, Receipt, FileText, ChevronRight, RefreshCw } from "lucide-react";
import { useLocation } from "wouter";
import { MILESTONE_LABELS, PcsDegradedBanner, PcsEmptyState, PcsGapList, ProvenanceLine } from "./pcs/pcsUi";

export default function PcsConsignments() {
  const [, navigate] = useLocation();
  const [cursor, setCursor] = useState(0);
  const query = trpc.pcs.myConsignments.list.useQuery({ limit: 20, cursor });
  const visitsQuery = trpc.pcs.vesselVisits.forMyCargo.useQuery({});

  const result = query.data;

  return (
    <DashboardLayout>
      <div className="container mx-auto max-w-6xl space-y-6 py-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">Port Community System</h1>
            <p className="text-sm text-slate-500">
              Cargo milestones, terminal bookings and port billing — projected from port authority events.
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={() => query.refetch()} disabled={query.isFetching}>
            <RefreshCw className={`mr-1.5 h-3.5 w-3.5 ${query.isFetching ? "animate-spin" : ""}`} /> Refresh
          </Button>
        </div>

        {/* Section cards */}
        <div className="grid gap-4 md:grid-cols-3">
          <Card className="cursor-pointer transition-colors hover:border-sky-500/40" onClick={() => navigate("/app/pcs/bookings")}>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-base"><CalendarCheck className="h-4 w-4 text-sky-400" /> Terminal bookings</CardTitle>
              <CardDescription>eCallUp bookings, slots and gate status</CardDescription>
            </CardHeader>
          </Card>
          <Card className="cursor-pointer transition-colors hover:border-sky-500/40" onClick={() => navigate("/app/pcs/billing")}>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-base"><Receipt className="h-4 w-4 text-emerald-400" /> Port billing</CardTitle>
              <CardDescription>Invoices and refunds (ledger projection)</CardDescription>
            </CardHeader>
          </Card>
          <Card className="cursor-pointer transition-colors hover:border-sky-500/40" onClick={() => navigate("/app/pcs/documents")}>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-base"><FileText className="h-4 w-4 text-violet-400" /> Port documents</CardTitle>
              <CardDescription>Delivery orders, gate passes, terminal notices</CardDescription>
            </CardHeader>
          </Card>
        </div>

        {/* Vessel visits (read-through, authority-sourced) */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base"><Ship className="h-4 w-4" /> Vessel visits carrying my cargo</CardTitle>
            <CardDescription>Port calls read live from the port system — positions and predictive ETAs are not available.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {visitsQuery.isLoading && <Skeleton className="h-16 w-full" />}
            {visitsQuery.data?.status === "unavailable" && (
              <PcsDegradedBanner reason={visitsQuery.data.reason} detail={visitsQuery.data.detail} onRetry={() => visitsQuery.refetch()} />
            )}
            {visitsQuery.data?.status === "ok" && (
              <>
                {visitsQuery.data.data.visits.length === 0 ? (
                  <p className="text-sm text-slate-500">
                    No port calls are linked to your consignments yet
                    {visitsQuery.data.data.unlinkedConsignments > 0
                      ? ` (${visitsQuery.data.data.unlinkedConsignments} consignment(s) awaiting authority linkage).`
                      : "."}
                  </p>
                ) : (
                  (visitsQuery.data.data.visits as Array<{
                    portCall: { call_id: string; vessel_imo: string; port_code: string; status: string };
                    consignmentIds: number[];
                    provenance: { recordVersion: number; recordUpdatedAt: string };
                  }>).map((v) => (
                    <div key={v.portCall.call_id} className="flex items-center justify-between rounded-md border border-slate-700/60 p-3">
                      <div>
                        <p className="font-mono text-sm">{v.portCall.call_id}</p>
                        <p className="text-xs text-slate-500">
                          IMO {v.portCall.vessel_imo} · {v.portCall.port_code} · {v.consignmentIds.length} consignment(s)
                        </p>
                        <ProvenanceLine
                          source="port-interop /v1/port-calls"
                          detail={`record v${v.provenance.recordVersion} · updated ${new Date(v.provenance.recordUpdatedAt).toLocaleString()}`}
                        />
                      </div>
                      <Badge variant="outline">{v.portCall.status}</Badge>
                    </div>
                  ))
                )}
                <PcsGapList gaps={visitsQuery.data.gaps} />
              </>
            )}
          </CardContent>
        </Card>

        {/* Consignments */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">My consignments</CardTitle>
            <CardDescription>Milestone projection from port authority events (ports.booking.v1 / ports.gate.v1).</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {query.isLoading && <Skeleton className="h-24 w-full" />}
            {result?.status === "unavailable" && (
              <PcsDegradedBanner reason={result.reason} detail={result.detail} onRetry={() => query.refetch()} />
            )}
            {result?.status === "ok" && (
              <>
                {result.data.consignments.length === 0 ? (
                  <PcsEmptyState
                    title="No consignments yet"
                    hint="Consignments appear here when port authority events are linked to your bookings. Nothing is synthesized — the feed shows only verified events."
                  />
                ) : (
                  (result.data.consignments as Array<{
                    id: number; blNumber: string | null; declarationUrn: string | null;
                    portCode: string | null; lastMilestone: string | null; lastMilestoneAt: string | null;
                  }>).map((c) => (
                    <button
                      key={c.id}
                      onClick={() => navigate(`/app/pcs/consignments/${c.id}`)}
                      className="flex w-full items-center justify-between rounded-md border border-slate-700/60 p-3 text-left transition-colors hover:border-sky-500/40"
                    >
                      <div>
                        <p className="font-mono text-sm">{c.blNumber ?? c.declarationUrn ?? `Consignment #${c.id}`}</p>
                        <p className="text-xs text-slate-500">
                          {c.portCode ?? "port pending"} · B/L {c.blNumber ?? "not yet associated"}
                        </p>
                        <ProvenanceLine source="pcs read model" detail={c.lastMilestoneAt ? `as of ${new Date(c.lastMilestoneAt).toLocaleString()}` : "no milestones yet"} />
                      </div>
                      <div className="flex items-center gap-2">
                        {c.lastMilestone ? (
                          <Badge variant="outline">{MILESTONE_LABELS[c.lastMilestone] ?? c.lastMilestone}</Badge>
                        ) : (
                          <Badge variant="outline" className="text-slate-500">awaiting events</Badge>
                        )}
                        <ChevronRight className="h-4 w-4 text-slate-500" />
                      </div>
                    </button>
                  ))
                )}
                {result.data.nextCursor !== null && (
                  <Button variant="outline" size="sm" onClick={() => setCursor(result.data.nextCursor as number)}>
                    Load more
                  </Button>
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
