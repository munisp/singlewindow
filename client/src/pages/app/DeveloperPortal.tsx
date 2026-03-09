import { useState } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import {
  Code2, Key, Zap, Globe, Copy, Eye, EyeOff, Plus,
  RefreshCw, Trash2, BarChart2, Shield, BookOpen, Settings
} from "lucide-react";

export default function DeveloperPortal() {
  const [activeTab, setActiveTab] = useState("keys");
  const [createOpen, setCreateOpen] = useState(false);
  const [showKey, setShowKey] = useState<Record<string, boolean>>({});
  const [sandboxMode, setSandboxMode] = useState(false);

  const [createForm, setCreateForm] = useState({
    name: "",
    description: "",
    environment: "sandbox",
    rateLimitPerMinute: "60",
    rateLimitPerDay: "10000",
    allowedScopes: [] as string[],
  });

  const { data: keysData, isLoading: keysLoading, refetch: refetchKeys } =
    trpc.devPortal.listApiKeys.useQuery();

  const { data: usageData } = trpc.devPortal.getUsageStats.useQuery({ days: 7 });

  const { data: sandboxStatus } = trpc.devPortal.getAvailableScopes.useQuery();

  const createMutation = trpc.devPortal.createApiKey.useMutation({
    onSuccess: (data: any) => {
      toast.success("API key created! Copy it now — it won't be shown again.");
      if (data?.key) {
        navigator.clipboard.writeText(data.key).catch(() => {});
        toast.info(`Key copied: ${data.key.substring(0, 20)}...`);
      }
      setCreateOpen(false);
      refetchKeys();
    },
    onError: (err: any) => toast.error(err.message),
  });

  const revokeMutation = trpc.devPortal.revokeApiKey.useMutation({
    onSuccess: () => { toast.success("API key revoked"); refetchKeys(); },
    onError: (err: any) => toast.error(err.message),
  });

  const handleCreate = () => {
    if (!createForm.name) {
      toast.error("Please provide a key name");
      return;
    }
    createMutation.mutate({
      name: createForm.name,
      scopes: ["declarations:read"],
      rateLimit: parseInt(createForm.rateLimitPerMinute) || 60,
    });
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text).then(() => toast.success("Copied to clipboard")).catch(() => toast.error("Copy failed"));
  };

  const keys = (keysData as any)?.keys ?? [];
  const usage = (usageData as any) ?? {};

  const API_ENDPOINTS = [
    { method: "GET", path: "/api/trpc/declarations.list", description: "List all declarations", auth: true },
    { method: "POST", path: "/api/trpc/declarations.submit", description: "Submit a new declaration", auth: true },
    { method: "GET", path: "/api/trpc/declarations.getStatus", description: "Get declaration status by UCR", auth: true },
    { method: "GET", path: "/api/trpc/cargo.track", description: "Track cargo by UCR", auth: false },
    { method: "GET", path: "/api/trpc/payments.getStatus", description: "Get payment status", auth: true },
    { method: "POST", path: "/api/trpc/payments.initiate", description: "Initiate duty payment", auth: true },
    { method: "GET", path: "/api/trpc/hsCodes.lookup", description: "HS code lookup and classification", auth: false },
    { method: "GET", path: "/api/trpc/oga.listAgencies", description: "List all OGA agencies", auth: false },
    { method: "POST", path: "/api/trpc/aeo.apply", description: "Submit AEO application", auth: true },
    { method: "GET", path: "/api/trpc/freeZone.listZones", description: "List registered free zones", auth: false },
  ];

  return (
    <DashboardLayout>
      <div className="p-6 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
              <Code2 className="w-7 h-7 text-violet-600" />
              Developer Portal
            </h1>
            <p className="text-muted-foreground text-sm mt-1">
              Manage API keys, rate limits, and explore the NGSWTP Open API ecosystem
            </p>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2 bg-muted/50 rounded-lg px-3 py-2">
              <Shield className="w-4 h-4 text-muted-foreground" />
              <span className="text-sm text-muted-foreground">Sandbox</span>
              <Switch
                checked={sandboxMode}
                onCheckedChange={(checked) => { setSandboxMode(checked); toast.info("Sandbox toggle requires a key ID — use key settings"); }}
              />
            </div>
            <Button variant="outline" size="sm" onClick={() => refetchKeys()}>
              <RefreshCw className="w-4 h-4 mr-2" />
              Refresh
            </Button>
            <Dialog open={createOpen} onOpenChange={setCreateOpen}>
              <DialogTrigger asChild>
                <Button size="sm" className="bg-violet-600 hover:bg-violet-700 text-white">
                  <Plus className="w-4 h-4 mr-2" />
                  New API Key
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-md">
                <DialogHeader>
                  <DialogTitle>Create API Key</DialogTitle>
                </DialogHeader>
                <div className="space-y-4 py-2">
                  <div>
                    <Label>Key Name *</Label>
                    <Input placeholder="e.g. My Integration" value={createForm.name} onChange={e => setCreateForm(f => ({ ...f, name: e.target.value }))} />
                  </div>
                  <div>
                    <Label>Description</Label>
                    <Input placeholder="What will this key be used for?" value={createForm.description} onChange={e => setCreateForm(f => ({ ...f, description: e.target.value }))} />
                  </div>
                  <div>
                    <Label>Environment</Label>
                    <Select value={createForm.environment} onValueChange={v => setCreateForm(f => ({ ...f, environment: v }))}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="sandbox">Sandbox</SelectItem>
                        <SelectItem value="production">Production</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label>Rate Limit / min</Label>
                      <Input type="number" value={createForm.rateLimitPerMinute} onChange={e => setCreateForm(f => ({ ...f, rateLimitPerMinute: e.target.value }))} />
                    </div>
                    <div>
                      <Label>Rate Limit / day</Label>
                      <Input type="number" value={createForm.rateLimitPerDay} onChange={e => setCreateForm(f => ({ ...f, rateLimitPerDay: e.target.value }))} />
                    </div>
                  </div>
                  <Button className="w-full bg-violet-600 hover:bg-violet-700 text-white" onClick={handleCreate} disabled={createMutation.isPending}>
                    {createMutation.isPending ? "Creating..." : "Create API Key"}
                  </Button>
                </div>
              </DialogContent>
            </Dialog>
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: "Active Keys", value: keys.filter((k: any) => k.status === "active").length, icon: <Key className="w-5 h-5 text-violet-600" />, color: "text-violet-600" },
            { label: "API Calls (24h)", value: usage.callsLast24h ?? "—", icon: <Zap className="w-5 h-5 text-blue-500" />, color: "text-blue-600" },
            { label: "Unique Endpoints", value: usage.uniqueEndpoints ?? API_ENDPOINTS.length, icon: <Globe className="w-5 h-5 text-green-500" />, color: "text-green-600" },
            { label: "Rate Limit Hits", value: usage.rateLimitHits ?? "—", icon: <BarChart2 className="w-5 h-5 text-orange-500" />, color: "text-orange-600" },
          ].map(stat => (
            <Card key={stat.label}>
              <CardContent className="p-4 flex items-center gap-3">
                {stat.icon}
                <div>
                  <div className={`text-2xl font-bold ${stat.color}`}>{stat.value}</div>
                  <div className="text-xs text-muted-foreground">{stat.label}</div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList>
            <TabsTrigger value="keys"><Key className="w-3.5 h-3.5 mr-1.5" />API Keys</TabsTrigger>
            <TabsTrigger value="docs"><BookOpen className="w-3.5 h-3.5 mr-1.5" />API Reference</TabsTrigger>
            <TabsTrigger value="usage"><BarChart2 className="w-3.5 h-3.5 mr-1.5" />Usage</TabsTrigger>
          </TabsList>

          <TabsContent value="keys" className="mt-4">
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Your API Keys</CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                {keysLoading ? (
                  <div className="p-8 text-center text-muted-foreground text-sm">Loading keys...</div>
                ) : keys.length === 0 ? (
                  <div className="p-8 text-center text-muted-foreground text-sm">
                    <Key className="w-8 h-8 mx-auto mb-2 opacity-30" />
                    No API keys yet. Create your first key to get started.
                  </div>
                ) : (
                  <div className="divide-y divide-border">
                    {keys.map((key: any) => (
                      <div key={key.id} className="p-4 hover:bg-muted/30">
                        <div className="flex items-start justify-between">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-1">
                              <span className="font-semibold text-sm">{key.name}</span>
                              <Badge className={`text-xs ${key.status === "active" ? "bg-green-100 text-green-800" : "bg-red-100 text-red-800"}`}>
                                {key.status}
                              </Badge>
                              <Badge variant="outline" className="text-xs">
                                {key.environment}
                              </Badge>
                            </div>
                            {key.description && (
                              <div className="text-xs text-muted-foreground mb-1">{key.description}</div>
                            )}
                            <div className="flex items-center gap-2">
                              <code className="text-xs bg-muted px-2 py-0.5 rounded font-mono">
                                {showKey[key.id] ? key.keyPreview : `${key.keyPrefix}${"•".repeat(24)}`}
                              </code>
                              <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={() => setShowKey(s => ({ ...s, [key.id]: !s[key.id] }))}>
                                {showKey[key.id] ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
                              </Button>
                              <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={() => copyToClipboard(key.keyPreview ?? key.keyPrefix)}>
                                <Copy className="w-3 h-3" />
                              </Button>
                            </div>
                            <div className="text-xs text-muted-foreground mt-1">
                              {key.rateLimitPerMinute}/min · {key.rateLimitPerDay?.toLocaleString()}/day
                              {key.lastUsedAt && ` · Last used: ${new Date(key.lastUsedAt).toLocaleDateString()}`}
                            </div>
                          </div>
                          {key.status === "active" && (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 w-7 p-0 text-red-500 hover:text-red-700"
                              onClick={() => revokeMutation.mutate({ keyId: key.id })}
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </Button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="docs" className="mt-4">
            <Card>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base flex items-center gap-2">
                    <BookOpen className="w-4 h-4" />
                    NGSWTP API Reference
                  </CardTitle>
                  <Badge variant="outline" className="text-xs">v1.0 · tRPC + REST</Badge>
                </div>
              </CardHeader>
              <CardContent>
                <div className="mb-4 p-3 bg-muted/50 rounded-lg text-xs text-muted-foreground">
                  <strong>Base URL:</strong> <code className="font-mono">{window.location.origin}/api/trpc</code>
                  <br />
                  <strong>Authentication:</strong> Bearer token via <code className="font-mono">Authorization: Bearer &lt;api-key&gt;</code>
                </div>
                <div className="space-y-2">
                  {API_ENDPOINTS.map((ep, i) => (
                    <div key={i} className="flex items-center gap-3 p-3 border border-border rounded-lg hover:bg-muted/30">
                      <Badge className={`text-xs w-12 justify-center ${ep.method === "GET" ? "bg-green-100 text-green-800" : "bg-blue-100 text-blue-800"}`}>
                        {ep.method}
                      </Badge>
                      <code className="text-xs font-mono flex-1 truncate text-foreground">{ep.path}</code>
                      <span className="text-xs text-muted-foreground hidden md:block">{ep.description}</span>
                      {ep.auth ? (
                        <Shield className="w-3.5 h-3.5 text-orange-500 shrink-0" />
                      ) : (
                        <Globe className="w-3.5 h-3.5 text-green-500 shrink-0" />
                      )}
                    </div>
                  ))}
                </div>
                <div className="mt-4 p-3 bg-violet-50 dark:bg-violet-950/30 rounded-lg text-xs text-violet-700 dark:text-violet-300">
                  Full OpenAPI specification available at <code className="font-mono">/api/openapi.json</code>. 
                  Interactive Swagger UI at <code className="font-mono">/api/docs</code>.
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="usage" className="mt-4">
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <BarChart2 className="w-4 h-4" />
                  API Usage Analytics
                </CardTitle>
              </CardHeader>
              <CardContent>
                {!usage.callsLast24h ? (
                  <div className="p-8 text-center text-muted-foreground text-sm">
                    <BarChart2 className="w-8 h-8 mx-auto mb-2 opacity-30" />
                    No usage data available yet. Make your first API call to see analytics.
                  </div>
                ) : (
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                    {[
                      { label: "Calls (24h)", value: usage.callsLast24h },
                      { label: "Calls (7d)", value: usage.callsLast7Days },
                      { label: "Calls (30d)", value: usage.callsLast30Days },
                      { label: "Avg Latency (ms)", value: usage.avgLatencyMs },
                      { label: "Error Rate", value: `${usage.errorRate ?? 0}%` },
                      { label: "Rate Limit Hits", value: usage.rateLimitHits },
                    ].map(stat => (
                      <div key={stat.label} className="p-3 bg-muted/30 rounded-lg">
                        <div className="text-xl font-bold text-foreground">{stat.value ?? "—"}</div>
                        <div className="text-xs text-muted-foreground">{stat.label}</div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </DashboardLayout>
  );
}
