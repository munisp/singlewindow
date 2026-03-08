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
} from "lucide-react";
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
  hs_code: "HS Code",
  port: "Port",
  oga: "OGA",
  corridor: "Corridor",
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
  const [minRisk, setMinRisk] = useState(0.4);
  const [limit, setLimit] = useState(200);
  const [filterType, setFilterType] = useState<NodeType | "all">("all");
  const [zoom, setZoom] = useState(1);
  const zoomRef = useRef<d3.ZoomBehavior<SVGSVGElement, unknown> | null>(null);

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
              Fraud Network Intelligence
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              GNN-powered trade entity graph — node colour indicates risk lane (red/amber/green)
            </p>
          </div>
          <div className="flex items-center gap-2">
            {data?.fallback && (
              <Badge variant="secondary" className="gap-1">
                <Info size={12} />
                Demo data — bridge offline
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
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
}
