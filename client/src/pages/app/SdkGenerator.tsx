/**
 * Sprint 71 — OpenAPI SDK Generator
 * Generates downloadable TypeScript and Python SDK clients from the live OpenAPI spec.
 * Route: /app/developer/sdk
 */

import { useState, useEffect } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Separator } from "@/components/ui/separator";
import {
  Download, Copy, Check, Code2, Package, RefreshCw,
  Terminal, FileCode, Loader2, AlertCircle, Sparkles,
  ChevronRight, BookOpen,
} from "lucide-react";
import { toast } from "sonner";

// ─── TYPES ────────────────────────────────────────────────────────────────────

interface OpenApiSpec {
  openapi: string;
  info: { title: string; version: string; description?: string };
  paths: Record<string, Record<string, {
    summary?: string;
    operationId?: string;
    tags?: string[];
    security?: unknown[];
    requestBody?: { content?: { "application/json"?: { schema?: Record<string, unknown> } } };
    responses?: Record<string, { description?: string; content?: Record<string, unknown> }>;
  }>>;
  components?: { schemas?: Record<string, unknown> };
}

interface SdkEndpoint {
  tag: string;
  method: string;
  path: string;
  operationId: string;
  summary: string;
  requiresAuth: boolean;
  hasBody: boolean;
}

// ─── SDK GENERATORS ───────────────────────────────────────────────────────────

function generateTypeScriptSdk(spec: OpenApiSpec, endpoints: SdkEndpoint[]): string {
  const lines: string[] = [];

  lines.push(`/**`);
  lines.push(` * TradeGateway NGSWTP — TypeScript SDK`);
  lines.push(` * Generated from OpenAPI ${spec.info.version}`);
  lines.push(` * ${new Date().toISOString()}`);
  lines.push(` */`);
  lines.push(``);
  lines.push(`// ─── Configuration ───────────────────────────────────────────────────────────`);
  lines.push(``);
  lines.push(`export interface TradeGatewayConfig {`);
  lines.push(`  baseUrl: string;`);
  lines.push(`  /** Session cookie is set automatically after OAuth login */`);
  lines.push(`  credentials?: RequestCredentials;`);
  lines.push(`}`);
  lines.push(``);
  lines.push(`export class TradeGatewayClient {`);
  lines.push(`  private baseUrl: string;`);
  lines.push(`  private credentials: RequestCredentials;`);
  lines.push(``);
  lines.push(`  constructor(config: TradeGatewayConfig) {`);
  lines.push(`    this.baseUrl = config.baseUrl.replace(/\\/$/, "");`);
  lines.push(`    this.credentials = config.credentials ?? "include";`);
  lines.push(`  }`);
  lines.push(``);
  lines.push(`  private async request<T>(path: string, input?: unknown): Promise<T> {`);
  lines.push(`    const url = new URL(\`\${this.baseUrl}/api/trpc/\${path}\`);`);
  lines.push(`    const isQuery = input === undefined;`);
  lines.push(`    if (isQuery) {`);
  lines.push(`      url.searchParams.set("input", JSON.stringify({}));`);
  lines.push(`    }`);
  lines.push(`    const res = await fetch(url.toString(), {`);
  lines.push(`      method: isQuery ? "GET" : "POST",`);
  lines.push(`      credentials: this.credentials,`);
  lines.push(`      headers: { "Content-Type": "application/json" },`);
  lines.push(`      body: isQuery ? undefined : JSON.stringify({ json: input }),`);
  lines.push(`    });`);
  lines.push(`    const data = await res.json() as { result?: { data?: { json?: T } }; error?: { message: string } };`);
  lines.push(`    if (data.error) throw new Error(data.error.message);`);
  lines.push(`    return data.result?.data?.json as T;`);
  lines.push(`  }`);
  lines.push(``);

  // Group by tag
  const byTag = new Map<string, SdkEndpoint[]>();
  for (const ep of endpoints) {
    if (!byTag.has(ep.tag)) byTag.set(ep.tag, []);
    byTag.get(ep.tag)!.push(ep);
  }

  for (const [tag, eps] of Array.from(byTag.entries())) {
    lines.push(`  // ─── ${tag.toUpperCase()} ───────────────────────────────────────────────────────────`);
    lines.push(``);
    for (const ep of eps) {
      const fnName = ep.operationId.replace(/\./g, "_");
      const paramType = ep.hasBody ? `input: Record<string, unknown>` : ``;
      const callArg = ep.hasBody ? `input` : `undefined`;
      const authNote = ep.requiresAuth ? ` // Requires authentication` : ``;
      lines.push(`  /** ${ep.summary || ep.operationId} */${authNote}`);
      lines.push(`  async ${fnName}(${paramType}): Promise<unknown> {`);
      lines.push(`    return this.request("${ep.operationId}", ${callArg});`);
      lines.push(`  }`);
      lines.push(``);
    }
  }

  lines.push(`}`);
  lines.push(``);
  lines.push(`// ─── Default export ──────────────────────────────────────────────────────────`);
  lines.push(``);
  lines.push(`export default TradeGatewayClient;`);
  lines.push(``);
  lines.push(`// Usage:`);
  lines.push(`// import TradeGatewayClient from "./tradegateway-sdk";`);
  lines.push(`// const client = new TradeGatewayClient({ baseUrl: "https://your-app.manus.space" });`);
  lines.push(`// const declarations = await client.declarations_list({});`);

  return lines.join("\n");
}

