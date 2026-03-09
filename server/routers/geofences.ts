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
