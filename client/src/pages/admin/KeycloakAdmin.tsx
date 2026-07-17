/**
 * KeycloakAdmin.tsx — Sprint Caddy
 * Comprehensive Keycloak + Caddy administration panel.
 *
 * Sections:
 *   1. Realm Configuration — DB-persisted OIDC settings (realmUrl, clientId, scopes)
 *   2. JWKS Status — live JWKS endpoint health, key count, rotation
 *   3. Token Introspection — paste any access token to inspect claims
 *   4. Session Management — list and revoke active Keycloak sessions
 *   5. Caddy Edge — architecture overview, virtual hosts, config file locations
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
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
  Lock,
  Users,
  Server,
  LogOut,
  AlertTriangle,
} from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

interface RealmConfig {
  enabled?: boolean;
  realmUrl?: string;
  clientId?: string;
  discoveryUrl?: string;
  jwksUri?: string;
  issuer?: string;
  scopes?: string[];
  fallbackEnabled?: boolean;
  roleMappings?: Record<string, string>;
  lastTestedAt?: string;
  lastTestResult?: string;
  lastTestError?: string;
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function KeycloakAdmin() {
  return (
    <div className="p-6 space-y-6 bg-[#0A1628] min-h-screen">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-lg bg-[#1E3A5F] flex items-center justify-center">
          <Shield className="w-5 h-5 text-[#D4A017]" />
        </div>
        <div>
          <h1 className="text-xl font-bold text-white">Keycloak + Caddy Administration</h1>
          <p className="text-gray-400 text-sm">
            Identity provider configuration, JWKS health, session management, and edge proxy overview.
          </p>
        </div>
      </div>

      {/* Tabs */}
      <Tabs defaultValue="config" className="space-y-4">
        <TabsList className="bg-[#0D1F3C] border border-[#1E3A5F] flex-wrap h-auto gap-1 p-1">
          <TabsTrigger value="config" className="data-[state=active]:bg-[#1E3A5F] text-gray-300">
            <Settings className="w-4 h-4 mr-1" />
            Realm Config
          </TabsTrigger>
          <TabsTrigger value="jwks" className="data-[state=active]:bg-[#1E3A5F] text-gray-300">
            <Key className="w-4 h-4 mr-1" />
            JWKS Status
          </TabsTrigger>
          <TabsTrigger value="introspect" className="data-[state=active]:bg-[#1E3A5F] text-gray-300">
            <Lock className="w-4 h-4 mr-1" />
            Introspect Token
          </TabsTrigger>
          <TabsTrigger value="sessions" className="data-[state=active]:bg-[#1E3A5F] text-gray-300">
            <Users className="w-4 h-4 mr-1" />
            Sessions
          </TabsTrigger>
          <TabsTrigger value="caddy" className="data-[state=active]:bg-[#1E3A5F] text-gray-300">
            <Server className="w-4 h-4 mr-1" />
            Caddy Edge
          </TabsTrigger>
        </TabsList>

        <TabsContent value="config"><RealmConfigPanel /></TabsContent>
        <TabsContent value="jwks"><JwksStatusPanel /></TabsContent>
        <TabsContent value="introspect"><IntrospectPanel /></TabsContent>
        <TabsContent value="sessions"><SessionsPanel /></TabsContent>
        <TabsContent value="caddy"><CaddyEdgePanel /></TabsContent>
      </Tabs>
    </div>
  );
}

// ─── Realm Config Panel ───────────────────────────────────────────────────────

