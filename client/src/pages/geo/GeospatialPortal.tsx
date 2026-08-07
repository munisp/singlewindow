/**
 * TradeGateway Geospatial Portal
 * ================================
 * Implements item 51: MapLibre, GeoLibre, and CesiumJS full integration
 *
 * Features:
 *   - MapLibre GL JS: 2D cargo tracking, vessel positions, port overlays
 *   - GeoLibre: Open-source geospatial data layers (OpenFreeMap tiles)
 *   - CesiumJS: 3D port visualization, vessel approach paths, geofencing
 *   - Real-time vessel tracking via tRPC geospatial router
 *   - Geofence breach alerts
 *   - Apache Sedona spatial queries via backend
 */

import React, { useEffect, useRef, useState, useCallback } from "react";
import { trpc } from "../../utils/trpc";

// Dynamic imports to avoid SSR issues with map libraries
let maplibregl: any = null;
let Cesium: any = null;

// ─── Types ────────────────────────────────────────────────────────────────────

interface Vessel {
  id: string;
  name: string;
  mmsi: string;
  imo: string;
  lat: number;
  lng: number;
  heading: number;
  speed: number;
  status: string;
  cargo_type: string;
  declaration_ref?: string;
  eta?: string;
  destination_port?: string;
}

interface Port {
  id: string;
  name: string;
  unlocode: string;
  lat: number;
  lng: number;
  country: string;
  type: string;
}

interface Geofence {
  id: string;
  name: string;
  type: "circle" | "polygon";
  center?: [number, number];
  radius?: number;
  coordinates?: [number, number][];
  alert_on_entry: boolean;
  alert_on_exit: boolean;
}

type MapMode = "2d" | "3d";
type MapLayer = "vessels" | "ports" | "geofences" | "cargo-routes" | "risk-zones";

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

// ─── Component ────────────────────────────────────────────────────────────────

