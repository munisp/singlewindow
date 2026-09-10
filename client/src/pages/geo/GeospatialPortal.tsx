/**
 * TradeGateway Geospatial Portal
 * ==============================
 * Phase 17 rewrite — unified 2D/3D map surface (innovation #1).
 *
 *   - 2D: MapLibre GL JS bundled as a pinned npm dependency (no runtime CDN).
 *   - 3D: CesiumJS bundled via vite-plugin-cesium; Ion-free by default
 *     (OSM imagery + ellipsoid terrain). Cesium Ion world terrain is enabled
 *     ONLY when import.meta.env.VITE_CESIUM_TOKEN is set — an absent token
 *     renders an honest notice instead of firing empty-token Ion requests.
 *   - Live AIS vessel layer + track replay from trpc.geospatial.listVessels /
 *     getVesselTrack with honest stale indicators.
 *   - Declaration/congestion heatmap layer from trpc.geospatial.heatmapData.
 *   - Route/ETA overlay: selected vessel → destination port leg + ETA panel.
 *   - Low-bandwidth mode: raster-only tiles + reduced motion.
 *
 * Tiles/styles/glyphs are env-driven (VITE_MAP_STYLE_URL); production CSP
 * origins are whitelisted via server CSP_CONNECT_SRC_EXTRA (see .env.example).
 */

import { useEffect, useRef, useState, useCallback } from "react";
import "maplibre-gl/dist/maplibre-gl.css";
import { trpc } from "@/lib/trpc";
import {
  GeoVessel,
  VesselTrackingRow,
  toMapVessel,
  vesselsToGeoJSON,
  trackToLineString,
  isFeedStale,
  lowDataRasterStyle,
  resolveMapStyleUrl,
  resolveCesiumIonToken,
} from "@/lib/geo";

// ─── Types ────────────────────────────────────────────────────────────────────

interface Port {
  id: string;
  name: string;
  unlocode: string;
  lat: number;
  lng: number;
  country: string;
  type: string;
}

type MapMode = "2d" | "3d";
type MapLayer = "vessels" | "ports" | "geofences" | "congestion-heatmap";

// ─── Nigerian Ports ───────────────────────────────────────────────────────────

const NIGERIAN_PORTS: Port[] = [
  { id: "apapa",      name: "Apapa Port",          unlocode: "NGAPP", lat: 6.4474,  lng: 3.3903,  country: "NG", type: "seaport" },
  { id: "tincan",     name: "Tin Can Island Port",  unlocode: "NGTCI", lat: 6.4333,  lng: 3.3500,  country: "NG", type: "seaport" },
  { id: "onne",       name: "Onne Port",            unlocode: "NGONE", lat: 4.7167,  lng: 7.1500,  country: "NG", type: "seaport" },
  { id: "warri",      name: "Warri Port",           unlocode: "NGWAR", lat: 5.5167,  lng: 5.7500,  country: "NG", type: "seaport" },
  { id: "calabar",    name: "Calabar Port",         unlocode: "NGCBQ", lat: 4.9500,  lng: 8.3167,  country: "NG", type: "seaport" },
  { id: "lagos-air",  name: "Murtala Muhammed Int'l Airport", unlocode: "NGLOS", lat: 6.5774, lng: 3.3214, country: "NG", type: "airport" },
  { id: "kano-air",   name: "Mallam Aminu Kano Airport", unlocode: "NGKAN", lat: 12.0476, lng: 8.5246, country: "NG", type: "airport" },
];

const CESIUM_ION_TOKEN = resolveCesiumIonToken(import.meta.env.VITE_CESIUM_TOKEN);
const MAP_STYLE_URL = resolveMapStyleUrl(import.meta.env.VITE_MAP_STYLE_URL);

// ─── Component ────────────────────────────────────────────────────────────────

