/**
 * Sprint 66 — Cargo Tracking Real-Time Map
 * tRPC router: live AIS vessel positions, route polylines, shipment linkage
 *
 * P0 remediation (audit): the synthetic BASE_VESSELS fleet and the position
 * "drift" simulator were REMOVED. Positions are served ONLY from the persisted
 * vessel_tracking_events store (real ingested AIS events). When that store is
 * empty or unreachable the procedures return an honest empty state with
 * sourceService:"none" — no positions are ever synthesized.
 *
 * Required upstream for live coverage: an AIS ingestion worker (e.g. sedona-svc
 * /api/v1/ais/vessels poller) writing into vessel_tracking_events.
 */

import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
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

/**
 * Port arrival row served by getPortArrivals. Fields the persisted AIS store
 * does not track are explicit nulls — never fabricated values.
 */
export interface PortArrival {
  vesselName: string;
  mmsi: string;
  eta: string | null;
  berth: string | null; // berth assignment is not tracked
  cargoType: string | null;
  teu: number | null; // TEU is not tracked
  riskFlag: RiskFlag;
}

// ─── SEED DATA / DRIFT SIMULATION — REMOVED (P0 remediation) ──────────────
// The hardcoded BASE_VESSELS fleet and driftVessel() position synthesizer were
// removed: they served fabricated "live" AIS positions on public procedures.
// Real positions come from the persisted vessel_tracking_events table only.

// ─── ROUTE GENERATION — REMOVED (SW-25) ──────────────────────────────────────
// The fabricated 12-waypoint route synthesizer with randomized speeds was
// removed. Vessel history is served only from persisted vessel_tracking_events.

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

// ─── REAL-DATA HELPERS (P0 remediation) ──────────────────────────────────────
// Latest persisted position per vessel from the real AIS ingestion store.

const HIGH_RISK_FLAGS = ["IRN","PRK","SYR","RUS","BLR"];
const MED_RISK_FLAGS = ["LBY","SOM","SDN","YEM","MMR"];

async function latestVesselRows(limit = 200) {
  return pgQuery(
    `SELECT DISTINCT ON (mmsi) mmsi, vessel_name, imo_number, latitude, longitude,
            speed, heading, destination_port, eta, cargo_type, flag_country, recorded_at
     FROM vessel_tracking_events
     ORDER BY mmsi, recorded_at DESC LIMIT $1`,
    [limit]
  );
}

function mapVesselRow(r: any) {
  const flag = String(r.flag_country ?? "");
  const speed = Number(r.speed ?? 0);
  const mmsi = String(r.mmsi);
  return {
    id: mmsi,
    mmsi,
    vesselName: String(r.vessel_name ?? ""),
    imoNumber: String(r.imo_number ?? ""),
    vesselType: null as string | null, // not tracked in the persisted store
    lat: Number(r.latitude),
    lon: Number(r.longitude),
    speed,
    heading: Number(r.heading ?? 0),
    status: (speed < 0.5 ? "moored" : speed < 2 ? "anchored" : "underway") as "moored" | "anchored" | "underway",
    destinationPort: String(r.destination_port ?? ""),
    eta: r.eta ? new Date(r.eta).toISOString() : null,
    cargoType: String(r.cargo_type ?? "General"),
    flagCountry: flag,
    riskFlag: (HIGH_RISK_FLAGS.includes(flag) ? "red" : MED_RISK_FLAGS.includes(flag) ? "amber" : "green") as "green" | "amber" | "red",
    lastUpdate: r.recorded_at ? new Date(r.recorded_at).toISOString() : new Date().toISOString(),
  };
}

// ─── ROUTER ──────────────────────────────────────────────────────

