/**
 * TradeGateway NGSWTP — Fluvio AIS Stream Replay Panel
 * Design: Sovereign Blueprint — deep navy + gold
 *
 * Reflects actual production implementation:
 * - services/rust/stream-processor/src/main.rs (Fluvio consumer)
 * - kafka/topics.yaml (ais.vessel.positions topic)
 * - lakehouse/flink/declaration_stream_job.py (stream processing)
 *
 * Shows live AIS vessel position events flowing through Fluvio,
 * with a port map overlay plotting vessel positions.
 */

import { useState, useEffect, useRef, useCallback } from "react";
import { Radio, Ship, AlertTriangle, CheckCircle, Clock, Zap, Play, Pause, RotateCcw, ChevronRight } from "lucide-react";

interface VesselEvent {
  id: string;
  mmsi: string;
  vesselName: string;
  vesselType: "container" | "bulk" | "tanker" | "roro" | "general";
  lat: number;
  lon: number;
  speed: number;
  heading: number;
  status: "underway" | "anchored" | "moored" | "restricted";
  cargoStatus: "pre-arrival" | "arrived" | "berthed" | "loading" | "departed";
  declarationRef: string | null;
  riskFlag: "green" | "amber" | "red" | null;
  timestamp: string;
  topic: string;
  offset: number;
  partition: number;
}

interface FluvioMessage {
  id: string;
  topic: string;
  partition: number;
  offset: number;
  key: string;
  value: string;
  timestamp: string;
  processingLatencyMs: number;
  rustEngineMs: number;
}

// Simulated vessels near a major port (Mombasa-like coordinates)
const VESSEL_POOL: Omit<VesselEvent, "timestamp" | "offset" | "topic" | "partition">[] = [
  { id: "v1", mmsi: "636091234", vesselName: "MSC NAIROBI", vesselType: "container", lat: -4.0435, lon: 39.6682, speed: 12.4, heading: 285, status: "underway", cargoStatus: "pre-arrival", declarationRef: "URN-2026-001234", riskFlag: "green" },
  { id: "v2", mmsi: "636092345", vesselName: "EVER GOLDEN GATE", vesselType: "container", lat: -4.0612, lon: 39.6891, speed: 0.2, heading: 180, status: "moored", cargoStatus: "berthed", declarationRef: "URN-2026-001235", riskFlag: "amber" },
  { id: "v3", mmsi: "636093456", vesselName: "AFRICAN EXPLORER", vesselType: "bulk", lat: -4.0789, lon: 39.7012, speed: 8.1, heading: 310, status: "underway", cargoStatus: "arrived", declarationRef: null, riskFlag: null },
  { id: "v4", mmsi: "636094567", vesselName: "KENYA TRADER", vesselType: "general", lat: -4.0234, lon: 39.6543, speed: 0.0, heading: 90, status: "anchored", cargoStatus: "loading", declarationRef: "URN-2026-001236", riskFlag: "green" },
  { id: "v5", mmsi: "636095678", vesselName: "GULF PIONEER", vesselType: "tanker", lat: -4.0956, lon: 39.7234, speed: 5.3, heading: 270, status: "underway", cargoStatus: "pre-arrival", declarationRef: "URN-2026-001237", riskFlag: "red" },
  { id: "v6", mmsi: "636096789", vesselName: "EAST AFRICA EXPRESS", vesselType: "roro", lat: -4.0123, lon: 39.6789, speed: 0.1, heading: 0, status: "moored", cargoStatus: "loading", declarationRef: "URN-2026-001238", riskFlag: "green" },
];

function generateEvent(vessel: typeof VESSEL_POOL[0], offset: number): VesselEvent {
  const jitter = () => (Math.random() - 0.5) * 0.005;
  return {
    ...vessel,
    lat: vessel.lat + jitter(),
    lon: vessel.lon + jitter(),
    speed: Math.max(0, vessel.speed + (Math.random() - 0.5) * 0.5),
    timestamp: new Date().toISOString(),
    topic: "ais.vessel.positions",
    offset,
    partition: Math.floor(Math.random() * 3),
  };
}

