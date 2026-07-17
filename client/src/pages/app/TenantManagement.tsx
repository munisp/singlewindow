/**
 * Tenant Management — TradeGateway™ NGSWTP
 * Admin page for managing multi-tenant deployments, Keycloak SSO configs,
 * and Caddy On-Demand TLS custom domain registration.
 */
import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import {
  Building2, Plus, RefreshCw, Users, Key, CheckCircle,
  XCircle, Globe, Copy, AlertTriangle, ShieldCheck, Trash2,
} from "lucide-react";

function formatDate(ts: Date | string | null | undefined) {
  if (!ts) return "—";
  return new Date(ts).toLocaleString();
}

const STATUS_COLORS: Record<string, string> = {
  active: "bg-green-100 text-green-800 border-green-200",
  suspended: "bg-red-100 text-red-800 border-red-200",
  pending: "bg-yellow-100 text-yellow-800 border-yellow-200",
  trial: "bg-blue-100 text-blue-800 border-blue-200",
};

const DOMAIN_STATUS_COLORS: Record<string, string> = {
  verified: "bg-green-100 text-green-800 border-green-200",
  pending: "bg-yellow-100 text-yellow-800 border-yellow-200",
  none: "bg-gray-100 text-gray-600 border-gray-200",
};

export default function TenantManagement() {
  const { user } = useAuth();
  const { toast } = useToast();
  const utils = trpc.useUtils();
  const isAdmin = user?.role === "admin";

  const [showProvisionDialog, setShowProvisionDialog] = useState(false);
  const [showKeycloakDialog, setShowKeycloakDialog] = useState(false);
  const [showUsersDialog, setShowUsersDialog] = useState(false);
  const [showDomainDialog, setShowDomainDialog] = useState(false);
  const [selectedTenantId, setSelectedTenantId] = useState<number | null>(null);
  const [selectedTenantName, setSelectedTenantName] = useState<string>("");
  const [domainInput, setDomainInput] = useState("");
  const [provisionForm, setProvisionForm] = useState({
    name: "",
    country: "GHA",
    plan: "standard" as "starter" | "standard" | "enterprise",
    contactEmail: "",
  });
  const [keycloakForm, setKeycloakForm] = useState({
    realm: "",
    discoveryUrl: "https://auth.tradegateway.gov/realms/tradegateway/.well-known/openid-configuration",
    clientId: "tradegateway-app",
    clientSecret: "",
    adminUser: "admin",
    adminPassword: "",
  });

  // ── Queries ──────────────────────────────────────────────────────────────────
  const { data: tenants, isLoading } = trpc.tenant.listTenants.useQuery(undefined, { enabled: isAdmin });
  const { data: stats } = trpc.tenant.getTenantStats.useQuery(undefined, { enabled: isAdmin });
  const { data: tenantUsers, isLoading: usersLoading } = trpc.tenant.listTenantUsers.useQuery(
    { tenantId: String(selectedTenantId!) },
    { enabled: selectedTenantId !== null && showUsersDialog }
  );
  const { data: myTenants } = trpc.tenant.getMyTenants.useQuery(undefined, { enabled: !isAdmin });
  const { data: domainList, isLoading: domainsLoading, refetch: refetchDomains } =
    trpc.tenant.listTenantDomains.useQuery(undefined, { enabled: isAdmin });

  // ── Mutations ─────────────────────────────────────────────────────────────────
  const provisionMutation = trpc.tenant.provisionTenant.useMutation({
    onSuccess: () => {
      toast({ title: "Tenant provisioned" });
      utils.tenant.listTenants.invalidate();
      utils.tenant.getTenantStats.invalidate();
      setShowProvisionDialog(false);
      setProvisionForm({ name: "", country: "GHA", plan: "standard", contactEmail: "" });
    },
    onError: (err) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const updateStatusMutation = trpc.tenant.updateTenantStatus.useMutation({
    onSuccess: () => {
      toast({ title: "Status updated" });
      utils.tenant.listTenants.invalidate();
    },
    onError: (err) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const upsertKeycloakMutation = trpc.tenant.upsertKeycloakConfig.useMutation({
    onSuccess: () => {
      toast({ title: "Keycloak config saved" });
      setShowKeycloakDialog(false);
    },
    onError: (err) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const registerDomainMutation = trpc.tenant.registerCustomDomain.useMutation({
    onSuccess: (data: any) => {
      toast({ title: "Domain registered", description: `Add the DNS TXT record to verify: ${data.verificationToken}` });
      utils.tenant.listTenantDomains.invalidate();
      setDomainInput("");
    },
    onError: (err) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const verifyDomainMutation = trpc.tenant.verifyCustomDomain.useMutation({
    onSuccess: (data: any) => {
      if (data.verified) {
        toast({ title: "Domain verified!", description: `${data.domain} is now active. Caddy will issue a TLS certificate on the next request.` });
      } else {
        toast({ title: "DNS record not found yet", description: "The TXT record may take up to 48 hours to propagate. Try again later.", variant: "destructive" });
      }
      utils.tenant.listTenantDomains.invalidate();
    },
    onError: (err) => toast({ title: "Verification failed", description: err.message, variant: "destructive" }),
  });

  const removeDomainMutation = trpc.tenant.removeCustomDomain.useMutation({
    onSuccess: () => {
      toast({ title: "Custom domain removed" });
      utils.tenant.listTenantDomains.invalidate();
    },
    onError: (err) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const tenantList: any[] = Array.isArray(tenants) ? tenants : [];
  const domainRows: any[] = Array.isArray(domainList) ? domainList : [];

  if (!isAdmin) {
    return (
      <div className="p-6 space-y-6">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Building2 className="w-7 h-7 text-accent" />
            My Tenants
          </h1>
          <p className="text-muted-foreground text-sm mt-1">Organizations you belong to</p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {(myTenants ?? []).map((t: any) => (
            <div key={t.id} className="bg-card border rounded-lg p-4">
              <div className="flex items-center justify-between mb-2">
                <span className="font-medium">{t.name}</span>
                <Badge className={`text-xs border ${STATUS_COLORS[t.status] ?? STATUS_COLORS.pending}`}>{t.status}</Badge>
              </div>
              <div className="text-xs text-muted-foreground">{t.country} · {t.plan} plan</div>
            </div>
          ))}
          {(!myTenants || myTenants.length === 0) && (
            <div className="col-span-2 text-center py-8 text-muted-foreground">
              <Building2 className="w-8 h-8 mx-auto mb-2 opacity-30" />
              <p>You are not a member of any tenant</p>
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <Building2 className="w-7 h-7 text-accent" />
            Tenant Management
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            Provision and manage multi-tenant deployments
          </p>
        </div>
        <Button
          onClick={() => setShowProvisionDialog(true)}
          className="bg-accent hover:bg-[#b8891a] text-white"
        >
          <Plus className="w-4 h-4 mr-2" /> Provision Tenant
        </Button>
      </div>

      {/* Stats */}
      {stats && (
        <div className="grid grid-cols-4 gap-4">
          <div className="bg-card border rounded-lg p-4">
            <div className="text-xs text-muted-foreground uppercase">Total Tenants</div>
            <div className="text-2xl font-bold mt-1">{(stats as any).totalTenants ?? 0}</div>
          </div>
          <div className="bg-card border rounded-lg p-4">
            <div className="text-xs text-muted-foreground uppercase">Active</div>
            <div className="text-2xl font-bold text-green-600 mt-1">{(stats as any).activeTenants ?? 0}</div>
          </div>
          <div className="bg-card border rounded-lg p-4">
            <div className="text-xs text-muted-foreground uppercase">Trial</div>
            <div className="text-2xl font-bold text-blue-600 mt-1">{(stats as any).trialTenants ?? 0}</div>
          </div>
          <div className="bg-card border rounded-lg p-4">
            <div className="text-xs text-muted-foreground uppercase">Suspended</div>
            <div className="text-2xl font-bold text-red-600 mt-1">{(stats as any).suspendedTenants ?? 0}</div>
          </div>
        </div>
      )}

      {/* Tabs: Tenants | Custom Domains */}
      <Tabs defaultValue="tenants">
        <TabsList>
          <TabsTrigger value="tenants">
            <Building2 className="w-4 h-4 mr-1.5" /> Tenants
          </TabsTrigger>
          <TabsTrigger value="domains">
            <Globe className="w-4 h-4 mr-1.5" /> Custom Domains
          </TabsTrigger>
        </TabsList>

        {/* ── Tenants Tab ─────────────────────────────────────────────────────── */}
        <TabsContent value="tenants" className="mt-4">
          {isLoading ? (
            <div className="flex items-center justify-center py-12 text-muted-foreground">
              <RefreshCw className="w-5 h-5 animate-spin mr-2" /> Loading...
            </div>
          ) : tenantList.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <Building2 className="w-12 h-12 mx-auto mb-3 opacity-30" />
              <p className="font-medium">No tenants provisioned yet</p>
              <Button className="mt-4 bg-accent hover:bg-[#b8891a] text-white" onClick={() => setShowProvisionDialog(true)}>
                <Plus className="w-4 h-4 mr-2" /> Provision First Tenant
              </Button>
            </div>
          ) : (
            <div className="border rounded-lg overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-muted/50">
                  <tr>
                    <th className="text-left px-4 py-3 font-medium">Tenant</th>
                    <th className="text-left px-4 py-3 font-medium">Country</th>
                    <th className="text-left px-4 py-3 font-medium">Plan</th>
                    <th className="text-left px-4 py-3 font-medium">Status</th>
                    <th className="text-left px-4 py-3 font-medium">Created</th>
                    <th className="px-4 py-3"></th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {tenantList.map((tenant: any) => (
                    <tr key={tenant.id} className="hover:bg-muted/30 transition-colors">
                      <td className="px-4 py-3">
                        <div className="font-medium">{tenant.name}</div>
                        <div className="text-xs text-muted-foreground font-mono">{tenant.slug}</div>
                      </td>
                      <td className="px-4 py-3 text-sm">{tenant.country}</td>
                      <td className="px-4 py-3 capitalize text-sm">{tenant.plan}</td>
                      <td className="px-4 py-3">
                        <Badge className={`text-xs border ${STATUS_COLORS[tenant.status] ?? STATUS_COLORS.pending}`}>
                          {tenant.status}
                        </Badge>
                      </td>
                      <td className="px-4 py-3 text-xs text-muted-foreground">{formatDate(tenant.createdAt)}</td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1">
                          <Button
                            variant="ghost" size="sm"
                            onClick={() => { setSelectedTenantId(tenant.id as any); setShowUsersDialog(true); }}
                            title="View users"
                          >
                            <Users className="w-4 h-4" />
                          </Button>
                          <Button
                            variant="ghost" size="sm"
                            onClick={() => {
                              setSelectedTenantId(tenant.id as any);
                              setKeycloakForm((f) => ({ ...f, realm: tenant.slug }));
                              setShowKeycloakDialog(true);
                            }}
                            title="Keycloak SSO config"
                          >
                            <Key className="w-4 h-4" />
                          </Button>
                          <Button
                            variant="ghost" size="sm"
                            onClick={() => {
                              setSelectedTenantId(tenant.id as any);
                              setSelectedTenantName(tenant.name);
                              setShowDomainDialog(true);
                            }}
                            title="Custom domain"
                          >
                            <Globe className="w-4 h-4" />
                          </Button>
                          {tenant.status === "active" ? (
                            <Button
                              variant="ghost" size="sm"
                              className="text-red-600 hover:text-red-700"
                              onClick={() => updateStatusMutation.mutate({ tenantId: String(tenant.id), status: "suspended" })}
                              title="Suspend"
                            >
                              <XCircle className="w-4 h-4" />
                            </Button>
                          ) : (
                            <Button
                              variant="ghost" size="sm"
                              className="text-green-600 hover:text-green-700"
                              onClick={() => updateStatusMutation.mutate({ tenantId: String(tenant.id), status: "active" })}
                              title="Activate"
                            >
                              <CheckCircle className="w-4 h-4" />
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
        </TabsContent>

        {/* ── Custom Domains Tab ───────────────────────────────────────────────── */}
        <TabsContent value="domains" className="mt-4 space-y-4">
          {/* Explanation banner */}
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 text-sm text-blue-900">
            <div className="flex items-start gap-2">
              <Globe className="w-4 h-4 mt-0.5 shrink-0" />
              <div>
                <span className="font-semibold">Caddy On-Demand TLS</span> — Custom domains are issued
                TLS certificates automatically at the first HTTPS request. Register a domain below,
                add the DNS TXT record to prove ownership, then click <strong>Verify</strong>.
                Caddy will issue a Let's Encrypt / ZeroSSL certificate within seconds of the first request.
              </div>
            </div>
          </div>

          {/* Domain table */}
          {domainsLoading ? (
            <div className="flex items-center justify-center py-8 text-muted-foreground">
              <RefreshCw className="w-5 h-5 animate-spin mr-2" /> Loading domains...
            </div>
          ) : domainRows.length === 0 ? (
            <div className="text-center py-10 text-muted-foreground border rounded-lg">
              <Globe className="w-10 h-10 mx-auto mb-2 opacity-30" />
              <p className="font-medium">No custom domains registered</p>
              <p className="text-xs mt-1">Click the <Globe className="w-3 h-3 inline" /> icon on a tenant row to register a domain.</p>
            </div>
          ) : (
            <div className="border rounded-lg overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-muted/50">
                  <tr>
                    <th className="text-left px-4 py-3 font-medium">Tenant</th>
                    <th className="text-left px-4 py-3 font-medium">Custom Domain</th>
                    <th className="text-left px-4 py-3 font-medium">TLS Status</th>
                    <th className="text-left px-4 py-3 font-medium">Verified At</th>
                    <th className="px-4 py-3"></th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {domainRows.map((row: any) => {
                    const domainStatus = !row.customDomain ? "none" : row.domainVerified ? "verified" : "pending";
                    return (
                      <tr key={row.id} className="hover:bg-muted/30 transition-colors">
                        <td className="px-4 py-3">
                          <div className="font-medium">{row.name}</div>
                          <div className="text-xs text-muted-foreground font-mono">{row.slug}</div>
                        </td>
                        <td className="px-4 py-3 font-mono text-sm">
                          {row.customDomain ?? <span className="text-muted-foreground italic">none</span>}
                        </td>
                        <td className="px-4 py-3">
                          <Badge className={`text-xs border ${DOMAIN_STATUS_COLORS[domainStatus]}`}>
                            {domainStatus === "verified" && <ShieldCheck className="w-3 h-3 mr-1 inline" />}
                            {domainStatus === "pending" && <AlertTriangle className="w-3 h-3 mr-1 inline" />}
                            {domainStatus}
                          </Badge>
                        </td>
                        <td className="px-4 py-3 text-xs text-muted-foreground">
                          {formatDate(row.domainVerifiedAt)}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-1">
                            {row.customDomain && !row.domainVerified && (
                              <Button
                                variant="outline" size="sm"
                                className="text-xs"
                                disabled={verifyDomainMutation.isPending}
                                onClick={() => verifyDomainMutation.mutate({ tenantId: String(row.id) })}
                              >
                                {verifyDomainMutation.isPending ? <RefreshCw className="w-3 h-3 animate-spin mr-1" /> : <CheckCircle className="w-3 h-3 mr-1" />}
                                Verify DNS
                              </Button>
                            )}
                            {row.customDomain && (
                              <Button
                                variant="ghost" size="sm"
                                className="text-red-600 hover:text-red-700"
                                onClick={() => removeDomainMutation.mutate({ tenantId: String(row.id) })}
                                title="Remove custom domain"
                              >
                                <Trash2 className="w-4 h-4" />
                              </Button>
                            )}
                            {!row.customDomain && (
                              <Button
                                variant="outline" size="sm"
                                className="text-xs"
                                onClick={() => {
                                  setSelectedTenantId(row.id);
                                  setSelectedTenantName(row.name);
                                  setShowDomainDialog(true);
                                }}
                              >
                                <Plus className="w-3 h-3 mr-1" /> Register
                              </Button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {/* Refresh button */}
          <div className="flex justify-end">
            <Button variant="outline" size="sm" onClick={() => refetchDomains()}>
              <RefreshCw className="w-4 h-4 mr-1.5" /> Refresh
            </Button>
          </div>
        </TabsContent>
      </Tabs>

      {/* ── Provision Dialog ─────────────────────────────────────────────────── */}
      <Dialog open={showProvisionDialog} onOpenChange={setShowProvisionDialog}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Provision New Tenant</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <label className="text-sm font-medium">Organisation Name *</label>
              <Input className="mt-1" placeholder="e.g. Ghana Revenue Authority"
                value={provisionForm.name}
                onChange={(e) => setProvisionForm((f) => ({ ...f, name: e.target.value }))} />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-sm font-medium">Country *</label>
                <Select value={provisionForm.country} onValueChange={(v) => setProvisionForm((f) => ({ ...f, country: v }))}>
                  <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="GHA">Ghana</SelectItem>
                    <SelectItem value="RWA">Rwanda</SelectItem>
                    <SelectItem value="SGP">Singapore</SelectItem>
                    <SelectItem value="KEN">Kenya</SelectItem>
                    <SelectItem value="NGA">Nigeria</SelectItem>
                    <SelectItem value="TZA">Tanzania</SelectItem>
                    <SelectItem value="UGA">Uganda</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="text-sm font-medium">Plan *</label>
                <Select value={provisionForm.plan} onValueChange={(v: any) => setProvisionForm((f) => ({ ...f, plan: v }))}>
                  <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="starter">Starter (Trial)</SelectItem>
                    <SelectItem value="standard">Standard</SelectItem>
                    <SelectItem value="enterprise">Enterprise</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div>
              <label className="text-sm font-medium">Contact Email *</label>
              <Input className="mt-1" type="email" placeholder="admin@organisation.gov"
                value={provisionForm.contactEmail}
                onChange={(e) => setProvisionForm((f) => ({ ...f, contactEmail: e.target.value }))} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowProvisionDialog(false)}>Cancel</Button>
            <Button
              className="bg-accent hover:bg-[#b8891a] text-white"
              disabled={!provisionForm.name || !provisionForm.contactEmail || provisionMutation.isPending}
              onClick={() => provisionMutation.mutate(provisionForm)}
            >
              {provisionMutation.isPending ? <RefreshCw className="w-4 h-4 animate-spin mr-2" /> : <Building2 className="w-4 h-4 mr-2" />}
              Provision
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Keycloak Config Dialog ───────────────────────────────────────────── */}
      <Dialog open={showKeycloakDialog} onOpenChange={setShowKeycloakDialog}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Key className="w-5 h-5" /> Keycloak SSO Configuration
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div>
              <label className="text-sm font-medium">Realm</label>
              <Input className="mt-1" value={keycloakForm.realm}
                onChange={(e) => setKeycloakForm((f) => ({ ...f, realm: e.target.value }))} />
            </div>
            <div>
              <label className="text-sm font-medium">Server URL</label>
              <Input className="mt-1" value={keycloakForm.discoveryUrl}
                onChange={(e) => setKeycloakForm((f) => ({ ...f, discoveryUrl: e.target.value }))} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-sm font-medium">Client ID</label>
                <Input className="mt-1" value={keycloakForm.clientId}
                  onChange={(e) => setKeycloakForm((f) => ({ ...f, clientId: e.target.value }))} />
              </div>
              <div>
                <label className="text-sm font-medium">Client Secret</label>
                <Input className="mt-1" type="password" value={keycloakForm.clientSecret}
                  onChange={(e) => setKeycloakForm((f) => ({ ...f, clientSecret: e.target.value }))} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-sm font-medium">Admin User</label>
                <Input className="mt-1" value={keycloakForm.adminUser}
                  onChange={(e) => setKeycloakForm((f) => ({ ...f, adminUser: e.target.value }))} />
              </div>
              <div>
                <label className="text-sm font-medium">Admin Password</label>
                <Input className="mt-1" type="password" value={keycloakForm.adminPassword}
                  onChange={(e) => setKeycloakForm((f) => ({ ...f, adminPassword: e.target.value }))} />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowKeycloakDialog(false)}>Cancel</Button>
            <Button
              className="bg-accent hover:bg-[#b8891a] text-white"
              disabled={!selectedTenantId || upsertKeycloakMutation.isPending}
              onClick={() => upsertKeycloakMutation.mutate({ tenantId: String(selectedTenantId!), realm: keycloakForm.realm, clientId: keycloakForm.clientId, discoveryUrl: keycloakForm.discoveryUrl, clientSecret: keycloakForm.clientSecret || undefined })}
            >
              {upsertKeycloakMutation.isPending ? <RefreshCw className="w-4 h-4 animate-spin mr-2" /> : <Key className="w-4 h-4 mr-2" />}
              Save Config
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Custom Domain Dialog ─────────────────────────────────────────────── */}
      <Dialog open={showDomainDialog} onOpenChange={(open) => { setShowDomainDialog(open); if (!open) { setDomainInput(""); setSelectedTenantId(null); } }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Globe className="w-5 h-5" /> Register Custom Domain
              {selectedTenantName && <span className="text-muted-foreground font-normal text-sm">— {selectedTenantName}</span>}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <label className="text-sm font-medium">Custom Domain</label>
              <Input
                className="mt-1 font-mono"
                placeholder="e.g. customs.acme-logistics.com"
                value={domainInput}
                onChange={(e) => setDomainInput(e.target.value.toLowerCase().trim())}
              />
              <p className="text-xs text-muted-foreground mt-1">
                Must be a fully-qualified domain name you control. Caddy will issue a TLS certificate automatically.
              </p>
            </div>

            {/* DNS verification instructions */}
            <div className="bg-muted/50 rounded-lg p-3 text-xs space-y-1">
              <p className="font-semibold text-sm">After registering, add this DNS record:</p>
              <div className="font-mono bg-background border rounded px-2 py-1 flex items-center justify-between gap-2">
                <span className="text-muted-foreground">_ngswtp-verify.{domainInput || "your-domain.com"}</span>
                <span className="text-accent font-bold">TXT</span>
                <span className="text-muted-foreground italic">(token shown after registration)</span>
                <Button
                  variant="ghost" size="sm" className="h-6 w-6 p-0"
                  onClick={() => { navigator.clipboard.writeText(`_ngswtp-verify.${domainInput}`); toast({ title: "Copied!" }); }}
                >
                  <Copy className="w-3 h-3" />
                </Button>
              </div>
              <p className="text-muted-foreground">DNS propagation can take up to 48 hours. Click <strong>Verify DNS</strong> in the Custom Domains tab once the record is live.</p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setShowDomainDialog(false); setDomainInput(""); }}>Cancel</Button>
            <Button
              className="bg-accent hover:bg-[#b8891a] text-white"
              disabled={!selectedTenantId || !domainInput || registerDomainMutation.isPending}
              onClick={() => registerDomainMutation.mutate({ tenantId: String(selectedTenantId!), domain: domainInput })}
            >
              {registerDomainMutation.isPending ? <RefreshCw className="w-4 h-4 animate-spin mr-2" /> : <Globe className="w-4 h-4 mr-2" />}
              Register Domain
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Users Dialog ─────────────────────────────────────────────────────── */}
      <Dialog open={showUsersDialog} onOpenChange={() => { setShowUsersDialog(false); setSelectedTenantId(null); }}>
        <DialogContent className="max-w-lg max-h-[70vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Users className="w-5 h-5" /> Tenant Users
            </DialogTitle>
          </DialogHeader>
          {usersLoading ? (
            <div className="py-8 text-center text-muted-foreground">
              <RefreshCw className="w-5 h-5 animate-spin mx-auto mb-2" /> Loading...
            </div>
          ) : (
            <div className="space-y-2">
              {(Array.isArray(tenantUsers) ? tenantUsers : []).map((u: any) => (
                <div key={u.id} className="flex items-center justify-between border rounded-lg px-3 py-2 text-sm">
                  <div>
                    <div className="font-medium">{u.name ?? u.username}</div>
                    <div className="text-xs text-muted-foreground">{u.email}</div>
                  </div>
                  <Badge variant="secondary" className="text-xs capitalize">{u.role}</Badge>
                </div>
              ))}
              {(!tenantUsers || (Array.isArray(tenantUsers) && tenantUsers.length === 0)) && (
                <div className="text-center py-6 text-muted-foreground">No users in this tenant</div>
              )}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => { setShowUsersDialog(false); setSelectedTenantId(null); }}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
