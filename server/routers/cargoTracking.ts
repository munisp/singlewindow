/**
 * Sprint 66 — Cargo Tracking Real-Time Map
 * tRPC router: live AIS vessel positions, route polylines, shipment linkage
 * Simulates sedona-svc AIS feed with realistic vessel data for Mombasa Port area
 */

import { z } from "zod";
import { publicProcedure, protectedProcedure, router } from "../_core/trpc";
import { publishEvent, TOPICS } from "../_core/kafka";

// ─── TYPES ────────────────────────────────────────────────────────────────────

export type VesselStatus = "underway" | "moored" | "anchored" | "restricted" | "aground";
export type CargoStatus = "pre-arrival" | "arrived" | "berthed" | "loading" | "unloading" | "departed";
export type RiskFlag = "green" | "amber" | "red" | null;
export type VesselType = "container" | "bulk" | "tanker" | "general" | "roro" | "passenger";

export interface LiveVessel {
  id: string;
  mmsi: string;
  imo: string;
  vesselName: string;
  vesselType: VesselType;
  flag: string;
  callSign: string;
  lat: number;
  lon: number;
  speed: number;       // knots
  heading: number;     // degrees 0-359
  course: number;      // degrees 0-359
  status: VesselStatus;
  cargoStatus: CargoStatus;
  declarationRef: string | null;
  riskFlag: RiskFlag;
  eta: string | null;  // ISO timestamp
  destination: string;
  draught: number;     // metres
  length: number;      // metres
  lastUpdate: string;  // ISO timestamp
  originPort: string;
  originLat: number;
  originLon: number;
}

export interface RouteWaypoint {
  lat: number;
  lon: number;
  timestamp: string;
  speed: number;
  event?: string;
}

// ─── SEED DATA ────────────────────────────────────────────────────────────────

