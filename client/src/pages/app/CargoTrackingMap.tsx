/**
 * Sprint 66 — Cargo Tracking Real-Time Map
 * Live AIS vessel positions on Google Maps with animated markers,
 * route polylines, 30-second refresh, and shipment info panel.
 */

import { useRef, useEffect, useCallback, useState } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { MapView } from "@/components/Map";
import { trpc } from "@/lib/trpc";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import {
  Anchor, Ship, Navigation, AlertTriangle, RefreshCw,
  Clock, MapPin, Gauge, Compass, Package, Radio,
  Filter, X, ChevronRight, Activity, Wifi, WifiOff, Layers,
} from "lucide-react";
import { useVesselWebSocket } from "@/hooks/useVesselWebSocket";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "../../../../server/routers";

// ─── TYPES ────────────────────────────────────────────────────────────────────

// The vessel shape is derived from the cargoTracking router output — the
// persisted AIS store is the only source, and fields it does not track
// (call sign, draught, length, origin port, declaration linkage) are NOT
// shown here rather than rendered from the removed synthetic fleet.
type RouterOutputs = inferRouterOutputs<AppRouter>;
type Vessel = RouterOutputs["cargoTracking"]["getLiveVessels"]["vessels"][number];

// ─── HELPERS ──────────────────────────────────────────────────────────────────

const RISK_COLORS: Record<string, string> = {
  green: "#22c55e",
  amber: "#f59e0b",
  red: "#ef4444",
};

const STATUS_COLORS: Record<string, string> = {
  underway: "#3b82f6",
  moored: "#8b5cf6",
  anchored: "#f59e0b",
  restricted: "#ef4444",
  aground: "#dc2626",
};

const VESSEL_ICONS: Record<string, string> = {
  container: "🚢",
  bulk: "⛴️",
  tanker: "🛢️",
  general: "🚢",
  roro: "🚗",
  passenger: "🛳️",
};

