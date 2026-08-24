import { useState } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";

const types = [
  ["freight_forwarder", "Licensed customs / freight-forwarding agent"],
  ["shipping_line", "Shipping line"],
  ["shipping_company", "Shipping company"],
  ["airline_gha", "Airline / GHA"],
] as const;

export default function StakeholderRegistration() {
  const [type, setType] = useState<typeof types[number][0]>("freight_forwarder");
  const [form, setForm] = useState({ organizationName: "", organizationCode: "", licenseNumber: "", licenseExpiresAt: "", taxId: "", country: "NG", phone: "" });
  const mutation = trpc.stakeholderRegistrations.register.useMutation({
    onSuccess: result => { toast.success("Registration submitted", { description: result.referenceNumber }); },
    onError: error => toast.error("Registration failed", { description: error.message }),
  });
  const set = (key: keyof typeof form, value: string) => setForm(previous => ({ ...previous, [key]: value }));
  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    mutation.mutate({
      stakeholderType: type,
      organizationName: form.organizationName,
      organizationCode: form.organizationCode || undefined,
      licenseNumber: form.licenseNumber || undefined,
      licenseExpiresAt: form.licenseExpiresAt ? `${form.licenseExpiresAt}T23:59:59.000Z` : undefined,
      taxId: form.taxId || undefined,
      country: form.country.toUpperCase(),
      phone: form.phone || undefined,
      kycDocumentIds: [],
    });
  };
  return <DashboardLayout title="Stakeholder Registration"><div className="mx-auto max-w-2xl space-y-6">
    <Card><CardHeader><CardTitle>Register a stakeholder party</CardTitle><p className="text-sm text-muted-foreground">Your application remains pending until reviewed by an authorised officer.</p></CardHeader>
      <CardContent><form className="space-y-4" onSubmit={submit}>
        <div><Label>Party type</Label><Select value={type} onValueChange={value => setType(value as typeof type)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{types.map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent></Select></div>
        <div><Label>Organisation name</Label><Input required value={form.organizationName} onChange={e => set("organizationName", e.target.value)} /></div>
        <div className="grid gap-4 sm:grid-cols-2"><div><Label>Organisation code</Label><Input value={form.organizationCode} onChange={e => set("organizationCode", e.target.value)} /></div><div><Label>Tax ID</Label><Input value={form.taxId} onChange={e => set("taxId", e.target.value)} /></div></div>
        {type === "freight_forwarder" && <div className="grid gap-4 rounded-lg border p-4 sm:grid-cols-2"><div><Label>Licence number</Label><Input required value={form.licenseNumber} onChange={e => set("licenseNumber", e.target.value)} /></div><div><Label>Licence expiry</Label><Input required type="date" value={form.licenseExpiresAt} onChange={e => set("licenseExpiresAt", e.target.value)} /></div></div>}
        <div className="grid gap-4 sm:grid-cols-2"><div><Label>Country (ISO 2)</Label><Input required maxLength={2} value={form.country} onChange={e => set("country", e.target.value)} /></div><div><Label>Phone</Label><Input value={form.phone} onChange={e => set("phone", e.target.value)} /></div></div>
        <Button type="submit" disabled={mutation.isPending}>{mutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Submit for review</Button>
      </form></CardContent>
    </Card>
    <MyRegistrations />
  </div></DashboardLayout>;
}

function MyRegistrations() {
  const { data, isLoading } = trpc.stakeholderRegistrations.mine.useQuery();
  return <Card><CardHeader><CardTitle className="text-base">My applications</CardTitle></CardHeader><CardContent>{isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : data?.length ? <div className="space-y-2">{data.map(item => <div key={item.id} className="flex flex-wrap items-center justify-between gap-2 rounded border p-3 text-sm"><span className="font-mono">{item.referenceNumber}</span><span>{item.organizationName}</span><Badge variant="outline" className="capitalize">{item.status}</Badge>{item.rejectionReason && <span className="basis-full text-xs text-red-600">{item.rejectionReason}</span>}</div>)}</div> : <p className="text-sm text-muted-foreground">No stakeholder applications submitted.</p>}</CardContent></Card>;
}
