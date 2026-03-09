/**
 * TenantPortal.tsx — Super-Admin Multi-Tenancy Portal (Sprint 47)
 * Provision new national customs authority tenants, manage status,
 * configure per-tenant Keycloak realms, and manage tenant user assignments.
 */

import { useState } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import {
  Building2, Plus, Globe, Users, Key, Shield, CheckCircle,
  XCircle, AlertTriangle, RefreshCw, Settings,
} from "lucide-react";

const STATUS_BADGE: Record<string, "default" | "secondary" | "destructive"> = {
  active: "default",
  suspended: "secondary",
  deprovisioned: "destructive",
};

const PLAN_COLORS: Record<string, string> = {
  starter: "text-blue-500",
  standard: "text-green-500",
  enterprise: "text-amber-500",
};

export default function TenantPortal() {
  const [provisionOpen, setProvisionOpen] = useState(false);
  const [form, setForm] = useState({
    name: "",
    country: "",
    contactEmail: "",
    plan: "standard" as "starter" | "standard" | "enterprise",
    keycloakRealm: "",
    keycloakClientId: "",
    keycloakDiscoveryUrl: "",
  });

  const utils = trpc.useUtils();
  const { data: tenants, isLoading } = trpc.tenant.listTenants.useQuery();
  const { data: stats } = trpc.tenant.getTenantStats.useQuery();

  const provisionMutation = trpc.tenant.provisionTenant.useMutation({
    onSuccess: (data) => {
      toast.success(`Tenant '${data.tenant.name}' provisioned`, {
        description: `API prefix: ${data.apiPrefix}`,
      });
      setProvisionOpen(false);
      setForm({ name: "", country: "", contactEmail: "", plan: "standard", keycloakRealm: "", keycloakClientId: "", keycloakDiscoveryUrl: "" });
      utils.tenant.listTenants.invalidate();
      utils.tenant.getTenantStats.invalidate();
    },
    onError: (err) => toast.error("Provisioning failed", { description: err.message }),
  });

  const updateStatusMutation = trpc.tenant.updateTenantStatus.useMutation({
    onSuccess: () => {
      toast.success("Tenant status updated");
      utils.tenant.listTenants.invalidate();
      utils.tenant.getTenantStats.invalidate();
    },
    onError: (err) => toast.error("Update failed", { description: err.message }),
  });

  return (
    <DashboardLayout>
      <div className="p-6 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
              <Building2 className="h-6 w-6 text-blue-500" />
              Tenant Portal
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              Provision and manage national customs authority tenants
            </p>
          </div>
          <Dialog open={provisionOpen} onOpenChange={setProvisionOpen}>
            <DialogTrigger asChild>
              <Button size="sm">
                <Plus className="h-4 w-4 mr-1" /> Provision Tenant
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-lg">
              <DialogHeader>
                <DialogTitle>Provision New Customs Authority</DialogTitle>
              </DialogHeader>
              <div className="space-y-4 pt-2">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label>Authority Name *</Label>
                    <Input placeholder="Ghana Revenue Authority" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
                  </div>
                  <div>
                    <Label>Country Code (ISO-3) *</Label>
                    <Input placeholder="GHA" maxLength={3} value={form.country} onChange={(e) => setForm({ ...form, country: e.target.value.toUpperCase() })} />
                  </div>
                </div>
                <div>
                  <Label>Contact Email *</Label>
                  <Input type="email" placeholder="admin@gra.gov.gh" value={form.contactEmail} onChange={(e) => setForm({ ...form, contactEmail: e.target.value })} />
                </div>
                <div>
                  <Label>Plan</Label>
                  <Select value={form.plan} onValueChange={(v) => setForm({ ...form, plan: v as typeof form.plan })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="starter">Starter</SelectItem>
                      <SelectItem value="standard">Standard</SelectItem>
                      <SelectItem value="enterprise">Enterprise</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="border-t border-border pt-3">
                  <p className="text-xs text-muted-foreground mb-3 font-medium">Keycloak SSO (Optional)</p>
                  <div className="space-y-2">
                    <Input placeholder="Realm name" value={form.keycloakRealm} onChange={(e) => setForm({ ...form, keycloakRealm: e.target.value })} />
                    <Input placeholder="Client ID" value={form.keycloakClientId} onChange={(e) => setForm({ ...form, keycloakClientId: e.target.value })} />
                    <Input placeholder="OIDC Discovery URL" value={form.keycloakDiscoveryUrl} onChange={(e) => setForm({ ...form, keycloakDiscoveryUrl: e.target.value })} />
                  </div>
                </div>
                <div className="flex justify-end gap-2 pt-2">
                  <Button variant="outline" onClick={() => setProvisionOpen(false)}>Cancel</Button>
                  <Button
                    onClick={() => provisionMutation.mutate(form)}
                    disabled={!form.name || !form.country || !form.contactEmail || provisionMutation.isPending}
                  >
                    {provisionMutation.isPending ? "Provisioning…" : "Provision"}
                  </Button>
                </div>
              </div>
            </DialogContent>
          </Dialog>
        </div>

        {/* Stats Cards */}
        {stats && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <Card>
              <CardContent className="p-4">
                <div className="flex items-center gap-2 mb-1">
                  <Building2 className="h-4 w-4 text-blue-500" />
                  <span className="text-xs text-muted-foreground">Total Tenants</span>
                </div>
                <p className="text-2xl font-bold">{stats.total}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <div className="flex items-center gap-2 mb-1">
                  <CheckCircle className="h-4 w-4 text-green-500" />
                  <span className="text-xs text-muted-foreground">Active</span>
                </div>
                <p className="text-2xl font-bold text-green-600">{stats.active}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <div className="flex items-center gap-2 mb-1">
                  <AlertTriangle className="h-4 w-4 text-amber-500" />
                  <span className="text-xs text-muted-foreground">Suspended</span>
                </div>
                <p className="text-2xl font-bold text-amber-600">{stats.suspended}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <div className="flex items-center gap-2 mb-1">
                  <XCircle className="h-4 w-4 text-red-500" />
                  <span className="text-xs text-muted-foreground">Deprovisioned</span>
                </div>
                <p className="text-2xl font-bold text-red-600">{stats.deprovisioned}</p>
              </CardContent>
            </Card>
          </div>
        )}

        {/* Plan breakdown */}
        {stats?.by_plan && Object.keys(stats.by_plan).length > 0 && (
          <div className="flex items-center gap-4 text-sm">
            <span className="text-muted-foreground font-medium">By Plan:</span>
            {Object.entries(stats.by_plan).map(([plan, count]) => (
              <span key={plan} className={`font-semibold ${PLAN_COLORS[plan] ?? ""}`}>
                {plan.charAt(0).toUpperCase() + plan.slice(1)}: {count}
              </span>
            ))}
          </div>
        )}

        {/* Tenant List */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Globe className="h-4 w-4 text-blue-500" />
              Provisioned Tenants
            </CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="h-32 flex items-center justify-center text-muted-foreground text-sm">Loading…</div>
            ) : !tenants?.length ? (
              <div className="h-32 flex flex-col items-center justify-center text-muted-foreground text-sm gap-2">
                <Building2 className="h-8 w-8 opacity-30" />
                <p>No tenants provisioned yet</p>
                <Button size="sm" variant="outline" onClick={() => setProvisionOpen(true)}>
                  <Plus className="h-4 w-4 mr-1" /> Provision First Tenant
                </Button>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border text-muted-foreground">
                      <th className="text-left py-2 pr-4">Authority</th>
                      <th className="text-left py-2 pr-4">Country</th>
                      <th className="text-left py-2 pr-4">Plan</th>
                      <th className="text-left py-2 pr-4">API Prefix</th>
                      <th className="text-left py-2 pr-4">Status</th>
                      <th className="text-left py-2 pr-4">Created</th>
                      <th className="text-right py-2">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {tenants.map((t) => (
                      <tr key={t.id} className="border-b border-border/50 hover:bg-muted/30">
                        <td className="py-2 pr-4">
                          <div className="font-medium">{t.name}</div>
                          <div className="text-xs text-muted-foreground">{t.contactEmail}</div>
                        </td>
                        <td className="py-2 pr-4">
                          <Badge variant="outline" className="text-xs">{t.country}</Badge>
                        </td>
                        <td className="py-2 pr-4">
                          <span className={`font-medium text-xs ${PLAN_COLORS[t.plan] ?? ""}`}>
                            {t.plan.charAt(0).toUpperCase() + t.plan.slice(1)}
                          </span>
                        </td>
                        <td className="py-2 pr-4 font-mono text-xs text-muted-foreground">{t.apiPrefix}</td>
                        <td className="py-2 pr-4">
                          <Badge variant={STATUS_BADGE[t.status] ?? "secondary"} className="text-xs">
                            {t.status}
                          </Badge>
                        </td>
                        <td className="py-2 pr-4 text-xs text-muted-foreground">
                          {new Date(t.createdAt).toLocaleDateString()}
                        </td>
                        <td className="py-2 text-right">
                          <div className="flex items-center justify-end gap-1">
                            {t.status === "active" && (
                              <Button
                                size="sm"
                                variant="outline"
                                className="text-xs h-7"
                                onClick={() => updateStatusMutation.mutate({ tenantId: t.id, status: "suspended" })}
                              >
                                Suspend
                              </Button>
                            )}
                            {t.status === "suspended" && (
                              <Button
                                size="sm"
                                variant="outline"
                                className="text-xs h-7 text-green-600"
                                onClick={() => updateStatusMutation.mutate({ tenantId: t.id, status: "active" })}
                              >
                                Reactivate
                              </Button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Info Panel */}
        <Card className="border-blue-200 bg-blue-50/30 dark:bg-blue-950/20">
          <CardContent className="p-4">
            <div className="flex items-start gap-3">
              <Shield className="h-5 w-5 text-blue-500 mt-0.5 shrink-0" />
              <div className="text-sm">
                <p className="font-medium text-blue-700 dark:text-blue-300">Multi-Tenancy Architecture</p>
                <p className="text-muted-foreground mt-1">
                  Each tenant is an isolated national customs authority with its own API prefix, Keycloak realm configuration,
                  and data partition. All declarations, payments, and audit events are scoped to the tenant via{" "}
                  <code className="text-xs bg-muted px-1 rounded">tenant_id</code>. Tenant users are assigned roles
                  (admin, customs_officer, trader, port_operator, oga_officer, auditor, viewer) that map to Keycloak realm roles
                  via the configurable role mapping table.
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}
