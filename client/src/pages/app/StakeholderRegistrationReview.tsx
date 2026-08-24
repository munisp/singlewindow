import DashboardLayout from "@/components/DashboardLayout";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";

export default function StakeholderRegistrationReview() {
  const utils = trpc.useUtils();
  const { data, isLoading, isError } = trpc.stakeholderRegistrations.pending.useQuery();
  const approve = trpc.stakeholderRegistrations.approve.useMutation({ onSuccess: () => { toast.success("Registration approved"); utils.stakeholderRegistrations.pending.invalidate(); }, onError: error => toast.error("Approval failed", { description: error.message }) });
  const reject = trpc.stakeholderRegistrations.reject.useMutation({ onSuccess: () => { toast.success("Registration rejected"); utils.stakeholderRegistrations.pending.invalidate(); }, onError: error => toast.error("Rejection failed", { description: error.message }) });
  return <DashboardLayout title="Stakeholder Registration Review"><div className="max-w-5xl space-y-4">
    <Card><CardHeader><CardTitle>Pending registrations</CardTitle></CardHeader><CardContent>{isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : isError ? <p className="text-sm text-red-600">Registration review is unavailable.</p> : data?.length ? <div className="space-y-3">{data.map(item => <div key={item.id} className="grid gap-3 rounded-lg border p-4 md:grid-cols-[1fr_auto]"><div className="space-y-1 text-sm"><div className="flex flex-wrap items-center gap-2"><span className="font-mono">{item.referenceNumber}</span><Badge variant="outline" className="capitalize">{item.stakeholderType.replace(/_/g, " ")}</Badge></div><p className="font-medium">{item.organizationName}</p><p className="text-muted-foreground">Country: {item.country} · Applicant #{item.userId}</p>{item.licenseNumber && <p className="text-muted-foreground">Licence: {item.licenseNumber} (expires {item.licenseExpiresAt ? new Date(item.licenseExpiresAt).toLocaleDateString() : "—"})</p>}</div><div className="flex items-center gap-2"><Button size="sm" onClick={() => approve.mutate({ registrationId: item.id })} disabled={approve.isPending}>Approve</Button><Button size="sm" variant="destructive" onClick={() => { const reason = window.prompt("Rejection reason (at least 10 characters):"); if (reason && reason.length >= 10) reject.mutate({ registrationId: item.id, reason }); }} disabled={reject.isPending}>Reject</Button></div></div>)}</div> : <p className="text-sm text-muted-foreground">No registrations are pending review.</p>}</CardContent></Card>
  </div></DashboardLayout>;
}
