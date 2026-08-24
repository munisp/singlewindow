/**
 * Cargo tracking backed by persisted AIS events.
 *
 * A tracking response is never synthesized. Persisted-source failures are
 * surfaced as unavailable, while successful empty queries remain empty.
 */

import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { publicProcedure, publicRateLimitedProcedure, protectedProcedure, router } from "../_core/trpc";
import { publishEvent, TOPICS } from "../_core/kafka";
import { getDb, getPool } from "../db";

export type VesselStatus = "underway" | "moored" | "anchored" | "restricted" | "aground";
export type CargoStatus = "pre-arrival" | "arrived" | "berthed" | "loading" | "unloading" | "departed";
export type RiskFlag = "green" | "amber" | "red" | null;
export type VesselType = "container" | "bulk" | "tanker" | "general" | "roro" | "passenger";

export interface LiveVessel {
  id: string;
  mmsi: string;
  imo: string | null;
  vesselName: string | null;
  vesselType: VesselType | null;
  flag: string | null;
  callSign: string | null;
  lat: number;
  lon: number;
  speed: number | null;
  heading: number | null;
  course: number | null;
  status: VesselStatus | null;
  cargoStatus: CargoStatus | null;
  declarationRef: string | null;
  riskFlag: RiskFlag;
  eta: string | null;
  destination: string | null;
  draught: number | null;
  length: number | null;
  lastUpdate: string;
  originPort: string | null;
  originLat: number | null;
  originLon: number | null;
}

export interface RouteWaypoint {
  lat: number;
  lon: number;
  timestamp: string;
  speed: number | null;
}

type VesselRow = {
  mmsi: string;
  vessel_name: string | null;
  imo_number: string | null;
  latitude: number;
  longitude: number;
  speed: number | null;
  heading: number | null;
  destination_port: string | null;
  eta: Date | string | null;
  cargo_type: string | null;
  flag_country: string | null;
  recorded_at: Date | string;
};

async function pgQuery<T = Record<string, unknown>>(query: string, params: unknown[] = []): Promise<T[]> {
  await getDb();
  const pool = getPool();
  if (!pool) throw new Error("Database unavailable");
  const { rows } = await pool.query(query, params);
  return rows as T[];
}

async function persistedQuery<T = Record<string, unknown>>(query: string, params: unknown[] = []) {
  try {
    return await pgQuery<T>(query, params);
  } catch (error) {
    throw new TRPCError({
      code: "SERVICE_UNAVAILABLE",
      message: "Cargo tracking is unavailable.",
      cause: error,
    });
  }
}

type ShipmentTrackingUnavailableReason =
  | "bill_of_lading_not_linked"
  | "bill_of_lading_not_in_manifest"
  | "vessel_identifier_missing"
  | "ambiguous_vessel_name"
  | "no_ais_position";

export type ShipmentTrackingResult =
  | {
      trackingStatus: "position";
      vesselName: string | null;
      latitude: number;
      longitude: number;
      eta: string | null;
      lastUpdate: string;
      destination: string | null;
      linkage: "identifier-derived" | "name-matched";
    }
  | {
      trackingStatus: "not_linked" | "unavailable";
      reason: ShipmentTrackingUnavailableReason;
      message: string;
    };

function shipmentUnavailable(
  trackingStatus: "not_linked" | "unavailable",
  reason: ShipmentTrackingUnavailableReason,
  message: string,
): ShipmentTrackingResult {
  return { trackingStatus, reason, message };
}