function generatePythonSdk(spec: OpenApiSpec, endpoints: SdkEndpoint[]): string {
  const lines: string[] = [];

  lines.push(`"""TradeGateway NGSWTP — Python SDK`);
  lines.push(`Generated from OpenAPI ${spec.info.version}`);
  lines.push(`${new Date().toISOString()}`);
  lines.push(`"""`);
  lines.push(``);
  lines.push(`import json`);
  lines.push(`import requests`);
  lines.push(`from typing import Any, Optional`);
  lines.push(``);
  lines.push(``);
  lines.push(`class TradeGatewayClient:`);
  lines.push(`    """Client for the TradeGateway NGSWTP API."""`);
  lines.push(``);
  lines.push(`    def __init__(self, base_url: str, session_cookie: Optional[str] = None):`);
  lines.push(`        """Initialize the client.`);
  lines.push(`        Args:`);
  lines.push(`            base_url: Base URL of the TradeGateway instance (e.g. https://your-app.manus.space)`);
  lines.push(`            session_cookie: Session cookie value from browser login (optional for public endpoints)`);
  lines.push(`        """`);
  lines.push(`        self.base_url = base_url.rstrip("/")`);
  lines.push(`        self.session = requests.Session()`);
  lines.push(`        if session_cookie:`);
  lines.push(`            self.session.cookies.set("session", session_cookie)`);
  lines.push(``);
  lines.push(`    def _request(self, procedure: str, input_data: Optional[dict] = None) -> Any:`);
  lines.push(`        """Make a tRPC request."""`);
  lines.push(`        url = f"{self.base_url}/api/trpc/{procedure}"`);
  lines.push(`        if input_data is None:`);
  lines.push(`            resp = self.session.get(url, params={"input": json.dumps({})})`);
  lines.push(`        else:`);
  lines.push(`            resp = self.session.post(url, json={"json": input_data})`);
  lines.push(`        resp.raise_for_status()`);
  lines.push(`        data = resp.json()`);
  lines.push(`        if "error" in data:`);
  lines.push(`            raise Exception(data["error"]["message"])`);
  lines.push(`        return data.get("result", {}).get("data", {}).get("json")`);
  lines.push(``);

  // Group by tag
  const byTag = new Map<string, SdkEndpoint[]>();
  for (const ep of endpoints) {
    if (!byTag.has(ep.tag)) byTag.set(ep.tag, []);
    byTag.get(ep.tag)!.push(ep);
  }

  for (const [tag, eps] of Array.from(byTag.entries())) {
    lines.push(`    # ─── ${tag.toUpperCase()} ───────────────────────────────────────────────────────────`);
    lines.push(``);
    for (const ep of eps) {
      const fnName = ep.operationId.replace(/\./g, "_");
      const paramDef = ep.hasBody ? `self, input_data: dict` : `self`;
      const callArg = ep.hasBody ? `input_data` : `None`;
      const authNote = ep.requiresAuth ? `  # Requires authentication\n    ` : `    `;
      lines.push(`    def ${fnName}(${paramDef}) -> Any:`);
      lines.push(`        """${ep.summary || ep.operationId}"""`);
      lines.push(`${authNote}return self._request("${ep.operationId}", ${callArg})`);
      lines.push(``);
    }
  }

  lines.push(`# Usage:`);
  lines.push(`# from tradegateway_sdk import TradeGatewayClient`);
  lines.push(`# client = TradeGatewayClient("https://your-app.manus.space", session_cookie="...")`);
  lines.push(`# declarations = client.declarations_list()`);

  return lines.join("\n");
}

