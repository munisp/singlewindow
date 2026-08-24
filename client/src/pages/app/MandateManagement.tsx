import { useState } from "react";
import type { inferRouterOutputs } from "@trpc/server";
import DashboardLayout from "@/components/DashboardLayout";
import { trpc, type AppRouter } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";

type RouterOutputs = inferRouterOutputs<AppRouter>;
type Mandate = RouterOutputs["stakeholderRegistrations"]["mineMandates"][number];
type ApprovedAgent = RouterOutputs["stakeholderRegistrations"]["approvedAgents"][number];

function stateOf(mandate: { revokedAt: Date | string | null; validFrom: Date | string; validUntil: Date | string }) {
  if (mandate.revokedAt) return "revoked";
  const now = Date.now();
  if (new Date(mandate.validUntil).getTime() <= now) return "expired";
  if (new Date(mandate.validFrom).getTime() > now) return "scheduled";
  return "active";
}

export default function MandateManagement() {
  const [agentSearch, setAgentSearch] = useState("");
  const [selectedAgent, setSelectedAgent] = useState<ApprovedAgent | null>(null);
  const [validUntil, setValidUntil] = useState("");
  const utils = trpc.useUtils();
  const principal = trpc.stakeholderRegistrations.mineMandates.useQuery({ side: "principal" });
  const agent = trpc.stakeholderRegistrations.mineMandates.useQuery({ side: "agent" });
  const approvedAgents = trpc.stakeholderRegistrations.approvedAgents.useQuery();
  const create = trpc.stakeholderRegistrations.createMandate.useMutation({ onSuccess: () => { toast.success("Mandate granted"); principal.refetch(); setSelectedAgent(null); setAgentSearch(""); setValidUntil(""); }, onError: error => toast.error("Mandate creation failed", { description: error.message }) });
  const revoke = trpc.stakeholderRegistrations.revokeMandate.useMutation({ onSuccess: () => { toast.success("Mandate revoked"); utils.stakeholderRegistrations.mineMandates.invalidate(); }, onError: error => toast.error("Mandate revocation failed", { description: error.message }) });
  const matchingAgents = (approvedAgents.data ?? []).filter(candidate => {
    const query = agentSearch.trim().toLowerCase();
    return !query ||
      candidate.organizationName.toLowerCase().includes(query) ||
      candidate.licenseNumber?.toLowerCase().includes(query);
  });
  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!selectedAgent) return;
    create.mutate({ agentUserId: selectedAgent.userId, validUntil: new Date(`${validUntil}T23:59:59.000Z`).toISOString() });
  };
  return <DashboardLayout title="Mandate Management"><div className="max-w-4xl space-y-6">
    <Card><CardHeader><CardTitle>Grant a principal-to-agent mandate</CardTitle><p className="text-sm text-muted-foreground">Select an approved, currently licensed agent from the directory.</p></CardHeader><CardContent><form className="space-y-4" onSubmit={submit}>
      <div className="space-y-2"><Label htmlFor="agent-search">Licensed agent</Label><Input id="agent-search" required={!selectedAgent} value={selectedAgent?.organizationName ?? agentSearch} onChange={event => { setSelectedAgent(null); setAgentSearch(event.target.value); }} placeholder="Search by organisation or licence number" />
        {!selectedAgent && agentSearch.trim() && <div className="max-h-48 overflow-y-auto rounded-md border">{approvedAgents.isLoading ? <p className="p-3 text-sm text-muted-foreground">Loading approved agents…</p> : matchingAgents.length ? matchingAgents.map(candidate => <button key={candidate.userId} type="button" className="block w-full border-b p-3 text-left text-sm last:border-0 hover:bg-muted" onClick={() => { setSelectedAgent(candidate); setAgentSearch(""); }}><span className="font-medium">{candidate.organizationName}</span><span className="mt-1 block text-xs text-muted-foreground">Licence {candidate.licenseNumber ?? "not recorded"} · expires {candidate.licenseExpiresAt ? new Date(String(candidate.licenseExpiresAt)).toLocaleDateString() : "not recorded"}</span></button>) : <p className="p-3 text-sm text-muted-foreground">No approved licensed agents match that search.</p>}</div>}
      </div>
      <div className="grid gap-4 sm:grid-cols-2"><div><Label htmlFor="mandate-valid-until">Valid until</Label><Input id="mandate-valid-until" required type="date" value={validUntil} onChange={e => setValidUntil(e.target.value)} /></div><div className="flex items-end"><Button type="submit" disabled={create.isPending || !selectedAgent}>Grant mandate</Button></div></div>
    </form></CardContent></Card>
    <MandateList title="Mandates I granted" mandates={principal.data} canRevoke onRevoke={id => revoke.mutate({ mandateId: id })} />
    <MandateList title="Mandates I hold as agent" mandates={agent.data} />
  </div></DashboardLayout>;
}

function MandateList({ title, mandates, canRevoke, onRevoke }: { title: string; mandates?: Mandate[]; canRevoke?: boolean; onRevoke?: (id: number) => void }) {
  return <Card><CardHeader><CardTitle className="text-base">{title}</CardTitle></CardHeader><CardContent>{mandates?.length ? <div className="space-y-2">{mandates.map(mandate => { const state = stateOf(mandate); const stateClass = { active: "border-emerald-500 text-emerald-600", scheduled: "border-blue-500 text-blue-600", expired: "border-amber-500 text-amber-700", revoked: "border-red-500 bg-red-50 text-red-700" }[state]; return <div key={mandate.id} className="flex flex-wrap items-center justify-between gap-2 rounded border p-3 text-sm"><div><p className="font-mono">{mandate.referenceNumber}</p><p className="text-muted-foreground">Principal #{mandate.principalUserId} · Agent #{mandate.agentUserId}</p><p className="text-xs text-muted-foreground">{new Date(mandate.validFrom).toLocaleDateString()} – {new Date(mandate.validUntil).toLocaleDateString()}{mandate.revokedAt ? ` · revoked ${new Date(mandate.revokedAt).toLocaleString()}` : ""}</p>{mandate.revocationReason && <p className="text-xs text-red-600">{mandate.revocationReason}</p>}</div><div className="flex items-center gap-2"><Badge variant="outline" className={stateClass}>{state}</Badge>{canRevoke && state === "active" && <Button size="sm" variant="destructive" onClick={() => onRevoke?.(mandate.id)}>Revoke</Button>}</div></div>; })}</div> : <p className="text-sm text-muted-foreground">No mandate history.</p>}</CardContent></Card>;
}
