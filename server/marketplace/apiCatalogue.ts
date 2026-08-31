/**
 * WP-8 — Signed API Catalogue (OCEANS-X-style marketplace backbone)
 *
 * Every public API across the platform is registered here with:
 *   - OpenAPI reference, owner, classification, version, SLA
 *   - sha256 digest of its spec (JCS-canonical) — tamper-evident
 *
 * The catalogue is served signed (envelope v1.0: JCS + Ed25519 JWS) so any
 * tampering with entries, digests, or metadata is detectable by consumers.
 *
 * Fail-closed doctrine: if the signing key is not configured the catalogue is
 * still served but honestly marked `signatureStatus: "UNSIGNED_NO_KEY"` —
 * never a fabricated signature.
 */
import { createHash } from "crypto";
import { canonicalizeJcs, type JsonValue } from "../lib/jcs";
import { signPayloadJws, signingConfigured } from "../lib/envelopeSign";
import { ROUTER_CATALOGUE } from "../openapi";

export type ApiClassification = "PUBLIC" | "PARTNER" | "RESTRICTED";

export interface CatalogueEntry {
  apiId: string;
  title: string;
  owner: string;
  classification: ApiClassification;
  version: string;
  sla: { availabilityPct: number; maxLatencyMs: number; support: string };
  openapiRef: string;
  sandboxAvailable: boolean;
  procedures: string[];
  /** sha256 hex of the JCS-canonical spec fragment for this API */
  specDigest: string;
}

export interface ApiCatalogue {
  catalogueVersion: string;
  generatedAt: string;
  producer: string;
  entryCount: number;
  entries: CatalogueEntry[];
}

interface OwnerMeta {
  owner: string;
  classification: ApiClassification;
  sla: { availabilityPct: number; maxLatencyMs: number; support: string };
  sandboxAvailable: boolean;
}

const DEFAULT_SLA = { availabilityPct: 99.5, maxLatencyMs: 2000, support: "business-hours" };

/** Owner/classification metadata per tRPC router group in the catalogue. */
const GROUP_META: Record<string, OwnerMeta> = {
  auth: { owner: "platform-iam", classification: "PUBLIC", sla: { availabilityPct: 99.9, maxLatencyMs: 500, support: "24x7" }, sandboxAvailable: true },
  declarations: { owner: "customs-clearance", classification: "PARTNER", sla: { availabilityPct: 99.9, maxLatencyMs: 1500, support: "24x7" }, sandboxAvailable: true },
  payments: { owner: "financial-controls", classification: "PARTNER", sla: { availabilityPct: 99.9, maxLatencyMs: 2000, support: "24x7" }, sandboxAvailable: true },
  aeo: { owner: "customs-compliance", classification: "PARTNER", sla: DEFAULT_SLA, sandboxAvailable: true },
  geospatial: { owner: "geo-service", classification: "PUBLIC", sla: DEFAULT_SLA, sandboxAvailable: true },
  cargoTracking: { owner: "geo-service", classification: "PUBLIC", sla: DEFAULT_SLA, sandboxAvailable: true },
};

/** Cross-repo public APIs registered in the platform marketplace (beyond this service's tRPC surface). */
const EXTERNAL_ENTRIES: Array<Omit<CatalogueEntry, "specDigest" | "procedures"> & { specFragment: JsonValue }> = [
  {
    apiId: "blueeconomy-geo-service.feed",
    title: "Geo Service — AIS / met-ocean feed status API",
    owner: "geo-service",
    classification: "PUBLIC",
    version: "1.0.0",
    sla: DEFAULT_SLA,
    openapiRef: "https://github.com/munisp/blueeconomy-geo-service/docs/openapi.yaml",
    sandboxAvailable: true,
    specFragment: { service: "blueeconomy-geo-service", surfaces: ["feed-status", "vessel-positions", "geofences"] },
  },
  {
    apiId: "blueeconomy-data-platform.kpi",
    title: "Data Platform — KPI publishing API",
    owner: "data-platform",
    classification: "PUBLIC",
    version: "1.0.0",
    sla: DEFAULT_SLA,
    openapiRef: "https://github.com/munisp/blueeconomy-data-platform/docs/openapi.yaml",
    sandboxAvailable: false,
    specFragment: { service: "blueeconomy-data-platform", surfaces: ["kpi-snapshots", "lineage"] },
  },
  {
    apiId: "singlewindow.verify",
    title: "Certificate Verification — public clearance certificate check",
    owner: "customs-clearance",
    classification: "PUBLIC",
    version: "1.0.0",
    sla: { availabilityPct: 99.9, maxLatencyMs: 800, support: "24x7" },
    openapiRef: "/api/openapi.json#/paths/verify",
    sandboxAvailable: false,
    specFragment: { service: "singlewindow", surfaces: ["GET /api/verify/:certNumber"] },
  },
  {
    apiId: "singlewindow.operational-kpis",
    title: "Operational KPIs — clearance time, lanes, permits, payments",
    owner: "customs-clearance",
    classification: "PUBLIC",
    version: "1.0.0",
    sla: DEFAULT_SLA,
    openapiRef: "/api/kpis/public",
    sandboxAvailable: false,
    specFragment: { service: "singlewindow", surfaces: ["GET /api/kpis/public", "GET /api/kpis/snapshot"] },
  },
];

