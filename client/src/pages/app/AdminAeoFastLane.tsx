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
import { Award, RefreshCw, Sparkles, Zap } from "lucide-react";
import { useMemo, useState } from "react";

function QueryError({ message }: { message?: string }) {
  return <p className="text-sm text-red-400">{message ?? "Failed to load."}</p>;
}

export default function AdminAeoFastLane() {
  const [tab, setTab] = useState("exporters");
  const [showShadow, setShowShadow] = useState(false);
  const exporters = trpc.aeoFastLane.admin.accreditedExporters.useQuery({});
  const queue = trpc.aeoFastLane.queue.prioritized.useQuery({});
  const drawback = trpc.aeoFastLane.drawback.fastTrackQueue.useQuery({});
  const origin = trpc.aeoFastLane.origin.fastPathQueue.useQuery({});

  // Phase 18: RL queue-policy SHADOW suggestion. Loaded only when the
  // officer opts in via the toggle; never auto-applied to the queue.
  const shadow = trpc.queuePolicy.suggestion.useQuery({}, { enabled: showShadow, retry: false });
  const recordDecision = trpc.queuePolicy.recordDecision.useMutation();
  const utils = trpc.useUtils();

  // Map declaration id -> 1-based suggested position for badge lookup.
  const suggestedPosition = useMemo(() => {
    const map = new Map<number, number>();
    shadow.data?.suggestedOrder.forEach((id, i) => map.set(id, i + 1));
    return map;
  }, [shadow.data]);

  /** Honest untrained/unconfigured state is a first-class rendering. */
  const shadowRefusal =
    shadow.error?.message?.includes("QUEUE_POLICY_NOT_TRAINED") ? "untrained"
    : shadow.error?.message?.includes("QUEUE_POLICY_NOT_CONFIGURED") ? "not-configured"
    : null;

  function logDecision(declarationId: number, authoritativePosition: number, decision: "accepted" | "overrode") {
    if (!shadow.data) return;
    recordDecision.mutate(
      {
        declarationId,
        policyVersion: shadow.data.policyVersion,
        suggestedPosition: suggestedPosition.get(declarationId) ?? authoritativePosition,
        authoritativePosition,
        decision,
      },
      { onSuccess: () => utils.queuePolicy.suggestion.invalidate() }
    );
  }

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
                <div className="flex items-center gap-2">
                  <Button
                    variant={showShadow ? "default" : "outline"}
                    size="sm"
                    aria-pressed={showShadow}
                    onClick={() => setShowShadow((v) => !v)}
                  >
                    <Sparkles className="mr-1 h-3.5 w-3.5" />
                    {shadow.data
                      ? `Suggested order (shadow policy ${shadow.data.policyVersion})`
                      : "Shadow suggestion"}
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => queue.refetch()} disabled={queue.isFetching}>
                    <RefreshCw className={`h-3.5 w-3.5 ${queue.isFetching ? "animate-spin" : ""}`} />
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="space-y-2">
                {showShadow && shadow.isLoading && <Skeleton className="h-10 w-full" />}
                {showShadow && shadowRefusal === "untrained" && (
                  <div className="rounded-md border border-slate-700/60 p-3" role="status">
                    <p className="text-sm font-medium">Policy not trained</p>
                    <p className="text-xs text-slate-500">
                      The ml-stack has no promoted queue policy yet (honest refusal). The authoritative
                      AEO/FIFO order below remains in force — no suggestion is shown or fabricated.
                    </p>
                  </div>
                )}
                {showShadow && shadowRefusal === "not-configured" && (
                  <div className="rounded-md border border-slate-700/60 p-3" role="status">
                    <p className="text-sm font-medium">Shadow policy not configured</p>
                    <p className="text-xs text-slate-500">
                      This deployment has not enabled the RL shadow policy (ML_STACK_HTTP_URL /
                      RL_QUEUE_POLICY_SHADOW_ENABLED). The authoritative order below remains in force.
                    </p>
                  </div>
                )}
                {showShadow && shadow.error && shadowRefusal === null && (
                  <QueryError message={shadow.error.message} />
                )}
                {showShadow && shadow.data && (
                  <p className="text-xs text-slate-500">
                    Shadow policy <span className="font-mono">{shadow.data.policyVersion}</span> suggested an order for{" "}
                    {shadow.data.suggestedOrder.length} queued declarations
                    {shadow.data.opeScore != null ? ` · OPE score ${shadow.data.opeScore.toFixed(3)}` : ""}.
                    Advisory only — it is never applied automatically; accepting or overriding is logged.
                  </p>
                )}
                {queue.isLoading && <Skeleton className="h-24 w-full" />}
                {queue.error && <QueryError message={queue.error.message} />}
                {queue.data && queue.data.items.length === 0 && (
                  <p className="text-sm text-slate-500">No export declarations in the queue.</p>
                )}
                {queue.data?.items.map((d, idx) => {
                  const suggested = suggestedPosition.get(d.id);
                  const differs = suggested !== undefined && suggested !== idx + 1;
                  return (
                    <div key={d.id} className="flex items-center justify-between rounded-md border border-slate-700/60 p-3">
                      <div>
                        <p className="font-mono text-sm">{d.declarationNumber}</p>
                        <p className="text-xs text-slate-500">
                          {d.traderName ?? `Trader #${d.traderId}`} · {d.hsCode ?? "—"} → {d.countryOfDestination ?? "—"}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        {showShadow && shadow.data && suggested !== undefined && (
                          <Badge className="bg-sky-500/20 text-sky-300">
                            suggested #{suggested}{differs ? ` (auth #${idx + 1})` : ""}
                          </Badge>
                        )}
                        {showShadow && shadow.data && (
                          <>
                            <Button
                              variant="outline"
                              size="sm"
                              disabled={recordDecision.isPending}
                              onClick={() => logDecision(d.id, idx + 1, "accepted")}
                            >
                              Accept
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              disabled={recordDecision.isPending}
                              onClick={() => logDecision(d.id, idx + 1, "overrode")}
                            >
                              Override
                            </Button>
                          </>
                        )}
                        {d.fastLane && <Badge className="bg-amber-500/20 text-amber-300">AEO fast-lane{d.aeoTier ? ` · ${d.aeoTier}` : ""}</Badge>}
                        <Badge variant="outline">{d.status}</Badge>
                      </div>
                    </div>
                  );
                })}
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
