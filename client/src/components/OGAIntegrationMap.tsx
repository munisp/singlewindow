/**
 * OGA Integration Map — Force-directed graph showing all 37+ agencies,
 * international systems, and private sector partners connected to NGSWTP hub.
 * Design: Sovereign Blueprint — Deep Navy + Gold
 */

import { useEffect, useRef, useState } from "react";
import * as d3 from "d3";
import { X, ExternalLink } from "lucide-react";

// ─── DATA ────────────────────────────────────────────────────────────────────

interface NodeData {
  id: string;
  label: string;
  group: "hub" | "government" | "international" | "operational" | "private" | "financial";
  protocol?: string;
  dataExchange?: string;
  sla?: string;
  description?: string;
  link?: string;
}

interface LinkData {
  source: string;
  target: string;
}

const nodes: NodeData[] = [
  // Hub
  {
    id: "hub",
    label: "TradeGateway\nNGSWTP",
    group: "hub",
    description: "Central Single Window Hub — all trade regulatory processes consolidated on one platform.",
  },

  // Government Agencies
  { id: "customs", label: "Customs\nAuthority", group: "government", protocol: "REST API + Kafka", dataExchange: "Declarations, assessments, clearance permits", sla: "< 5 sec", description: "Primary customs administration — receives all import/export/transit declarations, performs risk assessment and issues clearance." },
  { id: "revenue", label: "Revenue\nAuthority", group: "government", protocol: "REST API + TigerBeetle", dataExchange: "Tax assessments, payment confirmations, duty drawback", sla: "< 3 sec", description: "Tax and revenue collection authority — receives duty assessments, confirms payment, processes drawback claims." },
  { id: "trade", label: "Ministry\nof Trade", group: "government", protocol: "REST API", dataExchange: "Trade licences, import/export permits, quotas", sla: "< 10 sec", description: "Issues trade licences, manages import/export quotas, and approves strategic commodity movements." },
  { id: "fda", label: "Food & Drug\nAuthority", group: "government", protocol: "REST API", dataExchange: "Import permits, health certificates, product approvals", sla: "< 30 min", description: "Regulates import of food, pharmaceuticals, and medical devices — issues import permits and health certificates." },
  { id: "agriculture", label: "Agriculture\nDept", group: "government", protocol: "REST API + SFTP", dataExchange: "Phytosanitary certificates, pest risk assessments", sla: "< 1 hour", description: "Issues phytosanitary certificates for plant products; manages pest risk assessments for agricultural imports." },
  { id: "standards", label: "Standards\nAuthority", group: "government", protocol: "REST API", dataExchange: "Conformity certificates, product standards compliance", sla: "< 2 hours", description: "Verifies that imported goods meet national standards — issues conformity assessment certificates." },
  { id: "immigration", label: "Immigration\nDept", group: "government", protocol: "REST API", dataExchange: "Crew manifests, passenger lists, visa verification", sla: "< 5 sec", description: "Verifies crew and passenger manifests for vessels and aircraft; checks visa status." },
  { id: "port", label: "Port\nAuthority", group: "government", protocol: "REST API + Kafka", dataExchange: "Vessel arrivals, berth allocation, cargo release", sla: "Real-time", description: "Manages vessel scheduling, berth allocation, and issues physical cargo release authorizations." },
  { id: "company_reg", label: "Company\nRegistry", group: "government", protocol: "REST API", dataExchange: "Trader registration, company status, ownership", sla: "< 2 sec", description: "Verifies trader registration status and company ownership for KYC and compliance purposes." },
  { id: "central_bank", label: "Central\nBank", group: "government", protocol: "Mojaloop API", dataExchange: "FX approvals, payment settlement, monetary policy", sla: "< 5 sec", description: "Provides foreign exchange approvals for imports; oversees payment settlement through Mojaloop." },
  { id: "environment", label: "Environment\nAgency", group: "government", protocol: "REST API", dataExchange: "Environmental permits, hazardous goods clearance", sla: "< 4 hours", description: "Issues permits for environmentally sensitive goods including chemicals, waste, and ozone-depleting substances." },
  { id: "energy", label: "Energy\nRegulator", group: "government", protocol: "REST API", dataExchange: "Energy import licences, fuel quality certificates", sla: "< 2 hours", description: "Regulates import of petroleum products, LPG, and electricity — issues energy import licences." },
  { id: "health", label: "Ministry\nof Health", group: "government", protocol: "REST API", dataExchange: "Medical device permits, drug import authorizations", sla: "< 1 hour", description: "Authorizes import of controlled medical devices and prescription drugs not covered by FDA." },
  { id: "defence", label: "Defence /\nSecurity", group: "government", protocol: "REST API (restricted)", dataExchange: "Dual-use goods, strategic items, weapons permits", sla: "< 24 hours", description: "Restricted interface for dual-use goods, strategic items, and weapons — requires enhanced security clearance." },
  { id: "statistics", label: "Statistics\nOffice", group: "government", protocol: "Kafka (async)", dataExchange: "Trade statistics, HS code aggregations, trade balance", sla: "Daily batch", description: "Receives anonymized trade statistics for national accounts and trade balance reporting." },

  // International Systems
  { id: "asean_sw", label: "ASEAN\nSingle Window", group: "international", protocol: "ASEAN ASW API", dataExchange: "ACDD, certificates of origin, transit documents", sla: "< 30 sec", description: "ASEAN Customs Declaration Document (ACDD) exchange and certificate of origin verification across ASEAN member states.", link: "https://www.asean.org/asean-economic-community/asean-single-window/" },
  { id: "wco_cen", label: "WCO CEN\nNetwork", group: "international", protocol: "WCO CEN API", dataExchange: "Smuggling intelligence, risk indicators, enforcement alerts", sla: "Real-time", description: "World Customs Organization Customs Enforcement Network — shares intelligence on smuggling patterns and high-risk traders.", link: "https://www.wcoomd.org/en/topics/enforcement-and-compliance/instruments-and-tools/cen.aspx" },
  { id: "comesa", label: "COMESA/EAC\nWindow", group: "international", protocol: "COMESA API", dataExchange: "Transit guarantees, regional trade documents", sla: "< 1 min", description: "COMESA Regional Integration Payment System (REPSS) and EAC Single Customs Territory — manages regional transit guarantees.", link: "https://www.comesa.int/" },
  { id: "interpol", label: "INTERPOL\nI-24/7", group: "international", protocol: "I-24/7 (restricted)", dataExchange: "Stolen vehicles, wanted persons, blacklisted entities", sla: "< 10 sec", description: "Restricted interface to INTERPOL's I-24/7 network for querying stolen vehicles, wanted persons, and blacklisted entities.", link: "https://www.interpol.int/" },
  { id: "un_comtrade", label: "UN\nComtrade", group: "international", protocol: "REST API", dataExchange: "Global trade statistics, benchmark values", sla: "Daily sync", description: "UN Comtrade database — provides benchmark trade statistics for customs valuation and risk scoring.", link: "https://comtradeplus.un.org/" },
  { id: "partner_customs", label: "Partner\nCountry Customs", group: "international", protocol: "G2G API / SFTP", dataExchange: "Advance cargo info, pre-arrival declarations", sla: "< 5 min", description: "Bilateral G2G connectivity with partner country customs for advance cargo information exchange, consistent with Singapore NTP model." },

  // Operational Systems
  { id: "port_mgmt", label: "Port\nManagement", group: "operational", protocol: "REST API + Kafka", dataExchange: "Vessel schedules, container positions, yard status", sla: "Real-time", description: "Port Terminal Operating System (TOS) — provides real-time container positions, vessel schedules, and yard management data." },
  { id: "shipping", label: "Shipping\nLines", group: "operational", protocol: "EDI EDIFACT + REST", dataExchange: "Bills of lading, manifests, container status", sla: "< 5 min", description: "Shipping line systems — submit bills of lading, cargo manifests, and provide real-time container tracking." },
  { id: "airlines", label: "Airlines /\nAir Cargo", group: "operational", protocol: "IATA CXML + REST", dataExchange: "Airway bills, cargo manifests, flight schedules", sla: "< 5 min", description: "Airline cargo systems — submit airway bills and cargo manifests; provide flight schedule data." },
  { id: "warehouse", label: "Bonded\nWarehouse", group: "operational", protocol: "REST API", dataExchange: "Inventory levels, tally reports, arrival notices", sla: "< 1 min", description: "Bonded warehouse management systems — receive manifest transmissions and generate automatic arrival notices (Rwanda ReSW model)." },
  { id: "freight_fwd", label: "Freight\nForwarders", group: "operational", protocol: "REST API", dataExchange: "Declaration submissions, status queries, document upload", sla: "< 3 sec", description: "Freight forwarder ERP integrations — direct API for declaration submission, status tracking, and document management." },
  { id: "insurance", label: "Insurance\nProviders", group: "operational", protocol: "REST API", dataExchange: "Insurance certificates, cargo value declarations", sla: "< 10 sec", description: "Automated insurance certificate validation and cargo value verification for customs valuation purposes." },

  // Financial Systems
  { id: "comm_banks", label: "Commercial\nBanks", group: "financial", protocol: "Mojaloop API", dataExchange: "Payment processing, banker's guarantee, LC", sla: "< 5 sec", description: "All licensed commercial banks connected via Mojaloop for duty payment processing and banker's guarantee management." },
  { id: "mobile_money", label: "Mobile\nMoney", group: "financial", protocol: "Mojaloop API", dataExchange: "Mobile duty payments, USSD transactions", sla: "< 3 sec", description: "Mobile money operators (MTN, Airtel, M-Pesa) connected via Mojaloop for mobile duty payment and USSD transactions." },
  { id: "trade_finance", label: "Trade\nFinance", group: "financial", protocol: "REST API", dataExchange: "Letters of credit, trade finance documents", sla: "< 30 sec", description: "Trade finance platforms — exchange letters of credit and trade finance documents for import payment verification." },
];

