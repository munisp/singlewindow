/**
 * Phase 32 (W1): maritimeIntel — live-query intelligence layer over external
 * APIs (GDELT news, Open-Meteo marine/wind, aisstream.io AIS,
 * OpenSanctions). No database tables: every response is derived from live
 * upstream calls or explicit configuration state.
 *
 * FAIL-CLOSED doctrine: no stub/mock/synthetic data. Any upstream failure
 * surfaces as TRPCError SERVICE_UNAVAILABLE with an honest message; partial
 * failures are reported per-source via an `errors` array.
 */
import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import { TRPCError } from "@trpc/server";
import { getDb } from "../db";
import { invokeLLM } from "../_core/llm";
import { screenSanctions, sanctionsConfigured } from "../_core/sanctions";
import { aisVesselPositions, sanctionsScreenings, intelBriefs } from "../../drizzle/schema";
import { eq, desc, sql, and, gte, lte } from "drizzle-orm";

/**
 * Fetch JSON from an external API with a 10s timeout. Non-2xx responses,
 * network errors and timeouts all fail closed as SERVICE_UNAVAILABLE.
 */
async function fetchJson(url: string, opts?: { headers?: Record<string, string> }): Promise<any> {
  const host = new URL(url).host;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: opts?.headers,
    });
    if (!res.ok) {
      throw new TRPCError({ code: "SERVICE_UNAVAILABLE", message: `Upstream unavailable: ${host}` });
    }
    return await res.json();
  } catch (err) {
    if (err instanceof TRPCError) throw err;
    throw new TRPCError({ code: "SERVICE_UNAVAILABLE", message: `Upstream unavailable: ${host}` });
  } finally {
    clearTimeout(timer);
  }
}

interface IntelArticle {
  title: string;
  url: string;
  source: string;
  seendate: string;
  tone: number | null;
}

interface IntelEventsResult {
  articles: IntelArticle[];
  count: number;
}

/** Shared GDELT ArtList query logic (also used by portIntelSummary). */
async function queryGdeltArticles(query: string, timespanHours: number): Promise<IntelEventsResult> {
  const url = `https://api.gdeltproject.org/api/v2/doc/doc?query=${encodeURIComponent(query)}&mode=ArtList&maxrecords=25&format=json&timespan=${timespanHours}h`;
  let data: any;
  try {
    data = await fetchJson(url);
  } catch (err) {
    if (err instanceof TRPCError) throw err;
    // Non-JSON body (GDELT sometimes returns HTML error pages)
    throw new TRPCError({ code: "SERVICE_UNAVAILABLE", message: "Upstream unavailable: api.gdeltproject.org" });
  }
  if (!data || !Array.isArray(data.articles)) {
    throw new TRPCError({ code: "SERVICE_UNAVAILABLE", message: "Upstream unavailable: api.gdeltproject.org" });
  }
  const articles: IntelArticle[] = data.articles.map((a: any) => ({
    title: String(a.title ?? ""),
    url: String(a.url ?? ""),
    source: String(a.domain ?? ""),
    seendate: String(a.seendate ?? ""),
    tone: typeof a.tone === "number" ? a.tone : null,
  }));
  return { articles, count: articles.length };
}

interface MarineWeatherResult {
  marine: Record<string, unknown> | null;
  wind: Record<string, unknown> | null;
  errors: string[];
}