function generateRequirementsTxt(): string {
  return `# TradeGateway NGSWTP Python SDK requirements\nrequests>=2.31.0\n`;
}

// ─── HELPERS ──────────────────────────────────────────────────────────────────

function extractEndpoints(spec: OpenApiSpec): SdkEndpoint[] {
  const endpoints: SdkEndpoint[] = [];
  for (const [path, methods] of Object.entries(spec.paths ?? {})) {
    for (const [method, op] of Object.entries(methods)) {
      if (!op || typeof op !== "object") continue;
      const operationId = (op as { operationId?: string }).operationId ?? path.replace(/\//g, "_");
      const tag = ((op as { tags?: string[] }).tags?.[0] ?? "general").toLowerCase();
      const summary = (op as { summary?: string }).summary ?? operationId;
      const requiresAuth = Array.isArray((op as { security?: unknown[] }).security) && (op as { security?: unknown[] }).security!.length > 0;
      const hasBody = method.toLowerCase() === "post" && !!(op as { requestBody?: unknown }).requestBody;
      endpoints.push({ tag, method, path, operationId, summary, requiresAuth, hasBody });
    }
  }
  return endpoints;
}

function downloadFile(content: string, filename: string, mimeType: string) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// ─── COMPONENT ────────────────────────────────────────────────────────────────

export default function SdkGenerator() {
  const [spec, setSpec] = useState<OpenApiSpec | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState("typescript");
  const [copied, setCopied] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);

  const fetchSpec = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/openapi.json");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json() as OpenApiSpec;
      setSpec(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load spec");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchSpec(); }, []);

  const endpoints = spec ? extractEndpoints(spec) : [];
  const tsSdk = spec ? generateTypeScriptSdk(spec, endpoints) : "";
  const pySdk = spec ? generatePythonSdk(spec, endpoints) : "";

  const handleCopy = async (text: string, key: string) => {
    await navigator.clipboard.writeText(text);
    setCopied(key);
    toast.success("Copied to clipboard");
    setTimeout(() => setCopied(null), 2000);
  };

  const handleDownloadTs = () => {
    setGenerating(true);
    setTimeout(() => {
      downloadFile(tsSdk, "tradegateway-sdk.ts", "text/typescript");
      toast.success("TypeScript SDK downloaded");
      setGenerating(false);
    }, 300);
  };

  const handleDownloadPy = () => {
    setGenerating(true);
    setTimeout(() => {
      downloadFile(pySdk, "tradegateway_sdk.py", "text/x-python");
      downloadFile(generateRequirementsTxt(), "requirements.txt", "text/plain");
      toast.success("Python SDK + requirements.txt downloaded");
      setGenerating(false);
    }, 300);
  };

  // Group endpoints by tag for the summary table
  const byTag = new Map<string, SdkEndpoint[]>();
  for (const ep of endpoints) {
    if (!byTag.has(ep.tag)) byTag.set(ep.tag, []);
    byTag.get(ep.tag)!.push(ep);
  }

  return (
    <DashboardLayout title="SDK Generator">
      <div className="flex flex-col gap-6 max-w-6xl">

        {/* Header */}
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
              <Sparkles className="h-6 w-6 text-primary" />
              SDK Generator
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              Auto-generated TypeScript and Python clients from the live OpenAPI specification.
              Always up-to-date with the latest API version.
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={fetchSpec} disabled={loading}>
            <RefreshCw className={`h-4 w-4 mr-2 ${loading ? "animate-spin" : ""}`} />
            Refresh Spec
          </Button>
        </div>

        {/* Spec summary */}
        {spec && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[
              { label: "API Version", value: spec.info.version, icon: BookOpen },
              { label: "Endpoints", value: endpoints.length, icon: Code2 },
              { label: "Tag Groups", value: byTag.size, icon: Package },
              { label: "Auth-Required", value: endpoints.filter(e => e.requiresAuth).length, icon: FileCode },
            ].map(stat => (
              <Card key={stat.label} className="bg-card/50">
                <CardContent className="p-3 flex items-center gap-2">
                  <stat.icon className="h-4 w-4 text-primary shrink-0" />
                  <div>
                    <p className="text-xs text-muted-foreground">{stat.label}</p>
                    <p className="text-lg font-bold">{stat.value}</p>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        {loading && (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            <span className="ml-3 text-muted-foreground">Loading OpenAPI spec…</span>
          </div>
        )}

        {error && (
          <Card className="border-destructive/50">
            <CardContent className="p-4 flex items-center gap-3 text-destructive">
              <AlertCircle className="h-5 w-5 shrink-0" />
              <span className="text-sm">Failed to load spec: {error}</span>
            </CardContent>
          </Card>
        )}

        {spec && (
          <Tabs value={activeTab} onValueChange={setActiveTab}>
            <TabsList className="grid w-full grid-cols-3 max-w-md">
              <TabsTrigger value="typescript">TypeScript</TabsTrigger>
              <TabsTrigger value="python">Python</TabsTrigger>
              <TabsTrigger value="endpoints">Endpoints</TabsTrigger>
            </TabsList>

            {/* ── TypeScript SDK ── */}
            <TabsContent value="typescript" className="mt-4">
              <Card>
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <CardTitle className="text-base flex items-center gap-2">
                        <Code2 className="h-4 w-4 text-blue-400" />
                        TypeScript SDK
                      </CardTitle>
                      <CardDescription className="mt-1">
                        A typed fetch-based client for Node.js and browser environments.
                        No dependencies required.
                      </CardDescription>
                    </div>
                    <div className="flex gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleCopy(tsSdk, "ts")}
                      >
                        {copied === "ts" ? <Check className="h-4 w-4 mr-1.5 text-green-500" /> : <Copy className="h-4 w-4 mr-1.5" />}
                        Copy
                      </Button>
                      <Button size="sm" onClick={handleDownloadTs} disabled={generating}>
                        {generating ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <Download className="h-4 w-4 mr-1.5" />}
                        Download .ts
                      </Button>
                    </div>
                  </div>
                </CardHeader>
                <Separator />
                <CardContent className="p-0">
                  {/* Installation snippet */}
                  <div className="bg-muted/30 border-b px-4 py-3">
                    <p className="text-xs font-medium text-muted-foreground mb-2 flex items-center gap-1.5">
                      <Terminal className="h-3.5 w-3.5" />
                      Quick Start (no install needed)
                    </p>
                    <div className="relative">
                      <pre className="text-xs font-mono bg-background rounded-md p-3 overflow-x-auto border">
{`// 1. Copy tradegateway-sdk.ts into your project
// 2. Import and use:
import TradeGatewayClient from "./tradegateway-sdk";

const client = new TradeGatewayClient({
  baseUrl: "https://your-app.manus.space",
  credentials: "include", // sends session cookie automatically
});

// Query declarations
const result = await client.declarations_list({});

// Submit a new declaration
const decl = await client.declarations_create({
  hsCode: "8471.30",
  goodsDescription: "Laptop computers",
  invoiceValue: 45000,
  currency: "USD",
});`}
                      </pre>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="absolute top-2 right-2 h-6 w-6"
                        onClick={() => handleCopy(`import TradeGatewayClient from "./tradegateway-sdk";\n\nconst client = new TradeGatewayClient({\n  baseUrl: "https://your-app.manus.space",\n  credentials: "include",\n});\n\nconst result = await client.declarations_list({});`, "ts-snippet")}
                      >
                        {copied === "ts-snippet" ? <Check className="h-3 w-3 text-green-500" /> : <Copy className="h-3 w-3" />}
                      </Button>
                    </div>
                  </div>
                  {/* SDK preview */}
                  <div className="relative">
                    <pre className="text-xs font-mono p-4 overflow-x-auto max-h-96 text-muted-foreground leading-relaxed">
                      {tsSdk.slice(0, 3000)}{tsSdk.length > 3000 ? "\n\n// ... (download for full SDK)" : ""}
                    </pre>
                  </div>
                </CardContent>
              </Card>
            </TabsContent>

            {/* ── Python SDK ── */}
            <TabsContent value="python" className="mt-4">
              <Card>
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <CardTitle className="text-base flex items-center gap-2">
                        <Code2 className="h-4 w-4 text-yellow-400" />
                        Python SDK
                      </CardTitle>
                      <CardDescription className="mt-1">
                        A requests-based client for Python 3.8+. Includes a requirements.txt.
                      </CardDescription>
                    </div>
                    <div className="flex gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleCopy(pySdk, "py")}
                      >
                        {copied === "py" ? <Check className="h-4 w-4 mr-1.5 text-green-500" /> : <Copy className="h-4 w-4 mr-1.5" />}
                        Copy
                      </Button>
                      <Button size="sm" onClick={handleDownloadPy} disabled={generating}>
                        {generating ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <Download className="h-4 w-4 mr-1.5" />}
                        Download .py
                      </Button>
                    </div>
                  </div>
                </CardHeader>
                <Separator />
                <CardContent className="p-0">
                  {/* Installation snippet */}
                  <div className="bg-muted/30 border-b px-4 py-3">
                    <p className="text-xs font-medium text-muted-foreground mb-2 flex items-center gap-1.5">
                      <Terminal className="h-3.5 w-3.5" />
                      Quick Start
                    </p>
                    <div className="relative">
                      <pre className="text-xs font-mono bg-background rounded-md p-3 overflow-x-auto border">
{`# 1. Install dependency
pip install requests

# 2. Copy tradegateway_sdk.py into your project
# 3. Use it:
from tradegateway_sdk import TradeGatewayClient

client = TradeGatewayClient(
    base_url="https://your-app.manus.space",
    session_cookie="your-session-cookie-here",
)

# Query declarations
declarations = client.declarations_list()

# Submit a declaration
result = client.declarations_create({
    "hsCode": "8471.30",
    "goodsDescription": "Laptop computers",
    "invoiceValue": 45000,
    "currency": "USD",
})`}
                      </pre>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="absolute top-2 right-2 h-6 w-6"
                        onClick={() => handleCopy(`pip install requests\n\nfrom tradegateway_sdk import TradeGatewayClient\nclient = TradeGatewayClient("https://your-app.manus.space", session_cookie="...")`, "py-snippet")}
                      >
                        {copied === "py-snippet" ? <Check className="h-3 w-3 text-green-500" /> : <Copy className="h-3 w-3" />}
                      </Button>
                    </div>
                  </div>
                  {/* SDK preview */}
                  <div className="relative">
                    <pre className="text-xs font-mono p-4 overflow-x-auto max-h-96 text-muted-foreground leading-relaxed">
                      {pySdk.slice(0, 3000)}{pySdk.length > 3000 ? "\n\n# ... (download for full SDK)" : ""}
                    </pre>
                  </div>
                </CardContent>
              </Card>
            </TabsContent>

            {/* ── Endpoints table ── */}
            <TabsContent value="endpoints" className="mt-4">
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base">Available Endpoints ({endpoints.length})</CardTitle>
                  <CardDescription>All procedures available in the generated SDK, grouped by tag.</CardDescription>
                </CardHeader>
                <Separator />
                <CardContent className="p-0">
                  <div className="divide-y">
                    {Array.from(byTag.entries()).map(([tag, eps]) => (
                      <div key={tag}>
                        <div className="px-4 py-2 bg-muted/30 flex items-center gap-2">
                          <Package className="h-3.5 w-3.5 text-muted-foreground" />
                          <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{tag}</span>
                          <Badge variant="secondary" className="text-xs ml-auto">{eps.length}</Badge>
                        </div>
                        {eps.map(ep => (
                          <div key={ep.operationId} className="px-4 py-2.5 flex items-center gap-3 hover:bg-muted/20 transition-colors">
                            <ChevronRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                            <code className="text-xs font-mono text-primary">{ep.operationId}</code>
                            <span className="text-xs text-muted-foreground truncate flex-1">{ep.summary}</span>
                            <div className="flex gap-1 shrink-0">
                              <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                                {ep.method.toUpperCase()}
                              </Badge>
                              {ep.requiresAuth && (
                                <Badge variant="outline" className="text-[10px] px-1.5 py-0 border-amber-500/50 text-amber-600">
                                  AUTH
                                </Badge>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        )}
      </div>
    </DashboardLayout>
  );
}