function generateFluvioMessage(event: VesselEvent): FluvioMessage {
  const payload = {
    mmsi: event.mmsi,
    vessel_name: event.vesselName,
    position: { lat: event.lat, lon: event.lon },
    speed_knots: event.speed,
    heading: event.heading,
    nav_status: event.status,
    timestamp: event.timestamp,
    source: "AIS_RECEIVER_MOMBASA_01",
  };
  return {
    id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    topic: "ais.vessel.positions",
    partition: event.partition,
    offset: event.offset,
    key: event.mmsi,
    value: JSON.stringify(payload, null, 2),
    timestamp: event.timestamp,
    processingLatencyMs: Math.floor(Math.random() * 15) + 2,
    rustEngineMs: Math.floor(Math.random() * 8) + 1,
  };
}

const VESSEL_TYPE_COLORS: Record<string, string> = {
  container: "#3b82f6",
  bulk: "#f97316",
  tanker: "#ef4444",
  roro: "#a855f7",
  general: "#10b981",
};

const RISK_COLORS: Record<string, string> = {
  green: "#10b981",
  amber: "#f59e0b",
  red: "#ef4444",
};

const STATUS_COLORS: Record<string, string> = {
  underway: "#3b82f6",
  anchored: "#f59e0b",
  moored: "#10b981",
  restricted: "#ef4444",
};