const sha256hex = (s: string) => createHash("sha256").update(s, "utf8").digest("hex");

/**
 * Build the tamper-evident API catalogue from the live router catalogue plus
 * registered cross-repo platform APIs. Deterministic for a given code state.
 */
export function buildApiCatalogue(now: Date = new Date()): ApiCatalogue {
  const entries: CatalogueEntry[] = [];

  for (const [group, procedures] of Object.entries(ROUTER_CATALOGUE)) {
    const meta = GROUP_META[group] ?? {
      owner: "singlewindow",
      classification: "PARTNER" as ApiClassification,
      sla: DEFAULT_SLA,
      sandboxAvailable: false,
    };
    const procNames = Object.keys(procedures).map((p) => `${group}.${p}`);
    // Spec fragment: full procedure metadata for this group — digest covers
    // summaries, auth requirements and tags so spec drift changes the digest.
    const fragment = canonicalizeJcs({ group, procedures } as unknown as JsonValue);
    entries.push({
      apiId: `singlewindow.${group}`,
      title: `Single Window — ${group} API`,
      owner: meta.owner,
      classification: meta.classification,
      version: "2.0.0",
      sla: meta.sla,
      openapiRef: `/api/openapi.json#/paths/~1api~1trpc~1${group}`,
      sandboxAvailable: meta.sandboxAvailable,
      procedures: procNames,
      specDigest: sha256hex(fragment),
    });
  }

  for (const ext of EXTERNAL_ENTRIES) {
    entries.push({
      apiId: ext.apiId,
      title: ext.title,
      owner: ext.owner,
      classification: ext.classification,
      version: ext.version,
      sla: ext.sla,
      openapiRef: ext.openapiRef,
      sandboxAvailable: ext.sandboxAvailable,
      procedures: [],
      specDigest: sha256hex(canonicalizeJcs(ext.specFragment)),
    });
  }

  entries.sort((a, b) => a.apiId.localeCompare(b.apiId));

  return {
    catalogueVersion: "1.0.0",
    generatedAt: now.toISOString(),
    producer: "singlewindow",
    entryCount: entries.length,
    entries,
  };
}

export interface SignedCatalogue {
  envelopeVersion: "1.0";
  catalogue: ApiCatalogue;
  /** sha256 of JCS-canonical catalogue — tamper-evidence anchor */
  catalogueDigest: string;
  signatureStatus: "SIGNED" | "UNSIGNED_NO_KEY";
  jws?: string;
  kid?: string;
}

/**
 * Build the signed catalogue envelope. Never fabricates a signature: without
 * a configured key the catalogue is returned with an honest unsigned status.
 */
export function buildSignedCatalogue(now: Date = new Date()): SignedCatalogue {
  const catalogue = buildApiCatalogue(now);
  const catalogueDigest = sha256hex(canonicalizeJcs(catalogue as unknown as JsonValue));
  if (!signingConfigured()) {
    return { envelopeVersion: "1.0", catalogue, catalogueDigest, signatureStatus: "UNSIGNED_NO_KEY" };
  }
  const signed = signPayloadJws(
    { catalogueDigest, catalogueVersion: catalogue.catalogueVersion, generatedAt: catalogue.generatedAt, producer: catalogue.producer },
    "singlewindow-0"
  );
  return {
    envelopeVersion: "1.0",
    catalogue,
    catalogueDigest,
    signatureStatus: "SIGNED",
    jws: signed.jws,
    kid: signed.kid,
  };
}