function formatEta(eta: string | null): string {
  if (!eta) return "—";
  const d = new Date(eta);
  const now = new Date();
  const diffH = Math.round((d.getTime() - now.getTime()) / 3600000);
  if (diffH < 0) return "Arrived";
  if (diffH < 1) return "< 1 hour";
  if (diffH < 24) return `${diffH}h`;
  return `${Math.round(diffH / 24)}d`;
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function flagEmoji(code: string): string {
  const flags: Record<string, string> = {
    LR: "🇱🇷", TW: "🇹🇼", GH: "🇬🇭", KE: "🇰🇪",
    AE: "🇦🇪", DK: "🇩🇰", EG: "🇪🇬",
  };
  return flags[code] ?? "🏳️";
}

// ─── COMPONENT ────────────────────────────────────────────────────────────────

export default function CargoTrackingMap() {
  const mapRef = useRef<google.maps.Map | null>(null);
  const markersRef = useRef<Map<string, google.maps.marker.AdvancedMarkerElement>>(new Map());
  const polylinesRef = useRef<Map<string, google.maps.Polyline>>(new Map());
  const routePolylineRef = useRef<google.maps.Polyline | null>(null);

  const [selectedVessel, setSelectedVessel] = useState<Vessel | null>(null);
  const [riskFilter, setRiskFilter] = useState<"all" | "green" | "amber" | "red">("all");
  const [statusFilter, setStatusFilter] = useState<"all" | "underway" | "moored" | "anchored">("all");
  const [lastRefresh, setLastRefresh] = useState<Date>(new Date());
  const [mapReady, setMapReady] = useState(false);
  const [showHeatmap, setShowHeatmap] = useState(false);
  const heatmapLayerRef = useRef<any>(null);

  // ─── SPRINT 70: WebSocket real-time push ─────────────────────────────────────

  const { vessels: wsVessels, connectionStatus, lastRefresh: wsLastRefresh } = useVesselWebSocket(true);
  // Use WebSocket data when live, fall back to tRPC polling otherwise
  const isWsLive = connectionStatus === "live";

  // ─── DATA FETCHING (polling fallback) ────────────────────────────────────────────────

  const { data: vesselData, refetch: refetchVessels, isLoading: vesselsLoading, isError: vesselsError, refetch: retryVessels } = trpc.cargoTracking.getLiveVessels.useQuery(
    { riskFilter, statusFilter },
    // Only poll when WebSocket is not live
    { refetchInterval: isWsLive ? false : 30000 }
  );

  const { data: statsData, isError: statsError } = trpc.cargoTracking.getVesselStats.useQuery(undefined, {
    refetchInterval: 30000,
  });

  const { data: arrivalsData, isError: arrivalsError } = trpc.cargoTracking.getPortArrivals.useQuery(undefined, {
    refetchInterval: 60000,
  });

  const trackingUnavailable = !isWsLive && (vesselsError || statsError || arrivalsError);

  const { data: routeData } = trpc.cargoTracking.getVesselRoute.useQuery(
    { mmsi: selectedVessel?.mmsi ?? "" },
    { enabled: !!selectedVessel }
  );
  const { data: heatmapData } = trpc.cargoTracking.getCargoHeatmapData.useQuery(
    { hours: 24, limit: 500 },
    { enabled: showHeatmap, staleTime: 120000 }
  );

  // ─── MAP INITIALISATION ─────────────────────────────────────────────────────

  const handleMapReady = useCallback((map: google.maps.Map) => {
    mapRef.current = map;
    setMapReady(true);
  }, []);

  // ─── MARKER MANAGEMENT ──────────────────────────────────────────────────────

  const updateMarkers = useCallback((vessels: Vessel[]) => {
    if (!mapRef.current || !window.google) return;

    const currentIds = new Set(vessels.map(v => v.id));

    // Remove stale markers
    markersRef.current.forEach((marker, id) => {
      if (!currentIds.has(id)) {
        marker.map = null;
        markersRef.current.delete(id);
      }
    });

    vessels.forEach(vessel => {
      const position = { lat: vessel.lat, lng: vessel.lon };
      const riskColor = vessel.riskFlag ? RISK_COLORS[vessel.riskFlag] : "#6b7280";
      const icon = VESSEL_ICONS[vessel.vesselType ?? ""] ?? "🚢";

      // Create marker element
      const el = document.createElement("div");
      el.style.cssText = `
        display: flex; flex-direction: column; align-items: center; cursor: pointer;
        filter: drop-shadow(0 2px 4px rgba(0,0,0,0.4));
        transition: transform 0.3s ease;
      `;

      const bubble = document.createElement("div");
      bubble.style.cssText = `
        background: ${riskColor}; color: white; border-radius: 50%;
        width: 36px; height: 36px; display: flex; align-items: center;
        justify-content: center; font-size: 18px; border: 2px solid white;
        box-shadow: 0 0 0 2px ${riskColor}40;
        transform: rotate(${vessel.heading}deg);
      `;
      bubble.textContent = icon;

      const label = document.createElement("div");
      label.style.cssText = `
        background: rgba(0,0,0,0.75); color: white; font-size: 10px;
        padding: 2px 6px; border-radius: 4px; margin-top: 2px;
        white-space: nowrap; max-width: 120px; overflow: hidden; text-overflow: ellipsis;
      `;
      label.textContent = vessel.vesselName;

      el.appendChild(bubble);
      el.appendChild(label);

      const existing = markersRef.current.get(vessel.id);
      if (existing) {
        // Animate to new position
        existing.position = position;
        (existing as any).content = el;
      } else {
        const marker = new google.maps.marker.AdvancedMarkerElement({
          map: mapRef.current!,
          position,
          title: vessel.vesselName,
          content: el,
        });
        marker.addListener("click", () => setSelectedVessel(vessel));
        markersRef.current.set(vessel.id, marker);
      }
    });

    setLastRefresh(new Date());
  }, []);

  // ─── ROUTE POLYLINE ─────────────────────────────────────────────────────────

  const drawRoute = useCallback((vessel: Vessel, waypoints: Array<{ lat: number; lon: number }>) => {
    if (!mapRef.current || !window.google) return;

    // Clear previous route
    if (routePolylineRef.current) {
      routePolylineRef.current.setMap(null);
    }

    const path = waypoints.map(wp => ({ lat: wp.lat, lng: wp.lon }));

    // Dashed historical track
    routePolylineRef.current = new google.maps.Polyline({
      path,
      geodesic: true,
      strokeColor: vessel.riskFlag ? RISK_COLORS[vessel.riskFlag] : "#6b7280",
      strokeOpacity: 0.8,
      strokeWeight: 2,
      icons: [{
        icon: { path: google.maps.SymbolPath.FORWARD_OPEN_ARROW, scale: 3 },
        offset: "50%",
        repeat: "80px",
      }],
      map: mapRef.current,
    });

    // Pan map to show full route
    const bounds = new google.maps.LatLngBounds();
    path.forEach(p => bounds.extend(p));
    mapRef.current.fitBounds(bounds, { top: 60, right: 60, bottom: 60, left: 60 });
  }, []);

  const clearRoute = useCallback(() => {
    if (routePolylineRef.current) {
      routePolylineRef.current.setMap(null);
      routePolylineRef.current = null;
    }
  }, []);

  //   // ─── EFFECTS ────────────────────────────────────────────────────────

  // Sprint 70: update markers from WebSocket when live
  useEffect(() => {
    if (mapReady && isWsLive && wsVessels.length > 0) {
      // Merge WS position updates into the full vessel objects from tRPC
      const fullVessels = vesselData?.vessels ?? [];
      const wsMap = new Map(wsVessels.map(v => [v.mmsi, v]));
      const merged = fullVessels.map(v => {
        const ws = wsMap.get(v.mmsi);
        if (!ws) return v;
        return { ...v, lat: ws.lat, lon: ws.lon, speed: ws.speed, heading: ws.heading, lastUpdate: ws.lastUpdate };
      });
      updateMarkers(merged.length > 0 ? merged : fullVessels);
      if (wsLastRefresh) setLastRefresh(new Date(wsLastRefresh));
    }
  }, [mapReady, isWsLive, wsVessels, vesselData, wsLastRefresh, updateMarkers]);

  // Fallback: update markers from tRPC polling when WS is not live
  useEffect(() => {
    if (mapReady && !isWsLive && vesselData?.vessels) {
      updateMarkers(vesselData.vessels);
    }
  }, [mapReady, isWsLive, vesselData, updateMarkers]);

  useEffect(() => {
    if (selectedVessel && routeData?.waypoints && mapReady) {
      drawRoute(selectedVessel, routeData.waypoints);
    } else if (!selectedVessel) {
      clearRoute();
    }
  }, [selectedVessel, routeData, mapReady, drawRoute, clearRoute]);

  // ─── RENDER ─────────────────────────────────────────────────────────────────

  const vessels: Vessel[] = vesselData?.vessels ?? [];

  // v100: Apply/remove heatmap layer when toggle changes
  useEffect(() => {
    if (!mapReady || typeof google === 'undefined') return;
    if (showHeatmap && heatmapData && heatmapData.length > 0) {
      if (heatmapLayerRef.current) {
        heatmapLayerRef.current.setMap(null);
      }
      const points = heatmapData.map((p: { lat: number; lng: number; weight: number }) =>
        new google.maps.LatLng(p.lat, p.lng)
      );
      heatmapLayerRef.current = new (google.maps.visualization as any).HeatmapLayer({
        data: points,
        radius: 40,
      });
      heatmapLayerRef.current.setMap((window as any).__map__);
    } else if (!showHeatmap && heatmapLayerRef.current) {
      heatmapLayerRef.current.setMap(null);
      heatmapLayerRef.current = null;
    }
  }, [showHeatmap, heatmapData, mapReady]);


  return (
    <DashboardLayout title="Cargo Tracking — Live AIS Map">
      <div className="flex flex-col gap-4 h-full">

        {trackingUnavailable && (
          <div role="alert" className="flex items-center justify-between gap-3 rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-2.5">
            <p className="text-sm text-destructive">
              Live tracking data is unavailable — figures below are not shown rather than stale values. The map may be empty until the connection recovers.
            </p>
            <Button variant="outline" size="sm" onClick={() => retryVessels()}>Retry</Button>
          </div>
        )}
        {vesselsLoading && !vesselData && !isWsLive && (
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3" aria-busy="true" aria-label="Loading vessel statistics">
            {Array.from({ length: 7 }).map((_, i) => (
              <div key={i} className="h-16 animate-pulse rounded-lg bg-muted" />
            ))}
          </div>
        )}

        {/* ── HEADER STATS ── */}
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3">
          {[
            { label: "Total Vessels", value: statsData?.total, icon: Ship, color: "text-blue-400" },
            { label: "Underway", value: statsData?.underway, icon: Navigation, color: "text-blue-400" },
            { label: "Moored", value: statsData?.moored, icon: Anchor, color: "text-purple-400" },
            { label: "Anchored", value: statsData?.anchored, icon: Anchor, color: "text-yellow-400" },
            { label: "Red Flag", value: statsData?.redFlag, icon: AlertTriangle, color: "text-red-400" },
            { label: "Amber Flag", value: statsData?.amberFlag, icon: AlertTriangle, color: "text-yellow-400" },
            { label: "Declared", value: statsData?.withDeclaration, icon: Package, color: "text-green-400" },
          ].map(stat => (
            <Card key={stat.label} className="bg-card/50">
              <CardContent className="p-3 flex items-center gap-2">
                <stat.icon className={`h-4 w-4 shrink-0 ${stat.color}`} />
                <div>
                  <p className="text-xs text-muted-foreground leading-none">{stat.label}</p>
                  <p className="text-lg font-bold leading-tight">{stat.value ?? "—"}</p>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* ── CONTROLS ── */}
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2">
            <Filter className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm text-muted-foreground">Filter:</span>
          </div>
          <Select value={riskFilter} onValueChange={v => setRiskFilter(v as typeof riskFilter)}>
            <SelectTrigger className="w-36 h-8 text-xs">
              <SelectValue placeholder="Risk Flag" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Risk Flags</SelectItem>
              <SelectItem value="green">Green</SelectItem>
              <SelectItem value="amber">Amber</SelectItem>
              <SelectItem value="red">Red</SelectItem>
            </SelectContent>
          </Select>
          <Select value={statusFilter} onValueChange={v => setStatusFilter(v as typeof statusFilter)}>
            <SelectTrigger className="w-36 h-8 text-xs">
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Statuses</SelectItem>
              <SelectItem value="underway">Underway</SelectItem>
              <SelectItem value="moored">Moored</SelectItem>
              <SelectItem value="anchored">Anchored</SelectItem>
            </SelectContent>
          </Select>
          <div className="ml-auto flex items-center gap-2 text-xs text-muted-foreground">
            {/* Sprint 70: WebSocket connection status badge */}
            {connectionStatus === "live" ? (
              <>
                <Wifi className="h-3 w-3 text-green-400" />
                <span className="text-green-500 font-medium">Live</span>
              </>
            ) : connectionStatus === "reconnecting" ? (
              <>
                <WifiOff className="h-3 w-3 text-yellow-400 animate-pulse" />
                <span className="text-yellow-500">Reconnecting…</span>
              </>
            ) : connectionStatus === "fallback" ? (
              <>
                <Activity className="h-3 w-3 text-blue-400 animate-pulse" />
                <span>Polling — 30s</span>
              </>
            ) : (
              <>
                <Activity className="h-3 w-3 text-muted-foreground animate-pulse" />
                <span>Connecting…</span>
              </>
            )}
            <span>·</span>
            <span>Last: {formatTime(lastRefresh.toISOString())}</span>
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => refetchVessels()}>
              <RefreshCw className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>

        {/* ── MAIN CONTENT ── */}
        <div className="flex gap-4 flex-1 min-h-0">

          {/* MAP */}
          <div className="flex-1 min-w-0 rounded-lg overflow-hidden border border-border">
            <MapView
              className="w-full h-full min-h-[500px]"
              initialCenter={{ lat: -4.05, lng: 39.67 }}
              initialZoom={10}
              onMapReady={handleMapReady}
            />
          </div>

          {/* SIDE PANEL */}
          <div className="w-80 shrink-0 flex flex-col gap-3 overflow-y-auto max-h-[680px]">

            {/* Selected vessel detail */}
            {selectedVessel ? (
              <Card className="border-primary/50">
                <CardHeader className="pb-2">
                  <div className="flex items-start justify-between">
                    <div>
                      <CardTitle className="text-sm flex items-center gap-2">
                        <span>{VESSEL_ICONS[selectedVessel.vesselType ?? ""] ?? "🚢"}</span>
                        <span>{selectedVessel.vesselName}</span>
                      </CardTitle>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {flagEmoji(selectedVessel.flagCountry)} {selectedVessel.flagCountry || "—"}
                      </p>
                    </div>
                    <Button variant="ghost" size="icon" className="h-6 w-6 -mt-1" onClick={() => setSelectedVessel(null)}>
                      <X className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                  <div className="flex gap-1.5 flex-wrap mt-1">
                    {selectedVessel.riskFlag && (
                      <Badge
                        variant="outline"
                        className="text-xs"
                        style={{ borderColor: RISK_COLORS[selectedVessel.riskFlag], color: RISK_COLORS[selectedVessel.riskFlag] }}
                      >
                        {selectedVessel.riskFlag.toUpperCase()} RISK
                      </Badge>
                    )}
                    <Badge
                      variant="outline"
                      className="text-xs"
                      style={{ borderColor: STATUS_COLORS[selectedVessel.status] ?? "#6b7280", color: STATUS_COLORS[selectedVessel.status] ?? "#6b7280" }}
                    >
                      {selectedVessel.status.toUpperCase()}
                    </Badge>
                    <Badge variant="secondary" className="text-xs capitalize">
                      {selectedVessel.cargoType}
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent className="pt-0 space-y-2 text-xs">
                  <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
                    {/* Only fields the persisted AIS store actually tracks are
                        shown — draught/length/call-sign are not tracked and were
                        dropped with the removed synthetic fleet. */}
                    {[
                      { label: "MMSI", value: selectedVessel.mmsi, icon: Radio },
                      { label: "IMO", value: selectedVessel.imoNumber || "—", icon: Ship },
                      { label: "Speed", value: `${selectedVessel.speed} kn`, icon: Gauge },
                      { label: "Heading", value: `${selectedVessel.heading}°`, icon: Compass },
                    ].map(item => (
                      <div key={item.label} className="flex items-center gap-1.5">
                        <item.icon className="h-3 w-3 text-muted-foreground shrink-0" />
                        <span className="text-muted-foreground">{item.label}:</span>
                        <span className="font-medium">{item.value}</span>
                      </div>
                    ))}
                  </div>
                  <Separator />
                  <div className="space-y-1">
                    <div className="flex items-center gap-1.5">
                      <MapPin className="h-3 w-3 text-green-400 shrink-0" />
                      <span className="text-muted-foreground">Destination:</span>
                      <span className="font-medium">{selectedVessel.destinationPort || "—"}</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <Clock className="h-3 w-3 text-muted-foreground shrink-0" />
                      <span className="text-muted-foreground">ETA:</span>
                      <span className="font-medium">{formatEta(selectedVessel.eta)}</span>
                    </div>
                  </div>
                  <div className="text-[10px] text-muted-foreground pt-1">
                    Last AIS update: {formatTime(selectedVessel.lastUpdate)} · Source: sedona-svc
                  </div>
                  {routeData?.waypoints && (
                    <div className="text-[10px] text-blue-400">
                      Route polyline: {routeData.waypoints.length} waypoints plotted
                    </div>
                  )}
                </CardContent>
              </Card>
            ) : (
              <Card className="border-dashed">
                <CardContent className="p-4 text-center text-sm text-muted-foreground">
                  <Ship className="h-8 w-8 mx-auto mb-2 opacity-30" />
                  <p>Click any vessel marker on the map to view details and route history.</p>
                </CardContent>
              </Card>
            )}

            {/* Vessel list */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Ship className="h-4 w-4" />
                  Active Vessels ({vessels.length})
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-0 space-y-1 max-h-60 overflow-y-auto">
                {vessels.map(v => (
                  <button
                    key={v.id}
                    onClick={() => {
                      setSelectedVessel(v);
                      if (mapRef.current) {
                        mapRef.current.panTo({ lat: v.lat, lng: v.lon });
                        mapRef.current.setZoom(12);
                      }
                    }}
                    className={`w-full text-left flex items-center gap-2 p-2 rounded hover:bg-accent transition-colors text-xs ${selectedVessel?.id === v.id ? "bg-accent" : ""}`}
                  >
                    <span className="text-base">{VESSEL_ICONS[v.vesselType ?? ""] ?? "🚢"}</span>
                    <div className="flex-1 min-w-0">
                      <p className="font-medium truncate">{v.vesselName}</p>
                      <p className="text-muted-foreground capitalize">{v.status} · {v.speed} kn</p>
                    </div>
                    {v.riskFlag && (
                      <div
                        className="h-2 w-2 rounded-full shrink-0"
                        style={{ background: RISK_COLORS[v.riskFlag] }}
                      />
                    )}
                    <ChevronRight className="h-3 w-3 text-muted-foreground shrink-0" />
                  </button>
                ))}
              </CardContent>
            </Card>

            {/* Upcoming arrivals */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Anchor className="h-4 w-4" />
                  Upcoming Arrivals
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-0 space-y-2">
                {(arrivalsData?.arrivals ?? []).map((a, i) => (
                  <div key={i} className="flex items-start gap-2 text-xs">
                    <div
                      className="h-2 w-2 rounded-full mt-1 shrink-0"
                      style={{ background: a.riskFlag ? RISK_COLORS[a.riskFlag] : "#6b7280" }}
                    />
                    <div className="flex-1 min-w-0">
                      <p className="font-medium truncate">{a.vesselName}</p>
                      <p className="text-muted-foreground">{a.berth} · {a.cargoType}</p>
                      <p className="text-muted-foreground">ETA: {formatEta(a.eta)}</p>
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>

          </div>
        </div>
      </div>
    </DashboardLayout>
  );
}
