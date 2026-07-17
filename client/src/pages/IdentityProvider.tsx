/**
 * IdentityProvider.tsx — Sprint 32
 * Keycloak OIDC configuration admin panel.
 * Allows admins to configure the Keycloak realm URL, client ID, role mappings,
 * test connectivity, force JWKS rotation, and validate tokens.
 *
 * Design: Sovereign Blueprint — Deep Navy (#0A1628) + Gold (#D4A017)
 */

import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import {
  Shield,
  RefreshCw,
  CheckCircle,
  XCircle,
  Loader2,
  Key,
  Globe,
  Settings,
  TestTube,
  Lock,
  Users,
  Server,
} from "lucide-react";
import { useAuth } from "@/_core/hooks/useAuth";

// ─── Default role mappings ────────────────────────────────────────────────────

const DEFAULT_ROLE_MAPPINGS = {
  "customs-admin": "admin",
  "customs-officer": "customs_officer",
  "oga-officer": "oga_officer",
  "inspector": "inspector",
  "finance-officer": "finance",
  "trader": "user",
  "default-roles-tradegateway": "user",
};

// ─── Connection Status Badge ──────────────────────────────────────────────────

function ServiceStatusBadge({ available }: { available: boolean }) {
  return available ? (
    <Badge className="bg-emerald-900/60 text-emerald-300 border border-emerald-500/40">
      <CheckCircle className="w-3 h-3 mr-1" />
      keycloak-svc Online
    </Badge>
  ) : (
    <Badge className="bg-red-900/60 text-red-300 border border-red-500/40">
      <XCircle className="w-3 h-3 mr-1" />
      keycloak-svc Offline
    </Badge>
  );
}

// ─── Config Form ──────────────────────────────────────────────────────────────