export const cargoTrackingRouter = router({
  /**
   * getLiveVessels — returns current AIS positions for all tracked vessels.
   * P0 remediation: positions are read from the persisted vessel_tracking_events
   * store (real ingested AIS events). The previous synthetic fleet + drift
   * simulator was removed. When the store is unreachable this returns an honest
   * empty state (sourceService:"none") — positions are never synthesized.
   * Required upstream for live coverage: an AIS ingestion worker (e.g.
   * sedona-svc /api/v1/ais/vessels poller) writing vessel_tracking_events.
   */
  getLiveVessels: protectedProcedure
    .input(z.object({
      riskFilter: z.enum(["all", "green", "amber", "red"]).optional().default("all"),
      statusFilter: z.enum(["all", "underway", "moored", "anchored"]).optional().default("all"),
    }))
    .query(async ({ input }) => {
      let rows: Awaited<ReturnType<typeof latestVesselRows>>;
      try {
        rows = await latestVesselRows(500);
      } catch {
        return {
          vessels: [] as ReturnType<typeof mapVesselRow>[],
          totalCount: 0,
          lastRefresh: new Date().toISOString(),
          sourceService: "none",
          unavailable: true,
          message:
            "TRACKING_STORE_UNAVAILABLE: no live AIS source is wired. " +
            "Positions require an AIS ingestion worker (e.g. sedona-svc) writing vessel_tracking_events.",
          coverageArea: "Indian Ocean — East Africa Corridor",
        };
      }
      const vessels = rows.map(mapVesselRow);

      let filtered = vessels;
      if (input.riskFilter !== "all") {
        filtered = filtered.filter(v => v.riskFlag === input.riskFilter);
      }
      if (input.statusFilter !== "all") {
        filtered = filtered.filter(v => v.status === input.statusFilter);
      }

      return {
        vessels: filtered,
        totalCount: vessels.length,
        lastRefresh: new Date().toISOString(),
        sourceService: vessels.length > 0 ? "vessel_tracking_events" : "none",
        unavailable: false,
        message: vessels.length === 0
          ? "NO_TRACKING_DATA: no persisted AIS positions. Live coverage requires an AIS ingestion worker (e.g. sedona-svc) writing vessel_tracking_events."
          : undefined,
        coverageArea: "Indian Ocean — East Africa Corridor",
      };
    }),

  /**
   * getVesselRoute — returns historical track (polyline) for a specific vessel
   */
  getVesselRoute: protectedProcedure
    .input(z.object({ mmsi: z.string() }))
    .query(async ({ input }) => {
      // SW-25: serve ONLY real persisted AIS tracking events. An empty result is
      // an explicit, labelled no-data state — never synthesized waypoints.
      let rows: Array<Record<string, unknown>>;
      try {
        rows = await pgQuery(
          `SELECT latitude AS lat, longitude AS lon, speed, heading,
                  recorded_at AS "timestamp", vessel_name AS "vesselName"
           FROM vessel_tracking_events WHERE mmsi = $1
           ORDER BY recorded_at ASC LIMIT 500`,
          [input.mmsi]
        );
      } catch {
        return {
          waypoints: [] as RouteWaypoint[],
          vessel: null,
          noData: true,
          unavailable: true,
          message: "TRACKING_STORE_UNAVAILABLE: persisted vessel tracking events could not be queried.",
        };
      }
      const waypoints = rows as unknown as RouteWaypoint[];
      return {
        waypoints,
        vessel: null,
        noData: waypoints.length === 0,
        unavailable: false,
        message: waypoints.length === 0
          ? "NO_TRACKING_DATA: no persisted tracking events exist for this MMSI."
          : undefined,
      };
    }),

  /**
   * getShipmentPosition — returns position for a specific declaration reference
   */
  getShipmentPosition: protectedProcedure
    .input(z.object({ declarationRef: z.string() }))
    .query(async ({ input }) => {
      // P0 remediation: the previous implementation matched against a
      // hardcoded fake fleet. vessel_tracking_events has no declaration-ref
      // linkage column, so there is currently NO real data source that maps a
      // declaration reference to a live vessel position. Return an honest
      // not-found state instead of synthesizing one.
      // Required upstream: a shipment↔vessel linkage table populated at
      // declaration-lodgement time (vessel MMSI on the declaration).
      void input;
      return {
        found: false,
        vessel: null,
        message:
          "NO_SHIPMENT_LINKAGE: no real data source links declaration references to vessel positions yet.",
      };
    }),

  /**
   * getPortArrivals — upcoming vessel arrivals at the home port, read from
   * persisted AIS events with a future ETA. Honest empty state when the
   * tracking store has no ETA data or is unreachable.
   */
  getPortArrivals: protectedProcedure.query(async () => {
    try {
      const rows = await pgQuery(
        `SELECT DISTINCT ON (mmsi) mmsi, vessel_name, eta, cargo_type, flag_country
         FROM vessel_tracking_events
         WHERE eta IS NOT NULL AND eta > NOW()
         ORDER BY mmsi, recorded_at DESC
         LIMIT 50`
      );
      const highRisk = ["IRN","PRK","SYR","RUS","BLR"];
      const medRisk = ["LBY","SOM","SDN","YEM","MMR"];
      const arrivals = (rows as any[])
        .map((r): PortArrival => {
          const flag = String(r.flag_country ?? "");
          return {
            vesselName: String(r.vessel_name ?? ""),
            mmsi: String(r.mmsi),
            eta: r.eta ? new Date(r.eta).toISOString() : null,
            berth: null, // berth assignment is not tracked
            cargoType: r.cargo_type ? String(r.cargo_type) : null,
            teu: null,   // TEU is not tracked
            riskFlag: (highRisk.includes(flag) ? "red" : medRisk.includes(flag) ? "amber" : "green") as RiskFlag,
          };
        })
        .sort((a, b) => String(a.eta).localeCompare(String(b.eta)));
      return {
        arrivals,
        port: "Mombasa International Port",
        portCode: "KEMBA",
        lastUpdate: new Date().toISOString(),
        message: arrivals.length === 0
          ? "NO_ETA_DATA: no persisted AIS events with a future ETA."
          : undefined,
      };
    } catch {
      return {
        arrivals: [] as PortArrival[],
        port: "Mombasa International Port",
        portCode: "KEMBA",
        lastUpdate: new Date().toISOString(),
        unavailable: true,
        message: "TRACKING_STORE_UNAVAILABLE: persisted vessel tracking events could not be queried.",
      };
    }
  }),

   /**
   * getVesselStats — summary statistics from DB (falls back to static)
   */
  getVesselStats: protectedProcedure.query(async () => {
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
    } catch { /* fall through to honest unavailable state */ }
    // P0 remediation: the fabricated BASE_VESSELS fallback was removed. When the
    // tracking store is unreachable we report an honest unavailable state with
    // zeroed counts instead of synthesized fleet statistics.
    return {
      total: 0,
      underway: 0, moored: 0, anchored: 0,
      redFlag: 0, amberFlag: 0, greenFlag: 0,
      withDeclaration: 0,
      unavailable: true,
      message: "TRACKING_STORE_UNAVAILABLE: vessel statistics could not be computed from the persisted store.",
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

  searchVessels: protectedProcedure
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
  /**
   * v100: Get cargo vessel tracking events as heatmap data points (lat/lng/weight).
   */
  getCargoHeatmapData: protectedProcedure
    .input(z.object({
      hours: z.number().int().min(1).max(168).default(24),
      limit: z.number().int().min(1).max(2000).default(500),
    }))
    .query(async ({ input }) => {
      const { getDb } = await import("../db");
      const db = await getDb();
      if (!db) return [];
      const { vesselTrackingEvents } = await import("../../drizzle/schema");
      const { gte, desc, isNotNull, and } = await import("drizzle-orm");
      const since = new Date(Date.now() - input.hours * 60 * 60 * 1000);
      const rows = await db.select({
        lat: vesselTrackingEvents.latitude,
        lng: vesselTrackingEvents.longitude,
        speed: vesselTrackingEvents.speed,
        recordedAt: vesselTrackingEvents.recordedAt,
        mmsi: vesselTrackingEvents.mmsi,
      })
        .from(vesselTrackingEvents)
        .where(and(
          gte(vesselTrackingEvents.recordedAt, since),
          isNotNull(vesselTrackingEvents.latitude),
          isNotNull(vesselTrackingEvents.longitude),
        ))
        .orderBy(desc(vesselTrackingEvents.recordedAt))
        .limit(input.limit);
      return rows.map(r => ({
        lat: Number(r.lat),
        lng: Number(r.lng),
        weight: r.speed ? Math.min(Number(r.speed) / 30, 1) : 0.5,
        vesselId: r.mmsi,
        timestamp: r.recordedAt,
      }));
    }),

});

// ─── Sync shim for WebSocket broadcaster and legacy tests ────────────────────
// Maintains a hot in-memory cache refreshed every 30s by the async DB query.
// The sync getLiveVesselsData() returns the last known snapshot immediately.
// P0 remediation: the cache starts EMPTY. It is populated only by real DB
// snapshots — never by the removed BASE_VESSELS seed fleet.
let _vesselCache: Array<{
  mmsi: string; vesselName: string; imoNumber: string;
  lat: number; lon: number; speed: number; heading: number;
  status: string; destinationPort: string; eta: string | null;
  cargoType: string; flagCountry: string; riskFlag: "green" | "amber" | "red";
  lastUpdate: string;
}> = [];

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
 * Returns the last known REAL snapshot from the DB (refreshed every 30s).
 * Returns an empty array when no real positions have been ingested — the
 * fabricated BASE_VESSELS fallback was removed (P0 remediation).
 */
export function getLiveVesselsData() {
  return _vesselCache;
}
