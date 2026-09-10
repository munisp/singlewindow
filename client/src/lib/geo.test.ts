/**
 * Phase 17 (G8) — unit tests for the shared geospatial helpers that back the
 * map components (GeospatialPortal 2D/3D, AIS layer, track replay, heatmap).
 */
import { describe, it, expect } from "vitest";
import {
  toMapVessel,
  vesselsToGeoJSON,
  trackToLineString,
  isFeedStale,
  lowDataRasterStyle,
  resolveMapStyleUrl,
  resolveCesiumIonToken,
  VesselTrackingRow,
} from "./geo";

const row: VesselTrackingRow = {
  id: 1,
  mmsi: "657123456",
  vesselName: "MT LAGOS STAR",
  imoNumber: "9074729",
  latitude: 6.42,
  longitude: 3.31,
  speed: 12.5,
  heading: 270,
  destinationPort: "NGAPP",
  eta: new Date("2026-01-01T00:00:00Z"),
  cargoType: "container",
  flagCountry: "NGA",
  recordedAt: new Date("2025-12-31T12:00:00Z"),
};

describe("toMapVessel", () => {
  it("maps a DB row to a GeoVessel with ISO eta", () => {
    const v = toMapVessel(row);
    expect(v).not.toBeNull();
    expect(v!.mmsi).toBe("657123456");
    expect(v!.lat).toBeCloseTo(6.42);
    expect(v!.eta).toBe("2026-01-01T00:00:00.000Z");
  });

  it("drops rows with out-of-range coordinates (fail-closed)", () => {
    expect(toMapVessel({ ...row, latitude: 91 })).toBeNull();
    expect(toMapVessel({ ...row, longitude: -181 })).toBeNull();
    expect(toMapVessel({ ...row, latitude: NaN })).toBeNull();
  });
});

describe("vesselsToGeoJSON", () => {
  it("builds a FeatureCollection keyed [lng, lat]", () => {
    const fc = vesselsToGeoJSON([toMapVessel(row)!]);
    expect(fc.type).toBe("FeatureCollection");
    expect(fc.features[0].geometry.coordinates).toEqual([3.31, 6.42]);
    expect(fc.features[0].properties.mmsi).toBe("657123456");
  });
});

describe("trackToLineString", () => {
  it("returns a LineString for 2+ valid points", () => {
    const line = trackToLineString([
      { latitude: 6.0, longitude: 3.0 },
      { latitude: 6.4, longitude: 3.3 },
      { latitude: NaN, longitude: 3.4 }, // dropped
      { latitude: 6.45, longitude: 3.39 },
    ]);
    expect(line).not.toBeNull();
    expect(line!.geometry.coordinates).toHaveLength(3);
  });

  it("returns null for fewer than 2 valid points (honest no-track)", () => {
    expect(trackToLineString([{ latitude: 6.0, longitude: 3.0 }])).toBeNull();
    expect(trackToLineString([])).toBeNull();
  });
});

describe("isFeedStale", () => {
  const now = Date.parse("2026-01-01T00:00:00Z");
  it("flags missing/old data as stale", () => {
    expect(isFeedStale(null, now)).toBe(true);
    expect(isFeedStale("2025-12-31T23:57:00Z", now)).toBe(true);
  });
  it("accepts fresh data", () => {
    expect(isFeedStale("2025-12-31T23:59:30Z", now)).toBe(false);
  });
});

describe("lowDataRasterStyle", () => {
  it("is a self-contained raster style (no remote style JSON fetch)", () => {
    const style = lowDataRasterStyle();
    expect(style.version).toBe(8);
    expect(style.sources.osm.type).toBe("raster");
    expect(style.layers).toHaveLength(1);
  });
});

describe("resolveMapStyleUrl", () => {
  it("uses the env URL when it is a valid http(s) URL", () => {
    expect(resolveMapStyleUrl("https://tiles.internal/styles/liberty")).toBe(
      "https://tiles.internal/styles/liberty"
    );
  });
  it("falls back to OpenFreeMap for empty/garbage values", () => {
    expect(resolveMapStyleUrl(undefined)).toContain("openfreemap");
    expect(resolveMapStyleUrl("javascript:alert(1)")).toContain("openfreemap");
  });
});

describe("resolveCesiumIonToken", () => {
  it("returns null when unset — never an empty-string token", () => {
    expect(resolveCesiumIonToken(undefined)).toBeNull();
    expect(resolveCesiumIonToken("   ")).toBeNull();
  });
  it("returns a configured token", () => {
    expect(resolveCesiumIonToken(" tok123 ")).toBe("tok123");
  });
});
