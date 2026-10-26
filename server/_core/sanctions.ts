/**
 * Phase 33: shared OpenSanctions screening helper.
 *
 * Config-gated (fail-open-by-design for availability, but fully honest):
 * returns null when OPENSANCTIONS_API_KEY is unset — callers record/skip
 * accordingly. Upstream failures throw TRPCError SERVICE_UNAVAILABLE so
 * callers can log and continue without blocking business flows.
 */
import { TRPCError } from "@trpc/server";

export interface SanctionsMatch {
  name: string;
  schema: string;
  datasets: string[];
  score: number | null;
}

export interface SanctionsScreenResult {
  matches: SanctionsMatch[];
  topScore: number | null;
}

export function sanctionsConfigured(): boolean {
  return Boolean(process.env.OPENSANCTIONS_API_KEY);
}

export async function screenSanctions(name: string): Promise<SanctionsScreenResult> {
  const key = process.env.OPENSANCTIONS_API_KEY;
  if (!key) {
    throw new TRPCError({
      code: "SERVICE_UNAVAILABLE",
      message: "Sanctions screening not configured — set OPENSANCTIONS_API_KEY",
    });
  }
  const url = `https://api.opensanctions.org/search/default?q=${encodeURIComponent(name)}&limit=10`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  let data: any;
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { Authorization: `ApiKey ${key}` },
    });
    if (!res.ok) {
      throw new TRPCError({ code: "SERVICE_UNAVAILABLE", message: "Upstream unavailable: api.opensanctions.org" });
    }
    data = await res.json();
  } catch (err) {
    if (err instanceof TRPCError) throw err;
    throw new TRPCError({ code: "SERVICE_UNAVAILABLE", message: "Upstream unavailable: api.opensanctions.org" });
  } finally {
    clearTimeout(timer);
  }
  const results: any[] = Array.isArray(data?.results) ? data.results : [];
  const matches: SanctionsMatch[] = results.map((r: any) => ({
    name: String(r.caption ?? ""),
    schema: String(r.schema ?? ""),
    datasets: Array.isArray(r.datasets) ? r.datasets.map(String) : [],
    score: typeof r.score === "number" ? r.score : null,
  }));
  const scores = matches.map((m) => m.score ?? 0);
  return { matches, topScore: scores.length ? Math.max(...scores) : null };
}