export async function getShipmentPosition(
  declarationRef: string,
): Promise<ShipmentTrackingResult | undefined> {
  const [declaration] = await pgQuery<{
    bill_of_lading_id: number | null;
    bill_of_lading_number: string | null;
  }>(`
    SELECT bill_of_lading_id, bill_of_lading_number
    FROM declarations
    WHERE declaration_number = $1 OR ucr = $1
    LIMIT 1
  `, [declarationRef]);
  if (!declaration) return undefined;
  if (!declaration.bill_of_lading_id && !declaration.bill_of_lading_number) {
    return shipmentUnavailable(
      "not_linked",
      "bill_of_lading_not_linked",
      "This declaration is not yet linked to a bill of lading.",
    );
  }

  const billConditions = declaration.bill_of_lading_id ? "bl.id = $1" : "bl.bl_number = $1";
  const billParam = declaration.bill_of_lading_id ?? declaration.bill_of_lading_number;
  const billRows = await pgQuery<{
    id: number;
    manifest_id: number;
    bl_number: string;
  }>(`
    SELECT bl.id, bl.manifest_id, bl.bl_number
    FROM bills_of_lading bl
    WHERE ${billConditions}
  `, [billParam]);
  if (billRows.length === 0) {
    return shipmentUnavailable(
      "not_linked",
      "bill_of_lading_not_linked",
      "The declared bill of lading has not been filed yet.",
    );
  }
  if (billRows.length > 1) {
    return shipmentUnavailable(
      "unavailable",
      "bill_of_lading_not_in_manifest",
      "The bill of lading reference is ambiguous and cannot be linked safely.",
    );
  }

  const [manifest] = await pgQuery<{
    vessel_name: string;
    mmsi: string | null;
    imo: string | null;
    eta: Date | string | null;
    port_of_discharge: string;
  }>(`
    SELECT vessel_name, mmsi, imo, eta, port_of_discharge
    FROM manifests
    WHERE id = $1
    LIMIT 1
  `, [billRows[0].manifest_id]);
  if (!manifest) {
    return shipmentUnavailable(
      "unavailable",
      "bill_of_lading_not_in_manifest",
      "The bill of lading is not associated with an available manifest.",
    );
  }

  let vesselRows: VesselRow[];
  let linkage: "identifier-derived" | "name-matched";
  if (manifest.mmsi || manifest.imo) {
    const conditions: string[] = [];
    const params: string[] = [];
    if (manifest.mmsi) {
      params.push(manifest.mmsi);
      conditions.push(`mmsi = $${params.length}`);
    }
    if (manifest.imo) {
      params.push(manifest.imo);
      conditions.push(`imo_number = $${params.length}`);
    }
    vesselRows = await pgQuery<VesselRow>(`
      SELECT mmsi, vessel_name, imo_number, latitude, longitude, speed, heading,
             destination_port, eta, cargo_type, flag_country, recorded_at
      FROM vessel_tracking_events
      WHERE ${conditions.join(" OR ")}
      ORDER BY recorded_at DESC
      LIMIT 1
    `, params);
    linkage = "identifier-derived";
  } else {
    const distinctVessels = await pgQuery<{ mmsi: string }>(`
      SELECT DISTINCT mmsi
      FROM vessel_tracking_events
      WHERE vessel_name = $1
    `, [manifest.vessel_name]);
    if (distinctVessels.length > 1) {
      return shipmentUnavailable(
        "unavailable",
        "ambiguous_vessel_name",
        "The manifest vessel name matches more than one tracked vessel.",
      );
    }
    if (distinctVessels.length === 0) {
      return shipmentUnavailable(
        "unavailable",
        "vessel_identifier_missing",
        "The manifest has no vessel identifier and no unambiguous AIS vessel match.",
      );
    }
    vesselRows = await pgQuery<VesselRow>(`
      SELECT mmsi, vessel_name, imo_number, latitude, longitude, speed, heading,
             destination_port, eta, cargo_type, flag_country, recorded_at
      FROM vessel_tracking_events
      WHERE mmsi = $1
      ORDER BY recorded_at DESC
      LIMIT 1
    `, [distinctVessels[0].mmsi]);
    linkage = "name-matched";
  }
  if (vesselRows.length === 0) {
    return shipmentUnavailable(
      "unavailable",
      "no_ais_position",
      "No current AIS position is available for this vessel.",
    );
  }

  const vessel = vesselRows[0];
  return {
    trackingStatus: "position",
    vesselName: vessel.vessel_name ?? manifest.vessel_name,
    latitude: Number(vessel.latitude),
    longitude: Number(vessel.longitude),
    eta: vessel.eta ? new Date(vessel.eta).toISOString() : manifest.eta ? new Date(manifest.eta).toISOString() : null,
    lastUpdate: new Date(vessel.recorded_at).toISOString(),
    destination: vessel.destination_port ?? manifest.port_of_discharge,
    linkage,
  };
}

function vesselType(cargoType: string | null): VesselType | null {
  const normalized = cargoType?.toLowerCase();
  if (normalized === "container" || normalized === "bulk" || normalized === "tanker"
    || normalized === "general" || normalized === "roro" || normalized === "passenger") {
    return normalized;
  }
  return null;
}