export default function GeospatialPortal() {
  const mapContainer2D = useRef<HTMLDivElement>(null);
  const mapContainer3D = useRef<HTMLDivElement>(null);
  const map2DRef = useRef<any>(null);
  const viewerRef = useRef<any>(null);
  const cesiumRef = useRef<any>(null);
  const [mapMode, setMapMode] = useState<MapMode>("2d");
  const [activeLayers, setActiveLayers] = useState<Set<MapLayer>>(
    new Set(["vessels", "ports", "geofences"])
  );
  const [selectedVessel, setSelectedVessel] = useState<GeoVessel | null>(null);
  const [mapLoaded, setMapLoaded] = useState(false);
  const [cesiumLoaded, setCesiumLoaded] = useState(false);
  const [mapError, setMapError] = useState<string | null>(null);
  const [cesiumError, setCesiumError] = useState<string | null>(null);
  // #8 low-bandwidth / accessibility mode
  const [lowData, setLowData] = useState(false);
  const reducedMotion =
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  // tRPC data — real router data, 30 s polling
  const vessels = trpc.geospatial.listVessels.useQuery(
    { destinationPort: "NGAPP", limit: 200 },
    { refetchInterval: 30_000 }
  );
  const heatmap = trpc.geospatial.heatmapData.useQuery(undefined, { refetchInterval: 30_000 });
  const track = trpc.geospatial.getVesselTrack.useQuery(
    { mmsi: selectedVessel?.mmsi ?? "", limit: 100 },
    { enabled: !!selectedVessel?.mmsi }
  );

  // #2 honest staleness: data older than 90 s is flagged, never presented as live
  const feedStale = isFeedStale(vessels.dataUpdatedAt ? new Date(vessels.dataUpdatedAt) : null);
  const mapVessels: GeoVessel[] = (vessels.data as VesselTrackingRow[] | undefined ?? [])
    .map(toMapVessel)
    .filter((v): v is GeoVessel => v !== null);

  // ─── Load MapLibre GL JS (bundled, pinned) ────────────────────────────────

  useEffect(() => {
    if (typeof window === "undefined") return;
    let cancelled = false;

    const loadMapLibre = async () => {
      try {
        const maplibregl = (await import("maplibre-gl")).default;
        if (cancelled || !mapContainer2D.current || map2DRef.current) return;

        map2DRef.current = new maplibregl.Map({
          container: mapContainer2D.current,
          style: lowData ? (lowDataRasterStyle() as any) : MAP_STYLE_URL,
          center: [3.3903, 6.4474], // Apapa Port, Lagos
          zoom: 8,
          pitch: 0,
          bearing: 0,
          attributionControl: {},
        });

        map2DRef.current.on("load", () => {
          if (cancelled) return;
          setMapLoaded(true);
          addPortLayers();
          addVesselLayers();
          addGeofenceLayers();
          addCongestionHeatmapLayer();
          addTrackLayers();
        });

        map2DRef.current.on("error", (e: any) => {
          if (cancelled) return;
          setMapError(
            `Map tiles unavailable — ${e?.error?.message ?? "tile/style fetch failed"}. ` +
            "Check CSP_CONNECT_SRC_EXTRA whitelist for the configured tile origin."
          );
        });

        map2DRef.current.on("click", "vessels-layer", (e: any) => {
          const feature = e.features?.[0];
          if (feature) setSelectedVessel(feature.properties as GeoVessel);
        });
        map2DRef.current.on("mouseenter", "vessels-layer", () => {
          if (map2DRef.current) map2DRef.current.getCanvas().style.cursor = "pointer";
        });
        map2DRef.current.on("mouseleave", "vessels-layer", () => {
          if (map2DRef.current) map2DRef.current.getCanvas().style.cursor = "";
        });
      } catch (err) {
        if (!cancelled) {
          setMapError(err instanceof Error ? err.message : "Map engine failed to load");
        }
      }
    };

    loadMapLibre();

    return () => {
      cancelled = true;
      if (map2DRef.current) {
        map2DRef.current.remove();
        map2DRef.current = null;
        setMapLoaded(false);
      }
    };
    // lowData switches require a full style reload → remount the map
  }, [lowData]);

  // ─── Load CesiumJS for 3D port-approach view (#3) ─────────────────────────

  useEffect(() => {
    if (mapMode !== "3d" || typeof window === "undefined") return;
    let cancelled = false;

    const loadCesium = async () => {
      try {
        // Lazy-load the SAME-ORIGIN prebuilt Cesium bundle (copied into
        // dist/cesium at build time — CSP script-src 'self' compatible, no
        // runtime CDN). Only fetched when the user opens the 3D view.
        await loadScript("/cesium/Cesium.js");
        await loadStylesheet("/cesium/Widgets/widgets.css");
        const Cesium = (window as any).Cesium;
        if (!Cesium) throw new Error("Cesium bundle loaded but global Cesium is missing");
        if (cancelled) return;
        cesiumRef.current = Cesium;

        // G3: Ion is opt-in. No token → honest Ion-free terrain, never an
        // empty-token request to ion.cesium.com.
        if (CESIUM_ION_TOKEN) {
          Cesium.Ion.defaultAccessToken = CESIUM_ION_TOKEN;
        }

        if (!mapContainer3D.current || viewerRef.current) return;

        viewerRef.current = new Cesium.Viewer(mapContainer3D.current, {
          // Ellipsoid terrain by default; Ion world terrain only when configured.
          terrainProvider: CESIUM_ION_TOKEN
            ? await Cesium.createWorldTerrainAsync()
            : new Cesium.EllipsoidTerrainProvider(),
          baseLayerPicker: false,
          geocoder: false,
          homeButton: false,
          sceneModePicker: false,
          navigationHelpButton: false,
          animation: false,
          timeline: false,
          fullscreenButton: false,
          // OSM imagery as base layer (Cesium 1.117: baseLayer, not imageryProvider)
          baseLayer: new Cesium.ImageryLayer(
            new Cesium.OpenStreetMapImageryProvider({
              url: "https://tile.openstreetmap.org/",
            })
          ),
        });

        viewerRef.current.camera.flyTo({
          destination: Cesium.Cartesian3.fromDegrees(3.3903, 6.4474, 50000),
          orientation: { heading: 0, pitch: Cesium.Math.toRadians(-45), roll: 0 },
          duration: reducedMotion ? 0 : 2,
        });

        NIGERIAN_PORTS.forEach(port => {
          viewerRef.current.entities.add({
            id: `port-${port.id}`,
            name: port.name,
            position: Cesium.Cartesian3.fromDegrees(port.lng, port.lat),
            billboard: {
              image: port.type === "airport"
                ? "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCI+PHBhdGggZmlsbD0iI2ZmYTUwMCIgZD0iTTIxIDMuNWwtOS45IDkuOUwzIDcuNWwxLjUtMS41IDYuNSA0LjUgOC41LTguNXoiLz48L3N2Zz4="
                : "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCI+PGNpcmNsZSBjeD0iMTIiIGN5PSIxMiIgcj0iOCIgZmlsbD0iIzAwN2JmZiIvPjwvc3ZnPg==",
              width: 32,
              height: 32,
            },
            label: {
              text: port.name,
              font: "12px sans-serif",
              fillColor: Cesium.Color.WHITE,
              outlineColor: Cesium.Color.BLACK,
              outlineWidth: 2,
              style: Cesium.LabelStyle.FILL_AND_OUTLINE,
              verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
              pixelOffset: new Cesium.Cartesian2(0, -40),
            },
          });
        });

        if (!cancelled) {
          setCesiumLoaded(true);
          add3DVessels();
        }
      } catch (err) {
        if (!cancelled) {
          setCesiumError(err instanceof Error ? err.message : "3D engine failed to load");
        }
      }
    };

    loadCesium();

    return () => {
      cancelled = true;
      if (viewerRef.current) {
        viewerRef.current.destroy();
        viewerRef.current = null;
        setCesiumLoaded(false);
      }
    };
  }, [mapMode, reducedMotion]);

  // ─── Update vessel positions on data change ───────────────────────────────

  useEffect(() => {
    if (!mapLoaded || !map2DRef.current) return;
    const source = map2DRef.current.getSource("vessels");
    if (source) source.setData(vesselsToGeoJSON(mapVessels));
  }, [vessels.data, mapLoaded]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!cesiumLoaded || !viewerRef.current) return;
    add3DVessels();
  }, [vessels.data, cesiumLoaded]); // eslint-disable-line react-hooks/exhaustive-deps

  // #4 congestion heatmap data → MapLibre heatmap source
  useEffect(() => {
    if (!mapLoaded || !map2DRef.current || !heatmap.data) return;
    const source = map2DRef.current.getSource("congestion");
    if (!source) return;
    source.setData({
      type: "FeatureCollection",
      features: heatmap.data.map(p => ({
        type: "Feature" as const,
        geometry: { type: "Point" as const, coordinates: [p.lng, p.lat] },
        properties: { weight: p.weight, portName: p.portName, status: p.congestionStatus },
      })),
    });
  }, [heatmap.data, mapLoaded]);

  // #2/#7 track replay + route overlay when a vessel is selected
  useEffect(() => {
    if (!mapLoaded || !map2DRef.current) return;
    const map = map2DRef.current;

    const trackSource = map.getSource("vessel-track");
    const rows = (track.data as VesselTrackingRow[] | undefined) ?? [];
    // getVesselTrack returns newest-first; reverse to oldest-first for replay
    const line = trackToLineString([...rows].reverse());
    if (trackSource) {
      trackSource.setData(
        line ?? { type: "FeatureCollection", features: [] }
      );
    }

    // Route/ETA overlay: leg from current position to destination port
    const routeSource = map.getSource("vessel-route");
    if (routeSource) {
      const dest = selectedVessel?.destination_port
        ? NIGERIAN_PORTS.find(p => p.unlocode === selectedVessel.destination_port)
        : undefined;
      routeSource.setData(
        selectedVessel && dest
          ? {
              type: "Feature",
              geometry: {
                type: "LineString",
                coordinates: [
                  [selectedVessel.lng, selectedVessel.lat],
                  [dest.lng, dest.lat],
                ],
              },
              properties: { destination: dest.name },
            }
          : { type: "FeatureCollection", features: [] }
      );
    }
  }, [track.data, selectedVessel, mapLoaded]);

  // ─── MapLibre Layer Functions ─────────────────────────────────────────────

  const addPortLayers = useCallback(() => {
    if (!map2DRef.current) return;
    const map = map2DRef.current;

    map.addSource("ports", {
      type: "geojson",
      data: {
        type: "FeatureCollection",
        features: NIGERIAN_PORTS.map(port => ({
          type: "Feature",
          geometry: { type: "Point", coordinates: [port.lng, port.lat] },
          properties: port,
        })),
      },
    });

    map.addLayer({
      id: "ports-layer",
      type: "circle",
      source: "ports",
      paint: {
        "circle-radius": 10,
        "circle-color": ["match", ["get", "type"], "airport", "#ff9800", "#007bff"],
        "circle-stroke-width": 2,
        "circle-stroke-color": "#ffffff",
      },
    });

    map.addLayer({
      id: "ports-labels",
      type: "symbol",
      source: "ports",
      layout: {
        "text-field": ["get", "name"],
        "text-size": 11,
        "text-offset": [0, 1.5],
        "text-anchor": "top",
      },
      paint: {
        "text-color": "#1a1a2e",
        "text-halo-color": "#ffffff",
        "text-halo-width": 1,
      },
    });
  }, []);

  const addVesselLayers = useCallback(() => {
    if (!map2DRef.current) return;
    const map = map2DRef.current;

    map.addSource("vessels", {
      type: "geojson",
      data: { type: "FeatureCollection", features: [] },
    });

    map.addLayer({
      id: "vessels-layer",
      type: "circle",
      source: "vessels",
      paint: {
        "circle-radius": 6,
        "circle-color": "#28a745",
        "circle-stroke-width": 2,
        "circle-stroke-color": "#ffffff",
      },
    });

    map.addLayer({
      id: "vessels-labels",
      type: "symbol",
      source: "vessels",
      layout: {
        "text-field": ["get", "name"],
        "text-size": 10,
        "text-offset": [0, 1.4],
        "text-anchor": "top",
      },
      paint: {
        "text-color": "#1a1a2e",
        "text-halo-color": "#ffffff",
        "text-halo-width": 1,
      },
    });
  }, []);

  const addGeofenceLayers = useCallback(() => {
    if (!map2DRef.current) return;
    const map = map2DRef.current;

    map.addSource("geofences", {
      type: "geojson",
      data: {
        type: "FeatureCollection",
        features: [
          {
            type: "Feature",
            geometry: {
              type: "Polygon",
              coordinates: [[
                [2.7, 3.5], [14.5, 3.5], [14.5, 9.5], [2.7, 9.5], [2.7, 3.5]
              ]],
            },
            properties: { name: "Nigeria EEZ", type: "eez" },
          },
          {
            type: "Feature",
            geometry: {
              type: "Polygon",
              coordinates: [[
                [3.2, 6.2], [3.6, 6.2], [3.6, 6.7], [3.2, 6.7], [3.2, 6.2]
              ]],
            },
            properties: { name: "Lagos Port Zone", type: "port-zone" },
          },
        ],
      },
    });

    map.addLayer({
      id: "geofences-fill",
      type: "fill",
      source: "geofences",
      paint: {
        "fill-color": ["match", ["get", "type"],
          "eez", "#007bff",
          "port-zone", "#28a745",
          "#6c757d"
        ],
        "fill-opacity": 0.1,
      },
    });

    map.addLayer({
      id: "geofences-outline",
      type: "line",
      source: "geofences",
      paint: {
        "line-color": ["match", ["get", "type"],
          "eez", "#007bff",
          "port-zone", "#28a745",
          "#6c757d"
        ],
        "line-width": 2,
        "line-dasharray": [4, 2],
      },
    });
  }, []);

  const addCongestionHeatmapLayer = useCallback(() => {
    if (!map2DRef.current) return;
    const map = map2DRef.current;

    map.addSource("congestion", {
      type: "geojson",
      data: { type: "FeatureCollection", features: [] },
    });

    map.addLayer({
      id: "congestion-heatmap-layer",
      type: "heatmap",
      source: "congestion",
      paint: {
        "heatmap-weight": ["interpolate", ["linear"], ["get", "weight"], 0, 0, 1, 1],
        "heatmap-intensity": ["interpolate", ["linear"], ["zoom"], 0, 1, 9, 3],
        "heatmap-radius": ["interpolate", ["linear"], ["zoom"], 0, 10, 9, 40],
        "heatmap-opacity": 0.6,
        "heatmap-color": [
          "interpolate", ["linear"], ["heatmap-density"],
          0, "rgba(0,255,0,0)",
          0.3, "rgba(0,255,0,1)",
          0.6, "rgba(255,255,0,1)",
          0.8, "rgba(255,165,0,1)",
          1, "rgba(255,0,0,1)",
        ],
      },
    });
  }, []);

  const addTrackLayers = useCallback(() => {
    if (!map2DRef.current) return;
    const map = map2DRef.current;

    map.addSource("vessel-track", {
      type: "geojson",
      data: { type: "FeatureCollection", features: [] },
    });
    map.addLayer({
      id: "vessel-track-layer",
      type: "line",
      source: "vessel-track",
      paint: {
        "line-color": "#007bff",
        "line-width": 2,
        "line-dasharray": [2, 2],
      },
    });

    map.addSource("vessel-route", {
      type: "geojson",
      data: { type: "FeatureCollection", features: [] },
    });
    map.addLayer({
      id: "vessel-route-layer",
      type: "line",
      source: "vessel-route",
      paint: {
        "line-color": "#ff9800",
        "line-width": 2,
        "line-dasharray": [6, 4],
      },
    });
  }, []);

  // ─── CesiumJS 3D Vessel Functions ─────────────────────────────────────────

  const add3DVessels = useCallback(() => {
    if (!viewerRef.current || !cesiumRef.current) return;
    const viewer = viewerRef.current;
    const Cesium = cesiumRef.current;
    const rows = (vessels.data as VesselTrackingRow[] | undefined) ?? [];

    const toRemove = viewer.entities.values.filter((e: any) => e.id?.startsWith("vessel-"));
    toRemove.forEach((e: any) => viewer.entities.remove(e));

    rows.map(toMapVessel).filter((v): v is GeoVessel => v !== null).forEach(vessel => {
      viewer.entities.add({
        id: `vessel-${vessel.id}`,
        name: vessel.name,
        position: Cesium.Cartesian3.fromDegrees(vessel.lng, vessel.lat, 0),
        box: {
          dimensions: new Cesium.Cartesian3(200, 50, 20),
          material: vessel.status === "underway"
            ? Cesium.Color.fromCssColorString("#28a745").withAlpha(0.8)
            : Cesium.Color.fromCssColorString("#ffc107").withAlpha(0.8),
          outline: true,
          outlineColor: Cesium.Color.WHITE,
        },
        label: {
          text: `${vessel.name}\n${vessel.speed} kn`,
          font: "12px sans-serif",
          fillColor: Cesium.Color.WHITE,
          outlineColor: Cesium.Color.BLACK,
          outlineWidth: 2,
          style: Cesium.LabelStyle.FILL_AND_OUTLINE,
          verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
          pixelOffset: new Cesium.Cartesian2(0, -30),
        },
      });
    });
  }, [vessels.data]);

  // ─── Layer Toggle ─────────────────────────────────────────────────────────

  const toggleLayer = (layer: MapLayer) => {
    setActiveLayers(prev => {
      const next = new Set(prev);
      if (next.has(layer)) {
        next.delete(layer);
      } else {
        next.add(layer);
      }

      if (map2DRef.current && mapLoaded) {
        const layerMap: Record<MapLayer, string[]> = {
          vessels: ["vessels-layer", "vessels-labels"],
          ports: ["ports-layer", "ports-labels"],
          geofences: ["geofences-fill", "geofences-outline"],
          "congestion-heatmap": ["congestion-heatmap-layer"],
        };
        const visibility = next.has(layer) ? "visible" : "none";
        layerMap[layer]?.forEach(id => {
          if (map2DRef.current.getLayer(id)) {
            map2DRef.current.setLayoutProperty(id, "visibility", visibility);
          }
        });
      }
      return next;
    });
  };

  // ─── Helpers ──────────────────────────────────────────────────────────────

  // Same-origin script/stylesheet loaders with error propagation (CSP-safe).
  const loadScript = (src: string): Promise<void> =>
    new Promise((resolve, reject) => {
      if (document.querySelector(`script[src="${src}"]`)) return resolve();
      const script = document.createElement("script");
      script.src = src;
      script.onload = () => resolve();
      script.onerror = () => reject(new Error(`Failed to load ${src}`));
      document.head.appendChild(script);
    });

  const loadStylesheet = (href: string): Promise<void> =>
    new Promise((resolve, reject) => {
      if (document.querySelector(`link[href="${href}"]`)) return resolve();
      const link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = href;
      link.onload = () => resolve();
      link.onerror = () => reject(new Error(`Failed to load ${href}`));
      document.head.appendChild(link);
    });

  // ─── Render ───────────────────────────────────────────────────────────────

  const LAYER_LABELS: Record<MapLayer, string> = {
    vessels: "Live vessels (AIS)",
    ports: "Ports",
    geofences: "Geofence zones",
    "congestion-heatmap": "Congestion heatmap",
  };

  return (
    <div className="flex flex-col h-screen bg-gray-900">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2 bg-gray-800 border-b border-gray-700">
        <div>
          <h1 className="text-white font-bold text-lg">TradeGateway Geospatial Portal</h1>
          <p className="text-gray-400 text-xs">MapLibre GL JS (2D) + CesiumJS (3D) — bundled, no runtime CDN</p>
        </div>
        <div className="flex items-center gap-3">
          {/* #2 honest stale indicator */}
          {vessels.data && feedStale && (
            <span role="status" className="text-amber-400 text-xs font-medium">
              AIS data stale (&gt;90 s) — positions may be outdated
            </span>
          )}
          {vessels.isError && (
            <span role="alert" className="text-red-400 text-xs font-medium">
              Vessel feed unavailable
            </span>
          )}

          {/* #8 low-bandwidth toggle (2D) */}
          <button
            onClick={() => setLowData(v => !v)}
            aria-pressed={lowData}
            className={`px-3 py-1 rounded text-xs font-medium transition-colors ${
              lowData ? "bg-amber-600 text-white" : "bg-gray-700 text-gray-300 hover:text-white"
            }`}
          >
            Low-data mode
          </button>

          {/* Mode Toggle */}
          <div className="flex bg-gray-700 rounded-lg p-1" role="group" aria-label="Map engine">
            <button
              onClick={() => setMapMode("2d")}
              aria-pressed={mapMode === "2d"}
              className={`px-3 py-1 rounded text-sm font-medium transition-colors ${
                mapMode === "2d" ? "bg-blue-600 text-white" : "text-gray-300 hover:text-white"
              }`}
            >
              2D MapLibre
            </button>
            <button
              onClick={() => setMapMode("3d")}
              aria-pressed={mapMode === "3d"}
              className={`px-3 py-1 rounded text-sm font-medium transition-colors ${
                mapMode === "3d" ? "bg-blue-600 text-white" : "text-gray-300 hover:text-white"
              }`}
            >
              3D CesiumJS
            </button>
          </div>

          {/* Vessel count */}
          <div className="text-gray-300 text-sm" aria-live="polite">
            <span className="text-green-400 font-bold">{mapVessels.length}</span> vessels tracked
          </div>
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* Layer Controls Sidebar */}
        <div className="w-56 bg-gray-800 border-r border-gray-700 p-3 flex flex-col gap-2 overflow-y-auto">
          <h3 className="text-gray-300 text-xs font-semibold uppercase tracking-wider mb-1">Layers</h3>
          {(Object.keys(LAYER_LABELS) as MapLayer[]).map(layer => (
            <label key={layer} className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={activeLayers.has(layer)}
                onChange={() => toggleLayer(layer)}
                aria-label={LAYER_LABELS[layer]}
                className="rounded"
              />
              <span className="text-gray-300 text-sm">{LAYER_LABELS[layer]}</span>
            </label>
          ))}

          <div className="border-t border-gray-700 mt-2 pt-2">
            <h3 className="text-gray-300 text-xs font-semibold uppercase tracking-wider mb-2">Nigerian Ports</h3>
            {NIGERIAN_PORTS.map(port => (
              <button
                key={port.id}
                onClick={() => {
                  if (mapMode === "2d" && map2DRef.current) {
                    map2DRef.current.flyTo({
                      center: [port.lng, port.lat],
                      zoom: 13,
                      duration: reducedMotion ? 0 : 1500,
                    });
                  } else if (viewerRef.current && cesiumRef.current) {
                    viewerRef.current.camera.flyTo({
                      destination: cesiumRef.current.Cartesian3.fromDegrees(port.lng, port.lat, 5000),
                      duration: reducedMotion ? 0 : 2,
                    });
                  }
                }}
                className="w-full text-left text-xs text-gray-400 hover:text-blue-400 py-1 px-1 rounded hover:bg-gray-700 transition-colors"
              >
                {port.type === "airport" ? "✈" : "⚓"} {port.name}
              </button>
            ))}
          </div>
        </div>

        {/* Map Area */}
        <div className="flex-1 relative">
          {/* 2D MapLibre Map */}
          <div
            ref={mapContainer2D}
            role="region"
            aria-label="2D map — vessels, ports, geofences, congestion heatmap"
            className={`absolute inset-0 ${mapMode === "2d" ? "block" : "hidden"}`}
          />

          {/* 3D CesiumJS Viewer */}
          <div
            ref={mapContainer3D}
            role="region"
            aria-label="3D port approach view"
            className={`absolute inset-0 ${mapMode === "3d" ? "block" : "hidden"}`}
          />

          {/* 2D error / loading overlays */}
          {mapError && mapMode === "2d" && (
            <div role="alert" className="absolute inset-0 flex items-center justify-center bg-gray-900">
              <div className="text-center max-w-md px-6">
                <p className="text-red-400 font-semibold mb-2">Map unavailable</p>
                <p className="text-gray-400 text-sm">{mapError}</p>
              </div>
            </div>
          )}
          {!mapLoaded && !mapError && mapMode === "2d" && (
            <div className="absolute inset-0 flex items-center justify-center bg-gray-900" aria-busy="true">
              <div className="text-white text-center">
                <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500 mx-auto mb-3" />
                <p>Loading MapLibre GL JS…</p>
              </div>
            </div>
          )}

          {/* 3D error / Ion notice overlays */}
          {cesiumError && mapMode === "3d" && (
            <div role="alert" className="absolute inset-0 flex items-center justify-center bg-gray-900">
              <div className="text-center max-w-md px-6">
                <p className="text-red-400 font-semibold mb-2">3D view unavailable</p>
                <p className="text-gray-400 text-sm">{cesiumError}</p>
              </div>
            </div>
          )}
          {!cesiumError && !CESIUM_ION_TOKEN && mapMode === "3d" && cesiumLoaded && (
            <div role="status" className="absolute top-2 left-2 bg-gray-800/90 text-gray-300 text-xs px-3 py-1.5 rounded border border-gray-600">
              Cesium Ion token not configured — using open OSM imagery and ellipsoid terrain.
            </div>
          )}

          {/* Empty-vessel honesty state */}
          {mapLoaded && vessels.data && mapVessels.length === 0 && !vessels.isError && (
            <div role="status" className="absolute top-2 left-2 bg-gray-800/90 text-gray-300 text-xs px-3 py-1.5 rounded border border-gray-600">
              No live AIS positions for the selected filter.
            </div>
          )}

          {/* Selected Vessel Panel (#2 track + #7 ETA) */}
          {selectedVessel && (
            <div className="absolute top-4 right-4 bg-gray-800 rounded-lg shadow-xl p-4 w-72 border border-gray-600">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-white font-semibold">⚓ {selectedVessel.name}</h3>
                <button
                  onClick={() => setSelectedVessel(null)}
                  aria-label="Close vessel panel"
                  className="text-gray-400 hover:text-white"
                >
                  ✕
                </button>
              </div>
              <div className="space-y-1 text-sm">
                {([
                  ["MMSI", selectedVessel.mmsi],
                  ["IMO", selectedVessel.imo || "—"],
                  ["Status", selectedVessel.status],
                  ["Speed", `${selectedVessel.speed} kn`],
                  ["Heading", `${selectedVessel.heading}°`],
                  ["Cargo", selectedVessel.cargo_type],
                  ["Destination", selectedVessel.destination_port ?? "—"],
                  ["ETA", selectedVessel.eta ? new Date(selectedVessel.eta).toLocaleString() : "—"],
                ] as [string, string][]).map(([label, value]) => (
                  <div key={label} className="flex justify-between">
                    <span className="text-gray-400">{label}:</span>
                    <span className="text-white font-medium">{value}</span>
                  </div>
                ))}
              </div>
              <p className="mt-2 text-xs text-gray-500">
                {track.isLoading
                  ? "Loading track history…"
                  : track.data && track.data.length > 1
                    ? `Track replay: ${track.data.length} recorded positions (dashed blue).`
                    : "No recorded track for this vessel."}
              </p>
            </div>
          )}

          {/* Map Attribution */}
          <div role="contentinfo" className="absolute bottom-2 left-2 text-gray-500 text-xs">
            {mapMode === "2d"
              ? lowData
                ? "© OpenStreetMap contributors (low-data raster)"
                : "© OpenFreeMap | MapLibre GL JS | © OpenStreetMap contributors"
              : "© CesiumJS | © OpenStreetMap contributors"}
          </div>
        </div>
      </div>
    </div>
  );
}
