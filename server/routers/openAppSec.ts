/**
 * OpenAppSec WAF Events tRPC Router — Sprint v81
 * Admin/security procedures for WAF event monitoring and triage.
 */
import { z } from "zod";
import { router, adminProcedure } from "../_core/trpc";
import { TRPCError } from "@trpc/server";

const SEVERITIES = ["critical", "high", "medium", "low"] as const;
const ATTACK_TYPES = [
  "SQL_INJECTION",
  "XSS",
  "PATH_TRAVERSAL",
  "COMMAND_INJECTION",
  "CSRF",
  "BROKEN_AUTH",
  "SENSITIVE_DATA_EXPOSURE",
  "RATE_LIMIT_EXCEEDED",
  "BOT_DETECTED",
  "MALFORMED_REQUEST",
] as const;

const SOURCE_IPS = [
  "192.168.1.45", "10.0.0.123", "172.16.0.88",
  "203.0.113.42", "198.51.100.7", "185.220.101.3",
];

// Dev-mode GeoIP seed data keyed by IP
const DEV_GEOIP: Record<string, { country: string; countryCode: string; city: string; asn: string; asnOrg: string }> = {
  "192.168.1.45":   { country: "Ghana",          countryCode: "GH", city: "Accra",       asn: "AS37055", asnOrg: "Vodafone Ghana" },
  "10.0.0.123":     { country: "Singapore",       countryCode: "SG", city: "Singapore",   asn: "AS9506",  asnOrg: "Singtel" },
  "172.16.0.88":    { country: "Rwanda",          countryCode: "RW", city: "Kigali",      asn: "AS37243", asnOrg: "MTN Rwanda" },
  "203.0.113.42":   { country: "Russia",          countryCode: "RU", city: "Moscow",      asn: "AS49505", asnOrg: "Selectel" },
  "198.51.100.7":   { country: "China",           countryCode: "CN", city: "Beijing",     asn: "AS4134",  asnOrg: "CHINANET" },
  "185.220.101.3":  { country: "Netherlands",     countryCode: "NL", city: "Amsterdam",   asn: "AS60729", asnOrg: "Tor Exit Node" },
};

const COUNTRY_FLAGS: Record<string, string> = {
  GH: "🇬🇭", SG: "🇸🇬", RW: "🇷🇼", RU: "🇷🇺", CN: "🇨🇳", NL: "🇳🇱", US: "🇺🇸", GB: "🇬🇧",
};

function makeDevEvent(i: number) {
  const severity = SEVERITIES[i % SEVERITIES.length];
  const attackType = ATTACK_TYPES[i % ATTACK_TYPES.length];
  const sourceIp = SOURCE_IPS[i % SOURCE_IPS.length];
  const geo = DEV_GEOIP[sourceIp];
  return {
    id: i + 1,
    eventId: `waf-evt-${(10000 + i).toString(16)}`,
    attackType,
    severity,
    sourceIp,
    targetPath: `/api/trpc/${["declarations", "payments", "kyc", "oga", "risk"][i % 5]}.${["list", "get", "create", "update"][i % 4]}`,
    requestMethod: ["GET", "POST", "PUT", "DELETE"][i % 4],
    userAgent: i % 2 === 0 ? "Mozilla/5.0 (compatible; Googlebot/2.1)" : "sqlmap/1.7.8",
    payload: attackType === "SQL_INJECTION" ? "' OR 1=1 --" : attackType === "XSS" ? "<script>alert(1)</script>" : null,
    ruleId: `OWASP-CRS-${900 + i}`,
    action: severity === "critical" ? "BLOCK" : "LOG",
    isAcknowledged: i % 5 === 0,
    acknowledgedBy: i % 5 === 0 ? 1 : null,
    createdAt: new Date(Date.now() - i * 900_000),
    // Geolocation fields
    country: geo?.country ?? null,
    countryCode: geo?.countryCode ?? null,
    countryFlag: geo?.countryCode ? (COUNTRY_FLAGS[geo.countryCode] ?? "🌐") : "🌐",
    city: geo?.city ?? null,
    asn: geo?.asn ?? null,
    asnOrg: geo?.asnOrg ?? null,
  };
}