function mapVessel(row: VesselRow): LiveVessel {
  const speed = row.speed === null ? null : Number(row.speed);
  return {
    id: String(row.mmsi),
    mmsi: String(row.mmsi),
    imo: row.imo_number,
    vesselName: row.vessel_name,
    vesselType: vesselType(row.cargo_type),
    flag: row.flag_country,
    callSign: null,
    lat: Number(row.latitude),
    lon: Number(row.longitude),
    speed,
    heading: row.heading === null ? null : Number(row.heading),
    course: row.heading === null ? null : Number(row.heading),
    status: speed === null ? null : speed < 0.5 ? "moored" : speed < 2 ? "anchored" : "underway",
    cargoStatus: null,
    declarationRef: null,
    riskFlag: null,
    eta: row.eta ? new Date(row.eta).toISOString() : null,
    destination: row.destination_port,
    draught: null,
    length: null,
    lastUpdate: new Date(row.recorded_at).toISOString(),
    originPort: null,
    originLat: null,
    originLon: null,
  };
}

const latestVesselsQuery = `
  SELECT DISTINCT ON (mmsi) mmsi, vessel_name, imo_number, latitude, longitude,
         speed, heading, destination_port, eta, cargo_type, flag_country, recorded_at
  FROM vessel_tracking_events
  ORDER BY mmsi, recorded_at DESC
`;