/** Shared Open-Meteo marine + wind query logic (also used by portIntelSummary). */
async function queryMarineWeather(lat: number, lon: number): Promise<MarineWeatherResult> {
  const marineUrl = `https://marine-api.open-meteo.com/v1/marine?latitude=${lat}&longitude=${lon}&current=wave_height,wave_period,wind_wave_height&forecast_days=1`;
  const windUrl = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=wind_speed_10m,wind_direction_10m`;
  const [marineRes, windRes] = await Promise.allSettled([fetchJson(marineUrl), fetchJson(windUrl)]);
  const errors: string[] = [];
  let marine: Record<string, unknown> | null = null;
  let wind: Record<string, unknown> | null = null;
  if (marineRes.status === "fulfilled") {
    marine = marineRes.value;
  } else {
    errors.push(marineRes.reason instanceof TRPCError ? marineRes.reason.message : "Upstream unavailable: marine-api.open-meteo.com");
  }
  if (windRes.status === "fulfilled") {
    wind = windRes.value;
  } else {
    errors.push(windRes.reason instanceof TRPCError ? windRes.reason.message : "Upstream unavailable: api.open-meteo.com");
  }
  if (!marine && !wind) {
    throw new TRPCError({ code: "SERVICE_UNAVAILABLE", message: "Upstream unavailable: api.open-meteo.com" });
  }
  return { marine, wind, errors };
}

/** Static port coordinates for Nigerian ports covered by portIntelSummary. */
const PORT_COORDS: Record<string, { lat: number; lon: number }> = {
  "Lagos Apapa": { lat: 6.45, lon: 3.36 },
  "Tin Can Island": { lat: 6.44, lon: 3.34 },
  "Onne": { lat: 4.72, lon: 7.15 },
  "Port Harcourt": { lat: 4.77, lon: 7.01 },
  "Calabar": { lat: 4.97, lon: 8.32 },
  "Warri": { lat: 5.52, lon: 5.75 },
  "Lekki": { lat: 6.44, lon: 4.03 },
  "Bonny": { lat: 4.45, lon: 7.17 },
};

const PortEnum = z.enum(["Lagos Apapa", "Tin Can Island", "Onne", "Port Harcourt", "Calabar", "Warri", "Lekki", "Bonny"]);

export const maritimeIntelRouter = router({
  /**
   * GDELT ArtList news feed for maritime/port security events.
   */
  intelEvents: protectedProcedure
    .input(
      z
        .object({
          query: z.string().max(200).optional(),
          timespanHours: z.number().int().min(1).max(72).default(24),
        })
        .optional(),
    )
    .query(async ({ input }) => {
      const q = input?.query ?? "port OR maritime OR piracy OR shipping Nigeria";
      const h = input?.timespanHours ?? 24;
      return queryGdeltArticles(q, h);
    }),

  /**
   * Current marine conditions + wind at a coordinate. Partial upstream
   * failure is reported honestly via `errors`; total failure fails closed.
   */
  marineWeather: protectedProcedure
    .input(
      z.object({
        lat: z.number().min(-90).max(90),
        lon: z.number().min(-180).max(180),
      }),
    )
    .query(async ({ input }) => {
      return queryMarineWeather(input.lat, input.lon);
    }),

  /**
   * AIS vessel-tracking configuration status. Fail-closed: 503 until an
   * aisstream.io API key is provisioned.
   */
  vesselTrackingStatus: protectedProcedure.query(async () => {
    if (!process.env.AISSTREAM_API_KEY) {
      throw new TRPCError({
        code: "SERVICE_UNAVAILABLE",
        message: "AIS tracking not configured — set AISSTREAM_API_KEY",
      });
    }
    return {
      configured: true,
      provider: "aisstream.io",
      note: "WebSocket AIS streaming endpoint available; live map integration pending",
    };
  }),

  /**
   * OpenSanctions entity screening. Fail-closed: 503 until an API key is
   * provisioned.
   */
  sanctionsScreen: protectedProcedure
    .input(z.object({ name: z.string().min(2).max(256) }))
    .query(async ({ input }) => {
      const { matches } = await screenSanctions(input.name);
      return { matches, count: matches.length };
    }),

  /**
   * Combined per-port intelligence summary: marine weather + GDELT events
   * over the last 48h. Each side is independently fault-tolerant.
   */
  portIntelSummary: protectedProcedure
    .input(z.object({ port: PortEnum }))
    .query(async ({ input }) => {
      const coords = PORT_COORDS[input.port];
      const [weatherRes, eventsRes] = await Promise.allSettled([
        queryMarineWeather(coords.lat, coords.lon),
        queryGdeltArticles(`"${input.port}" port`, 48),
      ]);
      const errors: string[] = [];
      const weather = weatherRes.status === "fulfilled" ? weatherRes.value : null;
      if (weatherRes.status === "rejected") {
        errors.push(weatherRes.reason instanceof TRPCError ? weatherRes.reason.message : String(weatherRes.reason));
      } else if (weather && weather.errors.length > 0) {
        errors.push(...weather.errors);
      }
      const events = eventsRes.status === "fulfilled" ? eventsRes.value : null;
      if (eventsRes.status === "rejected") {
        errors.push(eventsRes.reason instanceof TRPCError ? eventsRes.reason.message : String(eventsRes.reason));
      }
      return { port: input.port, coords, weather, events, errors };
    }),
  // ─── Phase 33: live AIS positions, screening ledger, AI briefs ────────────

  /** Latest AIS positions, optionally scoped to a port's ±0.5° box. */
  vesselPositions: protectedProcedure
    .input(z.object({ port: PortEnum.optional() }).optional())
    .query(async ({ input }) => {
      if (!process.env.AISSTREAM_API_KEY) {
        throw new TRPCError({
          code: "SERVICE_UNAVAILABLE",
          message: "AIS tracking not configured — set AISSTREAM_API_KEY",
        });
      }
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "SERVICE_UNAVAILABLE", message: "Database unavailable" });
      const conditions = [];
      if (input?.port) {
        const c = PORT_COORDS[input.port];
        conditions.push(
          gte(aisVesselPositions.lat, c.lat - 0.5),
          lte(aisVesselPositions.lat, c.lat + 0.5),
          gte(aisVesselPositions.lon, c.lon - 0.5),
          lte(aisVesselPositions.lon, c.lon + 0.5),
        );
      }
      const rows = await db
        .select()
        .from(aisVesselPositions)
        .where(conditions.length ? and(...conditions) : undefined)
        .orderBy(desc(aisVesselPositions.lastSeenAt))
        .limit(200);
      return { vessels: rows, count: rows.length };
    }),

  /** Latest known position of a single vessel by MMSI. */
  vesselTrack: protectedProcedure
    .input(z.object({ mmsi: z.string().min(3).max(16) }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "SERVICE_UNAVAILABLE", message: "Database unavailable" });
      const [row] = await db
        .select()
        .from(aisVesselPositions)
        .where(eq(aisVesselPositions.mmsi, input.mmsi))
        .limit(1);
      if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "No AIS position recorded for this MMSI" });
      return row;
    }),

  /** Sanctions screening ledger (populated by the declaration-submit gate). */
  screeningsList: protectedProcedure
    .input(z.object({ declarationId: z.number().int().positive().optional() }).optional())
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "SERVICE_UNAVAILABLE", message: "Database unavailable" });
      const rows = await db
        .select()
        .from(sanctionsScreenings)
        .where(input?.declarationId ? eq(sanctionsScreenings.declarationId, input.declarationId) : undefined)
        .orderBy(desc(sanctionsScreenings.screenedAt))
        .limit(200);
      return { screenings: rows, count: rows.length, configured: sanctionsConfigured() };
    }),

  /**
   * AI daily port brief. Cached per port/day in intel_briefs; generated from
   * live GDELT events + marine weather (+ AIS vessel count when configured).
   * Fails closed when the LLM provider is unconfigured.
   */
  dailyBrief: protectedProcedure
    .input(z.object({ port: PortEnum }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "SERVICE_UNAVAILABLE", message: "Database unavailable" });
      const period = new Date().toISOString().slice(0, 10);

      const [cached] = await db
        .select()
        .from(intelBriefs)
        .where(and(eq(intelBriefs.port, input.port), eq(intelBriefs.period, period)))
        .limit(1);
      if (cached) return { port: cached.port, period: cached.period, content: cached.content, generatedAt: cached.generatedAt, cached: true };

      const coords = PORT_COORDS[input.port];
      const [eventsRes, weatherRes] = await Promise.allSettled([
        queryGdeltArticles(`"${input.port}" port OR "${input.port}" maritime`, 24),
        queryMarineWeather(coords.lat, coords.lon),
      ]);
      const events = eventsRes.status === "fulfilled" ? eventsRes.value : null;
      const weather = weatherRes.status === "fulfilled" ? weatherRes.value : null;

      let vesselCount: number | null = null;
      if (process.env.AISSTREAM_API_KEY) {
        const [vc] = await db
          .select({ n: sql<number>`count(*)::int` })
          .from(aisVesselPositions)
          .where(and(
            gte(aisVesselPositions.lat, coords.lat - 0.5), lte(aisVesselPositions.lat, coords.lat + 0.5),
            gte(aisVesselPositions.lon, coords.lon - 0.5), lte(aisVesselPositions.lon, coords.lon + 0.5),
            gte(aisVesselPositions.lastSeenAt, sql`now() - interval '6 hours'`),
          ));
        vesselCount = vc?.n ?? 0;
      }

      const facts = [
        `Port: ${input.port} (${coords.lat}, ${coords.lon})`,
        weather?.marine ? `Marine: ${JSON.stringify(weather.marine.current ?? weather.marine)}` : "Marine weather: unavailable",
        weather?.wind ? `Wind: ${JSON.stringify(weather.wind.current ?? weather.wind)}` : "Wind: unavailable",
        vesselCount != null ? `AIS vessels within 0.5° in last 6h: ${vesselCount}` : "AIS: not configured",
        events ? `News events (24h, ${events.count}): ${events.articles.slice(0, 8).map((a) => `- ${a.title} (${a.source})`).join("; ")}` : "News events: unavailable",
      ].join("\n");

      let content: string;
      try {
        const res = await invokeLLM({
          messages: [
            { role: "system", content: "You are a maritime operations intelligence analyst. Write a concise daily brief (max 200 words): current conditions, notable events, operational risks, and recommended watch items. Use only the facts provided; if a section's data is unavailable, say so plainly. Never invent figures." },
            { role: "user", content: facts },
          ],
        });
        const c = res.choices?.[0]?.message?.content;
        content = typeof c === "string" ? c : "";
        if (!content) throw new Error("empty LLM response");
      } catch (err) {
        throw new TRPCError({
          code: "SERVICE_UNAVAILABLE",
          message: `AI briefing unavailable: ${err instanceof Error ? err.message : "LLM provider error"}`,
        });
      }

      const [row] = await db
        .insert(intelBriefs)
        .values({ port: input.port, period, content })
        .onConflictDoNothing()
        .returning();
      const brief = row ?? (await db
        .select()
        .from(intelBriefs)
        .where(and(eq(intelBriefs.port, input.port), eq(intelBriefs.period, period)))
        .limit(1))[0];
      return { port: brief.port, period: brief.period, content: brief.content, generatedAt: brief.generatedAt, cached: false };
    }),
});
