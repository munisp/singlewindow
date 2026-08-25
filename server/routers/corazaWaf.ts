/**
 * corazaWaf.ts — tRPC router for Coraza WAF rule management (Sprint Caddy)
 *
 * Provides admin procedures to:
 *   - List OWASP CRS rules with their current enabled/disabled status
 *   - Toggle individual rules on/off with an audit trail
 *   - Bulk-enable/disable by category or severity
 *   - Query WAF event stats correlated with specific rule IDs
 *
 * In production, rule state changes are also written to a Caddy admin API
 * endpoint that hot-reloads the Coraza plugin config without restarting Caddy.
 */

import { z } from "zod";
import { router, keycloakAdminProcedure } from "../_core/trpc";
import { TRPCError } from "@trpc/server";
import { getDb } from "../db";
import { corazaWafRules } from "../../drizzle/schema";
import { eq, and, inArray, desc, sql } from "drizzle-orm";

// ─── OWASP CRS seed data ──────────────────────────────────────────────────────
// A representative subset of OWASP Core Rule Set 4.x rules.
// In production these are read from the Coraza rule files; here we seed the DB
// with the most commonly tuned rules.

const OWASP_CRS_SEED = [
  // REQUEST-911: Method Enforcement
  { ruleId: "911100", category: "OWASP-CRS", severity: "critical", description: "Method is not allowed by policy" },
  // REQUEST-920: Protocol Enforcement
  { ruleId: "920100", category: "OWASP-CRS", severity: "medium",   description: "Invalid HTTP Request Line" },
  { ruleId: "920170", category: "OWASP-CRS", severity: "medium",   description: "GET or HEAD Request with Body Content" },
  { ruleId: "920300", category: "OWASP-CRS", severity: "low",      description: "Request Missing an Accept Header" },
  { ruleId: "920350", category: "OWASP-CRS", severity: "medium",   description: "Host header is a numeric IP address" },
  // REQUEST-930: Local File Inclusion
  { ruleId: "930100", category: "OWASP-CRS", severity: "critical", description: "Path Traversal Attack (/../)" },
  { ruleId: "930110", category: "OWASP-CRS", severity: "critical", description: "Path Traversal Attack (/../) — URL encoding" },
  { ruleId: "930120", category: "OWASP-CRS", severity: "high",     description: "OS File Access Attempt" },
  // REQUEST-932: Remote Command Execution
  { ruleId: "932100", category: "OWASP-CRS", severity: "critical", description: "Remote Command Execution: Unix Command Injection" },
  { ruleId: "932105", category: "OWASP-CRS", severity: "critical", description: "Remote Command Execution: Unix Command Injection" },
  { ruleId: "932150", category: "OWASP-CRS", severity: "critical", description: "Remote Command Execution: Direct Unix Command Execution" },
  // REQUEST-941: XSS
  { ruleId: "941100", category: "OWASP-CRS", severity: "high",     description: "XSS Attack Detected via libinjection" },
  { ruleId: "941110", category: "OWASP-CRS", severity: "high",     description: "XSS Filter — Category 1: Script Tag Vector" },
  { ruleId: "941120", category: "OWASP-CRS", severity: "high",     description: "XSS Filter — Category 2: Event Handler Vector" },
  { ruleId: "941130", category: "OWASP-CRS", severity: "high",     description: "XSS Filter — Category 3: Attribute Vector" },
  { ruleId: "941160", category: "OWASP-CRS", severity: "high",     description: "NoScript XSS InjectionChecker: HTML Injection" },
  // REQUEST-942: SQL Injection
  { ruleId: "942100", category: "OWASP-CRS", severity: "critical", description: "SQL Injection Attack Detected via libinjection" },
  { ruleId: "942110", category: "OWASP-CRS", severity: "critical", description: "SQL Injection Attack: Common Injection Testing Detected" },
  { ruleId: "942120", category: "OWASP-CRS", severity: "critical", description: "SQL Injection Attack: SQL Operator Detected" },
  { ruleId: "942130", category: "OWASP-CRS", severity: "critical", description: "SQL Injection Attack: SQL Tautology Detected" },
  { ruleId: "942150", category: "OWASP-CRS", severity: "high",     description: "SQL Injection Attack" },
  { ruleId: "942200", category: "OWASP-CRS", severity: "high",     description: "Detects MySQL comment-/space-obfuscated injections" },
  { ruleId: "942260", category: "OWASP-CRS", severity: "high",     description: "Detects basic SQL authentication bypass attempts 2/3" },
  // REQUEST-944: Java Attack
  { ruleId: "944100", category: "OWASP-CRS", severity: "critical", description: "Remote Command Execution: Suspicious Java class detected" },
  { ruleId: "944110", category: "OWASP-CRS", severity: "critical", description: "Remote Code Execution: Java process spawn" },
  // Custom NGSWTP rules
  { ruleId: "9900001", category: "NGSWTP-CUSTOM", severity: "high",    description: "NGSWTP: Suspicious HS code enumeration pattern" },
  { ruleId: "9900002", category: "NGSWTP-CUSTOM", severity: "critical", description: "NGSWTP: Declaration tampering attempt detected" },
  { ruleId: "9900003", category: "NGSWTP-CUSTOM", severity: "high",    description: "NGSWTP: Excessive OGA API polling (rate limit)" },
  { ruleId: "9900004", category: "NGSWTP-CUSTOM", severity: "medium",  description: "NGSWTP: Unusual trader registration burst" },
] as const;

