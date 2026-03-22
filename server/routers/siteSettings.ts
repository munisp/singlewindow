/**
 * Sprint 118 — Site Settings Router
 * Key-value store for configurable platform settings editable by admins.
 * Includes seed defaults for known settings (e.g. sla_breach_email_threshold).
 */
import { TRPCError } from "@trpc/server";
import { desc, eq } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "../db";
import { settingsAuditLog, siteSettings } from "../../drizzle/schema";
import { protectedProcedure, router } from "../_core/trpc";

// Known settings with defaults and descriptions
export const KNOWN_SETTINGS: Record<string, { defaultValue: string; description: string }> = {
  sla_breach_email_threshold: {
    defaultValue: "5",
    description: "Minimum number of SLA-breached declarations required to trigger an escalation email digest to the supervisor.",
  },
  sla_green_hours: {
    defaultValue: "4",
    description: "SLA threshold in hours for green-lane declarations.",
  },
  sla_yellow_hours: {
    defaultValue: "24",
    description: "SLA threshold in hours for yellow-lane declarations.",
  },
  sla_red_hours: {
    defaultValue: "72",
    description: "SLA threshold in hours for red-lane declarations.",
  },
  sla_blue_hours: {
    defaultValue: "48",
    description: "SLA threshold in hours for blue-lane declarations.",
  },
};

export const siteSettingsRouter = router({
  /**
   * List all site settings. Admins only.
   */
  list: protectedProcedure.query(async ({ ctx }) => {
    if (ctx.user.role !== "admin") {
      throw new TRPCError({ code: "FORBIDDEN", message: "Admin access required" });
    }
    const db = await getDb();
    if (!db) return [];

    const rows = await db.select().from(siteSettings);

    // Merge with known defaults so all known keys appear even if not yet persisted
    const persisted = new Map(rows.map((r) => [r.key, r]));
    const merged = Object.entries(KNOWN_SETTINGS).map(([key, meta]) => {
      const row = persisted.get(key);
      return {
        key,
        value: row?.value ?? meta.defaultValue,
        description: meta.description,
        updatedAt: row?.updatedAt ?? null,
        updatedBy: row?.updatedBy ?? null,
        isPersisted: !!row,
      };
    });

    // Append any custom (non-known) settings from DB
    for (const row of rows) {
      if (!KNOWN_SETTINGS[row.key]) {
        merged.push({
          key: row.key,
          value: row.value,
          description: row.description ?? "",
          updatedAt: row.updatedAt,
          updatedBy: row.updatedBy ?? null,
          isPersisted: true,
        });
      }
    }

    return merged;
  }),

  /**
   * Get a single setting by key. Falls back to default if not persisted.
   * Accessible by all authenticated users (for reading thresholds etc.).
   */
  get: protectedProcedure
    .input(z.object({ key: z.string().min(1).max(128) }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) {
        return { key: input.key, value: KNOWN_SETTINGS[input.key]?.defaultValue ?? null };
      }
      const [row] = await db
        .select()
        .from(siteSettings)
        .where(eq(siteSettings.key, input.key))
        .limit(1);
      return {
        key: input.key,
        value: row?.value ?? KNOWN_SETTINGS[input.key]?.defaultValue ?? null,
      };
    }),

  /**
   * Upsert a setting. Admins only.
   */
  set: protectedProcedure
    .input(
      z.object({
        key: z.string().min(1).max(128),
        value: z.string().max(4096),
      })
    )
    .mutation(async ({ ctx, input }) => {
      if (ctx.user.role !== "admin") {
        throw new TRPCError({ code: "FORBIDDEN", message: "Admin access required" });
      }
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

      const description = KNOWN_SETTINGS[input.key]?.description ?? null;

      // Read old value for audit log
      const [existing] = await db
        .select({ value: siteSettings.value })
        .from(siteSettings)
        .where(eq(siteSettings.key, input.key))
        .limit(1);
      const oldValue = existing?.value ?? null;

      await db
        .insert(siteSettings)
        .values({
          key: input.key,
          value: input.value,
          description,
          updatedAt: new Date(),
          updatedBy: ctx.user.id,
        })
        .onConflictDoUpdate({
          target: siteSettings.key,
          set: {
            value: input.value,
            updatedAt: new Date(),
            updatedBy: ctx.user.id,
          },
        });

      // Record audit log entry
      await db.insert(settingsAuditLog).values({
        settingKey: input.key,
        oldValue,
        newValue: input.value,
        changedBy: ctx.user.id,
        changedByName: ctx.user.name ?? ctx.user.email ?? String(ctx.user.id),
        changedAt: new Date(),
      });

      return { success: true, key: input.key, value: input.value };
    }),

  /**
   * List audit log entries for a given setting key (or all). Admins only.
   */
  listAuditLog: protectedProcedure
    .input(z.object({ key: z.string().min(1).max(128).optional(), limit: z.number().int().min(1).max(200).default(50) }))
    .query(async ({ ctx, input }) => {
      if (ctx.user.role !== "admin") {
        throw new TRPCError({ code: "FORBIDDEN", message: "Admin access required" });
      }
      const db = await getDb();
      if (!db) return [];

      const query = db
        .select()
        .from(settingsAuditLog)
        .orderBy(desc(settingsAuditLog.changedAt))
        .limit(input.limit);

      if (input.key) {
        return query.where(eq(settingsAuditLog.settingKey, input.key));
      }
      return query;
    }),
});
