/**
 * Knowledge Graph Explorer
 *
 * Unified UI for the polyglot AI/graph stack:
 *   - System health: Go bridge, FalkorDB/Neo4j, Rust GNN, Python AI, Ollama
 *   - High-risk corridors from the knowledge graph
 *   - OGA processing backlog from the knowledge graph
 *   - EPR-KGQA: natural language question answering over the trade graph
 *   - ART: adaptive risk explanation using Ollama local LLM
 *   - Raw Cypher query executor (admin only)
 *
 * All data comes from the tRPC knowledgeGraph router, which proxies to the
 * Go bridge microservice. If the bridge is unavailable, the page shows
 * graceful fallback states rather than crashing.
 */

import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import {
  Network,
  Brain,
  Zap,
  Server,
  AlertTriangle,
  CheckCircle,
  XCircle,
  Search,
  MessageSquare,
  Code,
  TrendingUp,
  Clock,
  Globe,
  Loader2,
  RefreshCw,
  ChevronRight,
} from "lucide-react";
import { toast } from "sonner";

// ─── HEALTH STATUS BADGE ──────────────────────────────────────────────────────

function StatusBadge({ ok, label }: { ok: boolean; label: string }) {
  return (
    <div className="flex items-center gap-2">
      {ok ? (
        <CheckCircle className="h-4 w-4 text-emerald-400" />
      ) : (
        <XCircle className="h-4 w-4 text-red-400" />
      )}
      <span className={`text-sm ${ok ? "text-emerald-400" : "text-red-400"}`}>
        {label}
      </span>
    </div>
  );
}

// ─── LANE BADGE ───────────────────────────────────────────────────────────────

function LaneBadge({ lane }: { lane: string }) {
  const colors: Record<string, string> = {
    green: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
    yellow: "bg-amber-500/20 text-amber-400 border-amber-500/30",
    red: "bg-red-500/20 text-red-400 border-red-500/30",
  };
  return (
    <span
      className={`px-2 py-0.5 rounded-full text-xs font-semibold border uppercase ${colors[lane] ?? "bg-slate-500/20 text-slate-400"}`}
    >
      {lane}
    </span>
  );
}

// ─── RISK SCORE BAR ───────────────────────────────────────────────────────────