// ─── Caddy admin API helper ───────────────────────────────────────────────────

const CADDY_ADMIN_URL = process.env.CADDY_ADMIN_URL ?? "http://localhost:2019";

/**
 * Notifies Caddy's admin API to reload the Coraza WAF configuration.
 * In production, this triggers a hot-reload of the Coraza plugin without
 * restarting Caddy. In dev/sandbox it is a no-op (Caddy not running).
 */
async function notifyCaddyReload(): Promise<{ reloaded: boolean; error?: string }> {
  try {
    const res = await fetch(`${CADDY_ADMIN_URL}/load`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reload: "coraza" }),
      signal: AbortSignal.timeout(3000),
    });
    return { reloaded: res.ok };
  } catch (err) {
    return { reloaded: false, error: String(err) };
  }
}

// ─── Router ──────────────────────────────────────────────────────────────────

export const corazaWafRouter = router({
  /**
   * listRules — list all Coraza WAF rules with their current state.
   * Seeds the DB with OWASP CRS defaults if no rules exist yet.
   */
  listRules: keycloakAdminProcedure
    .input(
      z.object({
        category: z.string().optional(),
        severity: z.enum(["critical", "high", "medium", "low"]).optional(),
        enabled: z.boolean().optional(),
        paranoiaLevel: z.number().int().min(1).max(4).optional(),
        page: z.number().int().min(1).default(1),
        pageSize: z.number().int().min(1).max(100).default(50),
      }).optional()
    )
    .query(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) {
        // Return seed data when DB is unavailable (dev/sandbox)
        return {
          rules: OWASP_CRS_SEED.map((r, i) => ({
            id: i + 1,
            ruleId: r.ruleId,
            enabled: true,
            severity: r.severity,
            category: r.category,
            description: r.description,
            disabledBy: null,
            disabledAt: null,
            enabledBy: null,
            enabledAt: null,
            changeReason: null,
            createdAt: new Date(),
            updatedAt: new Date(),
          })),
          total: OWASP_CRS_SEED.length,
          page: 1,
          pageSize: 50,
          seeded: false,
        };
      }

      // Auto-seed DB if empty
      const existing = await db.select({ id: corazaWafRules.id }).from(corazaWafRules).limit(1);
      if (!existing.length) {
        await db.insert(corazaWafRules).values(
          OWASP_CRS_SEED.map(r => ({
            ruleId: r.ruleId,
            enabled: true,
            severity: r.severity,
            category: r.category,
            description: r.description,
            createdAt: new Date(),
            updatedAt: new Date(),
          }))
        );
      }

      const conditions = [];
      if (input?.category) conditions.push(eq(corazaWafRules.category, input.category));
      if (input?.severity) conditions.push(eq(corazaWafRules.severity, input.severity));
      if (input?.enabled !== undefined) conditions.push(eq(corazaWafRules.enabled, input.enabled));
      if (input?.paranoiaLevel !== undefined) conditions.push(eq(corazaWafRules.paranoiaLevel, input.paranoiaLevel));

      const page = input?.page ?? 1;
      const pageSize = input?.pageSize ?? 50;
      const offset = (page - 1) * pageSize;

      const [rules, [{ count }]] = await Promise.all([
        db
          .select()
          .from(corazaWafRules)
          .where(conditions.length ? and(...conditions) : undefined)
          .orderBy(desc(corazaWafRules.severity), corazaWafRules.ruleId)
          .limit(pageSize)
          .offset(offset),
        db
          .select({ count: sql<number>`COUNT(*)` })
          .from(corazaWafRules)
          .where(conditions.length ? and(...conditions) : undefined),
      ]);

      return { rules, total: Number(count), page, pageSize, seeded: true };
    }),

  /**
   * toggleRule — enable or disable a single Coraza rule with an audit trail.
   * Also triggers a Caddy hot-reload.
   */
  toggleRule: keycloakAdminProcedure
    .input(
      z.object({
        ruleId: z.string().min(1).max(32),
        enabled: z.boolean(),
        reason: z.string().max(500).optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

      const [existing] = await db
        .select({ id: corazaWafRules.id })
        .from(corazaWafRules)
        .where(eq(corazaWafRules.ruleId, input.ruleId))
        .limit(1);

      if (!existing) {
        throw new TRPCError({ code: "NOT_FOUND", message: `Rule ${input.ruleId} not found` });
      }

      const now = new Date();
      await db
        .update(corazaWafRules)
        .set({
          enabled: input.enabled,
          disabledBy: input.enabled ? null : ctx.user.id,
          disabledAt: input.enabled ? null : now,
          enabledBy: input.enabled ? ctx.user.id : null,
          enabledAt: input.enabled ? now : null,
          changeReason: input.reason ?? null,
          updatedAt: now,
        })
        .where(eq(corazaWafRules.ruleId, input.ruleId));

      const caddyResult = await notifyCaddyReload();

      return {
        ruleId: input.ruleId,
        enabled: input.enabled,
        changedBy: ctx.user.id,
        changedAt: now,
        caddyReloaded: caddyResult.reloaded,
        caddyError: caddyResult.error,
      };
    }),

  /**
   * bulkToggleRules — enable or disable multiple rules at once (by category or explicit list).
   */
  bulkToggleRules: keycloakAdminProcedure
    .input(
      z.object({
        ruleIds: z.array(z.string()).min(1).max(200).optional(),
        category: z.string().optional(),
        enabled: z.boolean(),
        reason: z.string().max(500).optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

      if (!input.ruleIds && !input.category) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Provide either ruleIds or category" });
      }

      const now = new Date();
      const setValues = {
        enabled: input.enabled,
        disabledBy: input.enabled ? null : ctx.user.id,
        disabledAt: input.enabled ? null : now,
        enabledBy: input.enabled ? ctx.user.id : null,
        enabledAt: input.enabled ? now : null,
        changeReason: input.reason ?? null,
        updatedAt: now,
      };

      let affectedCount = 0;

      if (input.ruleIds) {
        const result = await db
          .update(corazaWafRules)
          .set(setValues)
          .where(inArray(corazaWafRules.ruleId, input.ruleIds));
        affectedCount = input.ruleIds.length;
      } else if (input.category) {
        const rows = await db
          .select({ id: corazaWafRules.id })
          .from(corazaWafRules)
          .where(eq(corazaWafRules.category, input.category));
        if (rows.length) {
          await db
            .update(corazaWafRules)
            .set(setValues)
            .where(eq(corazaWafRules.category, input.category));
          affectedCount = rows.length;
        }
      }

      const caddyResult = await notifyCaddyReload();

      return {
        affectedCount,
        enabled: input.enabled,
        changedBy: ctx.user.id,
        changedAt: now,
        caddyReloaded: caddyResult.reloaded,
      };
    }),

  /**
   * getRuleStats — summary of enabled/disabled counts by category and severity.
   */
  getRuleStats: keycloakAdminProcedure.query(async () => {
    const db = await getDb();
    if (!db) {
      const total = OWASP_CRS_SEED.length;
      const byCat: Record<string, number> = {};
      const bySev: Record<string, number> = {};
      for (const r of OWASP_CRS_SEED) {
        byCat[r.category] = (byCat[r.category] ?? 0) + 1;
        bySev[r.severity] = (bySev[r.severity] ?? 0) + 1;
      }
      return { total, enabled: total, disabled: 0, byCategory: byCat, bySeverity: bySev };
    }

    const rows = await db
      .select({
        category: corazaWafRules.category,
        severity: corazaWafRules.severity,
        enabled: corazaWafRules.enabled,
        count: sql<number>`COUNT(*)`,
      })
      .from(corazaWafRules)
      .groupBy(corazaWafRules.category, corazaWafRules.severity, corazaWafRules.enabled);

    let total = 0, enabled = 0, disabled = 0;
    const byCategory: Record<string, number> = {};
    const bySeverity: Record<string, number> = {};

    for (const row of rows) {
      const n = Number(row.count);
      total += n;
      if (row.enabled) enabled += n; else disabled += n;
      byCategory[row.category] = (byCategory[row.category] ?? 0) + n;
      bySeverity[row.severity] = (bySeverity[row.severity] ?? 0) + n;
    }

    return { total, enabled, disabled, byCategory, bySeverity };
  }),

  /**
   * getRecentChanges — audit log of the last N rule state changes.
   */
  getRecentChanges: keycloakAdminProcedure
    .input(z.object({ limit: z.number().int().min(1).max(100).default(20) }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return [];
      return db
        .select({
          id: corazaWafRules.id,
          ruleId: corazaWafRules.ruleId,
          enabled: corazaWafRules.enabled,
          severity: corazaWafRules.severity,
          category: corazaWafRules.category,
          description: corazaWafRules.description,
          disabledBy: corazaWafRules.disabledBy,
          disabledAt: corazaWafRules.disabledAt,
          enabledBy: corazaWafRules.enabledBy,
          enabledAt: corazaWafRules.enabledAt,
          changeReason: corazaWafRules.changeReason,
          updatedAt: corazaWafRules.updatedAt,
        })
        .from(corazaWafRules)
        .where(sql`${corazaWafRules.disabledAt} IS NOT NULL OR ${corazaWafRules.enabledAt} IS NOT NULL`)
        .orderBy(desc(corazaWafRules.updatedAt))
        .limit(input.limit);
    }),

  /**
   * getCaddyAdminStatus — check if Caddy's admin API is reachable.
   */
  getCaddyAdminStatus: keycloakAdminProcedure.query(async () => {
    try {
      const res = await fetch(`${CADDY_ADMIN_URL}/config/`, {
        signal: AbortSignal.timeout(3000),
      });
      if (res.ok) {
        const config = await res.json();
        return {
          reachable: true,
          version: (config as any)?.apps?.http?.servers ? "detected" : "unknown",
          adminUrl: CADDY_ADMIN_URL,
        };
      }
      return { reachable: false, adminUrl: CADDY_ADMIN_URL, error: `HTTP ${res.status}` };
    } catch (err) {
      return { reachable: false, adminUrl: CADDY_ADMIN_URL, error: String(err) };
    }
  }),

  /**
   * getTopFiringRules — returns the top N Coraza rule IDs by event count,
   * correlated against openAppSecEvents.ruleId (stored as OWASP-CRS-<ruleId>).
   * In dev mode returns seeded data; in production queries the DB.
   */
  getTopFiringRules: keycloakAdminProcedure
    .input(z.object({ limit: z.number().int().min(1).max(50).default(10) }).optional())
    .query(async ({ input }) => {
      const limit = input?.limit ?? 10;
      if (process.env.NODE_ENV !== "production") {
        // Return seeded dev data correlated with OWASP_CRS_SEED rule IDs
        return [
          { ruleId: "942100", description: "SQL Injection via libinjection",     category: "OWASP-CRS", severity: "critical", eventCount: 47, enabled: true },
          { ruleId: "941100", description: "XSS via libinjection",               category: "OWASP-CRS", severity: "high",     eventCount: 31, enabled: true },
          { ruleId: "930100", description: "Path Traversal (/../)",              category: "OWASP-CRS", severity: "critical", eventCount: 22, enabled: true },
          { ruleId: "932100", description: "Unix Command Injection",             category: "OWASP-CRS", severity: "critical", eventCount: 18, enabled: true },
          { ruleId: "942110", description: "SQL Injection Testing Detected",     category: "OWASP-CRS", severity: "critical", eventCount: 15, enabled: true },
          { ruleId: "941110", description: "XSS — Script Tag Vector",           category: "OWASP-CRS", severity: "high",     eventCount: 12, enabled: true },
          { ruleId: "920350", description: "Host header is numeric IP",          category: "OWASP-CRS", severity: "medium",   eventCount: 9,  enabled: true },
          { ruleId: "932150", description: "Direct Unix Command Execution",      category: "OWASP-CRS", severity: "critical", eventCount: 7,  enabled: false },
          { ruleId: "930120", description: "OS File Access Attempt",             category: "OWASP-CRS", severity: "high",     eventCount: 5,  enabled: true },
          { ruleId: "NGSWTP-001", description: "HS Code Injection Attempt",      category: "NGSWTP-Custom", severity: "high", eventCount: 4, enabled: true },
        ].slice(0, limit);
      }
      const db = await getDb();
      if (!db) return [];
      const { openAppSecEvents } = await import("../../drizzle/schema");
      const { count, like, isNotNull } = await import("drizzle-orm");
      // openAppSecEvents stores ruleId as "OWASP-CRS-<ruleId>" — strip prefix for join
      const rows = await db
        .select({
          rawRuleId: openAppSecEvents.id, // placeholder — we use sql below
          eventCount: count(openAppSecEvents.id),
        })
        .from(openAppSecEvents)
        .where(isNotNull(sql`${openAppSecEvents}.rule_id`))
        .groupBy(sql`${openAppSecEvents}.rule_id`)
        .orderBy(desc(count(openAppSecEvents.id)))
        .limit(limit);
      // Enrich with rule metadata from corazaWafRules table
      const ruleIds = rows.map((r: any) =>
        String(r.rawRuleId).replace(/^OWASP-CRS-/, "").replace(/^NGSWTP-/, "NGSWTP-")
      );
      const rules = ruleIds.length > 0
        ? await db.select().from(corazaWafRules).where(inArray(corazaWafRules.ruleId, ruleIds))
        : [];
      const ruleMap = new Map(rules.map((r) => [r.ruleId, r]));
      return rows.map((r: any, i: number) => ({
        ruleId: ruleIds[i],
        description: ruleMap.get(ruleIds[i])?.description ?? "Unknown rule",
        category: ruleMap.get(ruleIds[i])?.category ?? "OWASP-CRS",
        severity: ruleMap.get(ruleIds[i])?.severity ?? "medium",
        eventCount: Number(r.eventCount),
        enabled: ruleMap.get(ruleIds[i])?.enabled ?? true,
      }));
    }),

  /**
   * getEventsForRule — returns recent WAF events for a specific Coraza rule ID.
   * Correlates openAppSecEvents with corazaWafRules by ruleId.
   */
  getEventsForRule: keycloakAdminProcedure
    .input(z.object({
      ruleId: z.string().min(1),
      limit: z.number().int().min(1).max(200).default(20),
    }))
    .query(async ({ input }) => {
      if (process.env.NODE_ENV !== "production") {
        // Return seeded dev events for the requested rule
        const ATTACK_MAP: Record<string, string> = {
          "942100": "SQL_INJECTION", "941100": "XSS", "930100": "PATH_TRAVERSAL",
          "932100": "COMMAND_INJECTION", "NGSWTP-001": "SQL_INJECTION",
        };
        const attackType = ATTACK_MAP[input.ruleId] ?? "MALFORMED_REQUEST";
        return Array.from({ length: Math.min(input.limit, 8) }, (_, i) => ({
          id: i + 1,
          eventId: `waf-rule-${input.ruleId}-${i}`,
          attackType,
          severity: ["critical", "high", "medium"][i % 3],
          sourceIp: ["203.0.113.42", "185.220.101.3", "198.51.100.7"][i % 3],
          targetPath: `/api/trpc/declarations.${["create", "list", "update"][i % 3]}`,
          action: i % 3 === 0 ? "BLOCK" : "LOG",
          isAcknowledged: i % 4 === 0,
          createdAt: new Date(Date.now() - i * 1_800_000),
          ruleId: `OWASP-CRS-${input.ruleId}`,
        }));
      }
      const db = await getDb();
      if (!db) return [];
      const { openAppSecEvents } = await import("../../drizzle/schema");
      const { like } = await import("drizzle-orm");
      return db
        .select()
        .from(openAppSecEvents)
        .where(like(sql`${openAppSecEvents}.rule_id`, `%${input.ruleId}%`))
        .orderBy(desc(openAppSecEvents.createdAt))
        .limit(input.limit);
    }),

  /**
   * getEventCorrelationSummary — aggregate WAF event counts per rule for
   * the last N days, used to populate the heatmap in CorazaWafDashboard.
   */
  /**
   * exportEventsCSV — returns all WAF event correlation data as a CSV string
   * for the specified time window. Used by the "Export CSV" button in
   * CorazaWafDashboard.
   */
  exportEventsCSV: keycloakAdminProcedure
    .input(z.object({
      days: z.number().int().min(1).max(90).default(7),
      ruleId: z.string().optional(),
    }))
    .query(async ({ input }) => {
      const days = input.days;
      if (process.env.NODE_ENV !== "production") {
        // Dev: generate synthetic CSV rows
        const headers = ["Rule ID", "Attack Type", "Severity", "Source IP", "Target Path", "Action", "Acknowledged", "Timestamp"];
        const rows = Array.from({ length: 20 }, (_, i) => [
          `OWASP-CRS-94${2100 + i}`,
          ["SQL_INJECTION", "XSS", "PATH_TRAVERSAL", "COMMAND_INJECTION"][i % 4],
          ["critical", "high", "medium", "low"][i % 4],
          ["203.0.113.42", "185.220.101.3", "198.51.100.7"][i % 3],
          `/api/trpc/declarations.${["create", "list", "update"][i % 3]}`,
          i % 3 === 0 ? "BLOCK" : "LOG",
          i % 4 === 0 ? "true" : "false",
          new Date(Date.now() - i * 3_600_000).toISOString(),
        ]);
        const csv = [headers, ...rows].map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(",")).join("\n");
        return { csv, rowCount: rows.length, generatedAt: new Date().toISOString() };
      }
      const db = await getDb();
      if (!db) return { csv: "", rowCount: 0, generatedAt: new Date().toISOString() };
      const { openAppSecEvents } = await import("../../drizzle/schema");
      const { gte, like } = await import("drizzle-orm");
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - days);
      const conditions: any[] = [gte(openAppSecEvents.createdAt, cutoff)];
      if (input.ruleId) {
        conditions.push(like(sql`${openAppSecEvents}.rule_id`, `%${input.ruleId}%`));
      }
      const events = await db
        .select()
        .from(openAppSecEvents)
        .where(and(...conditions))
        .orderBy(desc(openAppSecEvents.createdAt))
        .limit(5000);
      const headers = ["Event ID", "Rule ID", "Attack Type", "Severity", "Source IP", "Target Path", "Action", "Acknowledged", "Timestamp"];
      const rows = events.map(e => [
        String(e.id ?? ""),
        String((e as any).ruleId ?? (e as any).rule_id ?? ""),
        String((e as any).attackType ?? (e as any).attack_type ?? ""),
        String((e as any).severity ?? ""),
        String((e as any).sourceIp ?? (e as any).source_ip ?? ""),
        String((e as any).targetPath ?? (e as any).target_path ?? ""),
        String((e as any).action ?? ""),
        String((e as any).isAcknowledged ?? (e as any).is_acknowledged ?? false),
        e.createdAt ? new Date(e.createdAt).toISOString() : "",
      ]);
      const csv = [headers, ...rows]
        .map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(","))
        .join("\n");
      return { csv, rowCount: rows.length, generatedAt: new Date().toISOString() };
    }),

  getEventCorrelationSummary: keycloakAdminProcedure
    .input(z.object({ days: z.number().int().min(1).max(90).default(7) }).optional())
    .query(async ({ input }) => {
      const days = input?.days ?? 7;
      if (process.env.NODE_ENV !== "production") {
        const RULE_IDS = ["942100", "941100", "930100", "932100", "942110", "941110", "920350", "932150"];
        return RULE_IDS.map((ruleId) => ({
          ruleId,
          totalEvents: Math.floor(Math.random() * 50) + 1,
          blockedEvents: Math.floor(Math.random() * 30),
          loggedEvents: Math.floor(Math.random() * 20),
          lastEventAt: new Date(Date.now() - Math.random() * 86_400_000 * days).toISOString(),
        }));
      }
      const db = await getDb();
      if (!db) return [];
      const { openAppSecEvents } = await import("../../drizzle/schema");
      const { gte, count } = await import("drizzle-orm");
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - days);
      const rows = await db
        .select({
          ruleId: sql<string>`${openAppSecEvents}.rule_id`,
          totalEvents: count(openAppSecEvents.id),
          blockedEvents: sql<number>`SUM(CASE WHEN ${openAppSecEvents.action} = 'block' THEN 1 ELSE 0 END)`,
          loggedEvents: sql<number>`SUM(CASE WHEN ${openAppSecEvents.action} = 'log' THEN 1 ELSE 0 END)`,
          lastEventAt: sql<string>`MAX(${openAppSecEvents.createdAt})`,
        })
        .from(openAppSecEvents)
        .where(and(gte(openAppSecEvents.createdAt, cutoff), sql`${openAppSecEvents}.rule_id IS NOT NULL`))
        .groupBy(sql`${openAppSecEvents}.rule_id`)
        .orderBy(desc(count(openAppSecEvents.id)))
        .limit(50);
      return rows.map((r) => ({
        ruleId: String(r.ruleId ?? "").replace(/^OWASP-CRS-/, ""),
        totalEvents: Number(r.totalEvents),
        blockedEvents: Number(r.blockedEvents ?? 0),
        loggedEvents: Number(r.loggedEvents ?? 0),
        lastEventAt: String(r.lastEventAt ?? ""),
      }));
    }),
});