export default function FluvioStreamPanel() {
  const [isPlaying, setIsPlaying] = useState(false);
  const [vessels, setVessels] = useState<VesselEvent[]>([]);
  const [messages, setMessages] = useState<FluvioMessage[]>([]);
  const [selectedVessel, setSelectedVessel] = useState<VesselEvent | null>(null);
  const [offsetCounter, setOffsetCounter] = useState(0);
  const [totalMessages, setTotalMessages] = useState(0);
  const [throughput, setThroughput] = useState(0);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const throughputRef = useRef(0);

  const tick = useCallback(() => {
    const newEvents: VesselEvent[] = [];
    const newMessages: FluvioMessage[] = [];
    const count = Math.floor(Math.random() * 3) + 1;

    for (let i = 0; i < count; i++) {
      const vessel = VESSEL_POOL[Math.floor(Math.random() * VESSEL_POOL.length)];
      const event = generateEvent(vessel, offsetCounter + i);
      const msg = generateFluvioMessage(event);
      newEvents.push(event);
      newMessages.push(msg);
    }

    setOffsetCounter((p) => p + count);
    setTotalMessages((p) => p + count);
    throughputRef.current += count;

    setVessels((prev) => {
      const map = new Map(prev.map((v) => [v.id, v]));
      newEvents.forEach((e) => map.set(e.id, e));
      return Array.from(map.values());
    });

    setMessages((prev) => [...newMessages, ...prev].slice(0, 50));
  }, [offsetCounter]);

  useEffect(() => {
    const throughputTimer = setInterval(() => {
      setThroughput(throughputRef.current);
      throughputRef.current = 0;
    }, 1000);
    return () => clearInterval(throughputTimer);
  }, []);

  useEffect(() => {
    if (isPlaying) {
      intervalRef.current = setInterval(tick, 800);
    } else {
      if (intervalRef.current) clearInterval(intervalRef.current);
    }
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [isPlaying, tick]);

  const reset = () => {
    setIsPlaying(false);
    setVessels([]);
    setMessages([]);
    setOffsetCounter(0);
    setTotalMessages(0);
    setThroughput(0);
    setSelectedVessel(null);
  };

  // Simple SVG port map
  const mapWidth = 400;
  const mapHeight = 260;
  const latMin = -4.12, latMax = -3.98, lonMin = 39.63, lonMax = 39.75;
  const toX = (lon: number) => ((lon - lonMin) / (lonMax - lonMin)) * mapWidth;
  const toY = (lat: number) => ((lat - latMax) / (latMin - latMax)) * mapHeight;

  return (
    <section id="fluvio-stream" className="py-20 bg-[#0D1E35]">
      <div className="max-w-6xl mx-auto px-6">
        {/* Header */}
        <div className="mb-10">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-1 h-10 bg-[#D4A017] rounded-full" />
            <span className="text-[#D4A017] text-sm font-semibold tracking-widest uppercase">
              Fluvio · AIS Stream Processing
            </span>
          </div>
          <h2 className="font-['Playfair_Display'] text-4xl font-bold text-white mb-4">
            Live Vessel Stream Replay
          </h2>
          <p className="text-slate-400 text-lg max-w-3xl">
            Real-time AIS vessel position events flowing through the Fluvio{" "}
            <code className="text-cyan-400 text-sm bg-slate-800 px-1.5 py-0.5 rounded">ais.vessel.positions</code>{" "}
            topic, processed by the Rust stream-processor engine in{" "}
            <span className="text-white font-semibold">&lt;15ms latency</span>.
            Reflects actual production code in{" "}
            <code className="text-cyan-400 text-sm bg-slate-800 px-1.5 py-0.5 rounded">services/rust/stream-processor/src/main.rs</code>.
          </p>
        </div>

        {/* Controls + Stats */}
        <div className="flex flex-wrap items-center gap-4 mb-6">
          <div className="flex gap-2">
            <button
              onClick={() => setIsPlaying(!isPlaying)}
              className={`flex items-center gap-2 px-5 py-2.5 rounded-xl font-semibold text-sm transition-all ${
                isPlaying
                  ? "bg-amber-600 hover:bg-amber-700 text-white"
                  : "bg-[#D4A017] hover:bg-[#B8860B] text-[#0A1628]"
              }`}
            >
              {isPlaying ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
              {isPlaying ? "Pause Stream" : "Start Stream"}
            </button>
            <button
              onClick={reset}
              className="flex items-center gap-2 px-4 py-2.5 rounded-xl border border-slate-700/50 text-slate-400 hover:text-white hover:border-slate-500 text-sm transition-all"
            >
              <RotateCcw className="w-4 h-4" />
              Reset
            </button>
          </div>
          <div className="flex gap-4 ml-auto">
            {[
              { label: "Messages/sec", value: throughput, color: "text-[#D4A017]" },
              { label: "Total Events", value: totalMessages, color: "text-blue-400" },
              { label: "Active Vessels", value: vessels.length, color: "text-emerald-400" },
              { label: "Fluvio Offset", value: offsetCounter, color: "text-purple-400" },
            ].map((s) => (
              <div key={s.label} className="text-center">
                <div className={`text-xl font-bold font-mono ${s.color}`}>{s.value}</div>
                <div className="text-xs text-slate-500">{s.label}</div>
              </div>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Port Map */}
          <div className="bg-[#0A1628] border border-slate-700/50 rounded-2xl overflow-hidden">
            <div className="px-5 py-3 border-b border-slate-700/30 flex items-center gap-2">
              <Ship className="w-4 h-4 text-[#D4A017]" />
              <span className="text-sm font-semibold text-white">Port Vessel Map</span>
              {isPlaying && (
                <span className="ml-auto flex items-center gap-1.5 text-xs text-emerald-400">
                  <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                  LIVE
                </span>
              )}
            </div>
            <div className="relative bg-[#071020]" style={{ height: mapHeight }}>
              <svg width="100%" height={mapHeight} viewBox={`0 0 ${mapWidth} ${mapHeight}`} className="absolute inset-0">
                {/* Ocean background */}
                <rect width={mapWidth} height={mapHeight} fill="#071828" />
                {/* Port area */}
                <rect x={280} y={80} width={100} height={120} fill="#0d2035" stroke="#1e3a5f" strokeWidth={1} rx={4} />
                <text x={330} y={145} fill="#334155" fontSize={9} textAnchor="middle">PORT</text>
                {/* Berths */}
                {[100, 120, 140, 160, 180].map((y, i) => (
                  <rect key={i} x={278} y={y} width={20} height={14} fill="#0f2d4a" stroke="#1e4a7a" strokeWidth={0.5} />
                ))}
                {/* Anchorage zone */}
                <circle cx={120} cy={130} r={50} fill="none" stroke="#1e3a5f" strokeWidth={1} strokeDasharray="4 4" />
                <text x={120} y={185} fill="#334155" fontSize={8} textAnchor="middle">ANCHORAGE</text>
                {/* Vessels */}
                {vessels.map((v) => {
                  const x = toX(v.lon);
                  const y = toY(v.lat);
                  const color = v.riskFlag ? RISK_COLORS[v.riskFlag] : VESSEL_TYPE_COLORS[v.vesselType];
                  const isSelected = selectedVessel?.id === v.id;
                  return (
                    <g key={v.id} onClick={() => setSelectedVessel(v === selectedVessel ? null : v)} style={{ cursor: "pointer" }}>
                      {isSelected && <circle cx={x} cy={y} r={14} fill={color} fillOpacity={0.15} />}
                      <polygon
                        points={`${x},${y - 8} ${x - 5},${y + 6} ${x + 5},${y + 6}`}
                        fill={color}
                        stroke={isSelected ? "white" : "transparent"}
                        strokeWidth={1}
                        transform={`rotate(${v.heading}, ${x}, ${y})`}
                        opacity={0.9}
                      />
                      {v.riskFlag === "red" && (
                        <circle cx={x + 7} cy={y - 7} r={4} fill="#ef4444" stroke="#0A1628" strokeWidth={1} />
                      )}
                    </g>
                  );
                })}
              </svg>
              {/* Legend */}
              <div className="absolute bottom-2 left-2 flex gap-3">
                {Object.entries(RISK_COLORS).map(([k, c]) => (
                  <div key={k} className="flex items-center gap-1">
                    <div className="w-2 h-2 rounded-full" style={{ background: c }} />
                    <span className="text-xs text-slate-500 capitalize">{k}</span>
                  </div>
                ))}
              </div>
            </div>
            {/* Vessel List */}
            <div className="divide-y divide-slate-800/50 max-h-48 overflow-y-auto">
              {vessels.length === 0 ? (
                <div className="p-6 text-center text-slate-600 text-sm">Start the stream to see vessel positions</div>
              ) : (
                vessels.map((v) => (
                  <button
                    key={v.id}
                    onClick={() => setSelectedVessel(selectedVessel?.id === v.id ? null : v)}
                    className={`w-full flex items-center gap-3 px-4 py-2.5 text-left hover:bg-white/2 transition-colors ${selectedVessel?.id === v.id ? "bg-white/5" : ""}`}
                  >
                    <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: v.riskFlag ? RISK_COLORS[v.riskFlag] : VESSEL_TYPE_COLORS[v.vesselType] }} />
                    <div className="flex-1 min-w-0">
                      <div className="text-xs font-semibold text-white truncate">{v.vesselName}</div>
                      <div className="text-xs text-slate-500">{v.mmsi} · {v.vesselType} · {v.speed.toFixed(1)}kn</div>
                    </div>
                    <div className="text-xs" style={{ color: STATUS_COLORS[v.status] }}>{v.status}</div>
                    <ChevronRight className="w-3 h-3 text-slate-600" />
                  </button>
                ))
              )}
            </div>
          </div>

          {/* Stream Messages + Selected Vessel Detail */}
          <div className="flex flex-col gap-4">
            {/* Selected Vessel Detail */}
            {selectedVessel && (
              <div className="bg-[#0A1628] border border-[#D4A017]/30 rounded-2xl p-4">
                <div className="flex items-center justify-between mb-3">
                  <div className="font-semibold text-white text-sm">{selectedVessel.vesselName}</div>
                  {selectedVessel.riskFlag && (
                    <span className="text-xs px-2 py-1 rounded-full font-bold" style={{ background: `${RISK_COLORS[selectedVessel.riskFlag]}20`, color: RISK_COLORS[selectedVessel.riskFlag] }}>
                      {selectedVessel.riskFlag.toUpperCase()} RISK
                    </span>
                  )}
                </div>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  {[
                    ["MMSI", selectedVessel.mmsi],
                    ["Type", selectedVessel.vesselType],
                    ["Speed", `${selectedVessel.speed.toFixed(1)} kn`],
                    ["Heading", `${selectedVessel.heading}°`],
                    ["Position", `${selectedVessel.lat.toFixed(4)}, ${selectedVessel.lon.toFixed(4)}`],
                    ["Status", selectedVessel.status],
                    ["Cargo Status", selectedVessel.cargoStatus],
                    ["Declaration", selectedVessel.declarationRef ?? "Not submitted"],
                  ].map(([k, v]) => (
                    <div key={k} className="bg-slate-900/50 rounded-lg p-2">
                      <div className="text-slate-500 mb-0.5">{k}</div>
                      <div className="text-white font-mono">{v}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Fluvio Message Stream */}
            <div className="bg-[#0A1628] border border-slate-700/50 rounded-2xl flex-1 overflow-hidden">
              <div className="px-5 py-3 border-b border-slate-700/30 flex items-center gap-2">
                <Radio className="w-4 h-4 text-cyan-400" />
                <span className="text-sm font-semibold text-white">Fluvio Consumer Log</span>
                <span className="ml-auto text-xs font-mono text-slate-500">topic: ais.vessel.positions</span>
              </div>
              <div className="font-mono text-xs overflow-y-auto" style={{ maxHeight: "320px" }}>
                {messages.length === 0 ? (
                  <div className="p-6 text-center text-slate-600">Waiting for stream events...</div>
                ) : (
                  messages.map((msg) => (
                    <div key={msg.id} className="border-b border-slate-800/30 px-4 py-2 hover:bg-white/2">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-slate-600">[{new Date(msg.timestamp).toLocaleTimeString()}]</span>
                        <span className="text-cyan-400">partition={msg.partition}</span>
                        <span className="text-purple-400">offset={msg.offset}</span>
                        <span className="text-emerald-400 ml-auto">{msg.processingLatencyMs}ms</span>
                        <span className="text-amber-400">rust:{msg.rustEngineMs}ms</span>
                      </div>
                      <div className="text-slate-400">
                        <span className="text-[#D4A017]">key=</span>
                        <span className="text-white">{msg.key}</span>
                        <span className="text-slate-600 ml-2 truncate">{msg.value.slice(0, 80)}...</span>
                      </div>
                    </div>
                  ))
                )}
                <div ref={messagesEndRef} />
              </div>
            </div>
          </div>
        </div>

        {/* Implementation Reference */}
        <div className="mt-6 bg-[#0A1628] border border-slate-700/30 rounded-xl p-4">
          <div className="text-xs text-slate-500 mb-2 font-semibold uppercase tracking-wider">Production Implementation Reference</div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs">
            {[
              { file: "services/rust/stream-processor/src/main.rs", desc: "Fluvio consumer with AIS NMEA parser, position enrichment, and Kafka bridge" },
              { file: "kafka/topics.yaml", desc: "ais.vessel.positions topic — 3 partitions, 7-day retention, compaction enabled" },
              { file: "lakehouse/flink/declaration_stream_job.py", desc: "Flink job consuming Fluvio → Delta Lake Bronze with exactly-once semantics" },
            ].map((ref) => (
              <div key={ref.file} className="bg-slate-900/50 rounded-lg p-3">
                <div className="font-mono text-cyan-400 mb-1">{ref.file}</div>
                <div className="text-slate-500">{ref.desc}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
