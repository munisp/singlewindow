/**
 * Geofences Router — Sprint 73
 * Manage port entry/exit geofence zones and trigger vessel alerts.
 */
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { adminProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import { geofences, geofenceEvents } from "../../drizzle/schema";
import { eq, desc, and, gte, count } from "drizzle-orm";
import { notifyOwner } from "../_core/notification";
import { geoServiceFetch, geoServiceStatus } from "../_core/geoServiceClient";

// ─── WP-10: geo-service backed geofencing (fail-closed) ─────────────────────
// The authoritative geofence engine is blueeconomy-geo-service (PostGIS-backed
// versioned fences, signed geo.geofence-event.v1 transitions). The procedures
// below consume it fail-closed: when GEO_SERVICE_URL/GEO_SERVICE_TOKEN are
// unset they return an honest GEO_SERVICE_UNCONFIGURED state; when the
// service is configured but failing they surface the upstream error — they
// NEVER silently fall back to the legacy local tables.
//
// The legacy local-table procedures above are retained for migration but must
// be treated as deprecated; new consumers use the remote* procedures.

function toMicrosRing(polygon: Array<{ lat: number; lon: number }>): [number, number][] {
  const ring = polygon.map(p => [Math.round(p.lat * 1e6), Math.round(p.lon * 1e6)] as [number, number]);
  const first = ring[0];
  const last = ring[ring.length - 1];
  if (first[0] !== last[0] || first[1] !== last[1]) ring.push([...first] as [number, number]);
  return ring;
}

const polygonPointSchema = z.object({ lat: z.number(), lon: z.number() });

async function requireDb() {
  const db = await getDb();
  if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
  return db;
}

export const geofencesRouter = router({
  /** List all geofences (admin) */
  list: adminProcedure
    .input(z.object({ status: z.enum(["active", "inactive", "draft", "all"]).default("all") }).optional())
    .query(async ({ input }) => {
      const db = await requireDb();
      const rows = await db
        .select()
        .from(geofences)
        .where(input?.status && input.status !== "all" ? eq(geofences.status, input.status) : undefined)
        .orderBy(desc(geofences.createdAt));
      return rows;
    }),

  /** Get a single geofence */
  get: adminProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .query(async ({ input }) => {
      const db = await requireDb();
      const [row] = await db.select().from(geofences).where(eq(geofences.id, input.id));
      if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Geofence not found" });
      return row;
    }),

  /** Create a geofence */
  create: adminProcedure
    .input(z.object({
      name: z.string().min(3).max(128),
      portCode: z.string().optional(),
      geofenceType: z.enum(["port_entry", "port_exit", "restricted_zone", "customs_zone"]).default("port_entry"),
      polygon: z.array(polygonPointSchema).min(3),
      radiusMeters: z.number().int().positive().optional(),
      alertOnEntry: z.boolean().default(true),
      alertOnExit: z.boolean().default(false),
      notifyOwnerOnTrigger: z.boolean().default(true),
    }))
    .mutation(async ({ input, ctx }) => {
      const db = await requireDb();
      const [row] = await db.insert(geofences).values({
        name: input.name,
        portCode: input.portCode,
        geofenceType: input.geofenceType,
        status: "active",
        polygon: input.polygon,
        radiusMeters: input.radiusMeters,
        alertOnEntry: input.alertOnEntry,
        alertOnExit: input.alertOnExit,
        notifyOwnerOnTrigger: input.notifyOwnerOnTrigger,
        createdBy: ctx.user.id,
      }).returning();
      return row;
    }),

  /** Update a geofence */
  update: adminProcedure
    .input(z.object({
      id: z.number().int().positive(),
      name: z.string().min(3).max(128).optional(),
      status: z.enum(["active", "inactive", "draft"]).optional(),
      polygon: z.array(polygonPointSchema).min(3).optional(),
      alertOnEntry: z.boolean().optional(),
      alertOnExit: z.boolean().optional(),
      notifyOwnerOnTrigger: z.boolean().optional(),
    }))
    .mutation(async ({ input }) => {
      const db = await requireDb();
      const { id, ...updates } = input;
      const [row] = await db
        .update(geofences)
        .set({ ...updates, updatedAt: new Date() })
        .where(eq(geofences.id, id))
        .returning();
      return row;
    }),

  /** Delete a geofence */
  delete: adminProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ input }) => {
      const db = await requireDb();
      await db.delete(geofences).where(eq(geofences.id, input.id));
      return { success: true };
    }),

  /** List geofence events (vessel crossings) */
  listEvents: adminProcedure
    .input(z.object({
      geofenceId: z.number().int().positive().optional(),
      mmsi: z.string().optional(),
      limit: z.number().int().min(1).max(200).default(50),
    }))
    .query(async ({ input }) => {
      const db = await requireDb();
      const conditions = [];
      if (input.geofenceId) conditions.push(eq(geofenceEvents.geofenceId, input.geofenceId));
      if (input.mmsi) conditions.push(eq(geofenceEvents.mmsi, input.mmsi));

      const rows = await db
        .select()
        .from(geofenceEvents)
        .where(conditions.length > 0 ? and(...conditions) : undefined)
        .orderBy(desc(geofenceEvents.occurredAt))
        .limit(input.limit);
      return rows;
    }),

  /** Record a geofence crossing event */
  recordEvent: adminProcedure
    .input(z.object({
      geofenceId: z.number().int().positive(),
      mmsi: z.string(),
      vesselName: z.string().optional(),
      eventType: z.enum(["entry", "exit"]),
      lat: z.number(),
      lon: z.number(),
      speed: z.number().optional(),
    }))
    .mutation(async ({ input }) => {
      const db = await requireDb();
      const [fence] = await db.select().from(geofences).where(eq(geofences.id, input.geofenceId));
      if (!fence) throw new TRPCError({ code: "NOT_FOUND", message: "Geofence not found" });

      const [event] = await db.insert(geofenceEvents).values({
        geofenceId: input.geofenceId,
        mmsi: input.mmsi,
        vesselName: input.vesselName,
        eventType: input.eventType,
        lat: input.lat,
        lon: input.lon,
        speed: input.speed,
        notificationSent: false,
      }).returning();

      if (fence.notifyOwnerOnTrigger) {
        const notified = await notifyOwner({
          title: `Geofence Alert: ${input.eventType === "entry" ? "Entry" : "Exit"} — ${fence.name}`,
          content: `Vessel ${input.vesselName ?? input.mmsi} (MMSI: ${input.mmsi}) ${input.eventType === "entry" ? "entered" : "exited"} geofence zone "${fence.name}" at ${new Date().toISOString()}. Position: ${input.lat.toFixed(4)}, ${input.lon.toFixed(4)}. Speed: ${input.speed?.toFixed(1) ?? "—"} knots.`,
        });
        if (notified) {
          await db.update(geofenceEvents)
            .set({ notificationSent: true })
            .where(eq(geofenceEvents.id, event.id));
        }
      }

      return event;
    }),

  /** WP-10: geo-service connectivity/config status (never throws). */
  geoStatus: adminProcedure.query(async () => geoServiceStatus()),

  /** WP-10: list ACTIVE geofences from the geo-service (fail-closed). */
  remoteList: adminProcedure.query(async () => {
    try {
      return await geoServiceFetch("/v1/geo/fences");
    } catch (err) {
      if (err instanceof Error && err.message.startsWith("GEO_SERVICE_UNCONFIGURED")) {
        return {
          fences: [], count: 0, unavailable: true,
          message: "GEO_SERVICE_UNCONFIGURED: versioned geofencing requires GEO_SERVICE_URL/GEO_SERVICE_TOKEN. Legacy local geofences remain available via the deprecated list procedure.",
        };
      }
      throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: err instanceof Error ? err.message : String(err) });
    }
  }),

  /** WP-10: version history of one geofence from the geo-service. */
  remoteHistory: adminProcedure
    .input(z.object({ geofenceId: z.string().min(1).max(64) }))
    .query(async ({ input }) => {
      try {
        return await geoServiceFetch(`/v1/geo/fences/${encodeURIComponent(input.geofenceId)}`);
      } catch (err) {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: err instanceof Error ? err.message : String(err) });
      }
    }),

  /**
   * WP-10: create (or version) a geofence in the geo-service. expectedVersion
   * 0 creates a new fence; N creates version N+1 (optimistic concurrency).
   */
  createRemote: adminProcedure
    .input(z.object({
      geofenceId: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/),
      name: z.string().min(3).max(256),
      classification: z.enum(["PUBLIC", "INTERNAL", "RESTRICTED", "CONFIDENTIAL", "SECRET"]).default("INTERNAL"),
      polygon: z.array(polygonPointSchema).min(3),
      dwellThresholdSeconds: z.number().int().min(0).max(86400).default(0),
      dwellSpeedGateKnots: z.number().min(0).max(102.3).default(1),
      expectedVersion: z.number().int().min(0).default(0),
    }))
    .mutation(async ({ input }) => {
      try {
        return await geoServiceFetch("/v1/geo/fences", {
          method: "POST",
          body: {
            geofenceId: input.geofenceId,
            name: input.name,
            classification: input.classification,
            verticesMicros: toMicrosRing(input.polygon),
            dwellThresholdSeconds: input.dwellThresholdSeconds,
            dwellSpeedGateMilliknots: Math.round(input.dwellSpeedGateKnots * 1000),
            expectedVersion: input.expectedVersion,
          },
        });
      } catch (err) {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: err instanceof Error ? err.message : String(err) });
      }
    }),

  /** WP-10: provenanced fence transition events from the geo-service. */
  remoteEvents: adminProcedure
    .input(z.object({ geofenceId: z.string().min(1).max(64), limit: z.number().int().min(1).max(1000).default(100) }))
    .query(async ({ input }) => {
      try {
        return await geoServiceFetch(`/v1/geo/fences/${encodeURIComponent(input.geofenceId)}/events?limit=${input.limit}`);
      } catch (err) {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: err instanceof Error ? err.message : String(err) });
      }
    }),

  /** Get geofence statistics */
  stats: adminProcedure.query(async () => {
    const db = await requireDb();
    const [total] = await db.select({ count: count() }).from(geofences);
    const [active] = await db.select({ count: count() }).from(geofences).where(eq(geofences.status, "active"));
    const [events24h] = await db.select({ count: count() }).from(geofenceEvents)
      .where(gte(geofenceEvents.occurredAt, new Date(Date.now() - 24 * 60 * 60 * 1000)));
    return {
      totalGeofences: total?.count ?? 0,
      activeGeofences: active?.count ?? 0,
      events24h: events24h?.count ?? 0,
    };
  }),
});

export type GeofencesRouter = typeof geofencesRouter;
