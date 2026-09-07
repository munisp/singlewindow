/**
 * TransshipmentDetail.tsx — transshipment declaration detail with bonded
 * transfer tracking (Phase 16 Wave P1). Shows the manifest coupling and the
 * append-only bonded-transfer audit trail; allowed next transitions are
 * server-computed (never client-guessed).
 */
import DashboardLayout from "@/components/DashboardLayout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { trpc } from "@/lib/trpc";
import { ArrowRight, RefreshCw } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

const STATUS_LABELS: Record<string, string> = {
  initiated: "Initiated",
  in_transit: "In transit",
  arrived_bond: "Arrived at bonded facility",
  under_supervision: "Under customs supervision",
  released: "Released from bond",
  completed: "Completed",
  cancelled: "Cancelled",
};

export default function TransshipmentDetail({ linkId }: { linkId: number }) {
  const [note, setNote] = useState("");
  const query = trpc.transshipment.get.useQuery({ linkId });
  const transition = trpc.transshipment.transition.useMutation({
    onSuccess: () => {
      setNote("");
      toast.success("Bonded transfer status updated.");
      query.refetch();
    },
    onError: (err) => toast.error(err.message),
  });

  const data = query.data;

  return (
    <DashboardLayout>
      <div className="container mx-auto max-w-4xl space-y-6 py-6">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold">Transshipment {data?.declaration.declarationNumber ?? ""}</h1>
          <Button variant="outline" size="sm" onClick={() => query.refetch()} disabled={query.isFetching}>
            <RefreshCw className={`mr-1.5 h-3.5 w-3.5 ${query.isFetching ? "animate-spin" : ""}`} /> Refresh
          </Button>
        </div>

        {query.isLoading && <Skeleton className="h-40 w-full" />}
        {query.error && <p className="text-sm text-red-400">{query.error.message}</p>}

        {data && (
          <>
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Manifest coupling</CardTitle>
                <CardDescription>Transshipment port: {data.link.transshipmentPort}</CardDescription>
              </CardHeader>
              <CardContent className="grid gap-4 md:grid-cols-2">
                <div className="rounded-md border border-slate-700/60 p-3">
                  <p className="text-xs uppercase text-slate-500">Inbound manifest</p>
                  <p className="font-mono text-sm">{data.inboundManifest?.manifestNumber ?? `#${data.link.inboundManifestId}`}</p>
                  {data.inboundManifest && (
                    <p className="text-xs text-slate-500">
                      {data.inboundManifest.vesselName} · {data.inboundManifest.portOfLoading} → {data.inboundManifest.portOfDischarge}
                    </p>
                  )}
                </div>
                <div className="rounded-md border border-slate-700/60 p-3">
                  <p className="text-xs uppercase text-slate-500">Outbound manifest</p>
                  <p className="font-mono text-sm">{data.outboundManifest?.manifestNumber ?? `#${data.link.outboundManifestId}`}</p>
                  {data.outboundManifest && (
                    <p className="text-xs text-slate-500">
                      {data.outboundManifest.vesselName} · {data.outboundManifest.portOfLoading} → {data.outboundManifest.portOfDischarge}
                    </p>
                  )}
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  Bonded transfer tracking <Badge variant="outline">{STATUS_LABELS[data.currentStatus] ?? data.currentStatus}</Badge>
                </CardTitle>
                <CardDescription>Append-only audit trail — every transition is a permanent record.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  {data.history.map((h) => (
                    <div key={h.id} className="flex items-center justify-between rounded-md border border-slate-700/60 p-2 text-sm">
                      <span>
                        {h.fromStatus ? `${STATUS_LABELS[h.fromStatus] ?? h.fromStatus} → ` : ""}
                        <strong>{STATUS_LABELS[h.toStatus] ?? h.toStatus}</strong>
                        {h.note ? <span className="ml-2 text-xs text-slate-500">{h.note}</span> : null}
                      </span>
                      <span className="text-xs text-slate-500">{new Date(h.createdAt).toLocaleString()}</span>
                    </div>
                  ))}
                </div>

                {data.allowedTransitions.length > 0 && (
                  <div className="space-y-2 border-t border-slate-700/60 pt-3">
                    <Textarea
                      value={note}
                      onChange={(e) => setNote(e.target.value)}
                      placeholder="Transition note (optional)"
                      rows={2}
                    />
                    <div className="flex flex-wrap gap-2">
                      {data.allowedTransitions.map((next) => (
                        <Button
                          key={next}
                          variant={next === "cancelled" ? "destructive" : "default"}
                          size="sm"
                          disabled={transition.isPending}
                          onClick={() => transition.mutate({ linkId, toStatus: next as never, note: note || undefined })}
                        >
                          <ArrowRight className="mr-1.5 h-3.5 w-3.5" /> {STATUS_LABELS[next] ?? next}
                        </Button>
                      ))}
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </DashboardLayout>
  );
}
