import { useState } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";

function stateOf(mandate: { revokedAt: Date | string | null; validFrom: Date | string; validUntil: Date | string }) {
  if (mandate.revokedAt) return "revoked";
  const now = Date.now();
  if (new Date(mandate.validUntil).getTime() <= now) return "expired";
  if (new Date(mandate.validFrom).getTime() > now) return "scheduled";
  return "active";
}

export default function MandateManagement() {
  const [agentUserId, setAgentUserId] = useState("");
  const [validUntil, setValidUntil] = useState("");
  const utils = trpc.useUtils();
  const principal = trpc.stakeholderRegistrations.mineMandates.useQuery({ side: "principal" });
  const agent = trpc.stakeholderRegistrations.mineMandates.useQuery({ side: "agent" });
  const create = trpc.stakeholderRegistrations.createMandate.useMutation({ onSuccess: () => { toast.success("Mandate granted"); principal.refetch(); setAgentUserId(""); setValidUntil(""); }, onError: error => toast.error("Mandate creation failed", { description: error.message }) });
  const revoke = trpc.stakeholderRegistrations.revokeMandate.useMutation({ onSuccess: () => { toast.success("Mandate revoked"); utils.stakeholderRegistrations.mineMandates.invalidate(); }, onError: error => toast.error("Mandate revocation failed", { description: error.message }) });
  const submit = (event: React.FormEvent) => { event.preventDefault(); create.mutate({ agentUserId: Number(agentUserId), validUntil: new Date(`${validUntil}T23:59:59.000Z`).toISOString() }); };
  return <DashboardLayout title="Mandate Management"><div className="max-w-4xl space-y-6">
    <Card><CardHeader><CardTitle>Grant a principal-to-agent mandate</CardTitle></CardHeader><CardContent><form className="grid gap-4 sm:grid-cols-3" onSubmit={submit}><div><Label>Agent user ID</Label><Input required type="number" min="1" value={agentUserId} onChange={e => setAgentUserId(e.target.value)} /></div><div><Label>Valid until</Label><Input required type="date" value={validUntil} onChange={e => setValidUntil(e.target.value)} /></div><div className="flex items-end"><Button type="submit" disabled={create.isPending}>Grant mandate</Button></div></form></CardContent></Card>
    <MandateList title="Mandates I granted" mandates={principal.data} canRevoke onRevoke={id => revoke.mutate({ mandateId: id })} />
    <MandateList title="Mandates I hold as agent" mandates={agent.data} />
  </div></DashboardLayout>;
}

function MandateList({ title, mandates, canRevoke, onRevoke }: { title: string; mandates?: Array<any>; canRevoke?: boolean; onRevoke?: (id: number) => void }) {
  return <Card><CardHeader><CardTitle className="text-base">{title}</CardTitle></CardHeader><CardContent>{mandates?.length ? <div className="space-y-2">{mandates.map(mandate => { const state = stateOf(mandate); return <div key={mandate.id} className="flex flex-wrap items-center justify-between gap-2 rounded border p-3 text-sm"><div><p className="font-mono">{mandate.referenceNumber}</p><p className="text-muted-foreground">Principal #{mandate.principalUserId} · Agent #{mandate.agentUserId}</p><p className="text-xs text-muted-foreground">{new Date(mandate.validFrom).toLocaleDateString()} – {new Date(mandate.validUntil).toLocaleDateString()}{mandate.revokedAt ? ` · revoked ${new Date(mandate.revokedAt).toLocaleString()}` : ""}</p>{mandate.revocationReason && <p className="text-xs text-red-600">{mandate.revocationReason}</p>}</div><div className="flex items-center gap-2"><Badge variant="outline" className={state === "active" ? "border-emerald-500 text-emerald-600" : "border-amber-500 text-amber-600"}>{state}</Badge>{canRevoke && state === "active" && <Button size="sm" variant="destructive" onClick={() => onRevoke?.(mandate.id)}>Revoke</Button>}</div></div>; })}</div> : <p className="text-sm text-muted-foreground">No mandate history.</p>}</CardContent></Card>;
}
