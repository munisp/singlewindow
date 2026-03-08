/**
 * Fraud Network Visualisation — /app/admin/fraud-network
 *
 * D3 force-directed graph showing traders, HS codes, ports, and OGAs
 * as nodes, with risk-weighted edges. Node colour = risk lane.
 * Powered by the knowledgeGraph.fraudNetwork tRPC procedure.
 */

import { useEffect, useRef, useState, useCallback } from "react";
import * as d3 from "d3";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AlertTriangle,
  Network,
  RefreshCw,
  ZoomIn,
  ZoomOut,
  Maximize2,
  Info,
  Activity,
  Users,
  Package,
  Anchor,
  Building2,
  Search,
  ShieldAlert,
  TrendingUp,
  FileText,
  X,
  CheckCircle,
  Clock,
  BarChart2,
} from "lucide-react";
import { toast } from "sonner";
import { useLocation } from "wouter";
import DashboardLayout from "@/components/DashboardLayout";

// ── Types ──────────────────────────────────────────────────────────────────────

type NodeType = "trader" | "hs_code" | "port" | "oga" | "corridor";

interface GraphNode extends d3.SimulationNodeDatum {
  id: string;
  label: string;
  type: NodeType;
  riskScore: number;
  properties: Record<string, unknown>;
}

interface GraphEdge extends d3.SimulationLinkDatum<GraphNode> {
  source: string | GraphNode;
  target: string | GraphNode;
  type: string;
  weight: number;
  properties: Record<string, unknown>;
}

// ── Constants ──────────────────────────────────────────────────────────────────

const NODE_RADIUS: Record<NodeType, number> = {
  trader: 14,
  hs_code: 10,
  port: 12,
  oga: 11,
  corridor: 8,
};

const NODE_ICON: Record<NodeType, string> = {
  trader: "T",
  hs_code: "H",
  port: "P",
  oga: "O",
  corridor: "C",
};

function riskColor(score: number): string {
  if (score >= 0.65) return "#ef4444"; // red
  if (score >= 0.35) return "#f59e0b"; // amber
  return "#22c55e"; // green
}

function riskLabel(score: number): string {
  if (score >= 0.65) return "HIGH";
  if (score >= 0.35) return "MEDIUM";
  return "LOW";
}

function riskBadgeVariant(score: number): "destructive" | "secondary" | "outline" {
  if (score >= 0.65) return "destructive";
  if (score >= 0.35) return "secondary";
  return "outline";
}

const TYPE_LABELS: Record<NodeType, string> = {
  trader: "Trader",
  hs_code: "Commodity",
  port: "Port",
  oga: "Government Agency",
  corridor: "Trade Route",
};

const TYPE_ICONS: Record<NodeType, React.ReactNode> = {
  trader: <Users size={14} />,
  hs_code: <Package size={14} />,
  port: <Anchor size={14} />,
  oga: <Building2 size={14} />,
  corridor: <Activity size={14} />,
};

// ── Component ──────────────────────────────────────────────────────────────────

