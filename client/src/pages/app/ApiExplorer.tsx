/**
 * Sprint 68 — OpenAPI / Swagger UI Explorer
 * Renders the auto-generated OpenAPI 3.1 spec in an interactive Swagger UI.
 * Uses the swagger-ui-react package (or CDN fallback) to display the spec.
 */

import { useState, useEffect, useRef } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Code2, ExternalLink, Download, Search, ChevronDown, ChevronRight,
  Globe, Lock, Unlock, Copy, CheckCheck, RefreshCw, BookOpen,
  Zap, Shield, Database, Activity,
} from "lucide-react";

// ─── TYPES ────────────────────────────────────────────────────────────────────

interface OpenApiSpec {
  info: { title: string; version: string; description: string };
  tags: Array<{ name: string }>;
  paths: Record<string, Record<string, {
    operationId: string;
    summary: string;
    description: string;
    tags: string[];
    security?: unknown[];
    parameters?: Array<{ name: string; in: string; description: string; required: boolean }>;
    requestBody?: { content: Record<string, { example?: unknown }> };
    responses: Record<string, { description: string }>;
  }>>;
}

// ─── ENDPOINT CARD ────────────────────────────────────────────────────────────

function EndpointCard({
  method, path, operation,
}: {
  method: string;
  path: string;
  operation: NonNullable<OpenApiSpec["paths"][string][string]>;
}) {
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);

  const isAuth = (operation.security?.length ?? 0) > 0;
  const methodColor = method === "get"
    ? "bg-blue-500/20 text-blue-400 border-blue-500/30"
    : "bg-orange-500/20 text-orange-400 border-orange-500/30";

  const handleCopy = () => {
    navigator.clipboard.writeText(path);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="border border-border rounded-lg overflow-hidden">
      <button
        onClick={() => setExpanded(e => !e)}
        className="w-full flex items-center gap-3 p-3 hover:bg-accent/50 transition-colors text-left"
      >
        <Badge variant="outline" className={`text-xs font-mono uppercase shrink-0 ${methodColor}`}>
          {method}
        </Badge>
        <code className="text-xs text-muted-foreground flex-1 truncate">{path}</code>
        <span className="text-sm font-medium truncate max-w-[200px]">{operation.summary}</span>
        {isAuth ? (
          <Lock className="h-3 w-3 text-yellow-400 shrink-0" />
        ) : (
          <Unlock className="h-3 w-3 text-green-400 shrink-0" />
        )}
        {expanded ? <ChevronDown className="h-4 w-4 shrink-0" /> : <ChevronRight className="h-4 w-4 shrink-0" />}
      </button>

      {expanded && (
        <div className="border-t border-border p-4 space-y-4 bg-card/30">
          <div className="flex items-start justify-between gap-4">
            <div className="flex-1">
              <p className="text-sm text-muted-foreground">{operation.description}</p>
              <div className="flex flex-wrap gap-1.5 mt-2">
                {operation.tags.map(tag => (
                  <Badge key={tag} variant="secondary" className="text-xs">{tag}</Badge>
                ))}
                {isAuth && (
                  <Badge variant="outline" className="text-xs text-yellow-400 border-yellow-400/50">
                    <Lock className="h-2.5 w-2.5 mr-1" /> Auth required
                  </Badge>
                )}
              </div>
            </div>
            <Button variant="ghost" size="sm" className="shrink-0" onClick={handleCopy}>
              {copied ? <CheckCheck className="h-3.5 w-3.5 text-green-400" /> : <Copy className="h-3.5 w-3.5" />}
            </Button>
          </div>

          {/* Parameters */}
          {operation.parameters && operation.parameters.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Parameters</p>
              <div className="space-y-1.5">
                {operation.parameters.map(param => (
                  <div key={param.name} className="flex items-center gap-2 text-xs">
                    <code className="font-mono bg-muted px-1.5 py-0.5 rounded text-foreground">{param.name}</code>
                    <Badge variant="outline" className="text-[10px] py-0">{param.in}</Badge>
                    {param.required && <Badge variant="outline" className="text-[10px] py-0 text-red-400 border-red-400/50">required</Badge>}
                    <span className="text-muted-foreground">{param.description}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Request body example */}
          {operation.requestBody && (
            <div>
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Request Body Example</p>
              <pre className="text-xs bg-muted rounded p-3 overflow-x-auto text-foreground">
                {JSON.stringify(
                  Object.values(operation.requestBody.content)[0]?.example ?? {},
                  null, 2
                )}
              </pre>
            </div>
          )}

          {/* Responses */}
          <div>
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Responses</p>
            <div className="space-y-1">
              {Object.entries(operation.responses).map(([code, resp]) => (
                <div key={code} className="flex items-center gap-2 text-xs">
                  <Badge
                    variant="outline"
                    className={`text-[10px] py-0 font-mono ${
                      code.startsWith("2") ? "text-green-400 border-green-400/50" :
                      code.startsWith("4") ? "text-yellow-400 border-yellow-400/50" :
                      "text-red-400 border-red-400/50"
                    }`}
                  >
                    {code}
                  </Badge>
                  <span className="text-muted-foreground">{resp.description}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── MAIN COMPONENT ──────────────────────────────────────────────────────────

export default function ApiExplorer() {
  const [spec, setSpec] = useState<OpenApiSpec | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [selectedTag, setSelectedTag] = useState<string | null>(null);
  const [expandedTags, setExpandedTags] = useState<Set<string>>(new Set());

  const fetchSpec = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/openapi.json");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setSpec(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load spec");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchSpec(); }, []);

  const toggleTag = (tag: string) => {
    setExpandedTags(prev => {
      const next = new Set(prev);
      if (next.has(tag)) next.delete(tag); else next.add(tag);
      return next;
    });
  };

  const handleDownload = () => {
    if (!spec) return;
    const blob = new Blob([JSON.stringify(spec, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "tradegateway-openapi.json";
    a.click();
    URL.revokeObjectURL(url);
  };

  // Build grouped endpoint list
  const groupedEndpoints: Record<string, Array<{ method: string; path: string; operation: NonNullable<OpenApiSpec["paths"][string][string]> }>> = {};

  if (spec) {
    for (const [path, methods] of Object.entries(spec.paths)) {
      for (const [method, operation] of Object.entries(methods)) {
        const tags = operation.tags ?? ["Other"];
        for (const tag of tags) {
          if (!groupedEndpoints[tag]) groupedEndpoints[tag] = [];

          // Apply search filter
          const searchLower = search.toLowerCase();
          if (
            !search ||
            operation.summary.toLowerCase().includes(searchLower) ||
            path.toLowerCase().includes(searchLower) ||
            tag.toLowerCase().includes(searchLower)
          ) {
            // Avoid duplicates (endpoint may appear in multiple tags)
            if (!groupedEndpoints[tag].some(e => e.path === path && e.method === method)) {
              groupedEndpoints[tag].push({ method, path, operation });
            }
          }
        }
      }
    }
  }

  const filteredTags = selectedTag
    ? Object.keys(groupedEndpoints).filter(t => t === selectedTag)
    : Object.keys(groupedEndpoints).sort();

  const totalEndpoints = spec ? Object.values(spec.paths).reduce((acc, methods) => acc + Object.keys(methods).length, 0) : 0;
  const authEndpoints = spec ? Object.values(spec.paths).reduce((acc, methods) =>
    acc + Object.values(methods).filter(op => (op.security?.length ?? 0) > 0).length, 0
  ) : 0;

  return (
    <DashboardLayout title="API Explorer — OpenAPI 3.1">
      <div className="space-y-4">

        {/* Header stats */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label: "Total Endpoints", value: totalEndpoints, icon: Zap, color: "text-blue-400" },
            { label: "Auth Required", value: authEndpoints, icon: Lock, color: "text-yellow-400" },
            { label: "Public", value: totalEndpoints - authEndpoints, icon: Globe, color: "text-green-400" },
            { label: "Tag Groups", value: spec?.tags.length ?? 0, icon: BookOpen, color: "text-purple-400" },
          ].map(stat => (
            <Card key={stat.label} className="bg-card/50">
              <CardContent className="p-3 flex items-center gap-2">
                <stat.icon className={`h-4 w-4 shrink-0 ${stat.color}`} />
                <div>
                  <p className="text-xs text-muted-foreground leading-none">{stat.label}</p>
                  <p className="text-lg font-bold leading-tight">{stat.value}</p>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Controls */}
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search endpoints..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="pl-9 h-9"
            />
          </div>
          <Button variant="outline" size="sm" onClick={fetchSpec} disabled={loading}>
            <RefreshCw className={`h-3.5 w-3.5 mr-2 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </Button>
          <Button variant="outline" size="sm" onClick={handleDownload} disabled={!spec}>
            <Download className="h-3.5 w-3.5 mr-2" />
            Download JSON
          </Button>
          <Button variant="outline" size="sm" asChild>
            <a href="/api/openapi.json" target="_blank" rel="noopener noreferrer">
              <ExternalLink className="h-3.5 w-3.5 mr-2" />
              Raw Spec
            </a>
          </Button>
        </div>

        {/* Tag filter pills */}
        {spec && (
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => setSelectedTag(null)}
              className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${
                !selectedTag ? "bg-primary text-primary-foreground border-primary" : "border-border hover:bg-accent"
              }`}
            >
              All
            </button>
            {spec.tags.map(tag => (
              <button
                key={tag.name}
                onClick={() => setSelectedTag(selectedTag === tag.name ? null : tag.name)}
                className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${
                  selectedTag === tag.name ? "bg-primary text-primary-foreground border-primary" : "border-border hover:bg-accent"
                }`}
              >
                {tag.name}
              </button>
            ))}
          </div>
        )}

        {/* Content */}
        {loading ? (
          <Card>
            <CardContent className="p-8 text-center">
              <RefreshCw className="h-8 w-8 animate-spin mx-auto mb-3 text-muted-foreground" />
              <p className="text-muted-foreground">Loading OpenAPI specification...</p>
            </CardContent>
          </Card>
        ) : error ? (
          <Card className="border-red-500/30">
            <CardContent className="p-6 text-center">
              <p className="text-red-400 font-medium">Failed to load specification</p>
              <p className="text-sm text-muted-foreground mt-1">{error}</p>
              <Button variant="outline" size="sm" className="mt-3" onClick={fetchSpec}>
                <RefreshCw className="h-3.5 w-3.5 mr-2" /> Retry
              </Button>
            </CardContent>
          </Card>
        ) : spec ? (
          <div className="space-y-3">
            {/* API Info */}
            <Card className="bg-gradient-to-r from-blue-500/10 to-purple-500/10 border-blue-500/20">
              <CardContent className="p-4">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <h2 className="font-bold text-lg">{spec.info.title}</h2>
                    <p className="text-sm text-muted-foreground">Version {spec.info.version}</p>
                  </div>
                  <Badge variant="outline" className="text-blue-400 border-blue-400/50 shrink-0">OAS 3.1</Badge>
                </div>
              </CardContent>
            </Card>

            {/* Endpoint groups */}
            {filteredTags.map(tag => {
              const endpoints = groupedEndpoints[tag] ?? [];
              if (endpoints.length === 0) return null;
              const isExpanded = expandedTags.has(tag);
              return (
                <Card key={tag}>
                  <CardHeader className="pb-0 pt-3 px-4">
                    <button
                      onClick={() => toggleTag(tag)}
                      className="flex items-center justify-between w-full"
                    >
                      <CardTitle className="text-sm flex items-center gap-2">
                        <Code2 className="h-4 w-4 text-muted-foreground" />
                        {tag}
                        <Badge variant="secondary" className="text-xs">{endpoints.length}</Badge>
                      </CardTitle>
                      {isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                    </button>
                  </CardHeader>
                  {isExpanded && (
                    <CardContent className="pt-3 space-y-2">
                      {endpoints.map(({ method, path, operation }) => (
                        <EndpointCard
                          key={`${method}-${path}`}
                          method={method}
                          path={path}
                          operation={operation}
                        />
                      ))}
                    </CardContent>
                  )}
                </Card>
              );
            })}
          </div>
        ) : null}
      </div>
    </DashboardLayout>
  );
}