export const cargoTrackingRouter = router({
  getShipmentPosition: publicRateLimitedProcedure
    .input(z.object({ declarationRef: z.string().min(8).max(64) }))
    .query(async ({ input }) => {
      try {
        const result = await getShipmentPosition(input.declarationRef);
        if (!result) throw new TRPCError({ code: "NOT_FOUND" });
        return result;
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "SERVICE_UNAVAILABLE",
          message: "Cargo tracking is unavailable.",
          cause: error,
        });
      }
    }),

  getLiveVessels: publicProcedure
    .input(z.object({
      riskFilter: z.enum(["all", "green", "amber", "red"]).optional().default("all"),
      statusFilter: z.enum(["all", "underway", "moored", "anchored"]).optional().default("all"),
    }))
    .query(async ({ input }) => {
      const rows = await persistedQuery<VesselRow>(latestVesselsQuery);
      let vessels = rows.map(mapVessel);
      if (input.riskFilter !== "all") vessels = vessels.filter(v => v.riskFlag === input.riskFilter);
      if (input.statusFilter !== "all") vessels = vessels.filter(v => v.status === input.statusFilter);
      return {
        vessels,
        totalCount: rows.length,
        lastRefresh: new Date().toISOString(),
        sourceService: "vessel_tracking_events",
      };
    }),

  getVesselRoute: publicProcedure
    .input(z.object({ mmsi: z.string().min(1) }))
    .query(async ({ input }) => {
      const rows = await persistedQuery<VesselRow>(`
        SELECT mmsi, vessel_name, imo_number, latitude, longitude, speed, heading,
               destination_port, eta, cargo_type, flag_country, recorded_at
        FROM vessel_tracking_events
        WHERE mmsi = $1
        ORDER BY recorded_at ASC
      `, [input.mmsi]);
      if (rows.length === 0) {
        return {
          waypoints: [],
          vessel: null,
          sourceService: "vessel_tracking_events",
        };
      }
      const latest = mapVessel(rows[rows.length - 1]);
      return {
        waypoints: rows.map(row => ({
          lat: Number(row.latitude),
          lon: Number(row.longitude),
          timestamp: new Date(row.recorded_at).toISOString(),
          speed: row.speed === null ? null : Number(row.speed),
        })),
        vessel: latest,
      };
    }),

  getPortArrivals: publicProcedure.query(async () => {
    const manifests = await persistedQuery<{
      vessel_name: string;
      eta: Date | string | null;
      port_of_discharge: string;
    }>(`
      SELECT vessel_name, eta, port_of_discharge
      FROM manifests
      WHERE eta IS NOT NULL
      ORDER BY eta ASC
      LIMIT 200
    `);
    if (manifests.length > 0) {
      const now = new Date();
      return {
        arrivals: manifests
          .filter(manifest => manifest.eta && new Date(manifest.eta) >= now)
          .map(manifest => ({
            vesselName: manifest.vessel_name,
            mmsi: null,
            eta: manifest.eta ? new Date(manifest.eta).toISOString() : null,
            berth: null,
            cargoType: null,
            teu: null,
            riskFlag: null,
            port: manifest.port_of_discharge,
          })),
        lastUpdate: new Date().toISOString(),
        sourceService: "manifests",
      };
    }

    const rows = await persistedQuery<VesselRow>(`
      SELECT DISTINCT ON (mmsi) mmsi, vessel_name, imo_number, latitude, longitude,
             speed, heading, destination_port, eta, cargo_type, flag_country, recorded_at
      FROM vessel_tracking_events
      ORDER BY mmsi, recorded_at DESC
    `);
    const arrivals = rows.filter(row => row.eta && new Date(row.eta) >= new Date());
    return {
      arrivals: arrivals.map(row => {
        const vessel = mapVessel(row);
        return {
          vesselName: vessel.vesselName,
          mmsi: vessel.mmsi,
          eta: vessel.eta,
          berth: null,
          cargoType: row.cargo_type,
          teu: null,
          riskFlag: vessel.riskFlag,
          port: vessel.destination,
        };
      }),
      lastUpdate: new Date().toISOString(),
      sourceService: "vessel_tracking_events",
    };
  }),

  getVesselStats: publicProcedure.query(async () => {
    const [stats] = await persistedQuery<{
      total: string; moored: string; anchored: string; underway: string;
    }>(`
      SELECT
        COUNT(DISTINCT mmsi) AS total,
        SUM(CASE WHEN speed < 0.5 THEN 1 ELSE 0 END) AS moored,
        SUM(CASE WHEN speed >= 0.5 AND speed < 2 THEN 1 ELSE 0 END) AS anchored,
        SUM(CASE WHEN speed >= 2 THEN 1 ELSE 0 END) AS underway
      FROM (${latestVesselsQuery}) latest
    `);
    const total = Number(stats?.total ?? 0);
    return {
      total,
      underway: Number(stats.underway ?? 0),
      moored: Number(stats.moored ?? 0),
      anchored: Number(stats.anchored ?? 0),
      redFlag: null,
      amberFlag: null,
      greenFlag: null,
      withDeclaration: null,
      sourceService: "vessel_tracking_events",
    };
  }),

  logCargoEvent: protectedProcedure
    .input(z.object({
      mmsi: z.string(),
      vesselName: z.string(),
      eventType: z.enum(["arrived", "departed"]),
      portCode: z.string(),
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
      });
      return { success: true, eventType: input.eventType, mmsi: input.mmsi };
    }),

  searchVessels: publicProcedure
    .input(z.object({ q: z.string().min(2).max(100) }))
    .query(async ({ input }) => {
      const rows = await persistedQuery<VesselRow>(`
        SELECT DISTINCT ON (mmsi) mmsi, vessel_name, imo_number, latitude, longitude,
               speed, heading, destination_port, eta, cargo_type, flag_country, recorded_at
        FROM vessel_tracking_events
        WHERE vessel_name ILIKE $1 OR mmsi ILIKE $1 OR imo_number ILIKE $1
        ORDER BY mmsi, recorded_at DESC LIMIT 20
      `, [`%${input.q}%`]);
      return rows.map(mapVessel);
    }),

  getCargoHeatmapData: protectedProcedure
    .input(z.object({
      hours: z.number().int().min(1).max(168).default(24),
      limit: z.number().int().min(1).max(2000).default(500),
    }))
    .query(async ({ input }) => {
      const rows = await persistedQuery<{
        lat: number; lng: number; speed: number | null; recorded_at: Date; mmsi: string;
      }>(`
        SELECT latitude AS lat, longitude AS lng, speed, recorded_at, mmsi
        FROM vessel_tracking_events
        WHERE recorded_at >= NOW() - ($1 * INTERVAL '1 hour')
        ORDER BY recorded_at DESC
        LIMIT $2
      `, [input.hours, input.limit]);
      return {
        points: rows.map(row => ({
          lat: Number(row.lat),
          lng: Number(row.lng),
          weight: row.speed === null ? null : Math.min(Number(row.speed) / 30, 1),
          vesselId: row.mmsi,
          timestamp: row.recorded_at,
        })),
        sourceService: "vessel_tracking_events",
      };
    }),
});

let _vesselCache: LiveVessel[] = [];

async function _refreshVesselCache(): Promise<void> {
  try {
    const rows = await pgQuery<VesselRow>(latestVesselsQuery);
    _vesselCache = rows.map(mapVessel);
  } catch {
    _vesselCache = [];
  }
}

if (typeof setInterval !== "undefined") {
  setInterval(() => { void _refreshVesselCache(); }, 30_000);
  void _refreshVesselCache();
}

export function getLiveVesselsData() {
  return _vesselCache;
}
