/**
 * tenant.ts — tRPC router for multi-tenancy and role federation (Sprint 47)
 * Manages customs administration tenants, per-tenant Keycloak realm config,
 * and super-admin provisioning of new national customs authorities.
 */

import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { protectedProcedure, adminProcedure, publicProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import { getDomainVerificationHistory, getDomainHealthSummary } from "../db";
import { tenants, tenantKeycloakConfig, tenantUsers, tenantBranding } from "../../drizzle/schema";
import { eq, desc, and, or } from "drizzle-orm";
import crypto from "crypto";

// ─── On-Demand TLS helpers ────────────────────────────────────────────────────

/** Allowed base domain suffixes for NGSWTP portals. */
const ALLOWED_BASE_DOMAINS = [
  ".ngswtp.gov",
  ".tradegateway.gov",
  ".customs.gov",
];

/**
 * Returns true if the hostname is an allowed NGSWTP subdomain OR is a
 * verified custom domain registered by an active tenant.
 * Called by Caddy's `on_demand_tls.ask` endpoint before issuing a cert.
 */
async function isHostnameAllowed(hostname: string): Promise<boolean> {
  // 1. Allow any *.ngswtp.gov / *.tradegateway.gov / *.customs.gov subdomain
  const isBase = ALLOWED_BASE_DOMAINS.some(suffix => hostname.endsWith(suffix));
  if (isBase) return true;
  // 2. Allow verified custom domains registered by active tenants
  const db = await getDb();
  if (!db) return false;
  const rows = await db
    .select({ id: tenants.id })
    .from(tenants)
    .where(
      and(
        eq(tenants.customDomain, hostname),
        eq(tenants.domainVerified, true),
        eq(tenants.status, "active")
      )
    )
    .limit(1);
  return rows.length > 0;
}

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

  /**
   * v119: getTenantBranding — get the white-label branding config for a tenant.
   * Admins can query any tenant; regular users get their own tenant's branding.
   */
  getTenantBranding: protectedProcedure
    .input(z.object({ tenantId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const isAdmin = ctx.user.role === "admin";
      if (!isAdmin) {
        // Verify user belongs to this tenant
        const db = await getDb();
        if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
        const [membership] = await db.select({ id: tenantUsers.id })
          .from(tenantUsers)
          .where(and(eq(tenantUsers.tenantId, input.tenantId), eq(tenantUsers.userId, ctx.user.id)))
          .limit(1);
        if (!membership) throw new TRPCError({ code: "FORBIDDEN", message: "Not a member of this tenant" });
      }

      const db = await getDb();
      if (!db) return null;

      const [branding] = await db.select().from(tenantBranding)
        .where(eq(tenantBranding.tenantId, input.tenantId))
        .limit(1);

      return branding ?? null;
    }),

  /**
   * v119: upsertTenantBranding — create or update white-label branding for a tenant.
   * Only admins or tenant admins can update branding.
   */
  upsertTenantBranding: protectedProcedure
    .input(z.object({
      tenantId: z.string().uuid(),
      platformName: z.string().min(1).max(128).optional(),
      logoUrl: z.string().url().optional().nullable(),
      faviconUrl: z.string().url().optional().nullable(),
      primaryColor: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
      accentColor: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
      supportEmail: z.string().email().optional().nullable(),
      supportPhone: z.string().max(64).optional().nullable(),
      footerText: z.string().max(500).optional().nullable(),
      customCss: z.string().max(10000).optional().nullable(),
      loginBannerUrl: z.string().url().optional().nullable(),
    }))
    .mutation(async ({ ctx, input }) => {
      if (ctx.user.role !== "admin") throw new TRPCError({ code: "FORBIDDEN", message: "Admin access required" });

      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

      const { tenantId, ...brandingFields } = input;
      const values = { ...brandingFields, tenantId, updatedBy: ctx.user.id, updatedAt: new Date() };

      const [result] = await db.insert(tenantBranding)
        .values(values as any)
        .onConflictDoUpdate({
          target: tenantBranding.tenantId,
          set: { ...brandingFields, updatedBy: ctx.user.id, updatedAt: new Date() },
        })
        .returning();

      return result;
    }),

  /**
   * v119: resetTenantBranding — reset a tenant's branding to platform defaults.
   */
  resetTenantBranding: adminProcedure
    .input(z.object({ tenantId: z.string().uuid() }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      await db.delete(tenantBranding).where(eq(tenantBranding.tenantId, input.tenantId));
      return { success: true, message: "Branding reset to platform defaults" };
    }),

  // ─── Caddy On-Demand TLS ───────────────────────────────────────────────────────────────

  /**
   * validateHostname — Caddy's `on_demand_tls.ask` endpoint.
   *
   * Caddy sends a GET /api/trpc/tenant.validateHostname?input={"domain":"<hostname>"}
   * before issuing any ACME certificate via On-Demand TLS.
   * Returns HTTP 200 if the hostname is allowed, HTTP 403 otherwise.
   *
   * This is a PUBLIC procedure — Caddy calls it before the TLS handshake
   * completes, so there is no session cookie or Bearer token available.
   * The only secret is the shared CADDY_ASK_SECRET header that Caddy
   * sets in its `on_demand_tls.ask` block (validated below).
   */
  validateHostname: publicProcedure
    .input(z.object({ domain: z.string().min(1).max(253) }))
    .query(async ({ input, ctx }) => {
      // Validate the shared secret Caddy sends in X-Caddy-Ask-Secret
      const askSecret = process.env.CADDY_ASK_SECRET;
      if (askSecret) {
        const incoming = ctx.req.headers["x-caddy-ask-secret"] as string | undefined;
        if (incoming !== askSecret) {
          throw new TRPCError({ code: "FORBIDDEN", message: "Invalid ask secret" });
        }
      }
      const allowed = await isHostnameAllowed(input.domain);
      if (!allowed) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: `Hostname '${input.domain}' is not registered for On-Demand TLS`,
        });
      }
      return { allowed: true, domain: input.domain };
    }),

  /**
   * registerCustomDomain — admin registers a custom hostname for a tenant.
   * Generates a DNS TXT verification token that the tenant must publish.
   */
  registerCustomDomain: adminProcedure
    .input(
      z.object({
        tenantId: z.string().uuid(),
        domain: z
          .string()
          .min(4)
          .max(253)
          .regex(/^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$/, {
            message: "Invalid hostname format",
          }),
      })
    )
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

      // Check for conflicts with other tenants
      const conflict = await db
        .select({ id: tenants.id })
        .from(tenants)
        .where(and(eq(tenants.customDomain, input.domain)))
        .limit(1);
      if (conflict.length) {
        throw new TRPCError({ code: "CONFLICT", message: `Domain '${input.domain}' is already registered` });
      }

      const token = `ngswtp-verify-${crypto.randomBytes(16).toString("hex")}`;
      await db
        .update(tenants)
        .set({
          customDomain: input.domain,
          domainVerified: false,
          domainVerifiedAt: null,
          domainVerificationToken: token,
          updatedAt: new Date(),
        })
        .where(eq(tenants.id, input.tenantId));

      return {
        domain: input.domain,
        verificationToken: token,
        dnsRecord: {
          type: "TXT",
          name: `_ngswtp-verify.${input.domain}`,
          value: token,
          ttl: 300,
        },
        message: `Add the DNS TXT record below, then call verifyCustomDomain to complete verification.`,
      };
    }),

  /**
   * verifyCustomDomain — checks DNS TXT record and marks domain as verified.
   * On success, Caddy's On-Demand TLS will start issuing certs for this hostname.
   */
  verifyCustomDomain: adminProcedure
    .input(z.object({ tenantId: z.string().uuid() }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

      const [tenant] = await db
        .select({
          id: tenants.id,
          customDomain: tenants.customDomain,
          domainVerificationToken: tenants.domainVerificationToken,
          domainVerified: tenants.domainVerified,
        })
        .from(tenants)
        .where(eq(tenants.id, input.tenantId))
        .limit(1);

      if (!tenant) throw new TRPCError({ code: "NOT_FOUND", message: "Tenant not found" });
      if (!tenant.customDomain) throw new TRPCError({ code: "BAD_REQUEST", message: "No custom domain registered" });
      if (tenant.domainVerified) return { verified: true, domain: tenant.customDomain, alreadyVerified: true };

      // DNS TXT lookup
      const { promises: dns } = await import("dns");
      const txtName = `_ngswtp-verify.${tenant.customDomain}`;
      let found = false;
      try {
        const records = await dns.resolveTxt(txtName);
        found = records.some(r => r.join("") === tenant.domainVerificationToken);
      } catch {
        // DNS lookup failed — domain not yet propagated
      }

      if (!found) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: `DNS TXT record not found for ${txtName}. Ensure the record has propagated (TTL 300s).`,
        });
      }

      await db
        .update(tenants)
        .set({ domainVerified: true, domainVerifiedAt: new Date(), updatedAt: new Date() })
        .where(eq(tenants.id, input.tenantId));

      return { verified: true, domain: tenant.customDomain, alreadyVerified: false };
    }),

  /**
   * removeCustomDomain — admin removes a custom domain from a tenant.
   * Caddy will stop issuing certs for this hostname on the next renewal cycle.
   */
  removeCustomDomain: adminProcedure
    .input(z.object({ tenantId: z.string().uuid() }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      await db
        .update(tenants)
        .set({
          customDomain: null,
          domainVerified: false,
          domainVerifiedAt: null,
          domainVerificationToken: null,
          updatedAt: new Date(),
        })
        .where(eq(tenants.id, input.tenantId));
      return { success: true };
    }),

  /** List all tenants with their custom domain status (for the admin domain dashboard) */
  listTenantDomains: adminProcedure.query(async () => {
    const db = await getDb();
    if (!db) return [];
    return db
      .select({
        id: tenants.id,
        name: tenants.name,
        slug: tenants.slug,
        country: tenants.country,
        status: tenants.status,
        customDomain: tenants.customDomain,
        domainVerified: tenants.domainVerified,
        domainVerifiedAt: tenants.domainVerifiedAt,
      })
      .from(tenants)
      .orderBy(desc(tenants.createdAt));
  }),

  /**
   * validateCustomDomain — called by Caddy's On-Demand TLS 'ask' endpoint.
   * Returns 200 if the hostname is a verified tenant custom domain, 403 otherwise.
   * Caddy will only issue a certificate for hostnames that return 200.
   *
   * Called as: GET /api/trpc/tenant.validateCustomDomain?input={"domain":"..."}
   */
  validateCustomDomain: publicProcedure
    .input(z.object({ domain: z.string().min(1).max(253) }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) {
        // In dev/sandbox without DB, reject all On-Demand TLS requests
        throw new TRPCError({ code: "FORBIDDEN", message: "Domain not registered" });
      }
      const [tenant] = await db
        .select({ id: tenants.id, name: tenants.name })
        .from(tenants)
        .where(
          and(
            eq(tenants.customDomain, input.domain),
            eq(tenants.domainVerified, true),
          )
        )
        .limit(1);
      if (!tenant) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Domain not registered or not verified" });
      }
      return { allowed: true, tenantId: tenant.id, tenantName: tenant.name };
    }),

  /**
   * getDomainVerificationHistory — returns the last N verification events for a tenant.
   * Used by the Domain Health tab in TenantManagement.
   */
  getDomainVerificationHistory: protectedProcedure
    .input(z.object({
      tenantId: z.string().uuid(),
      limit: z.number().int().min(1).max(50).default(10),
    }))
    .query(async ({ input }) => {
      return getDomainVerificationHistory(input.tenantId, input.limit);
    }),

  /**
   * getDomainHealthSummary — aggregates the last 30 events for a tenant into
   * a health summary (success rate, last outcome, last checked).
   */
  getDomainHealthSummary: protectedProcedure
    .input(z.object({ tenantId: z.string().uuid() }))
    .query(async ({ input }) => {
      return getDomainHealthSummary(input.tenantId);
    }),
});