// Base vessel positions near Mombasa Port, Kenya (-4.05°, 39.67°)
const BASE_VESSELS: LiveVessel[] = [
  {
    id: "v1",
    mmsi: "636091234",
    imo: "9234567",
    vesselName: "MSC NAIROBI",
    vesselType: "container",
    flag: "LR",
    callSign: "A8KN9",
    lat: -4.0435,
    lon: 39.6682,
    speed: 12.4,
    heading: 285,
    course: 283,
    status: "underway",
    cargoStatus: "pre-arrival",
    declarationRef: "URN-2026-001234",
    riskFlag: "green",
    eta: new Date(Date.now() + 6 * 3600000).toISOString(),
    destination: "KEMBA",
    draught: 12.4,
    length: 294,
    lastUpdate: new Date().toISOString(),
    originPort: "Port Said",
    originLat: 31.2653,
    originLon: 32.3019,
  },
  {
    id: "v2",
    mmsi: "636092345",
    imo: "9345678",
    vesselName: "EVER GOLDEN GATE",
    vesselType: "container",
    flag: "TW",
    callSign: "BPKL2",
    lat: -4.0612,
    lon: 39.6891,
    speed: 0.2,
    heading: 180,
    course: 180,
    status: "moored",
    cargoStatus: "berthed",
    declarationRef: "URN-2026-001235",
    riskFlag: "amber",
    eta: null,
    destination: "KEMBA",
    draught: 13.1,
    length: 366,
    lastUpdate: new Date().toISOString(),
    originPort: "Shanghai",
    originLat: 31.2304,
    originLon: 121.4737,
  },
  {
    id: "v3",
    mmsi: "636093456",
    imo: "9456789",
    vesselName: "AFRICAN EXPLORER",
    vesselType: "bulk",
    flag: "GH",
    callSign: "9GA12",
    lat: -4.0789,
    lon: 39.7012,
    speed: 8.1,
    heading: 310,
    course: 308,
    status: "underway",
    cargoStatus: "arrived",
    declarationRef: null,
    riskFlag: null,
    eta: new Date(Date.now() + 2 * 3600000).toISOString(),
    destination: "KEMBA",
    draught: 9.8,
    length: 189,
    lastUpdate: new Date().toISOString(),
    originPort: "Durban",
    originLat: -29.8587,
    originLon: 31.0218,
  },
  {
    id: "v4",
    mmsi: "636094567",
    imo: "9567890",
    vesselName: "KENYA TRADER",
    vesselType: "general",
    flag: "KE",
    callSign: "5YKT4",
    lat: -4.0234,
    lon: 39.6543,
    speed: 0.0,
    heading: 90,
    course: 90,
    status: "anchored",
    cargoStatus: "loading",
    declarationRef: "URN-2026-001236",
    riskFlag: "green",
    eta: null,
    destination: "TZDAR",
    draught: 6.2,
    length: 142,
    lastUpdate: new Date().toISOString(),
    originPort: "Mombasa",
    originLat: -4.0435,
    originLon: 39.6682,
  },
  {
    id: "v5",
    mmsi: "636095678",
    imo: "9678901",
    vesselName: "GULF PIONEER",
    vesselType: "tanker",
    flag: "AE",
    callSign: "A6GP5",
    lat: -4.0956,
    lon: 39.7234,
    speed: 5.3,
    heading: 270,
    course: 268,
    status: "underway",
    cargoStatus: "pre-arrival",
    declarationRef: "URN-2026-001237",
    riskFlag: "red",
    eta: new Date(Date.now() + 4 * 3600000).toISOString(),
    destination: "KEMBA",
    draught: 14.2,
    length: 228,
    lastUpdate: new Date().toISOString(),
    originPort: "Fujairah",
    originLat: 25.1288,
    originLon: 56.3264,
  },
  {
    id: "v6",
    mmsi: "636096789",
    imo: "9789012",
    vesselName: "EAST AFRICA EXPRESS",
    vesselType: "roro",
    flag: "KE",
    callSign: "5YEA6",
    lat: -4.0123,
    lon: 39.6789,
    speed: 0.1,
    heading: 0,
    course: 0,
    status: "moored",
    cargoStatus: "unloading",
    declarationRef: "URN-2026-001238",
    riskFlag: "green",
    eta: null,
    destination: "KEMBA",
    draught: 7.8,
    length: 176,
    lastUpdate: new Date().toISOString(),
    originPort: "Dar es Salaam",
    originLat: -6.7924,
    originLon: 39.2083,
  },
  {
    id: "v7",
    mmsi: "636097890",
    imo: "9890123",
    vesselName: "MAERSK MOMBASA",
    vesselType: "container",
    flag: "DK",
    callSign: "OUMD7",
    lat: -3.9876,
    lon: 39.6234,
    speed: 14.2,
    heading: 220,
    course: 218,
    status: "underway",
    cargoStatus: "departed",
    declarationRef: "URN-2026-001239",
    riskFlag: "green",
    eta: new Date(Date.now() + 12 * 3600000).toISOString(),
    destination: "ZACPT",
    draught: 11.6,
    length: 294,
    lastUpdate: new Date().toISOString(),
    originPort: "Mombasa",
    originLat: -4.0435,
    originLon: 39.6682,
  },
  {
    id: "v8",
    mmsi: "636098901",
    imo: "9901234",
    vesselName: "NILE CARRIER",
    vesselType: "bulk",
    flag: "EG",
    callSign: "SUEG8",
    lat: -4.1234,
    lon: 39.7456,
    speed: 3.2,
    heading: 315,
    course: 312,
    status: "underway",
    cargoStatus: "pre-arrival",
    declarationRef: "URN-2026-001240",
    riskFlag: "amber",
    eta: new Date(Date.now() + 8 * 3600000).toISOString(),
    destination: "KEMBA",
    draught: 10.4,
    length: 195,
    lastUpdate: new Date().toISOString(),
    originPort: "Alexandria",
    originLat: 31.2001,
    originLon: 29.9187,
  },
];

// ─── POSITION DRIFT SIMULATION ────────────────────────────────────────────────
// Simulates AIS position updates: underway vessels drift along their heading

function driftVessel(vessel: LiveVessel, tickSeconds: number): LiveVessel {
  if (vessel.speed < 0.5) return { ...vessel, lastUpdate: new Date().toISOString() };

  const speedMs = (vessel.speed * 0.514444) * tickSeconds; // knots → m/s → metres
  const headingRad = (vessel.heading * Math.PI) / 180;

  // Approximate: 1 degree lat ≈ 111,320 m; 1 degree lon ≈ 111,320 * cos(lat) m
  const latDelta = (speedMs * Math.cos(headingRad)) / 111320;
  const lonDelta = (speedMs * Math.sin(headingRad)) / (111320 * Math.cos((vessel.lat * Math.PI) / 180));

  return {
    ...vessel,
    lat: vessel.lat + latDelta,
    lon: vessel.lon + lonDelta,
    lastUpdate: new Date().toISOString(),
  };
}

// ─── ROUTE GENERATION ────────────────────────────────────────────────────────

