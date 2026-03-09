/**
 * tenant.ts — tRPC router for multi-tenancy and role federation (Sprint 47)
 * Manages customs administration tenants, per-tenant Keycloak realm config,
 * and super-admin provisioning of new national customs authorities.
 */

import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { protectedProcedure, adminProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import { tenants, tenantKeycloakConfig, tenantUsers } from "../../drizzle/schema";
import { eq, desc, and } from "drizzle-orm";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function generateTenantSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 32);
}

function generateApiPrefix(slug: string): string {
  return `ngswtp_${slug.replace(/-/g, "_")}_`;
}

// ─── Router ──────────────────────────────────────────────────────────────────

export const tenantRouter = router({
  /** Super-admin: list all tenants */
  listTenants: adminProcedure.query(async () => {
    const db = await getDb();
    if (!db) return [];
    return db.select().from(tenants).orderBy(desc(tenants.createdAt));
  }),

  /** Super-admin: get a single tenant by ID */
  getTenant: adminProcedure
    .input(z.object({ tenantId: z.string().uuid() }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      const rows = await db.select().from(tenants).where(eq(tenants.id, input.tenantId)).limit(1);
      if (!rows.length) throw new TRPCError({ code: "NOT_FOUND", message: "Tenant not found" });
      return rows[0];
    }),

  /** Super-admin: provision a new national customs authority tenant */
  provisionTenant: adminProcedure
    .input(
      z.object({
        name: z.string().min(3).max(128),
        country: z.string().length(3),
        contactEmail: z.string().email(),
        plan: z.enum(["starter", "standard", "enterprise"]).default("standard"),
        keycloakRealm: z.string().min(3).max(64).optional(),
        keycloakClientId: z.string().min(3).max(128).optional(),
        keycloakDiscoveryUrl: z.string().url().optional(),
      })
    )
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

      const slug = generateTenantSlug(input.name);
      const apiPrefix = generateApiPrefix(slug);

      // Check for duplicate slug
      const existing = await db.select({ id: tenants.id }).from(tenants).where(eq(tenants.slug, slug)).limit(1);
      if (existing.length) {
        throw new TRPCError({ code: "CONFLICT", message: `Tenant slug '${slug}' already exists` });
      }

      const [tenant] = await db.insert(tenants).values({
        name: input.name,
        slug,
        country: input.country,
        contactEmail: input.contactEmail,
        plan: input.plan,
        apiPrefix,
        status: "active",
        createdAt: new Date(),
        updatedAt: new Date(),
      }).returning();

      // Optionally provision Keycloak config
      if (input.keycloakRealm && input.keycloakClientId && input.keycloakDiscoveryUrl) {
        await db.insert(tenantKeycloakConfig).values({
          tenantId: tenant.id,
          realm: input.keycloakRealm,
          clientId: input.keycloakClientId,
          discoveryUrl: input.keycloakDiscoveryUrl,
          enabled: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        });
      }

      return { tenant, apiPrefix, message: `Tenant '${input.name}' provisioned successfully` };
    }),

  /** Super-admin: update tenant status (active/suspended/deprovisioned) */
  updateTenantStatus: adminProcedure
    .input(
      z.object({
        tenantId: z.string().uuid(),
        status: z.enum(["active", "suspended", "deprovisioned"]),
        reason: z.string().max(256).optional(),
      })
    )
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      await db
        .update(tenants)
        .set({ status: input.status, updatedAt: new Date() })
        .where(eq(tenants.id, input.tenantId));
      return { success: true, tenantId: input.tenantId, status: input.status };
    }),

  /** Super-admin: configure per-tenant Keycloak realm */
  upsertKeycloakConfig: adminProcedure
    .input(
      z.object({
        tenantId: z.string().uuid(),
        realm: z.string().min(3).max(64),
        clientId: z.string().min(3).max(128),
        clientSecret: z.string().min(8).max(256).optional(),
        discoveryUrl: z.string().url(),
        roleMappings: z.record(z.string(), z.string()).optional(),
        enabled: z.boolean().default(true),
      })
    )
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

      const existing = await db
        .select({ id: tenantKeycloakConfig.id })
        .from(tenantKeycloakConfig)
        .where(eq(tenantKeycloakConfig.tenantId, input.tenantId))
        .limit(1);

      if (existing.length) {
        await db
          .update(tenantKeycloakConfig)
          .set({
            realm: input.realm,
            clientId: input.clientId,
            clientSecret: input.clientSecret,
            discoveryUrl: input.discoveryUrl,
            roleMappings: input.roleMappings ?? {},
            enabled: input.enabled,
            updatedAt: new Date(),
          })
          .where(eq(tenantKeycloakConfig.tenantId, input.tenantId));
      } else {
        await db.insert(tenantKeycloakConfig).values({
          tenantId: input.tenantId,
          realm: input.realm,
          clientId: input.clientId,
          clientSecret: input.clientSecret,
          discoveryUrl: input.discoveryUrl,
          roleMappings: input.roleMappings ?? {},
          enabled: input.enabled,
          createdAt: new Date(),
          updatedAt: new Date(),
        });
      }

      return { success: true, tenantId: input.tenantId };
    }),

  /** Get Keycloak config for a tenant (admin only — never expose clientSecret to frontend) */
  getTenantKeycloakConfig: adminProcedure
    .input(z.object({ tenantId: z.string().uuid() }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return null;
      const rows = await db
        .select({
          id: tenantKeycloakConfig.id,
          tenantId: tenantKeycloakConfig.tenantId,
          realm: tenantKeycloakConfig.realm,
          clientId: tenantKeycloakConfig.clientId,
          discoveryUrl: tenantKeycloakConfig.discoveryUrl,
          roleMappings: tenantKeycloakConfig.roleMappings,
          enabled: tenantKeycloakConfig.enabled,
          updatedAt: tenantKeycloakConfig.updatedAt,
        })
        .from(tenantKeycloakConfig)
        .where(eq(tenantKeycloakConfig.tenantId, input.tenantId))
        .limit(1);
      return rows[0] ?? null;
    }),

  /** List users belonging to a tenant */
  listTenantUsers: adminProcedure
    .input(z.object({ tenantId: z.string().uuid() }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return [];
      return db
        .select()
        .from(tenantUsers)
        .where(eq(tenantUsers.tenantId, input.tenantId))
        .orderBy(desc(tenantUsers.createdAt));
    }),

  /** Add a user to a tenant with a specific role */
  addTenantUser: adminProcedure
    .input(
      z.object({
        tenantId: z.string().uuid(),
        userId: z.number().int().positive(),
        role: z.enum(["admin", "customs_officer", "trader", "port_operator", "oga_officer", "auditor", "viewer"]),
      })
    )
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

      const existing = await db
        .select({ id: tenantUsers.id })
        .from(tenantUsers)
        .where(and(eq(tenantUsers.tenantId, input.tenantId), eq(tenantUsers.userId, input.userId)))
        .limit(1);

      if (existing.length) {
        throw new TRPCError({ code: "CONFLICT", message: "User already belongs to this tenant" });
      }

      const [row] = await db.insert(tenantUsers).values({
        tenantId: input.tenantId,
        userId: input.userId,
        role: input.role,
        createdAt: new Date(),
      }).returning();

      return row;
    }),

  /** Remove a user from a tenant */
  removeTenantUser: adminProcedure
    .input(z.object({ tenantId: z.string().uuid(), userId: z.number().int().positive() }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      await db
        .delete(tenantUsers)
        .where(and(eq(tenantUsers.tenantId, input.tenantId), eq(tenantUsers.userId, input.userId)));
      return { success: true };
    }),

  /** Get current user's tenant membership */
  getMyTenants: protectedProcedure.query(async ({ ctx }) => {
    const db = await getDb();
    if (!db) return [];
    return db
      .select({
        tenantId: tenantUsers.tenantId,
        role: tenantUsers.role,
        tenantName: tenants.name,
        tenantCountry: tenants.country,
        tenantStatus: tenants.status,
      })
      .from(tenantUsers)
      .innerJoin(tenants, eq(tenantUsers.tenantId, tenants.id))
      .where(eq(tenantUsers.userId, ctx.user.id));
  }),

  /** Get tenant statistics for the super-admin dashboard */
  getTenantStats: adminProcedure.query(async () => {
    const db = await getDb();
    if (!db) return { total: 0, active: 0, suspended: 0, deprovisioned: 0, by_plan: {} };
    const all = await db.select({ status: tenants.status, plan: tenants.plan }).from(tenants);
    const stats = { total: all.length, active: 0, suspended: 0, deprovisioned: 0, by_plan: {} as Record<string, number> };
    for (const t of all) {
      if (t.status === "active") stats.active++;
      else if (t.status === "suspended") stats.suspended++;
      else if (t.status === "deprovisioned") stats.deprovisioned++;
      stats.by_plan[t.plan] = (stats.by_plan[t.plan] ?? 0) + 1;
    }
    return stats;
  }),
});