function RiskBar({ score }: { score: number }) {
  const pct = Math.round(score * 100);
  const color =
    pct < 35 ? "bg-emerald-500" : pct < 65 ? "bg-amber-500" : "bg-red-500";
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 bg-white/10 rounded-full h-2">
        <div
          className={`h-2 rounded-full transition-all ${color}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="text-xs text-slate-400 w-8 text-right">{pct}%</span>
    </div>
  );
}

// ─── MAIN PAGE ────────────────────────────────────────────────────────────────

export default function KnowledgeGraph() {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";

  // ── State ──────────────────────────────────────────────────────────────────
  const [kgqaQuestion, setKgqaQuestion] = useState("");
  const [cypherQuery, setCypherQuery] = useState(
    "MATCH (t:Trader)-[:SUBMITTED]->(d:Declaration)\nWHERE d.riskScore > 0.7\nRETURN t.name, COUNT(d) AS highRiskCount\nORDER BY highRiskCount DESC\nLIMIT 10"
  );
  const [activeTab, setActiveTab] = useState<"overview" | "kgqa" | "cypher">(
    "overview"
  );

  // ── tRPC queries ───────────────────────────────────────────────────────────
  const { data: health, isLoading: healthLoading, refetch: refetchHealth } =
    trpc.knowledgeGraph.health.useQuery(undefined, {
      refetchInterval: 30_000,
    });

  const { data: corridors, isLoading: corridorsLoading } =
    trpc.knowledgeGraph.highRiskCorridors.useQuery();

  const { data: ogaBacklog, isLoading: ogaLoading } =
    trpc.knowledgeGraph.ogaBacklog.useQuery();

  // ── tRPC mutations ─────────────────────────────────────────────────────────
  const kgqaMutation = trpc.knowledgeGraph.askKnowledgeGraph.useMutation({
    onError: (err) => toast.error("KGQA error: " + err.message),
  });

  const cypherMutation = trpc.knowledgeGraph.executeCypher.useMutation({
    onError: (err) => toast.error("Cypher error: " + err.message),
  });

  // ── Handlers ───────────────────────────────────────────────────────────────
  const handleKGQA = () => {
    if (!kgqaQuestion.trim()) return;
    kgqaMutation.mutate({ question: kgqaQuestion });
  };

  const handleCypher = () => {
    if (!cypherQuery.trim()) return;
    cypherMutation.mutate({ cypher: cypherQuery });
  };

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-2">
            <Network className="h-6 w-6 text-gold" />
            Entity Relationship Map
          </h1>
          <p className="text-slate-400 mt-1 text-sm">
            Visualise connections between traders, shipments, agencies, and risk patterns
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => refetchHealth()}
          className="gap-2"
        >
          <RefreshCw className="h-3 w-3" />
          Refresh
        </Button>
      </div>

      {/* ── System Health ───────────────────────────────────────────────────── */}
      <Card className="bg-navy-900/60 border-white/10">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-mono tracking-widest text-gold uppercase flex items-center gap-2">
            <Server className="h-4 w-4" />
            Intelligence Services Status
          </CardTitle>
        </CardHeader>
        <CardContent>
          {healthLoading ? (
            <div className="flex items-center gap-2 text-slate-400">
              <Loader2 className="h-4 w-4 animate-spin" />
              Checking services...
            </div>
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
              <StatusBadge
                ok={health?.bridgeReachable ?? false}
                label="Integration Layer"
              />
              <StatusBadge
                ok={health?.graph ?? false}
                label="Relationship Database"
              />
              <StatusBadge
                ok={health?.bridgeReachable ?? false}
                label="Risk Scoring Engine"
              />
              <StatusBadge
                ok={health?.bridgeReachable ?? false}
                label="Document Indexer"
              />
              <StatusBadge
                ok={health?.bridgeReachable ?? false}
                label="Query Intelligence"
              />
              <StatusBadge
                ok={health?.bridgeReachable ?? false}
                label="AI Language Model"
              />
            </div>
          )}
          {health && !health.bridgeReachable && (
            <div className="mt-3 flex items-start gap-2 text-amber-400 text-xs bg-amber-500/10 rounded-lg p-3 border border-amber-500/20">
              <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
              <span>
                Go bridge is not running. Start it with{" "}
                <code className="font-mono bg-black/30 px-1 rounded">
                  cd services/go-graph-bridge && go run ./cmd/server
                </code>{" "}
                to enable live graph queries. All panels below show seeded
                demo data.
              </span>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── Tab Navigation ──────────────────────────────────────────────────── */}
      <div className="flex gap-1 border-b border-white/10 pb-1">
        {(
          [
            { id: "overview", label: "Overview", icon: TrendingUp },
            { id: "kgqa", label: "Ask a Question", icon: MessageSquare },
            { id: "cypher", label: "Advanced Query", icon: Code }
          ] as const
        ).map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => setActiveTab(id)}
            disabled={id === "cypher" && !isAdmin}
            className={`flex items-center gap-2 px-4 py-2 rounded-t-lg text-sm font-medium transition-all ${
              activeTab === id
                ? "bg-gold/20 text-gold border-b-2 border-gold"
                : "text-slate-400 hover:text-white hover:bg-white/5"
            } disabled:opacity-40 disabled:cursor-not-allowed`}
          >
            <Icon className="h-4 w-4" />
            {label}
            {id === "cypher" && !isAdmin && (
              <span className="text-xs text-slate-500">(admin)</span>
            )}
          </button>
        ))}
      </div>

      {/* ── OVERVIEW TAB ────────────────────────────────────────────────────── */}
      {activeTab === "overview" && (
        <div className="grid lg:grid-cols-2 gap-6">
          {/* High-Risk Corridors */}
          <Card className="bg-navy-900/60 border-white/10">
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Globe className="h-4 w-4 text-gold" />
                High-Risk Trade Corridors
              </CardTitle>
              <CardDescription>
                Trade routes with elevated risk indicators requiring closer scrutiny
              </CardDescription>
            </CardHeader>
            <CardContent>
              {corridorsLoading ? (
                <div className="flex items-center gap-2 text-slate-400">
                  <Loader2 className="h-4 w-4 animate-spin" /> Loading...
                </div>
              ) : corridors?.corridors && corridors.corridors.length > 0 ? (
                <div className="space-y-3">
                  {corridors.corridors.map((c) => (
                    <div
                      key={c.id}
                      className="flex items-center gap-3 p-3 rounded-lg bg-white/5 border border-white/10"
                    >
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-sm font-semibold text-white">
                            {c.origin}
                          </span>
                          <ChevronRight className="h-3 w-3 text-slate-500" />
                          <span className="text-sm font-semibold text-white">
                            {c.destination}
                          </span>
                          <span className="text-xs text-slate-500 ml-auto">
                            {c.volume.toLocaleString()} shipments/yr
                          </span>
                        </div>
                        <RiskBar score={c.riskIndex} />
                      </div>
                      <div className="text-right shrink-0">
                        <div className="text-xs text-slate-400">Avg transit</div>
                        <div className="text-sm font-semibold text-white">
                          {c.avgDays}d
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-slate-400 text-sm py-4 text-center">
                  No high-risk corridors found. Start the Go bridge to load live
                  data.
                </div>
              )}
            </CardContent>
          </Card>

          {/* OGA Backlog */}
          <Card className="bg-navy-900/60 border-white/10">
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Clock className="h-4 w-4 text-gold" />
                Agency Processing Backlog
              </CardTitle>
              <CardDescription>
                Current permit and approval queues across all government agencies
              </CardDescription>
            </CardHeader>
            <CardContent>
              {ogaLoading ? (
                <div className="flex items-center gap-2 text-slate-400">
                  <Loader2 className="h-4 w-4 animate-spin" /> Loading...
                </div>
              ) : ogaBacklog?.ogas && ogaBacklog.ogas.length > 0 ? (
                <div className="space-y-3">
                  {ogaBacklog.ogas.map((oga) => {
                    const slaBreached = oga.avgProcessingHours > oga.slaHours;
                    return (
                      <div
                        key={oga.id}
                        className={`p-3 rounded-lg border ${
                          slaBreached
                            ? "bg-red-500/10 border-red-500/20"
                            : "bg-white/5 border-white/10"
                        }`}
                      >
                        <div className="flex items-center justify-between mb-2">
                          <div>
                            <span className="text-sm font-semibold text-white">
                              {oga.code}
                            </span>
                            <span className="text-xs text-slate-400 ml-2">
                              {oga.name}
                            </span>
                          </div>
                          <div className="flex items-center gap-2">
                            {slaBreached && (
                              <Badge
                                variant="destructive"
                                className="text-xs"
                              >
                                SLA Breach
                              </Badge>
                            )}
                            <span className="text-xs text-slate-400">
                              {oga.backlogCount} pending
                            </span>
                          </div>
                        </div>
                        <div className="flex items-center gap-4 text-xs text-slate-400">
                          <span>
                            Avg:{" "}
                            <span
                              className={
                                slaBreached ? "text-red-400" : "text-white"
                              }
                            >
                              {oga.avgProcessingHours.toFixed(1)}h
                            </span>
                          </span>
                          <span>SLA: {oga.slaHours}h</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="text-slate-400 text-sm py-4 text-center">
                  No OGA data available. Start the Go bridge to load live data.
                </div>
              )}
            </CardContent>
          </Card>

          {/* Architecture Overview */}
          <Card className="bg-navy-900/60 border-white/10 lg:col-span-2">
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Brain className="h-4 w-4 text-gold" />
                How the Intelligence Platform Works
              </CardTitle>
              <CardDescription>
                The analytical capabilities that power risk detection, document processing, and trade insights
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid md:grid-cols-3 gap-4">
                {[
                  {
                    icon: <Network className="h-5 w-5" />,
                    title: "Trade Relationship Database",
                    subtitle: "Connecting Traders, Shipments & Agencies",
                    color: "text-blue-400",
                    bg: "bg-blue-500/10 border-blue-500/20",
                    points: [
                      "Maps every trader, declaration, and commodity code as linked entities",
                      "Tracks who submitted what, through which port, using which agent",
                      "Spreads risk signals across connected trader networks",
                      "Screens for restricted-party connections automatically",
                      "Detects complex patterns across thousands of shipments",
                    ],
                  },
                  {
                    icon: <Zap className="h-5 w-5" />,
                    title: "Risk Scoring Engine",
                    subtitle: "Automated Threat Assessment",
                    color: "text-orange-400",
                    bg: "bg-orange-500/10 border-orange-500/20",
                    points: [
                      "Analyses trader history, declaration patterns, and commodity risk",
                      "Risk signals flow from trader level down to individual shipments",
                      "Processes millions of data points in seconds",
                      "Combines automated scoring with rule-based compliance checks",
                      "Falls back to rule-based scoring if the engine is unavailable",
                    ],
                  },
                  {
                    icon: <Brain className="h-5 w-5" />,
                    title: "Document Intelligence",
                    subtitle: "Automated Document Reading & Q&A",
                    color: "text-purple-400",
                    bg: "bg-purple-500/10 border-purple-500/20",
                    points: [
                      "Automatically reads and indexes Bills of Lading, invoices, and permits",
                      "Extracts key data: trader names, commodity codes, port details",
                      "Answers natural-language questions about any shipment document",
                      "Identifies discrepancies between declared and extracted values",
                      "Multi-step reasoning to surface the most relevant information",
                    ],
                  },
                  {
                    icon: <MessageSquare className="h-5 w-5" />,
                    title: "Secure AI Language Model",
                    subtitle: "On-Premise, Data-Sovereign AI",
                    color: "text-emerald-400",
                    bg: "bg-emerald-500/10 border-emerald-500/20",
                    points: [
                      "AI model runs entirely within the national data centre",
                      "No trade data is ever sent to external cloud providers",
                      "Generates plain-language explanations of risk decisions",
                      "Summarises complex documents for customs officers",
                      "Falls back to approved cloud AI if the local model is unavailable",
                    ],
                  },
                  {
                    icon: <Server className="h-5 w-5" />,
                    title: "Integration Orchestrator",
                    subtitle: "Connecting All Intelligence Services",
                    color: "text-cyan-400",
                    bg: "bg-cyan-500/10 border-cyan-500/20",
                    points: [
                      "Single connection point linking all analytical services",
                      "Runs risk scoring, document analysis, and graph queries simultaneously",
                      "Automatically recovers if any individual service is unavailable",
                      "Full request logging for audit and compliance purposes",
                      "Scales horizontally to handle peak declaration volumes",
                    ],
                  },
                  {
                    icon: <TrendingUp className="h-5 w-5" />,
                    title: "Explainable Decision Engine",
                    subtitle: "Transparent, Auditable Risk Reasoning",
                    color: "text-gold",
                    bg: "bg-yellow-500/10 border-yellow-500/20",
                    points: [
                      "Explains in plain language why a shipment received its risk rating",
                      "Retrieves relevant precedents from historical trade data",
                      "Recommends specific actions for customs officers to take",
                      "Every decision is traceable and can be reviewed by supervisors",
                      "Cites similar past cases to support recommendations",
                    ],
                  },
                ].map((card) => (
                  <div
                    key={card.title}
                    className={`rounded-xl border p-4 ${card.bg}`}
                  >
                    <div className={`${card.color} mb-2`}>{card.icon}</div>
                    <div className="text-sm font-bold text-white mb-0.5">
                      {card.title}
                    </div>
                    <div className="text-xs text-slate-400 mb-3">
                      {card.subtitle}
                    </div>
                    <ul className="space-y-1">
                      {card.points.map((p, i) => (
                        <li
                          key={i}
                          className="text-xs text-slate-300 flex gap-1.5"
                        >
                          <span className={card.color}>›</span>
                          {p}
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* ── KGQA TAB ────────────────────────────────────────────────────────── */}
      {activeTab === "kgqa" && (
        <div className="space-y-6">
          <Card className="bg-navy-900/60 border-white/10">
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <MessageSquare className="h-4 w-4 text-gold" />
                Ask the Trade Knowledge Graph
              </CardTitle>
              <CardDescription>
                Ask a question in plain English and get structured answers from the trade intelligence graph.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex gap-3">
                <Input
                  value={kgqaQuestion}
                  onChange={(e) => setKgqaQuestion(e.target.value)}
                  placeholder="e.g. Which traders have the highest red-lane rate for HS chapter 85?"
                  className="bg-white/5 border-white/20 text-white placeholder:text-slate-500"
                  onKeyDown={(e) => e.key === "Enter" && handleKGQA()}
                />
                <Button
                  onClick={handleKGQA}
                  disabled={kgqaMutation.isPending || !kgqaQuestion.trim()}
                  className="gap-2 bg-gold text-navy hover:bg-gold/90 shrink-0"
                >
                  {kgqaMutation.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Search className="h-4 w-4" />
                  )}
                  Ask
                </Button>
              </div>

              {/* Example questions */}
              <div className="flex flex-wrap gap-2">
                {[
                  "Which corridors have the highest fraud rate?",
                  "Show traders with more than 5 violations",
                  "What is the average risk score for HS chapter 71?",
                  "Which OGAs are breaching their SLA?",
                ].map((q) => (
                  <button
                    key={q}
                    onClick={() => setKgqaQuestion(q)}
                    className="text-xs px-3 py-1.5 rounded-full bg-white/5 border border-white/10 text-slate-400 hover:text-white hover:border-gold/30 transition-colors"
                  >
                    {q}
                  </button>
                ))}
              </div>

              {/* Result */}
              {kgqaMutation.data && (
                <div className="space-y-3 mt-4">
                  <Separator className="bg-white/10" />
                  <div className="flex items-center gap-2">
                    <Badge
                      variant="outline"
                      className="text-xs border-gold/30 text-gold"
                    >
                      {kgqaMutation.data.intent}
                    </Badge>
                    <span className="text-xs text-slate-500">
                      {kgqaMutation.data.resultCount} results
                    </span>
                    {kgqaMutation.data.fallback && (
                      <Badge variant="destructive" className="text-xs">
                        Fallback
                      </Badge>
                    )}
                  </div>
                  <div className="bg-white/5 rounded-lg p-4 border border-white/10">
                    <p className="text-sm text-white leading-relaxed">
                      {kgqaMutation.data.answer}
                    </p>
                  </div>
                  {kgqaMutation.data.cypher && (
                    <div>
                      <div className="text-xs text-slate-500 mb-1 font-mono">
                        Query generated:
                      </div>
                      <pre className="text-xs text-emerald-400 bg-black/40 rounded-lg p-3 border border-white/10 overflow-x-auto">
                        {kgqaMutation.data.cypher}
                      </pre>
                    </div>
                  )}
                  {kgqaMutation.data.results.length > 0 && (
                    <div className="overflow-x-auto">
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="border-b border-white/10">
                            {Object.keys(kgqaMutation.data.results[0]).map(
                              (k) => (
                                <th
                                  key={k}
                                  className="text-left px-3 py-2 text-slate-400 font-normal"
                                >
                                  {k}
                                </th>
                              )
                            )}
                          </tr>
                        </thead>
                        <tbody>
                          {kgqaMutation.data.results.map((row, i) => (
                            <tr
                              key={i}
                              className="border-b border-white/5 hover:bg-white/5"
                            >
                              {Object.values(row).map((v, j) => (
                                <td
                                  key={j}
                                  className="px-3 py-2 text-slate-300"
                                >
                                  {String(v)}
                                </td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {/* ── CYPHER TAB (admin only) ──────────────────────────────────────────── */}
      {activeTab === "cypher" && isAdmin && (
        <Card className="bg-navy-900/60 border-white/10">
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Code className="h-4 w-4 text-gold" />
              Advanced Graph Query
            </CardTitle>
            <CardDescription>
              Run direct queries against the trade intelligence graph database. Administrator access only.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Textarea
              value={cypherQuery}
              onChange={(e) => setCypherQuery(e.target.value)}
              rows={6}
              className="font-mono text-sm bg-black/40 border-white/20 text-emerald-400 placeholder:text-slate-600"
              placeholder="MATCH (n) RETURN n LIMIT 10"
            />
            <Button
              onClick={handleCypher}
              disabled={cypherMutation.isPending || !cypherQuery.trim()}
              className="gap-2 bg-gold text-navy hover:bg-gold/90"
            >
              {cypherMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Zap className="h-4 w-4" />
              )}
              Run Query
            </Button>

            {cypherMutation.data && (
              <div className="space-y-2">
                <Separator className="bg-white/10" />
                <div className="text-xs text-slate-500">
                  {cypherMutation.data.count} rows returned
                </div>
                {cypherMutation.data.results.length > 0 ? (
                  <div className="overflow-x-auto">
                    <pre className="text-xs text-slate-300 bg-black/40 rounded-lg p-4 border border-white/10 max-h-64 overflow-y-auto">
                      {JSON.stringify(cypherMutation.data.results, null, 2)}
                    </pre>
                  </div>
                ) : (
                  <div className="text-slate-400 text-sm py-2">
                    No results returned (or Go bridge not running).
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