export default function FraudNetwork() {
  const svgRef = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const simulationRef = useRef<d3.Simulation<GraphNode, GraphEdge> | null>(null);

  const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null);
  const [investigationTraderId, setInvestigationTraderId] = useState<string | null>(null);
  const [minRisk, setMinRisk] = useState(0.4);
  const [limit, setLimit] = useState(200);
  const [filterType, setFilterType] = useState<NodeType | "all">("all");
  const [zoom, setZoom] = useState(1);
  const zoomRef = useRef<d3.ZoomBehavior<SVGSVGElement, unknown> | null>(null);

  // Investigation data from tRPC
  const investigationQuery = trpc.knowledgeGraph.getTraderInvestigation.useQuery(
    { traderId: investigationTraderId ?? "", months: 12 },
    { enabled: !!investigationTraderId, refetchOnWindowFocus: false }
  );

  // Shared-agent co-network data
  const sharedAgentQuery = trpc.knowledgeGraph.sharedAgentNetwork.useQuery(
    { traderId: investigationTraderId ?? "", months: 12 },
    { enabled: !!investigationTraderId, refetchOnWindowFocus: false }
  );

  const [, setLocation] = useLocation();

  // Create fraud case mutation
  const createCaseMutation = trpc.fraudCases.createCase.useMutation({
    onSuccess: (newCase) => {
      toast.success(`Case #${newCase.caseNumber} opened`, {
        description: `"${newCase.title}" — navigate to Fraud Cases to add notes.`,
        action: {
          label: "View Case",
          onClick: () => setLocation("/app/admin/fraud-cases"),
        },
      });
    },
    onError: (err: { message: string }) =>
      toast.error("Failed to open case", { description: err.message }),
  });

  // Post-clearance audit mutation to flag a trader
  const scheduleAuditMutation = trpc.postAudit.schedule.useMutation({
    onSuccess: () => {
      toast.success("Trader flagged for post-clearance audit");
      investigationQuery.refetch();
    },
    onError: (err: { message: string }) => toast.error("Failed to flag audit", { description: err.message }),
  });

  const { data, isLoading, refetch, isFetching } = trpc.knowledgeGraph.fraudNetwork.useQuery(
    { limit, minRisk },
    { refetchOnWindowFocus: false }
  );

  const buildGraph = useCallback(() => {
    if (!data || !svgRef.current || !containerRef.current) return;

    const container = containerRef.current;
    const width = container.clientWidth || 900;
    const height = container.clientHeight || 600;

    // Filter nodes by type
    const filteredNodes: GraphNode[] = (data.nodes as GraphNode[]).filter(
      (n) => filterType === "all" || n.type === filterType
    );
    const nodeIds = new Set(filteredNodes.map((n) => n.id));

    const filteredEdges: GraphEdge[] = (data.edges as GraphEdge[]).filter(
      (e) =>
        nodeIds.has(e.source as string) && nodeIds.has(e.target as string)
    );

    // Clear previous
    d3.select(svgRef.current).selectAll("*").remove();

    const svg = d3
      .select(svgRef.current)
      .attr("width", width)
      .attr("height", height);

    // Zoom behaviour
    const zoomBehavior = d3
      .zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.2, 4])
      .on("zoom", (event) => {
        g.attr("transform", event.transform);
        setZoom(event.transform.k);
      });
    zoomRef.current = zoomBehavior;
    svg.call(zoomBehavior);

    const g = svg.append("g");

    // Arrow marker
    svg
      .append("defs")
      .append("marker")
      .attr("id", "arrow")
      .attr("viewBox", "0 -5 10 10")
      .attr("refX", 20)
      .attr("refY", 0)
      .attr("markerWidth", 6)
      .attr("markerHeight", 6)
      .attr("orient", "auto")
      .append("path")
      .attr("d", "M0,-5L10,0L0,5")
      .attr("fill", "#475569");

    // Edges
    const link = g
      .append("g")
      .selectAll("line")
      .data(filteredEdges)
      .enter()
      .append("line")
      .attr("stroke", (d) => {
        const w = d.weight ?? 0;
        return w >= 0.65 ? "#ef444460" : w >= 0.35 ? "#f59e0b60" : "#22c55e40";
      })
      .attr("stroke-width", (d) => Math.max(1, (d.weight ?? 0) * 4))
      .attr("marker-end", "url(#arrow)")
      .style("cursor", "pointer")
      .on("mouseover", function (event, d) {
        d3.select(this).attr("stroke-opacity", 1).attr("stroke-width", (d.weight ?? 0) * 6 + 1);
      })
      .on("mouseout", function (event, d) {
        d3.select(this).attr("stroke-opacity", 0.6).attr("stroke-width", Math.max(1, (d.weight ?? 0) * 4));
      });

    // Edge labels
    const edgeLabel = g
      .append("g")
      .selectAll("text")
      .data(filteredEdges)
      .enter()
      .append("text")
      .attr("font-size", 8)
      .attr("fill", "#94a3b8")
      .attr("text-anchor", "middle")
      .text((d) => d.type.replace(/_/g, " "));

    // Nodes
    const node = g
      .append("g")
      .selectAll("g")
      .data(filteredNodes)
      .enter()
      .append("g")
      .style("cursor", "pointer")
      .on("click", (event, d) => {
        event.stopPropagation();
        setSelectedNode(d);
        // Open investigation panel for trader nodes
        if (d.type === "trader") {
          setInvestigationTraderId(d.id);
        }
      })
      .call(
        d3
          .drag<SVGGElement, GraphNode>()
          .on("start", (event, d) => {
            if (!event.active) simulationRef.current?.alphaTarget(0.3).restart();
            d.fx = d.x;
            d.fy = d.y;
          })
          .on("drag", (event, d) => {
            d.fx = event.x;
            d.fy = event.y;
          })
          .on("end", (event, d) => {
            if (!event.active) simulationRef.current?.alphaTarget(0);
            d.fx = null;
            d.fy = null;
          })
      );

    // Node circles
    node
      .append("circle")
      .attr("r", (d) => NODE_RADIUS[d.type])
      .attr("fill", (d) => riskColor(d.riskScore))
      .attr("fill-opacity", 0.85)
      .attr("stroke", "#1e293b")
      .attr("stroke-width", 2);

    // Node type letter
    node
      .append("text")
      .attr("text-anchor", "middle")
      .attr("dominant-baseline", "central")
      .attr("font-size", 9)
      .attr("font-weight", "bold")
      .attr("fill", "#fff")
      .text((d) => NODE_ICON[d.type]);

    // Node label
    node
      .append("text")
      .attr("x", (d) => NODE_RADIUS[d.type] + 4)
      .attr("y", 4)
      .attr("font-size", 10)
      .attr("fill", "#e2e8f0")
      .text((d) => (d.label.length > 18 ? d.label.slice(0, 16) + "…" : d.label));

    // Simulation
    const simulation = d3
      .forceSimulation<GraphNode>(filteredNodes)
      .force(
        "link",
        d3
          .forceLink<GraphNode, GraphEdge>(filteredEdges)
          .id((d) => d.id)
          .distance(80)
          .strength(0.5)
      )
      .force("charge", d3.forceManyBody().strength(-200))
      .force("center", d3.forceCenter(width / 2, height / 2))
      .force("collision", d3.forceCollide().radius((d) => NODE_RADIUS[(d as GraphNode).type] + 8))
      .on("tick", () => {
        link
          .attr("x1", (d) => (d.source as GraphNode).x ?? 0)
          .attr("y1", (d) => (d.source as GraphNode).y ?? 0)
          .attr("x2", (d) => (d.target as GraphNode).x ?? 0)
          .attr("y2", (d) => (d.target as GraphNode).y ?? 0);

        edgeLabel
          .attr("x", (d) => (((d.source as GraphNode).x ?? 0) + ((d.target as GraphNode).x ?? 0)) / 2)
          .attr("y", (d) => (((d.source as GraphNode).y ?? 0) + ((d.target as GraphNode).y ?? 0)) / 2);

        node.attr("transform", (d) => `translate(${d.x ?? 0},${d.y ?? 0})`);
      });

    simulationRef.current = simulation;

    // Deselect on background click
    svg.on("click", () => setSelectedNode(null));
  }, [data, filterType]);

  useEffect(() => {
    buildGraph();
    return () => {
      simulationRef.current?.stop();
    };
  }, [buildGraph]);

  // Handle resize
  useEffect(() => {
    const observer = new ResizeObserver(() => buildGraph());
    if (containerRef.current) observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, [buildGraph]);

  const handleZoomIn = () => {
    if (svgRef.current && zoomRef.current) {
      d3.select(svgRef.current).transition().call(zoomRef.current.scaleBy, 1.3);
    }
  };

  const handleZoomOut = () => {
    if (svgRef.current && zoomRef.current) {
      d3.select(svgRef.current).transition().call(zoomRef.current.scaleBy, 0.77);
    }
  };

  const handleFit = () => {
    if (svgRef.current && zoomRef.current && containerRef.current) {
      const width = containerRef.current.clientWidth;
      const height = containerRef.current.clientHeight;
      d3.select(svgRef.current)
        .transition()
        .call(zoomRef.current.transform, d3.zoomIdentity.translate(width / 2, height / 2).scale(0.8));
    }
  };

  const stats = data?.stats;

  return (
    <DashboardLayout>
      <div className="flex flex-col h-full gap-4 p-6">
        {/* Header */}
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
              <Network size={24} className="text-primary" />
              Trade Risk Network Map
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              Visual map of traders, shipments, ports, and agencies — colour indicates risk level (red = high, amber = medium, green = low)
            </p>
          </div>
          <div className="flex items-center gap-2">
            {data?.fallback && (
              <Badge variant="secondary" className="gap-1">
                <Info size={12} />
                Showing sample data — live data service offline
              </Badge>
            )}
            <Button
              variant="outline"
              size="sm"
              onClick={() => refetch()}
              disabled={isFetching}
              className="gap-2"
            >
              <RefreshCw size={14} className={isFetching ? "animate-spin" : ""} />
              Refresh
            </Button>
          </div>
        </div>

        {/* Stats row */}
        {stats && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[
              { label: "Total Nodes", value: stats.totalNodes, icon: <Network size={16} /> },
              { label: "Total Edges", value: stats.totalEdges, icon: <Activity size={16} /> },
              { label: "High-Risk Nodes", value: stats.highRiskNodes, icon: <AlertTriangle size={16} className="text-red-400" /> },
              { label: "Avg Risk Score", value: `${(stats.avgRiskScore * 100).toFixed(1)}%`, icon: <Activity size={16} /> },
            ].map((s) => (
              <Card key={s.label} className="bg-card">
                <CardContent className="p-3 flex items-center gap-3">
                  <div className="text-muted-foreground">{s.icon}</div>
                  <div>
                    <div className="text-lg font-bold">{s.value}</div>
                    <div className="text-xs text-muted-foreground">{s.label}</div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        <div className="flex gap-4 flex-1 min-h-0">
          {/* Controls sidebar */}
          <div className="w-56 shrink-0 flex flex-col gap-4">
            <Card>
              <CardHeader className="pb-2 pt-4 px-4">
                <CardTitle className="text-sm">Filters</CardTitle>
              </CardHeader>
              <CardContent className="px-4 pb-4 space-y-4">
                <div className="space-y-2">
                  <Label className="text-xs">Node Type</Label>
                  <Select
                    value={filterType}
                    onValueChange={(v) => setFilterType(v as NodeType | "all")}
                  >
                    <SelectTrigger className="h-8 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Types</SelectItem>
                      <SelectItem value="trader">Traders</SelectItem>
                      <SelectItem value="hs_code">HS Codes</SelectItem>
                      <SelectItem value="port">Ports</SelectItem>
                      <SelectItem value="oga">OGAs</SelectItem>
                      <SelectItem value="corridor">Corridors</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label className="text-xs">
                    Min Risk Score: {(minRisk * 100).toFixed(0)}%
                  </Label>
                  <Slider
                    min={0}
                    max={0.9}
                    step={0.05}
                    value={[minRisk]}
                    onValueChange={([v]) => setMinRisk(v)}
                    className="w-full"
                  />
                </div>

                <div className="space-y-2">
                  <Label className="text-xs">Node Limit: {limit}</Label>
                  <Slider
                    min={20}
                    max={500}
                    step={20}
                    value={[limit]}
                    onValueChange={([v]) => setLimit(v)}
                    className="w-full"
                  />
                </div>

                <Button
                  size="sm"
                  className="w-full"
                  onClick={() => refetch()}
                  disabled={isFetching}
                >
                  Apply Filters
                </Button>
              </CardContent>
            </Card>

            {/* Legend */}
            <Card>
              <CardHeader className="pb-2 pt-4 px-4">
                <CardTitle className="text-sm">Legend</CardTitle>
              </CardHeader>
              <CardContent className="px-4 pb-4 space-y-3">
                <div className="space-y-1.5">
                  <div className="text-xs text-muted-foreground font-medium">Risk Level</div>
                  {[
                    { color: "#ef4444", label: "High (≥65%)" },
                    { color: "#f59e0b", label: "Medium (35–64%)" },
                    { color: "#22c55e", label: "Low (<35%)" },
                  ].map((l) => (
                    <div key={l.label} className="flex items-center gap-2 text-xs">
                      <div className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: l.color }} />
                      {l.label}
                    </div>
                  ))}
                </div>

                <div className="space-y-1.5">
                  <div className="text-xs text-muted-foreground font-medium">Node Types</div>
                  {(Object.entries(TYPE_LABELS) as [NodeType, string][]).map(([type, label]) => (
                    <div key={type} className="flex items-center gap-2 text-xs">
                      <div className="w-5 h-5 rounded-full bg-slate-600 flex items-center justify-center text-white text-[9px] font-bold shrink-0">
                        {NODE_ICON[type]}
                      </div>
                      {label}
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>

            {/* Zoom controls */}
            <Card>
              <CardContent className="p-3 flex gap-2">
                <Button variant="outline" size="sm" onClick={handleZoomIn} className="flex-1 gap-1 text-xs">
                  <ZoomIn size={12} /> In
                </Button>
                <Button variant="outline" size="sm" onClick={handleZoomOut} className="flex-1 gap-1 text-xs">
                  <ZoomOut size={12} /> Out
                </Button>
                <Button variant="outline" size="sm" onClick={handleFit} className="flex-1 gap-1 text-xs">
                  <Maximize2 size={12} /> Fit
                </Button>
              </CardContent>
            </Card>
          </div>

          {/* Graph canvas */}
          <div className="flex-1 flex flex-col gap-3 min-w-0">
            <Card className="flex-1 overflow-hidden">
              <div
                ref={containerRef}
                className="relative w-full h-full bg-slate-950 rounded-lg overflow-hidden"
                style={{ minHeight: 500 }}
              >
                {isLoading && (
                  <div className="absolute inset-0 flex items-center justify-center bg-slate-950/80 z-10">
                    <div className="text-center space-y-2">
                      <RefreshCw size={32} className="animate-spin text-primary mx-auto" />
                      <p className="text-sm text-muted-foreground">Loading fraud network…</p>
                    </div>
                  </div>
                )}
                <svg ref={svgRef} className="w-full h-full" />
                <div className="absolute bottom-3 right-3 text-xs text-slate-500">
                  Zoom: {(zoom * 100).toFixed(0)}% · Drag nodes to explore · Click for details
                </div>
              </div>
            </Card>

            {/* Selected node detail */}
            {selectedNode && (
              <Card className="shrink-0">
                <CardHeader className="pb-2 pt-4 px-4">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <span className="text-muted-foreground">{TYPE_ICONS[selectedNode.type]}</span>
                    {selectedNode.label}
                    <Badge variant={riskBadgeVariant(selectedNode.riskScore)} className="ml-auto">
                      {riskLabel(selectedNode.riskScore)} RISK · {(selectedNode.riskScore * 100).toFixed(1)}%
                    </Badge>
                    {selectedNode.type === "trader" && (
                      <Button
                        variant="outline"
                        size="sm"
                        className="ml-2 gap-1 text-xs"
                        onClick={() => setInvestigationTraderId(selectedNode.id)}
                      >
                        <Search size={12} /> Investigate
                      </Button>
                    )}
                  </CardTitle>
                </CardHeader>
                <CardContent className="px-4 pb-4">
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                    <div>
                      <div className="text-muted-foreground">Type</div>
                      <div className="font-medium">{TYPE_LABELS[selectedNode.type]}</div>
                    </div>
                    <div>
                      <div className="text-muted-foreground">ID</div>
                      <div className="font-mono">{selectedNode.id}</div>
                    </div>
                    {Object.entries(selectedNode.properties).slice(0, 4).map(([k, v]) => (
                      <div key={k}>
                        <div className="text-muted-foreground capitalize">{k.replace(/_/g, " ")}</div>
                        <div className="font-medium">{String(v)}</div>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}

            {/* ── Fraud Investigation Drill-Down Panel ── */}
            {investigationTraderId && (
              <Card className="shrink-0 border-destructive/50">
                <CardHeader className="pb-2 pt-4 px-4">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <ShieldAlert size={16} className="text-destructive" />
                    Fraud Investigation
                    {investigationQuery.data && (
                      <span className="text-muted-foreground font-normal ml-1">
                        — {investigationQuery.data.trader.companyName || `Trader ${investigationTraderId}`}
                      </span>
                    )}
                    <Button
                      variant="ghost"
                      size="sm"
                      className="ml-auto h-6 w-6 p-0"
                      onClick={() => setInvestigationTraderId(null)}
                    >
                      <X size={14} />
                    </Button>
                  </CardTitle>
                </CardHeader>
                <CardContent className="px-4 pb-4">
                  {investigationQuery.isLoading && (
                    <div className="flex items-center gap-2 text-sm text-muted-foreground py-4">
                      <RefreshCw size={14} className="animate-spin" /> Loading investigation data…
                    </div>
                  )}
                  {investigationQuery.error && (
                    <div className="text-sm text-destructive py-2">
                      {investigationQuery.error.message}
                    </div>
                  )}
                  {investigationQuery.data && (() => {
                    const inv = investigationQuery.data;
                    return (
                      <div className="space-y-4">
                        {/* Summary KPIs */}
                        <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
                          {[
                            { label: "Declarations", value: inv.summary.totalDeclarations, icon: <FileText size={12} /> },
                            { label: "Red Lane", value: inv.summary.redLaneCount, icon: <AlertTriangle size={12} className="text-destructive" /> },
                            { label: "Yellow Lane", value: inv.summary.yellowLaneCount, icon: <Clock size={12} className="text-amber-500" /> },
                            { label: "Green Lane", value: inv.summary.greenLaneCount, icon: <CheckCircle size={12} className="text-emerald-500" /> },
                            { label: "Avg Risk", value: `${(inv.summary.avgRiskScore * 100).toFixed(0)}%`, icon: <TrendingUp size={12} /> },
                            { label: "Open Audits", value: inv.summary.openAudits, icon: <Activity size={12} className="text-orange-500" /> },
                          ].map((kpi) => (
                            <div key={kpi.label} className="bg-muted/40 rounded-lg p-2 text-center">
                              <div className="flex justify-center mb-1 text-muted-foreground">{kpi.icon}</div>
                              <div className="text-base font-bold">{kpi.value}</div>
                              <div className="text-[10px] text-muted-foreground">{kpi.label}</div>
                            </div>
                          ))}
                        </div>

                        {/* Declaration Timeline */}
                        <div>
                          <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2 flex items-center gap-1">
                            <FileText size={11} /> Declaration Timeline (last 12 months)
                          </div>
                          <div className="max-h-40 overflow-y-auto space-y-1">
                            {inv.timeline.length === 0 && (
                              <div className="text-xs text-muted-foreground italic">No declarations in this period.</div>
                            )}
                            {inv.timeline.map((d) => (
                              <div
                                key={d.id}
                                className="flex items-center gap-2 text-xs px-2 py-1.5 rounded bg-muted/30 hover:bg-muted/50 transition-colors"
                              >
                                <div
                                  className="w-2 h-2 rounded-full shrink-0"
                                  style={{
                                    backgroundColor:
                                      d.riskLane === "red" ? "#ef4444" :
                                      d.riskLane === "yellow" ? "#f59e0b" : "#22c55e",
                                  }}
                                />
                                <span className="font-mono text-[10px] text-muted-foreground shrink-0">
                                  {d.date ? new Date(d.date).toLocaleDateString() : "—"}
                                </span>
                                <span className="font-medium truncate flex-1">{d.declarationNumber}</span>
                                <span className="text-muted-foreground shrink-0">{d.hsCode}</span>
                                <Badge
                                  variant={d.riskLane === "red" ? "destructive" : d.riskLane === "yellow" ? "outline" : "secondary"}
                                  className="text-[9px] px-1 py-0 shrink-0"
                                >
                                  {d.riskLane.toUpperCase()}
                                </Badge>
                              </div>
                            ))}
                          </div>
                        </div>

                        {/* Connected Entities */}
                        <div className="grid sm:grid-cols-2 gap-3">
                          {/* HS Codes */}
                          {inv.connectedEntities.sharedHsCodes.length > 0 && (
                            <div>
                              <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1 flex items-center gap-1">
                                <Package size={11} /> Top HS Codes
                              </div>
                              <div className="space-y-1">
                                {inv.connectedEntities.sharedHsCodes.slice(0, 5).map((hs) => (
                                  <div key={hs.code} className="flex items-center gap-2 text-xs">
                                    <span className="font-mono text-muted-foreground w-16 shrink-0">{hs.code}</span>
                                    <div className="flex-1 bg-muted rounded-full h-1.5 overflow-hidden">
                                      <div
                                        className="h-full rounded-full"
                                        style={{
                                          width: `${(hs.avgRisk * 100).toFixed(0)}%`,
                                          backgroundColor: hs.avgRisk >= 0.65 ? "#ef4444" : hs.avgRisk >= 0.35 ? "#f59e0b" : "#22c55e",
                                        }}
                                      />
                                    </div>
                                    <span className="text-muted-foreground shrink-0">{hs.count}×</span>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}
                          {/* Ports */}
                          {inv.connectedEntities.sharedPorts.length > 0 && (
                            <div>
                              <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1 flex items-center gap-1">
                                <Anchor size={11} /> Ports Used
                              </div>
                              <div className="space-y-1">
                                {inv.connectedEntities.sharedPorts.map((p) => (
                                  <div key={p.port} className="flex items-center justify-between text-xs">
                                    <span className="truncate">{p.port}</span>
                                    <span className="text-muted-foreground ml-2 shrink-0">{p.count}×</span>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>

                        {/* Audit Flags */}
                        {inv.auditFlags.length > 0 && (
                          <div>
                            <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1 flex items-center gap-1">
                              <BarChart2 size={11} /> Audit History
                            </div>
                            <div className="space-y-1">
                              {inv.auditFlags.slice(0, 3).map((a) => (
                                <div key={a.id} className="flex items-center gap-2 text-xs px-2 py-1 rounded bg-muted/30">
                                  <Badge variant="outline" className="text-[9px] px-1 py-0">{a.status}</Badge>
                                  <span className="flex-1 truncate">{a.riskIndicators[0] ?? a.auditType}</span>
                                  <span className="text-muted-foreground shrink-0">
                                    {a.createdAt ? new Date(a.createdAt).toLocaleDateString() : "—"}
                                  </span>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}

                        {/* Shared-Agent Co-Network */}
                        {sharedAgentQuery.isLoading && (
                          <div className="flex items-center gap-2 text-xs text-muted-foreground py-2">
                            <RefreshCw size={11} className="animate-spin" /> Loading co-network…
                          </div>
                        )}
                        {sharedAgentQuery.data && sharedAgentQuery.data.relatedTraderCount > 0 && (() => {
                          const relatedNodes = sharedAgentQuery.data.nodes.filter((n) => n.type === "related_trader");
                          const corridorNodes = sharedAgentQuery.data.nodes.filter((n) => n.type === "corridor_agent");
                          return (
                            <div>
                              <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2 flex items-center gap-1">
                                <Users size={11} /> Shared-Corridor Co-Network
                                <Badge variant="outline" className="text-[9px] px-1 py-0 ml-1">
                                  {relatedNodes.length} traders
                                </Badge>
                              </div>
                              <div className="space-y-1 max-h-32 overflow-y-auto">
                                {relatedNodes.slice(0, 8).map((ct) => (
                                  <div
                                    key={ct.id}
                                    className="flex items-center gap-2 text-xs px-2 py-1.5 rounded bg-muted/30 hover:bg-muted/50 transition-colors cursor-pointer"
                                    onClick={() => setInvestigationTraderId(ct.id)}
                                  >
                                    <div
                                      className="w-2 h-2 rounded-full shrink-0"
                                      style={{
                                        backgroundColor:
                                          ct.riskScore >= 0.65 ? "#ef4444" :
                                          ct.riskScore >= 0.35 ? "#f59e0b" : "#22c55e",
                                      }}
                                    />
                                    <span className="font-medium truncate flex-1">{ct.label}</span>
                                    <span className="text-muted-foreground shrink-0">{ct.declarationCount} decls</span>
                                    <Badge
                                      variant={ct.riskScore >= 0.65 ? "destructive" : ct.riskScore >= 0.35 ? "outline" : "secondary"}
                                      className="text-[9px] px-1 py-0 shrink-0"
                                    >
                                      {(ct.riskScore * 100).toFixed(0)}%
                                    </Badge>
                                  </div>
                                ))}
                              </div>
                              {corridorNodes.length > 0 && (
                                <div className="mt-2 text-[10px] text-muted-foreground">
                                  Via corridors: {corridorNodes.slice(0, 3).map((c) => c.label).join(", ")}
                                  {corridorNodes.length > 3 && ` +${corridorNodes.length - 3} more`}
                                </div>
                              )}
                            </div>
                          );
                        })()}

                        {/* Open Fraud Case + Flag for Audit actions */}
                        <div className="flex flex-wrap items-center gap-2 pt-1 border-t">
                          <Button
                            variant="outline"
                            size="sm"
                            className="gap-1 text-xs border-amber-500/50 text-amber-400 hover:bg-amber-500/10"
                            disabled={createCaseMutation.isPending}
                            onClick={() => {
                              const traderName =
                                inv.trader?.companyName ||
                                `Trader ${investigationTraderId}`;
                              const avgRisk = (inv.summary.avgRiskScore * 100).toFixed(1);
                              createCaseMutation.mutate({
                                traderId: parseInt(investigationTraderId!, 10),
                                title: `Fraud Investigation — ${traderName}`,
                                priority:
                                  inv.summary.avgRiskScore >= 0.75
                                    ? "critical"
                                    : inv.summary.avgRiskScore >= 0.55
                                    ? "high"
                                    : "medium",
                                description:
                                  `Auto-opened from Fraud Network. Avg risk score: ${avgRisk}%. ` +
                                  `Red-lane declarations (12 mo): ${inv.summary.redLaneCount}. ` +
                                  `Total declarations: ${inv.summary.totalDeclarations}.`,
                              });
                            }}
                          >
                            {createCaseMutation.isPending ? (
                              <RefreshCw size={12} className="animate-spin" />
                            ) : (
                              <FileText size={12} />
                            )}
                            Open Fraud Case
                          </Button>
                          <Button
                            variant="destructive"
                            size="sm"
                            className="gap-1 text-xs"
                            disabled={scheduleAuditMutation.isPending || inv.timeline.length === 0}
                            onClick={() => {
                              // Use the most recent cleared declaration for the audit
                              const clearedDecl = inv.timeline.find((d) => d.status === "cleared");
                              if (!clearedDecl) {
                                toast.warning("No cleared declarations found to audit for this trader.");
                                return;
                              }
                              scheduleAuditMutation.mutate({
                                declarationId: parseInt(clearedDecl.id, 10),
                                triggerReason: `Flagged via Fraud Network investigation — risk score ${(inv.summary.avgRiskScore * 100).toFixed(1)}%, ${inv.summary.redLaneCount} red-lane declarations in last 12 months.`,
                              });
                            }}
                          >
                            {scheduleAuditMutation.isPending ? (
                              <RefreshCw size={12} className="animate-spin" />
                            ) : (
                              <ShieldAlert size={12} />
                            )}
                            Flag for Post-Clearance Audit
                          </Button>
                          {inv.fallback && (
                            <span className="text-[10px] text-muted-foreground">
                              (DB fallback — graph bridge offline)
                            </span>
                          )}
                        </div>
                      </div>
                    );
                  })()}
                </CardContent>
              </Card>
            )}
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
}