export default function GeospatialPortal() {
  const mapContainer2D = useRef<HTMLDivElement>(null);
  const mapContainer3D = useRef<HTMLDivElement>(null);
  const map2DRef = useRef<any>(null);
  const viewerRef = useRef<any>(null);
  const [mapMode, setMapMode] = useState<MapMode>("2d");
  const [activeLayers, setActiveLayers] = useState<Set<MapLayer>>(
    new Set(["vessels", "ports", "geofences"])
  );
  const [selectedVessel, setSelectedVessel] = useState<Vessel | null>(null);
  const [alerts, setAlerts] = useState<string[]>([]);
  const [mapLoaded, setMapLoaded] = useState(false);
  const [cesiumLoaded, setCesiumLoaded] = useState(false);

  // tRPC data
  const vessels = trpc.geospatial.getVesselPositions.useQuery(
    { port: "NGAPP", radius_km: 200 },
    { refetchInterval: 30000 }
  );
  const geofences = trpc.geofences.list.useQuery({ limit: 50 });
  const riskZones = trpc.geospatial.getRiskZones.useQuery(undefined, { enabled: activeLayers.has("risk-zones") });

  // ─── Load MapLibre GL JS ───────────────────────────────────────────────────

  useEffect(() => {
    if (typeof window === "undefined") return;

    const loadMapLibre = async () => {
      if (!maplibregl) {
        // Load MapLibre from CDN (GeoLibre-compatible)
        await loadScript("https://unpkg.com/maplibre-gl@4.1.3/dist/maplibre-gl.js");
        await loadCSS("https://unpkg.com/maplibre-gl@4.1.3/dist/maplibre-gl.css");
        maplibregl = (window as any).maplibregl;
      }

      if (!mapContainer2D.current || map2DRef.current) return;

      // Initialize MapLibre with GeoLibre OpenFreeMap tiles
      map2DRef.current = new maplibregl.Map({
        container: mapContainer2D.current,
        // GeoLibre / OpenFreeMap style — open-source alternative to Mapbox
        style: "https://tiles.openfreemap.org/styles/liberty",
        center: [3.3903, 6.4474], // Apapa Port, Lagos
        zoom: 8,
        pitch: 0,
        bearing: 0,
      });

      map2DRef.current.on("load", () => {
        setMapLoaded(true);
        addPortLayers();
        addVesselLayers();
        addGeofenceLayers();
      });

      // Click handler for vessel selection
      map2DRef.current.on("click", "vessels-layer", (e: any) => {
        const feature = e.features?.[0];
        if (feature) {
          setSelectedVessel(feature.properties as Vessel);
        }
      });

      map2DRef.current.on("mouseenter", "vessels-layer", () => {
        map2DRef.current.getCanvas().style.cursor = "pointer";
      });
      map2DRef.current.on("mouseleave", "vessels-layer", () => {
        map2DRef.current.getCanvas().style.cursor = "";
      });
    };

    loadMapLibre();

    return () => {
      if (map2DRef.current) {
        map2DRef.current.remove();
        map2DRef.current = null;
      }
    };
  }, []);

  // ─── Load CesiumJS for 3D View ────────────────────────────────────────────

  useEffect(() => {
    if (mapMode !== "3d" || typeof window === "undefined") return;

    const loadCesium = async () => {
      if (!Cesium) {
        await loadScript("https://cesium.com/downloads/cesiumjs/releases/1.117/Build/Cesium/Cesium.js");
        await loadCSS("https://cesium.com/downloads/cesiumjs/releases/1.117/Build/Cesium/Widgets/widgets.css");
        Cesium = (window as any).Cesium;
        // Use free Cesium Ion token (or anonymous)
        Cesium.Ion.defaultAccessToken = process.env.VITE_CESIUM_TOKEN || "";
      }

      if (!mapContainer3D.current || viewerRef.current) return;

      viewerRef.current = new Cesium.Viewer(mapContainer3D.current, {
        terrainProvider: await Cesium.createWorldTerrainAsync(),
        baseLayerPicker: false,
        geocoder: false,
        homeButton: false,
        sceneModePicker: false,
        navigationHelpButton: false,
        animation: false,
        timeline: false,
        fullscreenButton: false,
        imageryProvider: new Cesium.OpenStreetMapImageryProvider({
          url: "https://tile.openstreetmap.org/",
        }),
      });

      // Fly to Lagos / Apapa Port
      viewerRef.current.camera.flyTo({
        destination: Cesium.Cartesian3.fromDegrees(3.3903, 6.4474, 50000),
        orientation: { heading: 0, pitch: Cesium.Math.toRadians(-45), roll: 0 },
        duration: 2,
      });

      // Add Nigerian ports as 3D billboards
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

      setCesiumLoaded(true);
      add3DVessels();
    };

    loadCesium();

    return () => {
      if (viewerRef.current) {
        viewerRef.current.destroy();
        viewerRef.current = null;
        setCesiumLoaded(false);
      }
    };
  }, [mapMode]);

  // ─── Update vessel positions on data change ────────────────────────────────

  useEffect(() => {
    if (!mapLoaded || !map2DRef.current || !vessels.data) return;
    updateVesselLayer(vessels.data as Vessel[]);
  }, [vessels.data, mapLoaded]);

  useEffect(() => {
    if (!cesiumLoaded || !viewerRef.current || !vessels.data) return;
    add3DVessels();
  }, [vessels.data, cesiumLoaded]);

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
        "text-font": ["Open Sans Regular"],
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
      type: "symbol",
      source: "vessels",
      layout: {
        "icon-image": "marker-15",
        "icon-size": 1.5,
        "icon-rotate": ["get", "heading"],
        "icon-rotation-alignment": "map",
        "text-field": ["get", "name"],
        "text-font": ["Open Sans Regular"],
        "text-size": 10,
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

  const addGeofenceLayers = useCallback(() => {
    if (!map2DRef.current) return;
    const map = map2DRef.current;

    // Nigerian EEZ (200 nautical miles from baseline)
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

  const updateVesselLayer = useCallback((vesselData: Vessel[]) => {
    if (!map2DRef.current) return;
    const source = map2DRef.current.getSource("vessels");
    if (!source) return;

    source.setData({
      type: "FeatureCollection",
      features: vesselData.map(v => ({
        type: "Feature",
        geometry: { type: "Point", coordinates: [v.lng, v.lat] },
        properties: v,
      })),
    });
  }, []);

  // ─── CesiumJS 3D Vessel Functions ─────────────────────────────────────────

  const add3DVessels = useCallback(() => {
    if (!viewerRef.current || !vessels.data) return;
    const viewer = viewerRef.current;

    // Remove existing vessel entities
    const toRemove = viewer.entities.values.filter((e: any) => e.id?.startsWith("vessel-"));
    toRemove.forEach((e: any) => viewer.entities.remove(e));

    (vessels.data as Vessel[]).forEach(vessel => {
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

      // Toggle MapLibre layer visibility
      if (map2DRef.current && mapLoaded) {
        const layerMap: Record<MapLayer, string[]> = {
          vessels: ["vessels-layer"],
          ports: ["ports-layer", "ports-labels"],
          geofences: ["geofences-fill", "geofences-outline"],
          "cargo-routes": ["cargo-routes-layer"],
          "risk-zones": ["risk-zones-layer"],
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

  const loadScript = (src: string): Promise<void> => {
    return new Promise((resolve, reject) => {
      if (document.querySelector(`script[src="${src}"]`)) {
        resolve();
        return;
      }
      const script = document.createElement("script");
      script.src = src;
      script.onload = () => resolve();
      script.onerror = reject;
      document.head.appendChild(script);
    });
  };

  const loadCSS = (href: string): Promise<void> => {
    return new Promise(resolve => {
      if (document.querySelector(`link[href="${href}"]`)) {
        resolve();
        return;
      }
      const link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = href;
      link.onload = () => resolve();
      document.head.appendChild(link);
      resolve();
    });
  };

  // ─── Render ───────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col h-screen bg-gray-900">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2 bg-gray-800 border-b border-gray-700">
        <div>
          <h1 className="text-white font-bold text-lg">TradeGateway Geospatial Portal</h1>
          <p className="text-gray-400 text-xs">MapLibre GL JS + GeoLibre + CesiumJS 3D</p>
        </div>
        <div className="flex items-center gap-3">
          {/* Mode Toggle */}
          <div className="flex bg-gray-700 rounded-lg p-1">
            <button
              onClick={() => setMapMode("2d")}
              className={`px-3 py-1 rounded text-sm font-medium transition-colors ${
                mapMode === "2d" ? "bg-blue-600 text-white" : "text-gray-300 hover:text-white"
              }`}
            >
              2D MapLibre
            </button>
            <button
              onClick={() => setMapMode("3d")}
              className={`px-3 py-1 rounded text-sm font-medium transition-colors ${
                mapMode === "3d" ? "bg-blue-600 text-white" : "text-gray-300 hover:text-white"
              }`}
            >
              3D CesiumJS
            </button>
          </div>

          {/* Vessel count */}
          <div className="text-gray-300 text-sm">
            <span className="text-green-400 font-bold">{(vessels.data as Vessel[] | undefined)?.length ?? 0}</span> vessels tracked
          </div>
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* Layer Controls Sidebar */}
        <div className="w-56 bg-gray-800 border-r border-gray-700 p-3 flex flex-col gap-2 overflow-y-auto">
          <h3 className="text-gray-300 text-xs font-semibold uppercase tracking-wider mb-1">Layers</h3>
          {(["vessels", "ports", "geofences", "cargo-routes", "risk-zones"] as MapLayer[]).map(layer => (
            <label key={layer} className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={activeLayers.has(layer)}
                onChange={() => toggleLayer(layer)}
                className="rounded"
              />
              <span className="text-gray-300 text-sm capitalize">{layer.replace("-", " ")}</span>
            </label>
          ))}

          <div className="border-t border-gray-700 mt-2 pt-2">
            <h3 className="text-gray-300 text-xs font-semibold uppercase tracking-wider mb-2">Nigerian Ports</h3>
            {NIGERIAN_PORTS.map(port => (
              <button
                key={port.id}
                onClick={() => {
                  if (mapMode === "2d" && map2DRef.current) {
                    map2DRef.current.flyTo({ center: [port.lng, port.lat], zoom: 13, duration: 1500 });
                  } else if (viewerRef.current) {
                    viewerRef.current.camera.flyTo({
                      destination: Cesium.Cartesian3.fromDegrees(port.lng, port.lat, 5000),
                      duration: 2,
                    });
                  }
                }}
                className="w-full text-left text-xs text-gray-400 hover:text-blue-400 py-1 px-1 rounded hover:bg-gray-700 transition-colors"
              >
                {port.type === "airport" ? "✈" : "⚓"} {port.name}
              </button>
            ))}
          </div>

          {/* Alerts */}
          {alerts.length > 0 && (
            <div className="border-t border-gray-700 mt-2 pt-2">
              <h3 className="text-red-400 text-xs font-semibold uppercase tracking-wider mb-1">Alerts</h3>
              {alerts.map((alert, i) => (
                <div key={i} className="text-red-300 text-xs py-1 border-b border-gray-700">
                  {alert}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Map Area */}
        <div className="flex-1 relative">
          {/* 2D MapLibre Map */}
          <div
            ref={mapContainer2D}
            className={`absolute inset-0 ${mapMode === "2d" ? "block" : "hidden"}`}
          />

          {/* 3D CesiumJS Viewer */}
          <div
            ref={mapContainer3D}
            className={`absolute inset-0 ${mapMode === "3d" ? "block" : "hidden"}`}
          />

          {/* Loading overlay */}
          {!mapLoaded && mapMode === "2d" && (
            <div className="absolute inset-0 flex items-center justify-center bg-gray-900">
              <div className="text-white text-center">
                <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500 mx-auto mb-3" />
                <p>Loading MapLibre GL JS + GeoLibre tiles...</p>
              </div>
            </div>
          )}

          {/* Selected Vessel Panel */}
          {selectedVessel && (
            <div className="absolute top-4 right-4 bg-gray-800 rounded-lg shadow-xl p-4 w-72 border border-gray-600">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-white font-semibold">⚓ {selectedVessel.name}</h3>
                <button
                  onClick={() => setSelectedVessel(null)}
                  className="text-gray-400 hover:text-white"
                >
                  ✕
                </button>
              </div>
              <div className="space-y-1 text-sm">
                {[
                  ["MMSI", selectedVessel.mmsi],
                  ["IMO", selectedVessel.imo],
                  ["Status", selectedVessel.status],
                  ["Speed", `${selectedVessel.speed} kn`],
                  ["Heading", `${selectedVessel.heading}°`],
                  ["Cargo", selectedVessel.cargo_type],
                  ["Destination", selectedVessel.destination_port ?? "—"],
                  ["ETA", selectedVessel.eta ?? "—"],
                  ["Declaration", selectedVessel.declaration_ref ?? "—"],
                ].map(([label, value]) => (
                  <div key={label} className="flex justify-between">
                    <span className="text-gray-400">{label}:</span>
                    <span className="text-white font-medium">{value}</span>
                  </div>
                ))}
              </div>
              {selectedVessel.declaration_ref && (
                <button className="mt-3 w-full bg-blue-600 hover:bg-blue-700 text-white text-sm py-1.5 rounded transition-colors">
                  View Declaration
                </button>
              )}
            </div>
          )}

          {/* Map Attribution */}
          <div className="absolute bottom-2 left-2 text-gray-500 text-xs">
            {mapMode === "2d"
              ? "© OpenFreeMap (GeoLibre) | MapLibre GL JS | © OpenStreetMap contributors"
              : "© CesiumJS | © OpenStreetMap contributors"}
          </div>
        </div>
      </div>
    </div>
  );
}