function generateRoute(vessel: LiveVessel): RouteWaypoint[] {
  const waypoints: RouteWaypoint[] = [];
  const steps = 12;
  const now = Date.now();

  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const lat = vessel.originLat + (vessel.lat - vessel.originLat) * t;
    const lon = vessel.originLon + (vessel.lon - vessel.originLon) * t;
    const hoursAgo = (steps - i) * 2;
    const speed = vessel.status === "underway" ? vessel.speed * (0.8 + Math.random() * 0.4) : 0;

    waypoints.push({
      lat,
      lon,
      timestamp: new Date(now - hoursAgo * 3600000).toISOString(),
      speed: Math.round(speed * 10) / 10,
      event: i === 0 ? `Departed ${vessel.originPort}` : i === steps ? "Current position" : undefined,
    });
  }

  return waypoints;
}

// ─── PORT ARRIVALS ────────────────────────────────────────────────────────────

const PORT_ARRIVALS = [
  { vesselName: "MSC NAIROBI", mmsi: "636091234", eta: new Date(Date.now() + 6 * 3600000).toISOString(), berth: "Berth 12", cargoType: "Container", teu: 2840, riskFlag: "green" as RiskFlag },
  { vesselName: "GULF PIONEER", mmsi: "636095678", eta: new Date(Date.now() + 4 * 3600000).toISOString(), berth: "Berth 7 (Liquid)", cargoType: "Crude Oil", teu: null, riskFlag: "red" as RiskFlag },
  { vesselName: "AFRICAN EXPLORER", mmsi: "636093456", eta: new Date(Date.now() + 2 * 3600000).toISOString(), berth: "Berth 3 (Bulk)", cargoType: "Grain", teu: null, riskFlag: null },
  { vesselName: "NILE CARRIER", mmsi: "636098901", eta: new Date(Date.now() + 8 * 3600000).toISOString(), berth: "Berth 5 (Bulk)", cargoType: "Fertiliser", teu: null, riskFlag: "amber" as RiskFlag },
];

// ─── ROUTER// ─── SHARED DATA HELPER (used by Sprint 70 WS broadcast) ───────────────────────

import { getDb, getPool } from "../db";

async function pgQuery<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> {
  await getDb();
  const pool = getPool();
  if (!pool) return [];
  const { rows } = await pool.query(sql, params);
  return rows as T[];
}

// getLiveVesselsData (sync) is defined below the router — see end of file.

// ─── ROUTER ──────────────────────────────────────────────────────