function ConfigForm() {
  const configQuery = trpc.keycloak.getConfig.useQuery(undefined, { retry: false });
  const updateMutation = trpc.keycloak.updateConfig.useMutation({
    onSuccess: () => {
      toast.success("Keycloak configuration updated");
      configQuery.refetch();
    },
    onError: (err) => toast.error(err.message),
  });

  const cfg = configQuery.data as any ?? {};
  const [form, setForm] = useState({
    enabled: cfg.enabled ?? false,
    realmUrl: cfg.realmUrl ?? "",
    clientId: cfg.clientId ?? "tradegateway",
    audience: cfg.audience ?? "tradegateway",
    fallbackEnabled: cfg.fallbackEnabled ?? true,
    scopes: (cfg.scopes ?? ["openid", "profile", "email"]).join(", "),
  });

  const handleSave = () => {
    updateMutation.mutate({
      enabled: form.enabled,
      realmUrl: form.realmUrl || undefined,
      clientId: form.clientId || undefined,
      audience: form.audience || undefined,
      fallbackEnabled: form.fallbackEnabled,
      scopes: form.scopes.split(",").map((s: string) => s.trim()).filter(Boolean),
    });
  };

  if (configQuery.isLoading) {
    return <div className="flex justify-center py-8"><Loader2 className="w-6 h-6 animate-spin text-[#D4A017]" /></div>;
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between p-3 rounded-lg bg-[#0A1628] border border-[#1E3A5F]">
        <div>
          <p className="text-white text-sm font-medium">Enable Keycloak OIDC</p>
          <p className="text-gray-500 text-xs">When disabled, the platform uses Manus OAuth</p>
        </div>
        <Switch
          checked={form.enabled}
          onCheckedChange={(v) => setForm({ ...form, enabled: v })}
        />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="md:col-span-2 space-y-2">
          <Label className="text-gray-300 text-sm">Realm URL</Label>
          <Input
            value={form.realmUrl}
            onChange={(e) => setForm({ ...form, realmUrl: e.target.value })}
            placeholder="https://keycloak.example.com/realms/tradegateway"
            className="bg-[#0A1628] border-[#1E3A5F] text-white font-mono text-sm"
          />
          <p className="text-gray-600 text-xs">
            OIDC discovery will be fetched from {form.realmUrl || "…"}/.well-known/openid-configuration
          </p>
        </div>

        <div className="space-y-2">
          <Label className="text-gray-300 text-sm">Client ID</Label>
          <Input
            value={form.clientId}
            onChange={(e) => setForm({ ...form, clientId: e.target.value })}
            className="bg-[#0A1628] border-[#1E3A5F] text-white"
          />
        </div>

        <div className="space-y-2">
          <Label className="text-gray-300 text-sm">Audience</Label>
          <Input
            value={form.audience}
            onChange={(e) => setForm({ ...form, audience: e.target.value })}
            className="bg-[#0A1628] border-[#1E3A5F] text-white"
          />
        </div>

        <div className="space-y-2">
          <Label className="text-gray-300 text-sm">Scopes (comma-separated)</Label>
          <Input
            value={form.scopes}
            onChange={(e) => setForm({ ...form, scopes: e.target.value })}
            className="bg-[#0A1628] border-[#1E3A5F] text-white"
          />
        </div>

        <div className="flex items-center gap-3 p-3 rounded-lg bg-[#0A1628] border border-[#1E3A5F]">
          <div className="flex-1">
            <p className="text-white text-sm font-medium">Fallback to Manus OAuth</p>
            <p className="text-gray-500 text-xs">Allow login via Manus OAuth when Keycloak is unreachable</p>
          </div>
          <Switch
            checked={form.fallbackEnabled}
            onCheckedChange={(v) => setForm({ ...form, fallbackEnabled: v })}
          />
        </div>
      </div>

      <Button
        onClick={handleSave}
        disabled={updateMutation.isPending}
        className="bg-[#D4A017] hover:bg-[#B8860B] text-[#0A1628] font-semibold"
      >
        {updateMutation.isPending ? (
          <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Saving…</>
        ) : (
          <><Settings className="w-4 h-4 mr-2" />Save Configuration</>
        )}
      </Button>
    </div>
  );
}

// ─── Role Mappings Editor ─────────────────────────────────────────────────────

function RoleMappingsEditor() {
  const [mappings, setMappings] = useState<Record<string, string>>(DEFAULT_ROLE_MAPPINGS);
  const [newKeycloak, setNewKeycloak] = useState("");
  const [newTG, setNewTG] = useState("");

  const updateMutation = trpc.keycloak.updateConfig.useMutation({
    onSuccess: () => toast.success("Role mappings updated"),
    onError: (err) => toast.error(err.message),
  });

  const handleAdd = () => {
    if (!newKeycloak.trim() || !newTG.trim()) return;
    setMappings({ ...mappings, [newKeycloak.trim()]: newTG.trim() });
    setNewKeycloak("");
    setNewTG("");
  };

  const handleRemove = (key: string) => {
    const updated = { ...mappings };
    delete updated[key];
    setMappings(updated);
  };

  const handleSave = () => {
    updateMutation.mutate({ roleMappings: mappings });
  };

  return (
    <div className="space-y-4">
      <p className="text-gray-400 text-sm">
        Map Keycloak realm roles to TradeGateway roles. The first matching mapping wins.
      </p>

      <Table>
        <TableHeader>
          <TableRow className="border-[#1E3A5F] hover:bg-transparent">
            <TableHead className="text-gray-400">Keycloak Realm Role</TableHead>
            <TableHead className="text-gray-400">TradeGateway Role</TableHead>
            <TableHead className="text-gray-400 w-20">Action</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {Object.entries(mappings).map(([kc, tg]) => (
            <TableRow key={kc} className="border-[#1E3A5F] hover:bg-[#1E3A5F]/20">
              <TableCell className="text-gray-300 font-mono text-sm">{kc}</TableCell>
              <TableCell>
                <Badge className="bg-blue-900/60 text-blue-300 border border-blue-500/40 font-mono">
                  {tg}
                </Badge>
              </TableCell>
              <TableCell>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => handleRemove(kc)}
                  className="text-red-400 hover:text-red-300 hover:bg-red-900/20 h-7 px-2"
                >
                  Remove
                </Button>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

      <div className="flex gap-2 items-end">
        <div className="flex-1 space-y-1">
          <Label className="text-gray-400 text-xs">Keycloak Role</Label>
          <Input
            value={newKeycloak}
            onChange={(e) => setNewKeycloak(e.target.value)}
            placeholder="customs-supervisor"
            className="bg-[#0A1628] border-[#1E3A5F] text-white text-sm h-8"
          />
        </div>
        <div className="flex-1 space-y-1">
          <Label className="text-gray-400 text-xs">TradeGateway Role</Label>
          <Input
            value={newTG}
            onChange={(e) => setNewTG(e.target.value)}
            placeholder="customs_officer"
            className="bg-[#0A1628] border-[#1E3A5F] text-white text-sm h-8"
          />
        </div>
        <Button
          onClick={handleAdd}
          size="sm"
          className="bg-[#1E3A5F] hover:bg-[#2A4F7F] text-white h-8"
        >
          Add
        </Button>
      </div>

      <Button
        onClick={handleSave}
        disabled={updateMutation.isPending}
        className="bg-[#D4A017] hover:bg-[#B8860B] text-[#0A1628] font-semibold"
      >
        {updateMutation.isPending ? (
          <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Saving…</>
        ) : (
          <><Users className="w-4 h-4 mr-2" />Save Role Mappings</>
        )}
      </Button>
    </div>
  );
}

// ─── Connection Test Panel ────────────────────────────────────────────────────

function ConnectionTestPanel() {
  const [testResult, setTestResult] = useState<Record<string, unknown> | null>(null);
  const [tokenInput, setTokenInput] = useState("");
  const [validationResult, setValidationResult] = useState<Record<string, unknown> | null>(null);

  const testMutation = trpc.keycloak.testConnection.useMutation({
    onSuccess: (data) => {
      setTestResult(data as Record<string, unknown>);
      if ((data as any).success) {
        toast.success("Keycloak connection successful");
      } else {
        toast.error("Connection failed: " + (data as any).error);
      }
    },
    onError: (err) => toast.error(err.message),
  });

  const refreshJWKSMutation = trpc.keycloak.refreshJWKS.useMutation({
    onSuccess: () => toast.success("JWKS refreshed successfully"),
    onError: (err) => toast.error(err.message),
  });

  const validateMutation = trpc.keycloak.validateToken.useMutation({
    onSuccess: (data) => {
      setValidationResult(data as Record<string, unknown>);
      if ((data as any).valid) {
        toast.success("Token is valid");
      } else {
        toast.error("Token invalid: " + (data as any).error);
      }
    },
    onError: (err) => toast.error(err.message),
  });

  return (
    <div className="space-y-6">
      {/* Connection test */}
      <div className="space-y-3">
        <h3 className="text-white text-sm font-medium">Realm Connectivity Test</h3>
        <div className="flex gap-3">
          <Button
            onClick={() => testMutation.mutate()}
            disabled={testMutation.isPending}
            className="bg-[#1E3A5F] hover:bg-[#2A4F7F] text-white"
          >
            {testMutation.isPending ? (
              <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Testing…</>
            ) : (
              <><TestTube className="w-4 h-4 mr-2" />Test Connection</>
            )}
          </Button>
          <Button
            onClick={() => refreshJWKSMutation.mutate()}
            disabled={refreshJWKSMutation.isPending}
            variant="outline"
            className="border-[#1E3A5F] text-gray-300 hover:bg-[#1E3A5F]"
          >
            {refreshJWKSMutation.isPending ? (
              <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Refreshing…</>
            ) : (
              <><RefreshCw className="w-4 h-4 mr-2" />Rotate JWKS</>
            )}
          </Button>
        </div>

        {testResult && (
          <div className={`p-3 rounded-lg border text-sm ${
            (testResult as any).success
              ? "bg-emerald-900/20 border-emerald-500/30"
              : "bg-red-900/20 border-red-500/30"
          }`}>
            <div className="flex items-center gap-2 mb-2">
              {(testResult as any).success ? (
                <CheckCircle className="w-4 h-4 text-emerald-400" />
              ) : (
                <XCircle className="w-4 h-4 text-red-400" />
              )}
              <span className={`font-medium ${(testResult as any).success ? "text-emerald-300" : "text-red-300"}`}>
                {(testResult as any).success ? "Connection successful" : "Connection failed"}
              </span>
              <span className="text-gray-500 text-xs ml-auto">
                {(testResult as any).latencyMs}ms
              </span>
            </div>
            {(testResult as any).issuer && (
              <p className="text-gray-400 text-xs">Issuer: {(testResult as any).issuer}</p>
            )}
            {(testResult as any).error && (
              <p className="text-red-400 text-xs">{(testResult as any).error}</p>
            )}
          </div>
        )}
      </div>

      {/* Token validation */}
      <div className="space-y-3">
        <h3 className="text-white text-sm font-medium">Token Validation</h3>
        <Textarea
          value={tokenInput}
          onChange={(e) => setTokenInput(e.target.value)}
          placeholder="Paste a Keycloak JWT token here…"
          className="bg-[#0A1628] border-[#1E3A5F] text-white font-mono text-xs h-24 resize-none"
        />
        <Button
          onClick={() => validateMutation.mutate({ token: tokenInput })}
          disabled={validateMutation.isPending || !tokenInput.trim()}
          className="bg-[#1E3A5F] hover:bg-[#2A4F7F] text-white"
        >
          {validateMutation.isPending ? (
            <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Validating…</>
          ) : (
            <><Key className="w-4 h-4 mr-2" />Validate Token</>
          )}
        </Button>

        {validationResult && (
          <div className={`p-4 rounded-lg border space-y-3 ${
            (validationResult as any).valid
              ? "bg-emerald-900/20 border-emerald-500/30"
              : "bg-red-900/20 border-red-500/30"
          }`}>
            <div className="flex items-center gap-2">
              {(validationResult as any).valid ? (
                <CheckCircle className="w-4 h-4 text-emerald-400" />
              ) : (
                <XCircle className="w-4 h-4 text-red-400" />
              )}
              <span className={`font-medium text-sm ${(validationResult as any).valid ? "text-emerald-300" : "text-red-300"}`}>
                {(validationResult as any).valid ? "Token Valid" : "Token Invalid"}
              </span>
            </div>
            {(validationResult as any).valid && (
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div>
                  <span className="text-gray-500">Subject</span>
                  <p className="text-white font-mono">{(validationResult as any).subject}</p>
                </div>
                <div>
                  <span className="text-gray-500">Username</span>
                  <p className="text-white">{(validationResult as any).username}</p>
                </div>
                <div>
                  <span className="text-gray-500">Email</span>
                  <p className="text-white">{(validationResult as any).email}</p>
                </div>
                <div>
                  <span className="text-gray-500">Mapped Role</span>
                  <Badge className="bg-blue-900/60 text-blue-300 border border-blue-500/40 font-mono text-xs">
                    {(validationResult as any).mappedRole}
                  </Badge>
                </div>
                <div className="col-span-2">
                  <span className="text-gray-500">Realm Roles</span>
                  <div className="flex flex-wrap gap-1 mt-1">
                    {((validationResult as any).realmRoles ?? []).map((r: string) => (
                      <Badge key={r} className="bg-[#1E3A5F] text-gray-300 text-xs">{r}</Badge>
                    ))}
                  </div>
                </div>
                <div>
                  <span className="text-gray-500">Expires At</span>
                  <p className="text-white">{(validationResult as any).expiresAt ? new Date((validationResult as any).expiresAt).toLocaleString() : "—"}</p>
                </div>
              </div>
            )}
            {(validationResult as any).error && (
              <p className="text-red-400 text-xs">{(validationResult as any).error}</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function IdentityProvider() {
  const { user } = useAuth();
  const statusQuery = trpc.keycloak.getServiceStatus.useQuery(undefined, {
    retry: false,
    refetchInterval: 60_000,
  });

  const status = statusQuery.data as any;

  if (user?.role !== "admin") {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <Lock className="w-12 h-12 text-gray-600 mx-auto mb-3" />
          <p className="text-gray-400">Admin access required to manage identity providers.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white" style={{ fontFamily: "'Playfair Display', serif" }}>
            Identity Provider
          </h1>
          <p className="text-gray-400 text-sm mt-1">
            Keycloak OIDC integration · JWKS management · Role federation
          </p>
        </div>
        <div className="flex items-center gap-3">
          {status && <ServiceStatusBadge available={status.available} />}
        </div>
      </div>

      {/* Info banner */}
      <div className="p-4 rounded-lg bg-[#1A2A4A] border border-[#1E3A5F]">
        <div className="flex items-start gap-3">
          <Shield className="w-5 h-5 text-[#D4A017] flex-shrink-0 mt-0.5" />
          <div className="text-sm">
            <p className="text-white font-medium">Keycloak OIDC/SAML Integration</p>
            <p className="text-gray-400 mt-1">
              The Go <code className="text-[#D4A017] font-mono text-xs">keycloak-svc</code> microservice
              handles OIDC discovery, JWKS caching, JWT signature validation, and role federation.
              When Keycloak is enabled, all JWT tokens are validated against the configured realm.
              The service URL is <code className="text-gray-300 font-mono text-xs">{status?.serviceUrl ?? "http://keycloak-svc:8087"}</code>.
            </p>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <Tabs defaultValue="config" className="space-y-4">
        <TabsList className="bg-[#0D1F3C] border border-[#1E3A5F]">
          <TabsTrigger value="config" className="data-[state=active]:bg-[#1E3A5F] text-gray-300">
            <Settings className="w-4 h-4 mr-1" />
            Configuration
          </TabsTrigger>
          <TabsTrigger value="roles" className="data-[state=active]:bg-[#1E3A5F] text-gray-300">
            <Users className="w-4 h-4 mr-1" />
            Role Mappings
          </TabsTrigger>
          <TabsTrigger value="test" className="data-[state=active]:bg-[#1E3A5F] text-gray-300">
            <TestTube className="w-4 h-4 mr-1" />
            Test &amp; Validate
          </TabsTrigger>
          <TabsTrigger value="discovery" className="data-[state=active]:bg-[#1E3A5F] text-gray-300">
            <Globe className="w-4 h-4 mr-1" />
            OIDC Discovery
          </TabsTrigger>
          <TabsTrigger value="jwks" className="data-[state=active]:bg-[#1E3A5F] text-gray-300">
            <Key className="w-4 h-4 mr-1" />
            JWKS Status
          </TabsTrigger>
          <TabsTrigger value="introspect" className="data-[state=active]:bg-[#1E3A5F] text-gray-300">
            <Lock className="w-4 h-4 mr-1" />
            Introspect Token
          </TabsTrigger>
          <TabsTrigger value="caddy" className="data-[state=active]:bg-[#1E3A5F] text-gray-300">
            <Server className="w-4 h-4 mr-1" />
            Caddy Edge
          </TabsTrigger>
        </TabsList>

        <TabsContent value="config">
          <Card className="bg-[#0D1F3C] border-[#1E3A5F]">
            <CardHeader>
              <CardTitle className="text-white text-base">Keycloak Realm Configuration</CardTitle>
            </CardHeader>
            <CardContent>
              <ConfigForm />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="roles">
          <Card className="bg-[#0D1F3C] border-[#1E3A5F]">
            <CardHeader>
              <CardTitle className="text-white text-base">Role Federation Mappings</CardTitle>
            </CardHeader>
            <CardContent>
              <RoleMappingsEditor />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="test">
          <Card className="bg-[#0D1F3C] border-[#1E3A5F]">
            <CardHeader>
              <CardTitle className="text-white text-base">Connectivity &amp; Token Validation</CardTitle>
            </CardHeader>
            <CardContent>
              <ConnectionTestPanel />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="discovery">
          <DiscoveryPanel />
        </TabsContent>

        <TabsContent value="jwks">
          <JwksStatusPanel />
        </TabsContent>

        <TabsContent value="introspect">
          <IntrospectPanel />
        </TabsContent>

        <TabsContent value="caddy">
          <CaddyEdgePanel />
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ─── JWKS Status Panel ───────────────────────────────────────────────────────

function JwksStatusPanel() {
  const jwksQuery = trpc.keycloak.getJwksStatus.useQuery(undefined, {
    retry: false,
    refetchInterval: 60_000,
  });
  const refreshMutation = trpc.keycloak.refreshJWKS.useMutation({
    onSuccess: () => {
      toast.success("JWKS cache invalidated — keys re-fetched from Keycloak");
      jwksQuery.refetch();
    },
    onError: (err) => toast.error(err.message),
  });

  const status = jwksQuery.data;

  return (
    <Card className="bg-[#0D1F3C] border-[#1E3A5F]">
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="text-white text-base">JWKS Endpoint Health</CardTitle>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => jwksQuery.refetch()}
              disabled={jwksQuery.isFetching}
              className="border-[#1E3A5F] text-gray-300 hover:bg-[#1E3A5F]"
            >
              {jwksQuery.isFetching ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
              <span className="ml-1">Refresh</span>
            </Button>
            <Button
              size="sm"
              onClick={() => refreshMutation.mutate()}
              disabled={refreshMutation.isPending}
              className="bg-[#D4A017] hover:bg-[#B8860B] text-black"
            >
              {refreshMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Key className="w-4 h-4" />}
              <span className="ml-1">Rotate JWKS Cache</span>
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {jwksQuery.isLoading && (
          <div className="flex items-center gap-2 text-gray-400 py-4">
            <Loader2 className="w-4 h-4 animate-spin" />
            <span>Checking JWKS endpoint…</span>
          </div>
        )}
        {status && (
          <div className="space-y-3">
            <div className="flex items-center gap-3">
              {status.reachable ? (
                <CheckCircle className="w-5 h-5 text-green-400" />
              ) : (
                <XCircle className="w-5 h-5 text-red-400" />
              )}
              <span className={status.reachable ? "text-green-400 font-medium" : "text-red-400 font-medium"}>
                {status.reachable ? "JWKS endpoint reachable" : "JWKS endpoint unreachable"}
              </span>
              <Badge className={status.reachable ? "bg-green-900 text-green-300" : "bg-red-900 text-red-300"}>
                {status.keyCount} key{status.keyCount !== 1 ? "s" : ""}
              </Badge>
            </div>
            <div className="bg-[#0A1628] rounded-lg p-4 space-y-2 border border-[#1E3A5F]">
              <div className="flex justify-between text-sm">
                <span className="text-gray-400">Issuer</span>
                <span className="text-gray-200 font-mono text-xs">{status.issuer}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-gray-400">JWKS URL</span>
                <span className="text-gray-200 font-mono text-xs break-all">{status.jwksUrl}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-gray-400">Checked at</span>
                <span className="text-gray-200 text-xs">{new Date(status.checkedAt).toLocaleString()}</span>
              </div>
              {status.error && (
                <div className="flex justify-between text-sm">
                  <span className="text-gray-400">Error</span>
                  <span className="text-red-400 text-xs">{status.error}</span>
                </div>
              )}
            </div>
          </div>
        )}
        {jwksQuery.isError && (
          <p className="text-red-400 text-sm">{jwksQuery.error?.message}</p>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Token Introspection Panel ────────────────────────────────────────────────

function IntrospectPanel() {
  const [token, setToken] = useState("");
  const introspectMutation = trpc.keycloak.introspectToken.useMutation({
    onError: (err) => toast.error(err.message),
  });

  return (
    <Card className="bg-[#0D1F3C] border-[#1E3A5F]">
      <CardHeader>
        <CardTitle className="text-white text-base">Token Introspection</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-gray-400 text-sm">
          Paste a Keycloak access token to introspect it via the Keycloak introspection endpoint.
          Returns active status, expiry, subject, email, and realm roles.
        </p>
        <div className="space-y-2">
          <Label className="text-gray-300">Access Token</Label>
          <Textarea
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder="eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9..."
            className="bg-[#0A1628] border-[#1E3A5F] text-gray-200 font-mono text-xs h-28 resize-none"
          />
        </div>
        <Button
          onClick={() => introspectMutation.mutate({ token })}
          disabled={!token.trim() || introspectMutation.isPending}
          className="bg-[#1E3A5F] hover:bg-[#2A4F7F] text-white"
        >
          {introspectMutation.isPending ? (
            <Loader2 className="w-4 h-4 animate-spin mr-2" />
          ) : (
            <Lock className="w-4 h-4 mr-2" />
          )}
          Introspect Token
        </Button>
        {introspectMutation.data && (
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              {introspectMutation.data.active ? (
                <CheckCircle className="w-5 h-5 text-green-400" />
              ) : (
                <XCircle className="w-5 h-5 text-red-400" />
              )}
              <span className={introspectMutation.data.active ? "text-green-400 font-medium" : "text-red-400 font-medium"}>
                {introspectMutation.data.active ? "Token is ACTIVE" : "Token is INACTIVE / EXPIRED"}
              </span>
            </div>
            <div className="bg-[#0A1628] rounded-lg p-4 space-y-2 border border-[#1E3A5F]">
              {introspectMutation.data.sub && (
                <div className="flex justify-between text-sm">
                  <span className="text-gray-400">Subject (sub)</span>
                  <span className="text-gray-200 font-mono text-xs">{introspectMutation.data.sub}</span>
                </div>
              )}
              {introspectMutation.data.username && (
                <div className="flex justify-between text-sm">
                  <span className="text-gray-400">Username</span>
                  <span className="text-gray-200">{introspectMutation.data.username}</span>
                </div>
              )}
              {introspectMutation.data.email && (
                <div className="flex justify-between text-sm">
                  <span className="text-gray-400">Email</span>
                  <span className="text-gray-200">{introspectMutation.data.email}</span>
                </div>
              )}
              {introspectMutation.data.realmRoles.length > 0 && (
                <div className="flex justify-between text-sm">
                  <span className="text-gray-400">Realm Roles</span>
                  <div className="flex flex-wrap gap-1 justify-end">
                    {introspectMutation.data.realmRoles.map((r: string) => (
                      <Badge key={r} className="bg-[#1E3A5F] text-gray-200 text-xs">{r}</Badge>
                    ))}
                  </div>
                </div>
              )}
              {introspectMutation.data.expiresAt && (
                <div className="flex justify-between text-sm">
                  <span className="text-gray-400">Expires at</span>
                  <span className="text-gray-200 text-xs">{new Date(introspectMutation.data.expiresAt).toLocaleString()}</span>
                </div>
              )}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Caddy Edge Proxy Panel ───────────────────────────────────────────────────

function CaddyEdgePanel() {
  return (
    <Card className="bg-[#0D1F3C] border-[#1E3A5F]">
      <CardHeader>
        <CardTitle className="text-white text-base">Caddy Edge Proxy — Architecture</CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        <p className="text-gray-300 text-sm leading-relaxed">
          Caddy serves as the outermost TLS-terminating edge proxy for TradeGateway NGSWTP.
          It provisions and renews certificates automatically via ACME (Let's Encrypt / ZeroSSL),
          enables HTTP/3 + QUIC on all listeners, and enforces the Coraza WAF (OWASP CRS) before
          traffic reaches APISIX.
        </p>

        {/* Trust chain */}
        <div className="bg-[#0A1628] rounded-lg p-4 border border-[#1E3A5F]">
          <p className="text-[#D4A017] text-xs font-semibold uppercase tracking-wider mb-3">Trust Chain</p>
          <div className="flex flex-col gap-1 text-sm font-mono">
            {[
              { label: "Internet (HTTPS/HTTP3)", color: "text-gray-400" },
              { label: "↓", color: "text-gray-600" },
              { label: "Caddy :443  (TLS termination, Coraza WAF, forward_auth)", color: "text-[#D4A017]" },
              { label: "↓", color: "text-gray-600" },
              { label: "oauth2-proxy :4180  (Keycloak OIDC session management)", color: "text-blue-400" },
              { label: "↓", color: "text-gray-600" },
              { label: "Keycloak :8080  (OIDC provider, JWKS, token issuance)", color: "text-green-400" },
              { label: "↓", color: "text-gray-600" },
              { label: "APISIX :9080  (API gateway, openid-connect plugin, rate limiting)", color: "text-purple-400" },
              { label: "↓", color: "text-gray-600" },
              { label: "tRPC backend  (protectedProcedure, adminProcedure)", color: "text-gray-300" },
            ].map((item, i) => (
              <span key={i} className={item.color}>{item.label}</span>
            ))}
          </div>
        </div>

        {/* Virtual hosts */}
        <div>
          <p className="text-[#D4A017] text-xs font-semibold uppercase tracking-wider mb-3">Virtual Hosts</p>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[#1E3A5F]">
                  <th className="text-left text-gray-400 pb-2 pr-4">Host</th>
                  <th className="text-left text-gray-400 pb-2 pr-4">Auth</th>
                  <th className="text-left text-gray-400 pb-2">Upstream</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#1E3A5F]">
                {[
                  { host: "auth.*", auth: "None (public)", upstream: "Keycloak :8080" },
                  { host: "trader.*", auth: "forward_auth → oauth2-proxy → Keycloak", upstream: "APISIX + Frontend" },
                  { host: "oga.*", auth: "forward_auth → oauth2-proxy → Keycloak", upstream: "APISIX + Frontend" },
                  { host: "admin.*", auth: "forward_auth → oauth2-proxy → Keycloak", upstream: "APISIX + Frontend" },
                  { host: "api.*", auth: "Bearer JWT (APISIX validates)", upstream: "APISIX :9080" },
                  { host: "monitoring.*", auth: "None (internal)", upstream: "Grafana / Prometheus / Jaeger" },
                ].map((row) => (
                  <tr key={row.host}>
                    <td className="py-2 pr-4 text-gray-200 font-mono text-xs">{row.host}</td>
                    <td className="py-2 pr-4 text-gray-300 text-xs">{row.auth}</td>
                    <td className="py-2 text-gray-300 text-xs">{row.upstream}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Key features */}
        <div>
          <p className="text-[#D4A017] text-xs font-semibold uppercase tracking-wider mb-3">Key Features</p>
          <div className="grid grid-cols-2 gap-3">
            {[
              { icon: "🔒", title: "Automatic TLS", desc: "Let's Encrypt / ZeroSSL via ACME — zero manual cert management" },
              { icon: "⚡", title: "HTTP/3 + QUIC", desc: "Enabled by default on all listeners — benefits mobile traders" },
              { icon: "🛡️", title: "Coraza WAF", desc: "OWASP CRS compiled into Caddy — first-line WAF before APISIX" },
              { icon: "🔄", title: "Live Reconfiguration", desc: "Admin API at :2019 — add routes atomically without restart" },
            ].map((f) => (
              <div key={f.title} className="bg-[#0A1628] rounded-lg p-3 border border-[#1E3A5F]">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-lg">{f.icon}</span>
                  <span className="text-gray-200 font-medium text-sm">{f.title}</span>
                </div>
                <p className="text-gray-400 text-xs">{f.desc}</p>
              </div>
            ))}
          </div>
        </div>

        {/* Config files */}
        <div className="bg-[#0A1628] rounded-lg p-4 border border-[#1E3A5F]">
          <p className="text-[#D4A017] text-xs font-semibold uppercase tracking-wider mb-2">Configuration Files</p>
          <div className="space-y-1 text-xs font-mono">
            <p className="text-gray-300">infra/caddy/Caddyfile.prod — Production (ACME TLS, Coraza WAF, forward_auth)</p>
            <p className="text-gray-300">infra/caddy/Caddyfile.dev — Development (HTTP-only, port 8888)</p>
            <p className="text-gray-300">infra/caddy/oauth2-proxy.cfg — oauth2-proxy Keycloak OIDC config</p>
            <p className="text-gray-300">infra/k8s/caddy/ — Kubernetes Deployment, Service, ConfigMap, IngressClass</p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ─── OIDC Discovery Panel ─────────────────────────────────────────────────────

function DiscoveryPanel() {
  const discoveryQuery = trpc.keycloak.getDiscovery.useQuery(undefined, {
    retry: false,
    enabled: false,
  });

  return (
    <Card className="bg-[#0D1F3C] border-[#1E3A5F]">
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="text-white text-base">OIDC Discovery Document</CardTitle>
          <Button
            variant="outline"
            size="sm"
            onClick={() => discoveryQuery.refetch()}
            disabled={discoveryQuery.isFetching}
            className="border-[#1E3A5F] text-gray-300 hover:bg-[#1E3A5F]"
          >
            {discoveryQuery.isFetching ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <RefreshCw className="w-4 h-4" />
            )}
            <span className="ml-1">Fetch</span>
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {!discoveryQuery.data && !discoveryQuery.isError && (
          <p className="text-gray-500 text-sm text-center py-8">
            Click Fetch to load the OIDC discovery document from the configured Keycloak realm.
          </p>
        )}
        {discoveryQuery.isError && (
          <p className="text-red-400 text-sm">
            {discoveryQuery.error?.message}
          </p>
        )}
        {discoveryQuery.data && (
          <pre className="text-xs text-gray-300 font-mono bg-[#0A1628] p-4 rounded-lg overflow-x-auto border border-[#1E3A5F] max-h-96">
            {JSON.stringify(discoveryQuery.data, null, 2)}
          </pre>
        )}
      </CardContent>
    </Card>
  );
}
