/**
 * Port Congestion Heatmap — TradeGateway NGSWTP
 * Interactive Google Maps heatmap showing real-time port congestion data.
 * Wired to real tRPC geospatial.heatmapData and geospatial.listPorts.
 */
import { useState, useCallback, useRef, useEffect } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { MapView } from "@/components/Map";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { RefreshCw, MapPin, Ship, AlertTriangle, TrendingUp, Anchor, Wifi, WifiOff, Navigation, Flag, Radio, Zap } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { useFluvioFeed, type VesselPosition } from "@/hooks/useFluvioFeed";

type CongestionStatus = "clear" | "moderate" | "congested" | "critical";

const STATUS_COLORS: Record<CongestionStatus, string> = {
  clear: "#22c55e",
  moderate: "#f59e0b",
  congested: "#f97316",
  critical: "#ef4444",
};

const STATUS_LABELS: Record<CongestionStatus, string> = {
  clear: "Clear",
  moderate: "Moderate",
  congested: "Congested",
  critical: "Critical",
};

// ── Fluvio Live Feed Panel ────────────────────────────────────────────────────

function FluvioLiveFeedPanel() {
  const { events, vesselPositions, status, lastUpdated, pause, resume, clearEvents } = useFluvioFeed();

  const statusConfig: Record<string, { label: string; color: string; dot: string }> = {
    connected:    { label: "Live",         color: "text-emerald-400", dot: "bg-emerald-500" },
    connecting:   { label: "Connecting…",  color: "text-amber-400",  dot: "bg-amber-400" },
    reconnecting: { label: "Reconnecting…",color: "text-amber-400",  dot: "bg-amber-400" },
    paused:       { label: "Paused",       color: "text-muted-foreground", dot: "bg-muted-foreground" },
    error:        { label: "Offline",      color: "text-red-400",    dot: "bg-red-500" },
  };
  const cfg = statusConfig[status] ?? statusConfig.error;

  const recentVessels = vesselPositions.slice(0, 15);
  const recentEvents  = events.filter(e => e.type !== "ais.vessel_position").slice(0, 10);

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2">
            <Radio className="h-4 w-4 text-primary" />
            Fluvio Live Event Feed
            <span className="flex items-center gap-1.5 ml-2">
              {status === "connected" ? (
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
                </span>
              ) : (
                <span className={`h-2 w-2 rounded-full ${cfg.dot}`} />
              )}
              <span className={`text-xs font-normal ${cfg.color}`}>{cfg.label}</span>
            </span>
          </CardTitle>
          <div className="flex items-center gap-2">
            {lastUpdated && (
              <span className="text-xs text-muted-foreground hidden sm:inline">
                Last: {lastUpdated.toLocaleTimeString()}
              </span>
            )}
            <Button variant="ghost" size="sm" onClick={clearEvents} className="h-7 px-2 text-xs">
              Clear
            </Button>
            {status === "paused" ? (
              <Button variant="outline" size="sm" onClick={resume} className="h-7 gap-1.5 text-xs">
                <Wifi className="h-3 w-3" /> Resume
              </Button>
            ) : (
              <Button variant="outline" size="sm" onClick={pause} className="h-7 gap-1.5 text-xs">
                <WifiOff className="h-3 w-3" /> Pause
              </Button>
            )}
          </div>
        </div>
        <p className="text-xs text-muted-foreground">
          Real-time AIS vessel positions and declaration lifecycle events via Fluvio consumer (port 8085).
          {status === "error" && " Start the fluvio-consumer service to enable live feed."}
        </p>
      </CardHeader>
      <CardContent className="p-0">
        <Tabs defaultValue="vessels">
          <TabsList className="w-full rounded-none border-b bg-transparent h-9">
            <TabsTrigger value="vessels" className="flex-1 text-xs">
              <Ship className="h-3.5 w-3.5 mr-1" /> AIS Positions ({recentVessels.length})
            </TabsTrigger>
            <TabsTrigger value="events" className="flex-1 text-xs">
              <Zap className="h-3.5 w-3.5 mr-1" /> Events ({recentEvents.length})
            </TabsTrigger>
          </TabsList>

          {/* AIS Vessel Positions */}
          <TabsContent value="vessels" className="mt-0">
            {recentVessels.length === 0 ? (
              <div className="p-6 text-center text-muted-foreground text-sm">
                <Ship className="h-8 w-8 mx-auto mb-2 opacity-30" />
                {status === "connected" ? "Waiting for AIS data…" : "Connect to see live vessel positions."}
              </div>
            ) : (
              <div className="divide-y max-h-72 overflow-y-auto">
                {recentVessels.map((v: VesselPosition, idx: number) => (
                  <div key={idx} className="p-3 hover:bg-muted/20 transition-colors">
                    <div className="flex items-start justify-between">
                      <div className="flex items-center gap-2">
                        <Ship className="h-4 w-4 text-blue-400 shrink-0" />
                        <div>
                          <div className="text-sm font-medium">{v.vesselName || v.mmsi}</div>
                          <div className="flex gap-3 text-xs text-muted-foreground mt-0.5">
                            <span>MMSI: {v.mmsi}</span>
                            <span>Port: {v.portCode}</span>
                            <span>{v.speed?.toFixed(1)} kn</span>
                            <span>{v.heading}&deg;</span>
                          </div>
                        </div>
                      </div>
                      <div className="text-right text-xs text-muted-foreground shrink-0">
                        <div>{new Date(v.timestamp).toLocaleTimeString()}</div>
                        <div className="text-[10px]">{v.lat.toFixed(3)}&deg;N, {v.lng.toFixed(3)}&deg;E</div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </TabsContent>

          {/* Declaration / Cargo Events */}
          <TabsContent value="events" className="mt-0">
            {recentEvents.length === 0 ? (
              <div className="p-6 text-center text-muted-foreground text-sm">
                <Zap className="h-8 w-8 mx-auto mb-2 opacity-30" />
                {status === "connected" ? "Waiting for trade events…" : "Connect to see live trade events."}
              </div>
            ) : (
              <div className="divide-y max-h-72 overflow-y-auto">
                {recentEvents.map((e, idx) => (
                  <div key={idx} className="p-3 hover:bg-muted/20 transition-colors">
                    <div className="flex items-start justify-between">
                      <div>
                        <Badge variant="outline" className="text-[10px] mb-1">{e.type}</Badge>
                        <div className="text-xs text-muted-foreground font-mono">
                          {JSON.stringify(e.payload).slice(0, 80)}…
                        </div>
                      </div>
                      <span className="text-[10px] text-muted-foreground shrink-0 ml-2">
                        {new Date(e.timestamp).toLocaleTimeString()}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}

// ── Vessel Tracking Panel (DB-backed) ─────────────────────────────────────────

function VesselTrackingPanel({ selectedPort }: { selectedPort: string | null }) {
  const [search, setSearch] = useState("");
  const [portFilter, setPortFilter] = useState(selectedPort ?? "");

  // Sync portFilter when selectedPort changes
  useEffect(() => {
    if (selectedPort) setPortFilter(selectedPort);
  }, [selectedPort]);

  // Dynamic port list from DB
  const { data: portList, isError} = trpc.portCongestion.listPorts.useQuery();

  const { data: vessels, isLoading } = trpc.geospatial.getVesselTrack.useQuery(
    { portCode: portFilter || undefined, limit: 100 },
    { refetchInterval: 30_000 }
  );

  const filtered = (vessels ?? []).filter(v =>
    !search ||
    v.vesselName?.toLowerCase().includes(search.toLowerCase()) ||
    v.mmsi?.includes(search) ||
    v.imoNumber?.includes(search)
  );

  const cargoColor: Record<string, string> = {
    Container: "text-blue-400",
    Bulk: "text-amber-400",
    Tanker: "text-orange-400",
    "General Cargo": "text-emerald-400",
    RoRo: "text-purple-400",
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2">
            <Navigation className="h-4 w-4 text-primary" />
            Vessel Tracking Timeline
          </CardTitle>
          <span className="text-xs text-muted-foreground">{filtered.length} events</span>
        </div>
        <div className="flex gap-2 mt-2">
          <Input
            placeholder="Search vessel name, MMSI, or IMO..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="h-8 text-sm"
          />
          <Select value={portFilter} onValueChange={setPortFilter}>
            <SelectTrigger className="h-8 w-48 text-sm">
              <SelectValue placeholder="All ports" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="">All ports</SelectItem>
              {(portList ?? []).map(p => (
                <SelectItem key={p.portCode} value={p.portCode}>{p.portCode} — {p.portName}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        {isLoading ? (
          <div className="p-4 space-y-2">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-14 w-full" />)}</div>
        ) : filtered.length === 0 ? (
          <div className="p-8 text-center text-muted-foreground text-sm">
            <Ship className="h-8 w-8 mx-auto mb-2 opacity-30" />
            No vessel events found. Use the Admin Console to seed vessel data.
          </div>
        ) : (
          <div className="divide-y max-h-80 overflow-y-auto">
            {filtered.map((v, idx) => (
              <div key={idx} className="p-3 hover:bg-muted/20 transition-colors">
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-2">
                    <Ship className="h-4 w-4 text-blue-400 shrink-0 mt-0.5" />
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium">{v.vesselName ?? v.mmsi}</span>
                        {v.flagCountry && (
                          <Badge variant="outline" className="text-xs px-1 py-0">
                            <Flag className="h-2.5 w-2.5 mr-1" />{v.flagCountry}
                          </Badge>
                        )}
                        {v.cargoType && (
                          <span className={`text-xs font-medium ${cargoColor[v.cargoType] ?? "text-muted-foreground"}`}>
                            {v.cargoType}
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-3 text-xs text-muted-foreground mt-0.5">
                        <span>MMSI: {v.mmsi}</span>
                        {v.imoNumber && <span>IMO: {v.imoNumber}</span>}
                        {v.destinationPort && <span>Port: {v.destinationPort}</span>}
                        <span>Speed: {v.speed?.toFixed(1) ?? "0"} kn</span>
                        <span>Hdg: {v.heading ?? 0}&deg;</span>
                      </div>
                    </div>
                  </div>
                  <div className="text-right text-xs text-muted-foreground shrink-0">
                    <div>{v.recordedAt ? new Date(v.recordedAt).toLocaleTimeString() : "—"}</div>
                    <div className="text-[10px]">{v.recordedAt ? new Date(v.recordedAt).toLocaleDateString() : ""}</div>
                    <div className="text-[10px] mt-0.5">
                      {v.latitude?.toFixed(3)}&deg;N, {v.longitude?.toFixed(3)}&deg;E
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function CongestionBadge({ status }: { status: CongestionStatus }) {
  const colorMap: Record<CongestionStatus, string> = {
    clear: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
    moderate: "bg-amber-500/10 text-amber-400 border-amber-500/20",
    congested: "bg-orange-500/10 text-orange-400 border-orange-500/20",
    critical: "bg-red-500/10 text-red-400 border-red-500/20",
  };
  return (
    <Badge variant="outline" className={colorMap[status]}>
      {STATUS_LABELS[status]}
    </Badge>
  );
}

export default function PortHeatmap() {
  const [selectedPort, setSelectedPort] = useState<string | null>(null);
  const [mapReady, setMapReady] = useState(false);
  const mapRef = useRef<google.maps.Map | null>(null);
  const heatmapRef = useRef<google.maps.visualization.HeatmapLayer | null>(null);
  const markersRef = useRef<google.maps.Marker[]>([]);
  const infoWindowRef = useRef<google.maps.InfoWindow | null>(null);

  const [autoRefresh, setAutoRefresh] = useState(true);
  const [lastRefreshed, setLastRefreshed] = useState<Date>(() => new Date());

  // Fluvio AIS live vessel positions — overlay on the map
  const aisMarkersRef = useRef<Map<string, google.maps.Marker>>(new Map());
  const { vesselPositions: liveVessels, status: fluvioStatus } = useFluvioFeed();

  // Update AIS markers on the map whenever live vessel positions change
  useEffect(() => {
    if (!mapReady || !mapRef.current) return;
    const map = mapRef.current;
    const existing = aisMarkersRef.current;
    const seen = new Set<string>();

    for (const vessel of liveVessels) {
      seen.add(vessel.mmsi);
      const pos = { lat: vessel.lat, lng: vessel.lng };
      if (existing.has(vessel.mmsi)) {
        // Update position of existing marker
        existing.get(vessel.mmsi)!.setPosition(pos);
      } else {
        // Create new AIS marker (small blue ship icon)
        const marker = new google.maps.Marker({
          position: pos,
          map,
          title: `${vessel.vesselName ?? vessel.mmsi} — ${vessel.speed?.toFixed(1) ?? 0} kn`,
          icon: {
            path: google.maps.SymbolPath.FORWARD_CLOSED_ARROW,
            scale: 4,
            fillColor: "#3b82f6",
            fillOpacity: 0.9,
            strokeColor: "#ffffff",
            strokeWeight: 1,
            rotation: vessel.heading ?? 0,
          },
          zIndex: 10,
        });
        existing.set(vessel.mmsi, marker);
      }
    }

    // Remove markers for vessels no longer in the feed
    for (const [mmsi, marker] of Array.from(existing.entries())) {
      if (!seen.has(mmsi)) {
        marker.setMap(null);
        existing.delete(mmsi);
      }
    }
  }, [liveVessels, mapReady]);

  const { data: heatmapData, isLoading, isError, refetch, isFetching, dataUpdatedAt } = trpc.geospatial.heatmapData.useQuery(undefined, {
    refetchInterval: autoRefresh ? 30_000 : false, // 30-second polling when auto-refresh is on
  });

  // Update lastRefreshed whenever data changes
  useEffect(() => {
    if (dataUpdatedAt) setLastRefreshed(new Date(dataUpdatedAt));
  }, [dataUpdatedAt]);

  const selectedPortData = heatmapData?.find(p => p.portCode === selectedPort);

  const handleMapReady = useCallback((map: google.maps.Map) => {
    mapRef.current = map;
    setMapReady(true);

    // Center on Africa/trade routes
    map.setCenter({ lat: 5.0, lng: 20.0 });
    map.setZoom(3);

    infoWindowRef.current = new google.maps.InfoWindow();
  }, []);

  // Render heatmap and markers when data arrives
  const renderHeatmap = useCallback(() => {
    if (!mapRef.current || !heatmapData) return;

    // Clear existing markers
    markersRef.current.forEach(m => m.setMap(null));
    markersRef.current = [];

    // Clear existing heatmap
    if (heatmapRef.current) {
      heatmapRef.current.setMap(null);
    }

    // Build heatmap data points
    const heatmapPoints = heatmapData.map(p => ({
      location: new google.maps.LatLng(p.lat, p.lng),
      weight: p.weight * 10,
    }));

    heatmapRef.current = new google.maps.visualization.HeatmapLayer({
      data: heatmapPoints,
      map: mapRef.current,
      radius: 40,
      opacity: 0.7,
      gradient: [
        "rgba(0, 255, 0, 0)",
        "rgba(0, 255, 0, 1)",
        "rgba(255, 255, 0, 1)",
        "rgba(255, 165, 0, 1)",
        "rgba(255, 0, 0, 1)",
      ],
    });

    // Add port markers
    heatmapData.forEach(port => {
      const color = STATUS_COLORS[port.congestionStatus as CongestionStatus] ?? "#6b7280";
      const marker = new google.maps.Marker({
        position: { lat: port.lat, lng: port.lng },
        map: mapRef.current!,
        title: port.portName,
        icon: {
          path: google.maps.SymbolPath.CIRCLE,
          scale: 8,
          fillColor: color,
          fillOpacity: 0.9,
          strokeColor: "#ffffff",
          strokeWeight: 2,
        },
      });

      marker.addListener("click", () => {
        setSelectedPort(port.portCode);
        if (infoWindowRef.current) {
          infoWindowRef.current.setContent(`
            <div style="padding:8px;min-width:200px;font-family:sans-serif">
              <div style="font-weight:bold;font-size:14px;margin-bottom:4px">${port.portName}</div>
              <div style="color:#666;font-size:12px;margin-bottom:6px">${port.country} · ${port.portType}</div>
              <div style="display:grid;grid-template-columns:1fr 1fr;gap:4px;font-size:12px">
                <div><span style="color:#999">Status:</span> <span style="color:${color};font-weight:bold">${STATUS_LABELS[port.congestionStatus as CongestionStatus]}</span></div>
                <div><span style="color:#999">Vessels:</span> ${port.vesselCount}</div>
                <div><span style="color:#999">Wait:</span> ${port.waitTimeHours?.toFixed(1)}h</div>
                <div><span style="color:#999">Backlog:</span> ${port.declarationBacklog}</div>
              </div>
            </div>
          `);
          infoWindowRef.current.open(mapRef.current, marker);
        }
      });

      markersRef.current.push(marker);
    });
  }, [heatmapData]);

  // Trigger render when map and data are both ready
  if (mapReady && heatmapData && markersRef.current.length === 0) {
    renderHeatmap();
  }

  const stats = heatmapData ? {
    clear: heatmapData.filter(p => p.congestionStatus === "clear").length,
    moderate: heatmapData.filter(p => p.congestionStatus === "moderate").length,
    congested: heatmapData.filter(p => p.congestionStatus === "congested").length,
    critical: heatmapData.filter(p => p.congestionStatus === "critical").length,
    totalVessels: heatmapData.reduce((s, p) => s + (p.vesselCount ?? 0), 0),
  } : null;

  return (
    <DashboardLayout title="Port Heatmap">
      <div className="space-y-4">
        {isError && (
          <div className="p-3 bg-red-50 border border-red-200 rounded text-red-700 text-sm">
            Failed to load heatmap data. Please refresh the page.
          </div>
        )}
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
              <Anchor className="h-6 w-6 text-primary" />
              Port Congestion Heatmap
            </h1>
            <p className="text-muted-foreground text-sm mt-1">
              Live congestion status across all connected ports — auto-refreshes every 30 seconds
            </p>
          </div>
          <div className="flex items-center gap-2">
            {/* Live indicator */}
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              {isFetching ? (
                <RefreshCw className="h-3 w-3 animate-spin text-primary" />
              ) : autoRefresh ? (
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500" />
                </span>
              ) : (
                <span className="h-2 w-2 rounded-full bg-muted-foreground" />
              )}
              <span className="hidden sm:inline">
                {isFetching ? "Updating..." : `Updated ${lastRefreshed.toLocaleTimeString()}`}
              </span>
            </div>
            {/* Auto-refresh toggle */}
            <Button
              variant="outline"
              size="sm"
              onClick={() => setAutoRefresh((v) => !v)}
              className={`gap-1.5 ${autoRefresh ? "border-green-500/40 text-green-400" : ""}`}
            >
              {autoRefresh ? <Wifi className="h-4 w-4" /> : <WifiOff className="h-4 w-4" />}
              <span className="hidden sm:inline">{autoRefresh ? "Live" : "Paused"}</span>
            </Button>
            {/* Manual refresh */}
            <Button variant="outline" size="sm" onClick={() => { refetch(); renderHeatmap(); }} className="gap-1.5">
              <RefreshCw className={`h-4 w-4 ${isFetching ? "animate-spin" : ""}`} />
              <span className="hidden sm:inline">Refresh</span>
            </Button>
          </div>
        </div>

        {/* Stats Row */}
        <div className="grid grid-cols-5 gap-3">
          {[
            { label: "Clear", count: stats?.clear, icon: <MapPin className="h-4 w-4 text-emerald-400" />, color: "text-emerald-400" },
            { label: "Moderate", count: stats?.moderate, icon: <MapPin className="h-4 w-4 text-amber-400" />, color: "text-amber-400" },
            { label: "Congested", count: stats?.congested, icon: <AlertTriangle className="h-4 w-4 text-orange-400" />, color: "text-orange-400" },
            { label: "Critical", count: stats?.critical, icon: <AlertTriangle className="h-4 w-4 text-red-400" />, color: "text-red-400" },
            { label: "Total Vessels", count: stats?.totalVessels, icon: <Ship className="h-4 w-4 text-blue-400" />, color: "text-blue-400" },
            { label: "AIS Live", count: liveVessels.length, icon: <Zap className="h-4 w-4 text-primary" />, color: fluvioStatus === "connected" ? "text-primary" : "text-muted-foreground" },
          ].map((s) => (
            <Card key={s.label}>
              <CardContent className="p-4 flex items-center gap-3">
                {s.icon}
                <div>
                  <p className={`text-xl font-bold ${s.color}`}>{isLoading ? "—" : (s.count ?? 0)}</p>
                  <p className="text-xs text-muted-foreground">{s.label}</p>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        <div className="grid grid-cols-3 gap-4">
          {/* Map */}
          <div className="col-span-2">
            <Card>
              <CardContent className="p-0 overflow-hidden rounded-lg">
                {isLoading ? (
                  <Skeleton className="h-[500px] w-full" />
                ) : (
                  <MapView
                    className="h-[500px] w-full"
                    onMapReady={handleMapReady}
                  />
                )}
              </CardContent>
            </Card>
          </div>

          {/* Port List */}
          <div>
            <Card className="h-[500px] flex flex-col">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Port Status</CardTitle>
              </CardHeader>
              <CardContent className="flex-1 overflow-y-auto p-0">
                {isLoading ? (
                  <div className="p-4 space-y-2">
                    {Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}
                  </div>
                ) : (
                  <div className="divide-y">
                    {(heatmapData ?? []).map((port) => (
                      <button
                        key={port.portCode}
                        className={`w-full text-left p-3 hover:bg-muted/30 transition-colors ${selectedPort === port.portCode ? "bg-muted/50" : ""}`}
                        onClick={() => {
                          setSelectedPort(port.portCode);
                          if (mapRef.current) {
                            mapRef.current.panTo({ lat: port.lat, lng: port.lng });
                            mapRef.current.setZoom(8);
                          }
                        }}
                      >
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-sm font-medium truncate">{port.portName}</span>
                          <CongestionBadge status={port.congestionStatus as CongestionStatus} />
                        </div>
                        <div className="flex items-center gap-3 text-xs text-muted-foreground">
                          <span>{port.country}</span>
                          <span>·</span>
                          <span>{port.vesselCount} vessels</span>
                          <span>·</span>
                          <span>{port.waitTimeHours?.toFixed(1)}h wait</span>
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </div>

        {/* Selected Port Detail */}
        {selectedPortData && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Anchor className="h-4 w-4" />
                {selectedPortData.portName} — Detail
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-4 gap-4 text-sm">
                <div>
                  <p className="text-muted-foreground text-xs mb-1">Congestion Status</p>
                  <CongestionBadge status={(selectedPortData.congestionStatus ?? "clear") as CongestionStatus} />
                </div>
                <div>
                  <p className="text-muted-foreground text-xs mb-1">Vessels at Anchor</p>
                  <p className="font-semibold">{selectedPortData.vesselCount ?? 0}</p>
                </div>
                <div>
                  <p className="text-muted-foreground text-xs mb-1">Average Wait Time</p>
                  <p className="font-semibold">{selectedPortData.waitTimeHours?.toFixed(1) ?? "0"}h</p>
                </div>
                <div>
                  <p className="text-muted-foreground text-xs mb-1">Declaration Backlog</p>
                  <p className="font-semibold">{selectedPortData.declarationBacklog ?? 0}</p>
                </div>
                <div>
                  <p className="text-muted-foreground text-xs mb-1">Inspection Queue</p>
                  <p className="font-semibold">{(selectedPortData as any).inspectionQueueSize ?? 0}</p>
                </div>
                <div>
                  <p className="text-muted-foreground text-xs mb-1">Country</p>
                  <p className="font-semibold">{selectedPortData.country}</p>
                </div>
                <div>
                  <p className="text-muted-foreground text-xs mb-1">Port Type</p>
                  <p className="font-semibold capitalize">{selectedPortData.portType?.replace(/_/g, " ")}</p>
                </div>
                <div>
                  <p className="text-muted-foreground text-xs mb-1">Last Updated</p>
                  <p className="font-semibold">
                    {selectedPortData.lastUpdated
                      ? new Date(selectedPortData.lastUpdated).toLocaleString()
                      : "—"}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Legend */}
        <div className="flex items-center gap-6 text-xs text-muted-foreground">
          <span className="font-medium">Congestion Legend:</span>
          {Object.entries(STATUS_COLORS).map(([status, color]) => (
            <span key={status} className="flex items-center gap-1.5">
              <span className="h-3 w-3 rounded-full inline-block" style={{ backgroundColor: color }} />
              {STATUS_LABELS[status as CongestionStatus]}
            </span>
          ))}
        </div>

        {/* Fluvio Live Feed */}
        <FluvioLiveFeedPanel />

        {/* Vessel Tracking Timeline (DB-backed) */}
        <VesselTrackingPanel selectedPort={selectedPort} />
      </div>
    </DashboardLayout>
  );
}