export const openAppSecRouter = router({
  /**
   * getWafEvents — paginated list of WAF security events.
   */
  getWafEvents: adminProcedure
    .input(
      z.object({
        limit: z.number().int().min(1).max(500).default(50),
        offset: z.number().int().min(0).default(0),
        severity: z.enum(SEVERITIES).optional(),
        attackType: z.string().optional(),
        isAcknowledged: z.boolean().optional(),
        sourceIp: z.string().optional(),
      }).optional()
    )
    .query(async ({ input }) => {
      if (process.env.NODE_ENV !== "production") {
        const rows = Array.from({ length: 80 }, (_, i) => makeDevEvent(i));
        const filtered = rows.filter((r) => {
          if (input?.severity && r.severity !== input.severity) return false;
          if (input?.attackType && r.attackType !== input.attackType) return false;
          if (input?.isAcknowledged !== undefined && r.isAcknowledged !== input.isAcknowledged) return false;
          if (input?.sourceIp && r.sourceIp !== input.sourceIp) return false;
          return true;
        });
        return {
          events: filtered.slice(input?.offset ?? 0, (input?.offset ?? 0) + (input?.limit ?? 50)),
          total: filtered.length,
        };
      }
      const { getOpenAppSecEvents } = await import("../db");
      const events = await getOpenAppSecEvents({
        limit: input?.limit,
        offset: input?.offset,
        severity: input?.severity,
        attackType: input?.attackType,
        isAcknowledged: input?.isAcknowledged,
      });
      return { events, total: events.length };
    }),

  /**
   * acknowledgeEvent — mark a WAF event as acknowledged by the current admin.
   */
  acknowledgeEvent: adminProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ input, ctx }) => {
      if (process.env.NODE_ENV !== "production") {
        return { success: true, id: input.id, acknowledgedBy: ctx.user.id };
      }
      const { acknowledgeOpenAppSecEvent } = await import("../db");
      const row = await acknowledgeOpenAppSecEvent(input.id, ctx.user.id);
      if (!row) throw new TRPCError({ code: "NOT_FOUND", message: `WAF event ${input.id} not found` });
      return { success: true, id: row.id, acknowledgedBy: row.acknowledgedBy };
    }),

  /**
   * bulkAcknowledge — acknowledge multiple WAF events at once.
   */
  bulkAcknowledge: adminProcedure
    .input(z.object({ ids: z.array(z.number().int().positive()).min(1).max(200) }))
    .mutation(async ({ input, ctx }) => {
      if (process.env.NODE_ENV !== "production") {
        return { success: true, acknowledged: input.ids.length };
      }
      const { acknowledgeOpenAppSecEvent } = await import("../db");
      await Promise.all(input.ids.map((id) => acknowledgeOpenAppSecEvent(id, ctx.user.id)));
      return { success: true, acknowledged: input.ids.length };
    }),

  /**
   * getWafStats — summary counts by severity + unacknowledged total.
   */
  getWafStats: adminProcedure
    .query(async () => {
      if (process.env.NODE_ENV !== "production") {
        return { critical: 3, high: 12, medium: 28, low: 47, unacknowledged: 64 };
      }
      const { getOpenAppSecEventStats } = await import("../db");
      const stats = await getOpenAppSecEventStats();
      return stats ?? { critical: 0, high: 0, medium: 0, low: 0, unacknowledged: 0 };
    }),

  /**
   * getAttackTypes — list of distinct attack types for filter dropdowns.
   */
  getAttackTypes: adminProcedure
    .query(async () => {
      return [...ATTACK_TYPES];
    }),
});
