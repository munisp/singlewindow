/**
 * Phase 17 — shared geospatial helpers (pure, unit-tested).
 *
 * Fail-closed doctrine: every helper returns explicit "unavailable" signals
 * (null / empty / stale flags) instead of fabricating coordinates. Map style
 * and tile origins are env-driven so operators can point at a same-origin
 * tile proxy in sovereign deployments (see CSP_*_EXTRA server env vars).
 */

export interface GeoVessel {
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

/** Row shape returned by trpc.geospatial.listVessels / getVesselTrack. */
export interface VesselTrackingRow {
  id: number;
  mmsi: string;
  vesselName: string | null;
  imoNumber: string | null;
  latitude: number;
  longitude: number;
  speed: number | null;
  heading: number | null;
  destinationPort: string | null;
  eta: Date | string | null;
  cargoType: string | null;
  flagCountry: string | null;
  recordedAt: Date | string;
}

/** Convert a DB vessel row to a map vessel; invalid coordinates are dropped. */
export function toMapVessel(row: VesselTrackingRow): GeoVessel | null {
  if (!Number.isFinite(row.latitude) || !Number.isFinite(row.longitude)) return null;
  if (Math.abs(row.latitude) > 90 || Math.abs(row.longitude) > 180) return null;
  return {
    id: String(row.id),
    name: row.vesselName ?? row.mmsi,
    mmsi: row.mmsi,
    imo: row.imoNumber ?? "",
    lat: row.latitude,
    lng: row.longitude,
    heading: row.heading ?? 0,
    speed: row.speed ?? 0,
    status: "underway",
    cargo_type: row.cargoType ?? "unknown",
    declaration_ref: row.destinationPort ?? undefined,
    destination_port: row.destinationPort ?? undefined,
    eta: row.eta ? new Date(row.eta).toISOString() : undefined,
  };
}

export function vesselsToGeoJSON(vessels: GeoVessel[]) {
  return {
    type: "FeatureCollection" as const,
    features: vessels.map(v => ({
      type: "Feature" as const,
      geometry: { type: "Point" as const, coordinates: [v.lng, v.lat] },
      properties: { ...v },
    })),
  };
}

/** Vessel track (oldest → newest) as a GeoJSON LineString for replay overlays. */
export function trackToLineString(
  rows: Array<{ latitude: number; longitude: number }>,
) {
  const coords = rows
    .filter(r => Number.isFinite(r.latitude) && Number.isFinite(r.longitude))
    .map(r => [r.longitude, r.latitude] as [number, number]);
  if (coords.length < 2) return null;
  return {
    type: "Feature" as const,
    geometry: { type: "LineString" as const, coordinates: coords },
    properties: {},
  };
}

/** Honest staleness: true when the last AIS update is older than maxAgeMs. */
export function isFeedStale(lastUpdated: Date | string | null, now = Date.now(), maxAgeMs = 90_000): boolean {
  if (!lastUpdated) return true;
  const t = new Date(lastUpdated).getTime();
  if (!Number.isFinite(t)) return true;
  return now - t > maxAgeMs;
}

/** A raster-only MapLibre style for low-bandwidth / reduced-data mode. */
export function lowDataRasterStyle(tileUrl = "https://tile.openstreetmap.org/{z}/{x}/{y}.png") {
  return {
    version: 8 as const,
    name: "low-data-raster",
    sources: {
      osm: {
        type: "raster" as const,
        tiles: [tileUrl],
        tileSize: 256,
        attribution: "© OpenStreetMap contributors",
      },
    },
    layers: [{ id: "osm", type: "raster" as const, source: "osm" }],
  };
}

/** Resolve the 2D vector style URL; env first, OpenFreeMap liberty as default. */
export function resolveMapStyleUrl(envValue: string | undefined): string {
  const raw = (envValue ?? "").trim();
  if (/^https?:\/\/.+/.test(raw)) return raw;
  return "https://tiles.openfreemap.org/styles/liberty";
}

/** Resolve the Cesium Ion token; empty means "Ion disabled" — never send empty-token requests. */
export function resolveCesiumIonToken(envValue: string | undefined): string | null {
  const raw = (envValue ?? "").trim();
  return raw.length > 0 ? raw : null;
}