function RealmConfigPanel() {
  const configQuery = trpc.keycloak.getDbConfig.useQuery(undefined, { retry: false });
  const saveMutation = trpc.keycloak.saveDbConfig.useMutation({
    onSuccess: () => {
      toast.success("Keycloak configuration saved");
      configQuery.refetch();
    },
    onError: (err) => toast.error(err.message),
  });
  const testMutation = trpc.keycloak.testConnection.useMutation({
    onSuccess: (data: any) => {
      if (data.success) toast.success("Keycloak connection successful");
      else toast.error(`Connection failed: ${data.error}`);
      configQuery.refetch();
    },
    onError: (err) => toast.error(err.message),
  });

  const cfg = configQuery.data as RealmConfig | null | undefined;

  const [form, setForm] = useState({
    enabled: cfg?.enabled ?? true,
    realmUrl: cfg?.realmUrl ?? "",
    clientId: cfg?.clientId ?? "tradegateway-api",
    discoveryUrl: cfg?.discoveryUrl ?? "",
    jwksUri: cfg?.jwksUri ?? "",
    issuer: cfg?.issuer ?? "",
    scopes: (cfg?.scopes ?? ["openid", "profile", "email", "roles"]).join(" "),
    fallbackEnabled: cfg?.fallbackEnabled ?? true,
  });

  if (configQuery.isLoading) {
    return (
      <div className="flex items-center gap-2 text-gray-400 py-8">
        <Loader2 className="w-4 h-4 animate-spin" />
        <span>Loading configuration…</span>
      </div>
    );
  }

  return (
    <Card className="bg-[#0D1F3C] border-[#1E3A5F]">
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="text-white text-base">Realm Configuration</CardTitle>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => testMutation.mutate()}
              disabled={testMutation.isPending}
              className="border-[#1E3A5F] text-gray-300 hover:bg-[#1E3A5F]"
            >
              {testMutation.isPending ? (
                <Loader2 className="w-4 h-4 animate-spin mr-1" />
              ) : (
                <Globe className="w-4 h-4 mr-1" />
              )}
              Test Connection
            </Button>
            <Button
              size="sm"
              onClick={() =>
                saveMutation.mutate({
                  enabled: form.enabled,
                  realmUrl: form.realmUrl || undefined,
                  clientId: form.clientId || undefined,
                  discoveryUrl: form.discoveryUrl || undefined,
                  jwksUri: form.jwksUri || undefined,
                  issuer: form.issuer || undefined,
                  scopes: form.scopes.split(/\s+/).filter(Boolean),
                  fallbackEnabled: form.fallbackEnabled,
                })
              }
              disabled={saveMutation.isPending}
              className="bg-[#D4A017] hover:bg-[#B8860B] text-black"
            >
              {saveMutation.isPending ? (
                <Loader2 className="w-4 h-4 animate-spin mr-1" />
              ) : (
                <Settings className="w-4 h-4 mr-1" />
              )}
              Save
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Last test result */}
        {cfg?.lastTestResult && (
          <div
            className={`flex items-center gap-2 p-3 rounded-lg border text-sm ${
              cfg.lastTestResult === "ok"
                ? "bg-green-950 border-green-800 text-green-300"
                : "bg-red-950 border-red-800 text-red-300"
            }`}
          >
            {cfg.lastTestResult === "ok" ? (
              <CheckCircle className="w-4 h-4" />
            ) : (
              <XCircle className="w-4 h-4" />
            )}
            <span>
              Last test: {cfg.lastTestResult === "ok" ? "Passed" : `Failed — ${cfg.lastTestError}`}
              {cfg.lastTestedAt && (
                <span className="ml-2 text-xs opacity-70">
                  {new Date(cfg.lastTestedAt).toLocaleString()}
                </span>
              )}
            </span>
          </div>
        )}

        <div className="flex items-center gap-3">
          <Switch
            checked={form.enabled}
            onCheckedChange={(v) => setForm((f) => ({ ...f, enabled: v }))}
          />
          <Label className="text-gray-300">Keycloak OIDC enabled</Label>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1">
            <Label className="text-gray-400 text-xs">Realm URL</Label>
            <Input
              value={form.realmUrl}
              onChange={(e) => setForm((f) => ({ ...f, realmUrl: e.target.value }))}
              placeholder="http://keycloak:8080/realms/tradegateway"
              className="bg-[#0A1628] border-[#1E3A5F] text-gray-200 text-sm font-mono"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-gray-400 text-xs">Client ID</Label>
            <Input
              value={form.clientId}
              onChange={(e) => setForm((f) => ({ ...f, clientId: e.target.value }))}
              placeholder="tradegateway-api"
              className="bg-[#0A1628] border-[#1E3A5F] text-gray-200 text-sm font-mono"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-gray-400 text-xs">Discovery URL (auto-derived if blank)</Label>
            <Input
              value={form.discoveryUrl}
              onChange={(e) => setForm((f) => ({ ...f, discoveryUrl: e.target.value }))}
              placeholder="{realmUrl}/.well-known/openid-configuration"
              className="bg-[#0A1628] border-[#1E3A5F] text-gray-200 text-sm font-mono"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-gray-400 text-xs">JWKS URI (auto-derived if blank)</Label>
            <Input
              value={form.jwksUri}
              onChange={(e) => setForm((f) => ({ ...f, jwksUri: e.target.value }))}
              placeholder="{realmUrl}/protocol/openid-connect/certs"
              className="bg-[#0A1628] border-[#1E3A5F] text-gray-200 text-sm font-mono"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-gray-400 text-xs">Issuer (auto-derived if blank)</Label>
            <Input
              value={form.issuer}
              onChange={(e) => setForm((f) => ({ ...f, issuer: e.target.value }))}
              placeholder="{realmUrl}"
              className="bg-[#0A1628] border-[#1E3A5F] text-gray-200 text-sm font-mono"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-gray-400 text-xs">Scopes (space-separated)</Label>
            <Input
              value={form.scopes}
              onChange={(e) => setForm((f) => ({ ...f, scopes: e.target.value }))}
              placeholder="openid profile email roles"
              className="bg-[#0A1628] border-[#1E3A5F] text-gray-200 text-sm font-mono"
            />
          </div>
        </div>

        <div className="flex items-center gap-3">
          <Switch
            checked={form.fallbackEnabled}
            onCheckedChange={(v) => setForm((f) => ({ ...f, fallbackEnabled: v }))}
          />
          <Label className="text-gray-300 text-sm">
            Fallback to Manus OAuth when Keycloak is unavailable
          </Label>
        </div>
      </CardContent>
    </Card>
  );
}

