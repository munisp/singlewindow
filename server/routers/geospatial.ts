/**
 * Geospatial tRPC Router
 * Port congestion heatmap, vessel tracking, and trade corridor data.
 * All queries are TiDB/PostgreSQL compatible (no PostGIS required).
 */
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { protectedProcedure, adminProcedure, router } from "../_core/trpc";
import {
  listPortLocations, getPortCongestionHistory, listVesselTracking,
  getHeatmapData, insertPortLocation, insertCongestionEvent,
  getPortCount, getCongestionCount, seedPortLocations, seedCongestionEvents,
} from "../db";

// ─── SEED DATA ────────────────────────────────────────────────────────────────
const SEED_PORTS = [
  { portCode: "GHTEM", portName: "Tema Port", country: "GHA", latitude: 5.6333, longitude: -0.0167, portType: "seaport" },
  { portCode: "RWAKG", portName: "Kigali Dry Port", country: "RWA", latitude: -1.9441, longitude: 30.0619, portType: "inland_port" },
  { portCode: "SGSIN", portName: "Port of Singapore", country: "SGP", latitude: 1.2655, longitude: 103.8198, portType: "seaport" },
  { portCode: "KENYB", portName: "Port of Mombasa", country: "KEN", latitude: -4.0435, longitude: 39.6682, portType: "seaport" },
  { portCode: "TZDAR", portName: "Port of Dar es Salaam", country: "TZA", latitude: -6.8235, longitude: 39.2895, portType: "seaport" },
  { portCode: "NGLAG", portName: "Port of Lagos (Apapa)", country: "NGA", latitude: 6.4474, longitude: 3.3903, portType: "seaport" },
  { portCode: "ZADRB", portName: "Port of Durban", country: "ZAF", latitude: -29.8587, longitude: 31.0218, portType: "seaport" },
  { portCode: "EGPSD", portName: "Port Said", country: "EGY", latitude: 31.2565, longitude: 32.2841, portType: "seaport" },
  { portCode: "MAPTM", portName: "Tanger Med", country: "MAR", latitude: 35.8847, longitude: -5.5028, portType: "seaport" },
  { portCode: "CNDAL", portName: "Port of Dalian", country: "CHN", latitude: 38.9140, longitude: 121.6147, portType: "seaport" },
];

async function ensurePortsSeed() {
  const count = await getPortCount();
  if (count > 0) return;
  await seedPortLocations(SEED_PORTS);
}

async function ensureCongestionSeed() {
  const count = await getCongestionCount();
  if (count > 0) return;
  const statuses = ["clear", "moderate", "congested", "critical"] as const;
  const events = SEED_PORTS.map((p, i) => ({
    portCode: p.portCode,
    congestionStatus: statuses[i % 4],
    vesselCount: Math.floor(Math.random() * 40) + 5,
    waitTimeHours: Math.random() * 48,
    declarationBacklog: Math.floor(Math.random() * 200),
    inspectionQueueSize: Math.floor(Math.random() * 50),
    metadata: { source: "seed" },
  }));
  await seedCongestionEvents(events);
}

export const geospatialRouter = router({
  /**
   * List all active port locations with latest congestion status.
   */
  listPorts: protectedProcedure
    .input(z.object({
      country: z.string().length(3).optional(),
      portType: z.string().optional(),
    }).optional())
    .query(async ({ input }) => {
      await ensurePortsSeed();
      await ensureCongestionSeed();
      const ports = await listPortLocations(input ?? undefined);
      if (!ports.length) {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      }
      return ports;
    }),

  /**
   * Get congestion history for a specific port.
   */
  portCongestionHistory: protectedProcedure
    .input(z.object({
      portCode: z.string().min(3).max(16),
      hours: z.number().min(1).max(168).default(24),
    }))
    .query(async ({ input }) => {
      const since = new Date(Date.now() - input.hours * 3600 * 1000);
      return getPortCongestionHistory(input.portCode, since);
    }),

  /**
   * Record a new congestion event (admin or customs officer).
   */
  recordCongestion: protectedProcedure
    .input(z.object({
      portCode: z.string().min(3).max(16),
      congestionStatus: z.enum(["clear", "moderate", "congested", "critical"]),
      vesselCount: z.number().int().min(0).optional(),
      waitTimeHours: z.number().min(0).optional(),
      declarationBacklog: z.number().int().min(0).optional(),
      inspectionQueueSize: z.number().int().min(0).optional(),
    }))
    .mutation(async ({ input }) => {
      const event = await insertCongestionEvent({
        portCode: input.portCode,
        congestionStatus: input.congestionStatus,
        vesselCount: input.vesselCount ?? 0,
        waitTimeHours: input.waitTimeHours ?? 0,
        declarationBacklog: input.declarationBacklog ?? 0,
        inspectionQueueSize: input.inspectionQueueSize ?? 0,
      });
      if (!event) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      return event;
    }),

  /**
   * List recent vessel tracking events.
   */
  listVessels: protectedProcedure
    .input(z.object({
      destinationPort: z.string().optional(),
      limit: z.number().min(1).max(200).default(50),
    }))
    .query(async ({ input }) => {
      return listVesselTracking({ destinationPort: input.destinationPort, limit: input.limit });
    }),

  /**
   * Record a vessel AIS position update.
   */
  recordVesselPosition: protectedProcedure
    .input(z.object({
      mmsi: z.string().min(9).max(16),
      vesselName: z.string().optional(),
      imoNumber: z.string().optional(),
      latitude: z.number().min(-90).max(90),
      longitude: z.number().min(-180).max(180),
      speed: z.number().min(0).max(50).optional(),
      heading: z.number().min(0).max(360).optional(),
      destinationPort: z.string().optional(),
      eta: z.date().optional(),
      cargoType: z.string().optional(),
      flagCountry: z.string().length(3).optional(),
    }))
    .mutation(async ({ input }) => {
      // Use insertCongestionEvent pattern - but for vessels we need direct db access
      // This is handled via the db helper
      const { insertVesselPosition } = await import("../db");
      const event = await insertVesselPosition(input);
      if (!event) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      return event;
    }),

  /**
   * Get heatmap data: aggregated congestion scores per port for map rendering.
   */
  heatmapData: protectedProcedure.query(async () => {
    await ensurePortsSeed();
    await ensureCongestionSeed();
    const rows = await getHeatmapData();
    const statusWeight: Record<string, number> = { clear: 0.1, moderate: 0.4, congested: 0.75, critical: 1.0 };

    return rows.map(row => ({
      portCode: row.portCode,
      portName: row.portName,
      country: null as string | null,
      lat: row.latitude,
      lng: row.longitude,
      portType: null as string | null,
      weight: statusWeight[row.congestionStatus ?? "clear"] ?? 0.2,
      congestionStatus: row.congestionStatus ?? "clear",
      vesselCount: row.vesselCount ?? 0,
      waitTimeHours: row.waitTimeHours ?? 0,
      declarationBacklog: row.declarationBacklog ?? 0,
      lastUpdated: row.recordedAt ?? null,
    }));
  }),

  /**
   * Admin: Add a new port location.
   */
  addPort: adminProcedure
    .input(z.object({
      portCode: z.string().min(3).max(16),
      portName: z.string().min(3).max(128),
      country: z.string().length(3),
      latitude: z.number().min(-90).max(90),
      longitude: z.number().min(-180).max(180),
      portType: z.string().default("seaport"),
    }))
    .mutation(async ({ input }) => {
      const port = await insertPortLocation(input);
      if (!port) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      return port;
    }),
});