const links: LinkData[] = nodes
  .filter((n) => n.id !== "hub")
  .map((n) => ({ source: "hub", target: n.id }));

// ─── COLORS ──────────────────────────────────────────────────────────────────

const groupColors: Record<NodeData["group"], string> = {
  hub: "#D4A017",
  government: "#1E3A5F",
  international: "#0E6655",
  operational: "#6B21A8",
  financial: "#B45309",
  private: "#374151",
};

const groupLabels: Record<NodeData["group"], string> = {
  hub: "Hub",
  government: "Government Agencies",
  international: "International Systems",
  operational: "Operational Systems",
  financial: "Financial Systems",
  private: "Private Sector",
};

// ─── COMPONENT ───────────────────────────────────────────────────────────────

export default function OGAIntegrationMap() {
  const svgRef = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [selected, setSelected] = useState<NodeData | null>(null);
  const [filterGroup, setFilterGroup] = useState<NodeData["group"] | "all">("all");

  useEffect(() => {
    if (!svgRef.current || !containerRef.current) return;

    const container = containerRef.current;
    const width = container.clientWidth;
    const height = container.clientHeight || 560;

    // Clear previous
    d3.select(svgRef.current).selectAll("*").remove();

    const svg = d3
      .select(svgRef.current)
      .attr("width", width)
      .attr("height", height)
      .attr("viewBox", `0 0 ${width} ${height}`);

    // Background
    svg
      .append("rect")
      .attr("width", width)
      .attr("height", height)
      .attr("fill", "oklch(0.14 0.04 240)")
      .attr("rx", 12);

    // Subtle grid
    const gridGroup = svg.append("g").attr("opacity", 0.05);
    for (let x = 0; x < width; x += 60) {
      gridGroup.append("line").attr("x1", x).attr("y1", 0).attr("x2", x).attr("y2", height).attr("stroke", "#D4A017").attr("stroke-width", 0.5);
    }
    for (let y = 0; y < height; y += 60) {
      gridGroup.append("line").attr("x1", 0).attr("y1", y).attr("x2", width).attr("y2", y).attr("stroke", "#D4A017").attr("stroke-width", 0.5);
    }

    const filteredNodes = filterGroup === "all"
      ? nodes
      : nodes.filter((n) => n.id === "hub" || n.group === filterGroup);

    const filteredLinks = links.filter(
      (l) => filteredNodes.some((n) => n.id === l.source) && filteredNodes.some((n) => n.id === l.target)
    );

    // Simulation
    const simulation = d3
      .forceSimulation(filteredNodes as d3.SimulationNodeDatum[])
      .force("link", d3.forceLink(filteredLinks).id((d: any) => d.id).distance(120).strength(0.5))
      .force("charge", d3.forceManyBody().strength(-300))
      .force("center", d3.forceCenter(width / 2, height / 2))
      .force("collision", d3.forceCollide(48));

    // Zoom
    const g = svg.append("g");
    svg.call(
      d3.zoom<SVGSVGElement, unknown>()
        .scaleExtent([0.3, 3])
        .on("zoom", (event) => g.attr("transform", event.transform))
    );

    // Links
    const link = g
      .append("g")
      .selectAll("line")
      .data(filteredLinks)
      .join("line")
      .attr("stroke", "#D4A017")
      .attr("stroke-opacity", 0.2)
      .attr("stroke-width", 1);

    // Node groups
    const node = g
      .append("g")
      .selectAll("g")
      .data(filteredNodes)
      .join("g")
      .attr("cursor", "pointer")
.call(
        d3.drag<SVGGElement, NodeData>()
          .on("start", (event, d: any) => {
            if (!event.active) simulation.alphaTarget(0.3).restart();
            d.fx = d.x;
            d.fy = d.y;
          })
          .on("drag", (event, d: any) => {
            d.fx = event.x;
            d.fy = event.y;
          })
          .on("end", (event, d: any) => {
            if (!event.active) simulation.alphaTarget(0);
            d.fx = null;
            d.fy = null;
          }) as any
      )
      .on("click", (_event, d) => setSelected(d));

    // Node circles
    node
      .append("circle")
      .attr("r", (d) => (d.id === "hub" ? 38 : 28))
      .attr("fill", (d) => groupColors[d.group] + "33")
      .attr("stroke", (d) => groupColors[d.group])
      .attr("stroke-width", (d) => (d.id === "hub" ? 3 : 1.5))
      .attr("filter", (d) => (d.id === "hub" ? "url(#glow)" : "none"));

    // Glow filter for hub
    const defs = svg.append("defs");
    const filter = defs.append("filter").attr("id", "glow");
    filter.append("feGaussianBlur").attr("stdDeviation", "4").attr("result", "coloredBlur");
    const feMerge = filter.append("feMerge");
    feMerge.append("feMergeNode").attr("in", "coloredBlur");
    feMerge.append("feMergeNode").attr("in", "SourceGraphic");

    // Node labels
    node
      .append("text")
      .attr("text-anchor", "middle")
      .attr("dominant-baseline", "middle")
      .attr("fill", "#E2E8F0")
      .attr("font-size", (d) => (d.id === "hub" ? "10px" : "8.5px"))
      .attr("font-weight", (d) => (d.id === "hub" ? "700" : "500"))
      .attr("font-family", "DM Sans, system-ui, sans-serif")
      .attr("pointer-events", "none")
      .each(function (d) {
        const lines = d.label.split("\n");
        const el = d3.select(this);
        lines.forEach((line, i) => {
          el.append("tspan")
            .attr("x", 0)
            .attr("dy", i === 0 ? `${-(lines.length - 1) * 6}px` : "12px")
            .text(line);
        });
      });

    // Hover effect
    node
      .on("mouseenter", function (_event, d) {
        d3.select(this).select("circle")
          .transition().duration(150)
          .attr("r", d.id === "hub" ? 44 : 33)
          .attr("stroke-width", d.id === "hub" ? 4 : 2.5);
      })
      .on("mouseleave", function (_event, d) {
        d3.select(this).select("circle")
          .transition().duration(150)
          .attr("r", d.id === "hub" ? 38 : 28)
          .attr("stroke-width", d.id === "hub" ? 3 : 1.5);
      });

    // Simulation tick
    simulation.on("tick", () => {
      link
        .attr("x1", (d: any) => d.source.x)
        .attr("y1", (d: any) => d.source.y)
        .attr("x2", (d: any) => d.target.x)
        .attr("y2", (d: any) => d.target.y);

      node.attr("transform", (d: any) => `translate(${d.x},${d.y})`);
    });

    return () => {
      simulation.stop();
    };
  }, [filterGroup]);

  const groups: Array<NodeData["group"] | "all"> = ["all", "government", "international", "operational", "financial"];

  return (
    <div className="space-y-4">
      {/* Filter Pills */}
      <div className="flex flex-wrap gap-2">
        {groups.map((g) => (
          <button
            key={g}
            onClick={() => setFilterGroup(g)}
            className={`px-4 py-1.5 rounded-full text-xs font-medium transition-all border ${
              filterGroup === g
                ? "text-navy border-transparent"
                : "text-slate-400 border-white/10 hover:border-white/30 hover:text-white"
            }`}
            style={filterGroup === g ? { backgroundColor: g === "all" ? "#D4A017" : groupColors[g as NodeData["group"]] } : {}}
          >
            {g === "all" ? "All Systems" : groupLabels[g as NodeData["group"]]}
          </button>
        ))}
      </div>

      {/* Legend */}
      <div className="flex flex-wrap gap-4 text-xs text-slate-400">
        {(Object.entries(groupLabels) as [NodeData["group"], string][]).map(([g, label]) => (
          <div key={g} className="flex items-center gap-1.5">
            <div className="w-3 h-3 rounded-full border" style={{ backgroundColor: groupColors[g] + "33", borderColor: groupColors[g] }} />
            {label}
          </div>
        ))}
      </div>

      {/* Graph */}
      <div
        ref={containerRef}
        className="relative rounded-xl overflow-hidden border border-white/10"
        style={{ height: 560 }}
      >
        <svg ref={svgRef} className="w-full h-full" />
        <div className="absolute bottom-3 right-3 text-xs text-slate-600">
          Drag nodes · Scroll to zoom · Click for details
        </div>
      </div>

      {/* Detail Panel */}
      {selected && (
        <div
          className="rounded-xl border border-white/10 p-5 relative"
          style={{ backgroundColor: groupColors[selected.group] + "20" }}
        >
          <button
            onClick={() => setSelected(null)}
            className="absolute top-4 right-4 text-slate-400 hover:text-white transition-colors"
          >
            <X size={16} />
          </button>
          <div
            className="inline-block px-2 py-0.5 rounded text-xs font-mono mb-2"
            style={{ backgroundColor: groupColors[selected.group] + "40", color: groupColors[selected.group] }}
          >
            {groupLabels[selected.group]}
          </div>
          <div className="text-lg font-bold text-white font-display mb-2">
            {selected.label.replace("\n", " ")}
          </div>
          <p className="text-sm text-slate-300 mb-4 leading-relaxed">{selected.description}</p>
          {selected.protocol && (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-sm">
              <div className="bg-white/5 rounded-lg p-3">
                <div className="text-xs text-slate-500 mb-1">Integration Protocol</div>
                <div className="text-white font-medium">{selected.protocol}</div>
              </div>
              <div className="bg-white/5 rounded-lg p-3">
                <div className="text-xs text-slate-500 mb-1">Data Exchange</div>
                <div className="text-white font-medium">{selected.dataExchange}</div>
              </div>
              <div className="bg-white/5 rounded-lg p-3">
                <div className="text-xs text-slate-500 mb-1">Response SLA</div>
                <div className="text-white font-medium">{selected.sla}</div>
              </div>
            </div>
          )}
          {selected.link && (
            <a
              href={selected.link}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 mt-3 text-xs text-gold hover:text-gold/70 transition-colors"
            >
              <ExternalLink size={12} /> Official Documentation
            </a>
          )}
        </div>
      )}
    </div>
  );
}
