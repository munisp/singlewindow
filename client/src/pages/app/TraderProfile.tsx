import DashboardLayout from "@/components/DashboardLayout";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Building2, Pencil, Save, X, CheckCircle2, Clock, AlertTriangle } from "lucide-react";
import { useState, useEffect } from "react";
import { toast } from "sonner";

const STATUS_BADGE: Record<string, { label: string; className: string; icon: React.ReactNode }> = {
  pending: { label: "Pending Review", className: "bg-amber-100 text-amber-700 border-amber-200", icon: <Clock className="h-3 w-3" /> },
  approved: { label: "Approved", className: "bg-emerald-100 text-emerald-700 border-emerald-200", icon: <CheckCircle2 className="h-3 w-3" /> },
  rejected: { label: "Rejected", className: "bg-red-100 text-red-700 border-red-200", icon: <AlertTriangle className="h-3 w-3" /> },
  suspended: { label: "Suspended", className: "bg-slate-100 text-slate-700 border-slate-200", icon: <AlertTriangle className="h-3 w-3" /> },
};

export default function TraderProfile() {
  const { data, isLoading, refetch } = trpc.profiles.me.useQuery();
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({
    organizationName: "",
    organizationCode: "",
    licenseNumber: "",
    taxId: "",
    stakeholderType: "trader" as string,
    country: "GH",
    phone: "",
  });

  useEffect(() => {
    if (data) {
      setForm({
        organizationName: data.organizationName ?? "",
        organizationCode: data.organizationCode ?? "",
        licenseNumber: data.licenseNumber ?? "",
        taxId: data.taxId ?? "",
        stakeholderType: data.stakeholderType ?? "trader",
        country: data.country ?? "",
        phone: data.phone ?? "",
      });
    }
  }, [data]);

  const utils = trpc.useUtils();
  const upsertMutation = trpc.profiles.upsert.useMutation({
    onSuccess: () => {
      toast.success("Profile updated successfully");
      setEditing(false);
      utils.profiles.me.invalidate();
      refetch();
    },
    onError: (err) => toast.error("Failed to update profile", { description: err.message }),
  });

  const handleSave = () => {
    upsertMutation.mutate({
      organizationName: form.organizationName,
      organizationCode: form.organizationCode || undefined,
      licenseNumber: form.licenseNumber || undefined,
      taxId: form.taxId || undefined,
      stakeholderType: (form.stakeholderType || "trader") as any,
      country: form.country || "GH",
      phone: form.phone || undefined,
    });
  };

  const statusConf = data ? STATUS_BADGE[data.status] ?? STATUS_BADGE.pending : null;

  return (
    <DashboardLayout title="My Profile">
      <div className="space-y-6 max-w-3xl">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Building2 className="h-6 w-6 text-primary" />
            My Business Profile
          </h1>
          {data && !editing && (
            <Button variant="outline" size="sm" onClick={() => setEditing(true)} className="gap-2">
              <Pencil className="h-4 w-4" /> Edit Profile
            </Button>
          )}
          {editing && (
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={() => setEditing(false)} className="gap-2">
                <X className="h-4 w-4" /> Cancel
              </Button>
              <Button size="sm" onClick={handleSave} disabled={upsertMutation.isPending} className="gap-2">
                <Save className="h-4 w-4" />
                {upsertMutation.isPending ? "Saving..." : "Save Changes"}
              </Button>
            </div>
          )}
        </div>

        {data && statusConf && (
          <div className={`flex items-center gap-2 px-4 py-2 rounded-lg border text-sm font-medium ${statusConf.className}`}>
            {statusConf.icon}
            Profile Status: {statusConf.label}
            {data.status === "rejected" && (
              <span className="ml-2 text-xs opacity-80">— You may update and resubmit</span>
            )}
          </div>
        )}

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Business Details</CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="space-y-3">
                {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-8 w-full" />)}
              </div>
            ) : !data && !editing ? (
              <div className="text-center py-8 space-y-3">
                <Building2 className="h-10 w-10 text-muted-foreground mx-auto" />
                <p className="text-muted-foreground">No profile found. Complete your business registration to start submitting declarations.</p>
                <Button onClick={() => setEditing(true)}>Create Business Profile</Button>
              </div>
            ) : editing ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label htmlFor="orgName">Organization Name *</Label>
                  <Input id="orgName" value={form.organizationName} onChange={e => setForm(f => ({ ...f, organizationName: e.target.value }))} placeholder="Acme Trading Co." />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="orgCode">Organization Code</Label>
                  <Input id="orgCode" value={form.organizationCode} onChange={e => setForm(f => ({ ...f, organizationCode: e.target.value }))} placeholder="ACME001" />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="licNum">License Number</Label>
                  <Input id="licNum" value={form.licenseNumber} onChange={e => setForm(f => ({ ...f, licenseNumber: e.target.value }))} placeholder="LIC-2024-XXXXX" />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="taxId">Tax ID / TIN</Label>
                  <Input id="taxId" value={form.taxId} onChange={e => setForm(f => ({ ...f, taxId: e.target.value }))} placeholder="TIN-XXXXXXXXX" />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="stakeholderType">Stakeholder Type *</Label>
                  <Select value={form.stakeholderType} onValueChange={v => setForm(f => ({ ...f, stakeholderType: v }))}>
                    <SelectTrigger id="stakeholderType"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="trader">Trader (Importer/Exporter)</SelectItem>
                      <SelectItem value="freight_forwarder">Freight Forwarder</SelectItem>
                      <SelectItem value="customs_officer">Customs Officer</SelectItem>
                      <SelectItem value="oga_officer">OGA Officer</SelectItem>
                      <SelectItem value="bank_officer">Bank Officer</SelectItem>
                      <SelectItem value="port_authority">Port Authority</SelectItem>
                      <SelectItem value="auditor">Auditor</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="country">Country</Label>
                  <Input id="country" value={form.country} onChange={e => setForm(f => ({ ...f, country: e.target.value }))} placeholder="Ghana" />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="phone">Phone</Label>
                  <Input id="phone" value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} placeholder="+233 XX XXX XXXX" />
                </div>
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-4 text-sm">
                {[
                  ["Organization Name", data?.organizationName],
                  ["Organization Code", data?.organizationCode],
                  ["License #", data?.licenseNumber],
                  ["Tax ID", data?.taxId],
                  ["Stakeholder Type", data?.stakeholderType?.replace(/_/g, " ")],
                  ["Country", data?.country],
                  ["Phone", data?.phone],
                  ["Status", data?.status],
                ].map(([label, value]) => (
                  <div key={label as string}>
                    <p className="text-muted-foreground text-xs mb-1">{label}</p>
                    <p className="font-medium capitalize">{value ?? "—"}</p>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}
