/**
 * WP-10 — fail-closed client for blueeconomy-geo-service.
 *
 * Doctrine: geospatial reads/writes that depend on the geo-service must never
 * silently fall back to local or synthetic data. When the service is not
 * configured the caller receives { configured: false } and must surface an
 * honest GEO_SERVICE_UNCONFIGURED state. When it IS configured but
 * unreachable or returns an error, the call THROWS GeoServiceError — the
 * caller surfaces 503-style honesty, never stale-or-fake data.
 *
 * Env-only secrets:
 *   GEO_SERVICE_URL    e.g. https://geo-service.internal:8443  (no trailing /)
 *   GEO_SERVICE_TOKEN  service bearer token (never committed)
 *   GEO_SERVICE_TENANT tenant binding for RLS-scoped reads (default "singlewindow")
 */

export class GeoServiceError extends Error {
  constructor(
    message: string,
    public readonly status: number | null,
    public readonly upstreamBody?: string,
  ) {
    super(message);
    this.name = "GeoServiceError";
  }
}

export interface GeoServiceConfig {
  configured: boolean;
  url: string | null;
  tenant: string;
}

export function geoServiceConfig(): GeoServiceConfig {
  const url = (process.env.GEO_SERVICE_URL ?? "").trim().replace(/\/+$/, "");
  const token = (process.env.GEO_SERVICE_TOKEN ?? "").trim();
  return {
    configured: url.length > 0 && token.length > 0,
    url: url.length > 0 ? url : null,
    tenant: (process.env.GEO_SERVICE_TENANT ?? "singlewindow").trim(),
  };
}

const DEFAULT_TIMEOUT_MS = 8_000;

/** Fail-closed fetch. Throws GeoServiceError when configured-but-failing. */
export async function geoServiceFetch<T = unknown>(
  path: string,
  init: { method?: string; body?: unknown; timeoutMs?: number } = {},
): Promise<T> {
  const cfg = geoServiceConfig();
  if (!cfg.configured || !cfg.url) {
    throw new GeoServiceError("GEO_SERVICE_UNCONFIGURED: GEO_SERVICE_URL/GEO_SERVICE_TOKEN are not set", null);
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), init.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  try {
    const res = await fetch(`${cfg.url}${path}`, {
      method: init.method ?? "GET",
      headers: {
        authorization: `Bearer ${process.env.GEO_SERVICE_TOKEN}`,
        "content-type": "application/json",
        "x-tenant-id": cfg.tenant,
      },
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
      signal: controller.signal,
    });
    const text = await res.text();
    if (!res.ok) {
      throw new GeoServiceError(
        `GEO_SERVICE_UPSTREAM_${res.status}: ${path} failed`,
        res.status,
        text.slice(0, 500),
      );
    }
    return (text ? JSON.parse(text) : null) as T;
  } catch (err) {
    if (err instanceof GeoServiceError) throw err;
    const reason = err instanceof Error && err.name === "AbortError" ? "timeout" : String(err);
    throw new GeoServiceError(`GEO_SERVICE_UNREACHABLE: ${path} (${reason})`, null);
  } finally {
    clearTimeout(timer);
  }
}

/** Readiness probe that never throws — for honest status surfacing. */
export async function geoServiceStatus(): Promise<
  { configured: false } | { configured: true; reachable: boolean; detail?: string }
> {
  const cfg = geoServiceConfig();
  if (!cfg.configured) return { configured: false };
  try {
    await geoServiceFetch("/healthz", { timeoutMs: 3_000 });
    return { configured: true, reachable: true };
  } catch (err) {
    return { configured: true, reachable: false, detail: err instanceof Error ? err.message : String(err) };
  }
}
