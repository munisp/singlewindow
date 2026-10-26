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
      const key = process.env.OPENSANCTIONS_API_KEY;
      if (!key) {
        throw new TRPCError({
          code: "SERVICE_UNAVAILABLE",
          message: "Sanctions screening not configured — set OPENSANCTIONS_API_KEY",
        });
      }
      const url = `https://api.opensanctions.org/search/default?q=${encodeURIComponent(input.name)}&limit=10`;
      const data = await fetchJson(url, { headers: { Authorization: `ApiKey ${key}` } });
      const results: any[] = Array.isArray(data?.results) ? data.results : [];
      const matches = results.map((r: any) => ({
        name: String(r.caption ?? ""),
        schema: String(r.schema ?? ""),
        datasets: Array.isArray(r.datasets) ? r.datasets : [],
        score: typeof r.score === "number" ? r.score : null,
      }));
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
});
