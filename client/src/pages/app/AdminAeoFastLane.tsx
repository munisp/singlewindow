/**
 * AdminAeoFastLane.tsx — AEO export fast-lane admin surface (Phase 16 Wave P1).
 * Sections: accredited exporters (authority-certified only), prioritized
 * export declaration queue, drawback fast-track queue, rules-of-origin
 * fast-path queue. All data is live from the backend — no fixtures.
 */
import DashboardLayout from "@/components/DashboardLayout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { trpc } from "@/lib/trpc";
import { Award, RefreshCw, Zap } from "lucide-react";
import { useState } from "react";

function QueryError({ message }: { message?: string }) {
  return <p className="text-sm text-red-400">{message ?? "Failed to load."}</p>;
}

export default function AdminAeoFastLane() {
  const [tab, setTab] = useState("exporters");
  const exporters = trpc.aeoFastLane.admin.accreditedExporters.useQuery({});
  const queue = trpc.aeoFastLane.queue.prioritized.useQuery({});
  const drawback = trpc.aeoFastLane.drawback.fastTrackQueue.useQuery({});
  const origin = trpc.aeoFastLane.origin.fastPathQueue.useQuery({});

  return (
    <DashboardLayout>
      <div className="container mx-auto max-w-6xl space-y-6 py-6">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold"><Zap className="h-6 w-6 text-amber-400" /> AEO export fast-lane</h1>
          <p className="text-sm text-slate-500">
            Queue prioritization, drawback acceleration and rules-of-origin fast path for AEO-certified exporters.
          </p>
        </div>

        <Tabs value={tab} onValueChange={setTab}>
          <TabsList>
            <TabsTrigger value="exporters">Accredited exporters</TabsTrigger>
            <TabsTrigger value="queue">Export queue</TabsTrigger>
            <TabsTrigger value="drawback">Drawback fast-track</TabsTrigger>
            <TabsTrigger value="origin">Origin fast-path</TabsTrigger>
          </TabsList>

          <TabsContent value="exporters">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base"><Award className="h-4 w-4" /> Accredited exporters</CardTitle>
                <CardDescription>Stakeholder profiles with authority-certified AEO status.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-2">
                {exporters.isLoading && <Skeleton className="h-24 w-full" />}
                {exporters.error && <QueryError message={exporters.error.message} />}
                {exporters.data && exporters.data.items.length === 0 && (
                  <p className="text-sm text-slate-500">No AEO-certified exporter profiles.</p>
                )}
                {exporters.data?.items.map((e) => (
                  <div key={e.profileId} className="flex items-center justify-between rounded-md border border-slate-700/60 p-3">
                    <div>
                      <p className="text-sm font-medium">{e.organizationName ?? e.userName ?? `User #${e.userId}`}</p>
                      <p className="text-xs text-slate-500">{e.userEmail} · {e.stakeholderType}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant="secondary">{e.aeoTier ?? "standard"}</Badge>
                      <Badge>{e.aeoStatus}</Badge>
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="queue">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between">
                <div>
                  <CardTitle className="text-base">Prioritized export declaration queue</CardTitle>
                  <CardDescription>AEO-certified exporters first (tier rank, then FIFO).</CardDescription>
                </div>
                <Button variant="outline" size="sm" onClick={() => queue.refetch()} disabled={queue.isFetching}>
                  <RefreshCw className={`h-3.5 w-3.5 ${queue.isFetching ? "animate-spin" : ""}`} />
                </Button>
              </CardHeader>
              <CardContent className="space-y-2">
                {queue.isLoading && <Skeleton className="h-24 w-full" />}
                {queue.error && <QueryError message={queue.error.message} />}
                {queue.data && queue.data.items.length === 0 && (
                  <p className="text-sm text-slate-500">No export declarations in the queue.</p>
                )}
                {queue.data?.items.map((d) => (
                  <div key={d.id} className="flex items-center justify-between rounded-md border border-slate-700/60 p-3">
                    <div>
                      <p className="font-mono text-sm">{d.declarationNumber}</p>
                      <p className="text-xs text-slate-500">
                        {d.traderName ?? `Trader #${d.traderId}`} · {d.hsCode ?? "—"} → {d.countryOfDestination ?? "—"}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      {d.fastLane && <Badge className="bg-amber-500/20 text-amber-300">AEO fast-lane{d.aeoTier ? ` · ${d.aeoTier}` : ""}</Badge>}
                      <Badge variant="outline">{d.status}</Badge>
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="drawback">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Drawback claims — fast-track first</CardTitle>
                <CardDescription>Claims flagged for acceleration by AEO-certified exporters.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-2">
                {drawback.isLoading && <Skeleton className="h-24 w-full" />}
                {drawback.error && <QueryError message={drawback.error.message} />}
                {drawback.data && drawback.data.items.length === 0 && (
                  <p className="text-sm text-slate-500">No drawback claims.</p>
                )}
                {drawback.data?.items.map((c) => (
                  <div key={c.id} className="flex items-center justify-between rounded-md border border-slate-700/60 p-3">
                    <div>
                      <p className="font-mono text-sm">{c.claimNumber}</p>
                      <p className="text-xs text-slate-500">
                        {c.traderName ?? `Trader #${c.traderId}`} · {c.drawbackType} · claimed {c.claimedAmount}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      {c.fastTrack && <Badge className="bg-amber-500/20 text-amber-300">fast-track</Badge>}
                      <Badge variant="outline">{c.status}</Badge>
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="origin">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Rules-of-origin certificates — fast-path first</CardTitle>
                <CardDescription>Certificates filed by AEO-certified exporters are auto-flagged fast-path at submission.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-2">
                {origin.isLoading && <Skeleton className="h-24 w-full" />}
                {origin.error && <QueryError message={origin.error.message} />}
                {origin.data && origin.data.items.length === 0 && (
                  <p className="text-sm text-slate-500">No origin certificates.</p>
                )}
                {origin.data?.items.map((c) => (
                  <div key={c.id} className="flex items-center justify-between rounded-md border border-slate-700/60 p-3">
                    <div>
                      <p className="font-mono text-sm">{c.certNumber ?? `#${c.id}`}</p>
                      <p className="text-xs text-slate-500">
                        {c.exporterName} · {c.originCountry} → {c.destinationCountry} · HS {c.hsCode}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      {c.fastPath && <Badge className="bg-amber-500/20 text-amber-300">fast-path</Badge>}
                      <Badge variant="outline">{c.status}</Badge>
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </DashboardLayout>
  );
}
