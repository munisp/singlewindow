/**
 * PcsConsignmentTimeline.tsx — per-consignment milestone timeline (Phase 8, R2).
 * Every milestone renders its provenance (source event id + topic); missing
 * vessel-side milestones are shown as truthful gaps, never synthesized.
 */
import DashboardLayout from "@/components/DashboardLayout";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ArrowLeft, CheckCircle2, Circle } from "lucide-react";
import { useLocation } from "wouter";
import { MILESTONE_LABELS, PcsDegradedBanner, PcsGapList, ProvenanceLine } from "./pcs/pcsUi";

interface MilestoneRow {
  id: number;
  milestone: string;
  occurredAt: string;
  sourceTopic: string;
  sourceEventId: string;
  provenanceSignatureVerified: boolean;
}

export default function PcsConsignmentTimeline({ id }: { id: number }) {
  const [, navigate] = useLocation();
  const query = trpc.pcs.myConsignments.timeline.useQuery({ consignmentId: id });

  const result = query.data;
  const consignment = result?.status === "ok" ? (result.data.consignment as {
    id: number; blNumber: string | null; declarationUrn: string | null; portCode: string | null;
  }) : null;

  return (
    <DashboardLayout>
      <div className="container mx-auto max-w-3xl space-y-6 py-6">
        <Button variant="ghost" size="sm" onClick={() => navigate("/app/pcs")}>
          <ArrowLeft className="mr-1.5 h-4 w-4" /> Back to PCS
        </Button>

        <Card>
          <CardHeader>
            <CardTitle className="font-mono text-lg">
              {consignment?.blNumber ?? consignment?.declarationUrn ?? `Consignment #${id}`}
            </CardTitle>
            <CardDescription>
              Milestone timeline — each entry is stamped with its source event. Vessel positions and ETAs are not available (see gaps below).
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {query.isLoading && <Skeleton className="h-40 w-full" />}
            {query.isError && (
              <p className="text-sm text-red-400">{query.error.message}</p>
            )}
            {result?.status === "unavailable" && (
              <PcsDegradedBanner reason={result.reason} detail={result.detail} onRetry={() => query.refetch()} />
            )}
            {result?.status === "ok" && (
              <>
                {(result.data.milestones as MilestoneRow[]).length === 0 ? (
                  <p className="text-sm text-slate-500">
                    No milestones have been projected for this consignment yet. Customs-linked and gate events
                    appear here automatically once the port system publishes them.
                  </p>
                ) : (
                  <ol className="relative space-y-4 border-l border-slate-700 pl-6">
                    {(result.data.milestones as MilestoneRow[]).map((m) => (
                      <li key={m.id} className="relative">
                        <span className="absolute -left-[31px] top-0.5">
                          {m.provenanceSignatureVerified ? (
                            <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                          ) : (
                            <Circle className="h-4 w-4 text-slate-500" />
                          )}
                        </span>
                        <p className="font-medium text-sm">{MILESTONE_LABELS[m.milestone] ?? m.milestone}</p>
                        <p className="text-xs text-slate-400">{new Date(m.occurredAt).toLocaleString()}</p>
                        <ProvenanceLine
                          source={`${m.sourceTopic} event ${m.sourceEventId}`}
                          detail={m.provenanceSignatureVerified ? "signature verified" : "signature NOT verified"}
                        />
                      </li>
                    ))}
                  </ol>
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