// ─── JWKS Status Panel ────────────────────────────────────────────────────────

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
              {jwksQuery.isFetching ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <RefreshCw className="w-4 h-4" />
              )}
              <span className="ml-1">Refresh</span>
            </Button>
            <Button
              size="sm"
              onClick={() => refreshMutation.mutate()}
              disabled={refreshMutation.isPending}
              className="bg-[#D4A017] hover:bg-[#B8860B] text-black"
            >
              {refreshMutation.isPending ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Key className="w-4 h-4" />
              )}
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
              {(status as any).reachable ? (
                <CheckCircle className="w-5 h-5 text-green-400" />
              ) : (
                <XCircle className="w-5 h-5 text-red-400" />
              )}
              <span
                className={
                  (status as any).reachable ? "text-green-400 font-medium" : "text-red-400 font-medium"
                }
              >
                {(status as any).reachable ? "JWKS endpoint reachable" : "JWKS endpoint unreachable"}
              </span>
              <Badge
                className={
                  (status as any).reachable
                    ? "bg-green-900 text-green-300"
                    : "bg-red-900 text-red-300"
                }
              >
                {(status as any).keyCount} key{(status as any).keyCount !== 1 ? "s" : ""}
              </Badge>
            </div>
            <div className="bg-[#0A1628] rounded-lg p-4 space-y-2 border border-[#1E3A5F]">
              <div className="flex justify-between text-sm">
                <span className="text-gray-400">Issuer</span>
                <span className="text-gray-200 font-mono text-xs">{(status as any).issuer}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-gray-400">JWKS URL</span>
                <span className="text-gray-200 font-mono text-xs break-all">
                  {(status as any).jwksUrl}
                </span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-gray-400">Checked at</span>
                <span className="text-gray-200 text-xs">
                  {new Date((status as any).checkedAt).toLocaleString()}
                </span>
              </div>
              {(status as any).error && (
                <div className="flex justify-between text-sm">
                  <span className="text-gray-400">Error</span>
                  <span className="text-red-400 text-xs">{(status as any).error}</span>
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
              <span
                className={
                  introspectMutation.data.active
                    ? "text-green-400 font-medium"
                    : "text-red-400 font-medium"
                }
              >
                {introspectMutation.data.active ? "Token is ACTIVE" : "Token is INACTIVE / EXPIRED"}
              </span>
            </div>
            <div className="bg-[#0A1628] rounded-lg p-4 space-y-2 border border-[#1E3A5F]">
              {introspectMutation.data.sub && (
                <div className="flex justify-between text-sm">
                  <span className="text-gray-400">Subject (sub)</span>
                  <span className="text-gray-200 font-mono text-xs">
                    {introspectMutation.data.sub}
                  </span>
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
                      <Badge key={r} className="bg-[#1E3A5F] text-gray-200 text-xs">
                        {r}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}
              {introspectMutation.data.expiresAt && (
                <div className="flex justify-between text-sm">
                  <span className="text-gray-400">Expires at</span>
                  <span className="text-gray-200 text-xs">
                    {new Date(introspectMutation.data.expiresAt).toLocaleString()}
                  </span>
                </div>
              )}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Sessions Panel ───────────────────────────────────────────────────────────

function SessionsPanel() {
  const sessionsQuery = trpc.keycloak.getSessions.useQuery(
    { isActive: true },
    { retry: false }
  );
  const revokeMutation = trpc.keycloak.revokeSession.useMutation({
    onSuccess: () => {
      toast.success("Session revoked");
      sessionsQuery.refetch();
    },
    onError: (err) => toast.error(err.message),
  });

  const sessions = sessionsQuery.data ?? [];

  return (
    <Card className="bg-[#0D1F3C] border-[#1E3A5F]">
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="text-white text-base">
            Active Sessions
            {sessions.length > 0 && (
              <Badge className="ml-2 bg-[#1E3A5F] text-gray-300">{sessions.length}</Badge>
            )}
          </CardTitle>
          <Button
            variant="outline"
            size="sm"
            onClick={() => sessionsQuery.refetch()}
            disabled={sessionsQuery.isFetching}
            className="border-[#1E3A5F] text-gray-300 hover:bg-[#1E3A5F]"
          >
            {sessionsQuery.isFetching ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <RefreshCw className="w-4 h-4" />
            )}
            <span className="ml-1">Refresh</span>
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {sessionsQuery.isLoading && (
          <div className="flex items-center gap-2 text-gray-400 py-4">
            <Loader2 className="w-4 h-4 animate-spin" />
            <span>Loading sessions…</span>
          </div>
        )}
        {sessionsQuery.isError && (
          <div className="flex items-center gap-2 text-red-400 py-4">
            <AlertTriangle className="w-4 h-4" />
            <span>{sessionsQuery.error?.message}</span>
          </div>
        )}
        {!sessionsQuery.isLoading && sessions.length === 0 && (
          <p className="text-gray-500 text-sm text-center py-8">No active sessions found.</p>
        )}
        {sessions.length > 0 && (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="border-[#1E3A5F]">
                  <TableHead className="text-gray-400">Session ID</TableHead>
                  <TableHead className="text-gray-400">User</TableHead>
                  <TableHead className="text-gray-400">IP</TableHead>
                  <TableHead className="text-gray-400">Started</TableHead>
                  <TableHead className="text-gray-400">Expires</TableHead>
                  <TableHead className="text-gray-400">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sessions.map((s: any) => (
                  <TableRow key={s.sessionId} className="border-[#1E3A5F]">
                    <TableCell className="text-gray-300 font-mono text-xs">
                      {s.sessionId.slice(0, 12)}…
                    </TableCell>
                    <TableCell className="text-gray-300 text-sm">{s.username ?? s.userId}</TableCell>
                    <TableCell className="text-gray-400 text-xs">{s.ipAddress ?? "—"}</TableCell>
                    <TableCell className="text-gray-400 text-xs">
                      {s.startedAt ? new Date(s.startedAt).toLocaleString() : "—"}
                    </TableCell>
                    <TableCell className="text-gray-400 text-xs">
                      {s.expiresAt ? new Date(s.expiresAt).toLocaleString() : "—"}
                    </TableCell>
                    <TableCell>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => revokeMutation.mutate({ sessionId: s.sessionId })}
                        disabled={revokeMutation.isPending}
                        className="border-red-800 text-red-400 hover:bg-red-950 text-xs"
                      >
                        <LogOut className="w-3 h-3 mr-1" />
                        Revoke
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Caddy Edge Panel ─────────────────────────────────────────────────────────

function CaddyEdgePanel() {
  return (
    <Card className="bg-[#0D1F3C] border-[#1E3A5F]">
      <CardHeader>
        <CardTitle className="text-white text-base">Caddy Edge Proxy — Architecture</CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        <p className="text-gray-300 text-sm leading-relaxed">
          Caddy serves as the outermost TLS-terminating edge proxy for TradeGateway NGSWTP. It
          provisions and renews certificates automatically via ACME (Let's Encrypt / ZeroSSL),
          enables HTTP/3 + QUIC on all listeners, and enforces the Coraza WAF (OWASP CRS) before
          traffic reaches APISIX.
        </p>

        {/* Trust chain */}
        <div className="bg-[#0A1628] rounded-lg p-4 border border-[#1E3A5F]">
          <p className="text-[#D4A017] text-xs font-semibold uppercase tracking-wider mb-3">
            Trust Chain
          </p>
          <div className="flex flex-col gap-1 text-sm font-mono">
            {[
              { label: "Internet (HTTPS / HTTP3 / QUIC)", color: "text-gray-400" },
              { label: "↓", color: "text-gray-600" },
              { label: "Caddy :443  (ACME TLS, Coraza WAF, forward_auth)", color: "text-[#D4A017]" },
              { label: "↓", color: "text-gray-600" },
              { label: "oauth2-proxy :4180  (Keycloak OIDC session management)", color: "text-blue-400" },
              { label: "↓", color: "text-gray-600" },
              { label: "Keycloak :8080  (OIDC provider, JWKS, token issuance)", color: "text-green-400" },
              { label: "↓", color: "text-gray-600" },
              { label: "APISIX :9080  (openid-connect plugin, rate limiting, RBAC)", color: "text-purple-400" },
              { label: "↓", color: "text-gray-600" },
              { label: "tRPC backend  (protectedProcedure / adminProcedure)", color: "text-gray-300" },
            ].map((item, i) => (
              <span key={i} className={item.color}>
                {item.label}
              </span>
            ))}
          </div>
        </div>

        {/* Virtual hosts */}
        <div>
          <p className="text-[#D4A017] text-xs font-semibold uppercase tracking-wider mb-3">
            Virtual Hosts
          </p>
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
                  {
                    host: "trader.*",
                    auth: "forward_auth → oauth2-proxy → Keycloak",
                    upstream: "APISIX + Frontend",
                  },
                  {
                    host: "oga.*",
                    auth: "forward_auth → oauth2-proxy → Keycloak",
                    upstream: "APISIX + Frontend",
                  },
                  {
                    host: "admin.*",
                    auth: "forward_auth → oauth2-proxy → Keycloak",
                    upstream: "APISIX + Frontend",
                  },
                  {
                    host: "api.*",
                    auth: "Bearer JWT (APISIX validates)",
                    upstream: "APISIX :9080",
                  },
                  {
                    host: "monitoring.*",
                    auth: "None (internal)",
                    upstream: "Grafana / Prometheus / Jaeger",
                  },
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
          <p className="text-[#D4A017] text-xs font-semibold uppercase tracking-wider mb-3">
            Key Features
          </p>
          <div className="grid grid-cols-2 gap-3">
            {[
              {
                icon: "🔒",
                title: "Automatic TLS",
                desc: "Let's Encrypt / ZeroSSL via ACME — zero manual cert management",
              },
              {
                icon: "⚡",
                title: "HTTP/3 + QUIC",
                desc: "Enabled by default on all listeners — benefits mobile traders",
              },
              {
                icon: "🛡️",
                title: "Coraza WAF",
                desc: "OWASP CRS compiled into Caddy — first-line WAF before APISIX",
              },
              {
                icon: "🔄",
                title: "Live Reconfiguration",
                desc: "Admin API at :2019 — add routes atomically without restart",
              },
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
          <p className="text-[#D4A017] text-xs font-semibold uppercase tracking-wider mb-2">
            Configuration Files
          </p>
          <div className="space-y-1 text-xs font-mono">
            <p className="text-gray-300">
              infra/caddy/Caddyfile.prod — Production (ACME TLS, Coraza WAF, forward_auth)
            </p>
            <p className="text-gray-300">
              infra/caddy/Caddyfile.dev — Development (HTTP-only, port 8888)
            </p>
            <p className="text-gray-300">
              infra/caddy/oauth2-proxy.cfg — oauth2-proxy Keycloak OIDC config
            </p>
            <p className="text-gray-300">
              infra/keycloak/realm-export.json — caddy-frontend client included
            </p>
            <p className="text-gray-300">
              infra/apisix/keycloak-consumer.yaml — caddy-forwarded-oidc plugin config
            </p>
            <p className="text-gray-300">
              infra/k8s/caddy/ — Kubernetes Deployment, Service, ConfigMap, IngressClass
            </p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