export const cargoTrackingRouter = router({
  /**
   * getLiveVessels — returns current AIS positions for all tracked vessels.
   * In production this calls sedona-svc /api/v1/ais/vessels
   */
  getLiveVessels: publicProcedure
    .input(z.object({
      riskFilter: z.enum(["all", "green", "amber", "red"]).optional().default("all"),
      statusFilter: z.enum(["all", "underway", "moored", "anchored"]).optional().default("all"),
    }))
    .query(({ input }) => {
      // Simulate 30-second drift from base positions (capped at 120 ticks = 1 hour)
      const tick = Math.floor(Date.now() / 30000) % 120;
      const vessels = BASE_VESSELS.map(v => driftVessel(v, tick * 0.5));

      let filtered = vessels;
      if (input.riskFilter !== "all") {
        filtered = filtered.filter(v => v.riskFlag === input.riskFilter);
      }
      if (input.statusFilter !== "all") {
        filtered = filtered.filter(v => v.status === input.statusFilter);
      }

      return {
        vessels: filtered,
        totalCount: BASE_VESSELS.length,
        lastRefresh: new Date().toISOString(),
        sourceService: "sedona-svc",
        coverageArea: "Indian Ocean — East Africa Corridor",
      };
    }),

  /**
   * getVesselRoute — returns historical track (polyline) for a specific vessel
   */
  getVesselRoute: publicProcedure
    .input(z.object({ mmsi: z.string() }))
    .query(({ input }) => {
      const vessel = BASE_VESSELS.find(v => v.mmsi === input.mmsi);
      if (!vessel) {
        return { waypoints: [], vessel: null };
      }
      return {
        waypoints: generateRoute(vessel),
        vessel,
      };
    }),

  /**
   * getShipmentPosition — returns position for a specific declaration reference
   */
  getShipmentPosition: publicProcedure
    .input(z.object({ declarationRef: z.string() }))
    .query(({ input }) => {
      const vessel = BASE_VESSELS.find(v => v.declarationRef === input.declarationRef);
      if (!vessel) return { found: false, vessel: null };
      return { found: true, vessel: driftVessel(vessel, Math.floor(Date.now() / 30000) * 0.5) };
    }),

  /**
   * getPortArrivals — upcoming vessel arrivals at the home port
   */
  getPortArrivals: publicProcedure.query(() => {
    return {
      arrivals: PORT_ARRIVALS,
      port: "Mombasa International Port",
      portCode: "KEMBA",
      lastUpdate: new Date().toISOString(),
    };
  }),

   /**
   * getVesselStats — summary statistics from DB (falls back to static)
   */
  getVesselStats: publicProcedure.query(async () => {
    try {
      const [stats] = await pgQuery(
        `SELECT
          COUNT(DISTINCT mmsi) AS total,
          SUM(CASE WHEN speed < 0.5 THEN 1 ELSE 0 END) AS moored,
          SUM(CASE WHEN speed >= 0.5 AND speed < 2 THEN 1 ELSE 0 END) AS anchored,
          SUM(CASE WHEN speed >= 2 THEN 1 ELSE 0 END) AS underway,
          SUM(CASE WHEN flag_country IN ('IRN','PRK','SYR','RUS','BLR') THEN 1 ELSE 0 END) AS red_flag,
          SUM(CASE WHEN flag_country IN ('LBY','SOM','SDN','YEM','MMR') THEN 1 ELSE 0 END) AS amber_flag
         FROM (SELECT DISTINCT ON (mmsi) mmsi, speed, flag_country FROM vessel_tracking_events ORDER BY mmsi, recorded_at DESC) l`
      ) as any[];
      if (stats) {
        const total = parseInt(stats.total ?? "0", 10);
        const red = parseInt(stats.red_flag ?? "0", 10);
        const amber = parseInt(stats.amber_flag ?? "0", 10);
        return {
          total,
          underway: parseInt(stats.underway ?? "0", 10),
          moored: parseInt(stats.moored ?? "0", 10),
          anchored: parseInt(stats.anchored ?? "0", 10),
          redFlag: red,
          amberFlag: amber,
          greenFlag: total - red - amber,
          withDeclaration: 0,
        };
      }
    } catch { /* fallback */ }
    // Static fallback
    const underway = BASE_VESSELS.filter(v => v.status === "underway").length;
    const moored = BASE_VESSELS.filter(v => v.status === "moored").length;
    const anchored = BASE_VESSELS.filter(v => v.status === "anchored").length;
    const redFlag = BASE_VESSELS.filter(v => v.riskFlag === "red").length;
    const amberFlag = BASE_VESSELS.filter(v => v.riskFlag === "amber").length;
    return {
      total: BASE_VESSELS.length,
      underway, moored, anchored, redFlag, amberFlag,
      greenFlag: BASE_VESSELS.filter(v => v.riskFlag === "green").length,
      withDeclaration: BASE_VESSELS.filter(v => v.declarationRef !== null).length,
    };
  }),

  /**
   * searchVessels — search by name, MMSI, or IMO number from DB.
   */
  /**
   * logCargoEvent — record an arrival or departure event and publish to Kafka
   */
  logCargoEvent: protectedProcedure
    .input(z.object({
      mmsi: z.string(),
      vesselName: z.string(),
      eventType: z.enum(["arrived", "departed"]),
      portCode: z.string().default("KEMBA"),
      declarationRef: z.string().optional(),
      lat: z.number().optional(),
      lon: z.number().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const topic = input.eventType === "arrived" ? TOPICS.CARGO_ARRIVED : TOPICS.CARGO_DEPARTED;
      await publishEvent(topic, {
        eventType: `cargo.${input.eventType}`,
        aggregateId: input.mmsi,
        payload: {
          mmsi: input.mmsi,
          vesselName: input.vesselName,
          portCode: input.portCode,
          declarationRef: input.declarationRef ?? null,
          lat: input.lat ?? null,
          lon: input.lon ?? null,
          loggedBy: ctx.user.id,
        },
      }).catch(() => {});
      return { success: true, eventType: input.eventType, mmsi: input.mmsi };
    }),

  searchVessels: publicProcedure
    .input(z.object({ q: z.string().min(2).max(100) }))
    .query(async ({ input }) => {
      const rows = await pgQuery(
        `SELECT DISTINCT ON (mmsi) mmsi, vessel_name, imo_number, latitude, longitude,
                speed, heading, destination_port, eta, cargo_type, flag_country, recorded_at
         FROM vessel_tracking_events
         WHERE vessel_name ILIKE $1 OR mmsi ILIKE $1 OR imo_number ILIKE $1
         ORDER BY mmsi, recorded_at DESC LIMIT 20`,
        [`%${input.q}%`]
      );
      const highRisk = ["IRN","PRK","SYR","RUS","BLR"];
      const medRisk = ["LBY","SOM","SDN","YEM","MMR"];
      return rows.map((r: any) => {
        const flag = String(r.flag_country ?? "");
        const speed = Number(r.speed ?? 0);
        return {
          mmsi: String(r.mmsi),
          vesselName: String(r.vessel_name),
          imoNumber: String(r.imo_number ?? ""),
          lat: Number(r.latitude),
          lon: Number(r.longitude),
          speed,
          heading: Number(r.heading ?? 0),
          status: speed < 0.5 ? "moored" : speed < 2 ? "anchored" : "underway",
          destinationPort: String(r.destination_port ?? ""),
          eta: r.eta ? new Date(r.eta).toISOString() : null,
          cargoType: String(r.cargo_type ?? "General"),
          flagCountry: flag,
          riskFlag: highRisk.includes(flag) ? "red" : medRisk.includes(flag) ? "amber" : "green",
          lastUpdate: r.recorded_at ? new Date(r.recorded_at).toISOString() : new Date().toISOString(),
        };
      });
    }),
});

// ─── Sync shim for WebSocket broadcaster and legacy tests ────────────────────
// Maintains a hot in-memory cache refreshed every 30s by the async DB query.
// The sync getLiveVesselsData() returns the last known snapshot immediately.
let _vesselCache: Array<{
  mmsi: string; vesselName: string; imoNumber: string;
  lat: number; lon: number; speed: number; heading: number;
  status: string; destinationPort: string; eta: string | null;
  cargoType: string; flagCountry: string; riskFlag: "green" | "amber" | "red";
  lastUpdate: string;
}> = BASE_VESSELS.map(v => ({
  mmsi: v.mmsi,
  vesselName: v.vesselName,
  imoNumber: v.imo,
  lat: v.lat,
  lon: v.lon,
  speed: v.speed,
  heading: v.heading,
  status: v.status,
  destinationPort: v.destination,
  eta: v.eta,
  cargoType: "Container",
  flagCountry: v.flag,
  riskFlag: v.riskFlag ?? "green",
  lastUpdate: v.lastUpdate,
}));

// Refresh cache from DB asynchronously (best-effort, non-blocking)
async function _refreshVesselCache(): Promise<void> {
  try {
    const rows = await pgQuery(
      `SELECT DISTINCT ON (mmsi) mmsi, vessel_name, imo_number, latitude, longitude,
              speed, heading, destination_port, eta, cargo_type, flag_country, recorded_at
       FROM vessel_tracking_events
       ORDER BY mmsi, recorded_at DESC LIMIT 200`
    );
    if (rows.length > 0) {
      const highRisk = ["IR", "KP", "SY", "CU", "IRN", "PRK", "SYR"];
      const medRisk = ["RU", "BY", "VE", "MM", "RUS", "BLR", "MMR"];
      _vesselCache = rows.map((r: any) => {
        const flag = String(r.flag_country ?? "");
        const speed = Number(r.speed ?? 0);
        return {
          mmsi: String(r.mmsi),
          vesselName: String(r.vessel_name),
          imoNumber: String(r.imo_number ?? ""),
          lat: Number(r.latitude),
          lon: Number(r.longitude),
          speed,
          heading: Number(r.heading ?? 0),
          status: speed < 0.5 ? "moored" : speed < 2 ? "anchored" : "underway",
          destinationPort: String(r.destination_port ?? ""),
          eta: r.eta ? new Date(r.eta as string).toISOString() : null,
          cargoType: String(r.cargo_type ?? "General"),
          flagCountry: flag,
          riskFlag: highRisk.includes(flag) ? "red" : medRisk.includes(flag) ? "amber" : "green",
          lastUpdate: r.recorded_at ? new Date(r.recorded_at as string).toISOString() : new Date().toISOString(),
        };
      });
    }
  } catch {
    // Silently keep existing cache on DB error
  }
}

// Schedule background refresh every 30 seconds
if (typeof setInterval !== "undefined") {
  setInterval(() => { void _refreshVesselCache(); }, 30_000);
  void _refreshVesselCache();
}

/**
 * getLiveVesselsData — synchronous accessor for the in-memory vessel cache.
 * Returns the last known snapshot from the DB (refreshed every 30s).
 * Falls back to BASE_VESSELS seed data when DB is unavailable.
 */
export function getLiveVesselsData() {
  return _vesselCache;
}
