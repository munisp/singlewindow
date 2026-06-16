/**
 * polyglotClients.ts — TradeGateway NGSWTP
 *
 * Unified client registry for all polyglot microservices.
 * The TypeScript BFF calls these clients; each client wraps the appropriate
 * transport (gRPC for Go/Rust services, HTTP for Python FastAPI services).
 *
 * Service map:
 *   declaration-engine  (Go)     → gRPC :50051
 *   risk-engine         (Go)     → gRPC :50052
 *   oga-hub             (Go)     → gRPC :50053
 *   cargo-tracking      (Go)     → gRPC :50054
 *   tigerbeetle-bridge  (Rust)   → gRPC :50055
 *   kafka-consumer      (Rust)   → internal (no external API)
 *   ai-risk-scorer      (Python) → HTTP  :8001
 *   opensearch-indexer  (Python) → internal (no external API)
 */

import { ENV } from "./env";

// ─── HTTP client for Python services ─────────────────────────────────────────

const AI_RISK_SCORER_URL = process.env.AI_RISK_SCORER_URL ?? "http://localhost:8001";
const DECLARATION_ENGINE_URL = process.env.DECLARATION_ENGINE_HTTP_URL ?? "http://localhost:8080";
const CARGO_TRACKING_URL = process.env.CARGO_TRACKING_HTTP_URL ?? "http://localhost:8082";
const OGA_HUB_URL = process.env.OGA_HUB_HTTP_URL ?? "http://localhost:8083";

const FETCH_TIMEOUT_MS = 10_000;

async function fetchWithTimeout(url: string, options: RequestInit = {}): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

// ─── AI Risk Scorer (Python FastAPI) ─────────────────────────────────────────

export interface RiskScoreRequest {
  declarationId: string;
  traderId: string;
  declarationType: string;
  countryOfOrigin: string;
  countryOfDestination: string;
  totalValue: number;
  totalWeight: number;
  totalDuty: number;
  numberOfPackages: number;
  items: Array<{
    hsCode: string;
    description: string;
    quantity: number;
    unitValue: number;
  }>;
  documents: Array<{ type: string; reference: string }>;
  traderHistory: {
    totalDeclarations: number;
    rejectionRate: number;
    amendmentRate: number;
    isAEO: boolean;
    monthsActive: number;
  };
}

export interface RiskScoreResult {
  declarationId: string;
  riskScore: number;
  mlScore: number;
  ruleScore: number;
  anomalyScore: number;
  lane: "GREEN" | "YELLOW" | "RED";
  triggeredRules: string[];
  shapExplanation: Record<string, number> | null;
  modelVersion: number;
  scoredAt: string;
  processingMs: number;
}

export async function scoreDeclarationRisk(
  request: RiskScoreRequest
): Promise<RiskScoreResult | null> {
  try {
    const res = await fetchWithTimeout(`${AI_RISK_SCORER_URL}/score`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
    });

    if (!res.ok) {
      const text = await res.text();
      console.error("[ai-risk-scorer] HTTP error", res.status, text);
      return null;
    }

    const data = await res.json();
    // Map snake_case Python response to camelCase
    return {
      declarationId: data.declaration_id,
      riskScore: data.risk_score,
      mlScore: data.ml_score,
      ruleScore: data.rule_score,
      anomalyScore: data.anomaly_score,
      lane: data.lane,
      triggeredRules: data.triggered_rules,
      shapExplanation: data.shap_explanation,
      modelVersion: data.model_version,
      scoredAt: data.scored_at,
      processingMs: data.processing_ms,
    };
  } catch (err) {
    console.error("[ai-risk-scorer] Request failed:", err);
    return null;
  }
}

export async function batchScoreDeclarations(
  requests: RiskScoreRequest[]
): Promise<RiskScoreResult[]> {
  try {
    const res = await fetchWithTimeout(`${AI_RISK_SCORER_URL}/batch-score`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(requests),
    });
    if (!res.ok) return [];
    const data = await res.json();
    return data.map((d: any) => ({
      declarationId: d.declaration_id,
      riskScore: d.risk_score,
      mlScore: d.ml_score,
      ruleScore: d.rule_score,
      anomalyScore: d.anomaly_score,
      lane: d.lane,
      triggeredRules: d.triggered_rules,
      shapExplanation: d.shap_explanation,
      modelVersion: d.model_version,
      scoredAt: d.scored_at,
      processingMs: d.processing_ms,
    }));
  } catch (err) {
    console.error("[ai-risk-scorer] Batch request failed:", err);
    return [];
  }
}

export async function getAiRiskScorerHealth(): Promise<{
  healthy: boolean;
  modelLoaded: boolean;
  modelVersion: number;
}> {
  try {
    const res = await fetchWithTimeout(`${AI_RISK_SCORER_URL}/health`);
    if (!res.ok) return { healthy: false, modelLoaded: false, modelVersion: 0 };
    const data = await res.json();
    return {
      healthy: data.status === "ok",
      modelLoaded: data.model_loaded,
      modelVersion: data.model_version,
    };
  } catch {
    return { healthy: false, modelLoaded: false, modelVersion: 0 };
  }
}

// ─── Declaration Engine (Go gRPC via HTTP gateway) ────────────────────────────

export interface DeclarationValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  hsCodeValidations: Array<{
    hsCode: string;
    valid: boolean;
    description: string;
    requiredPermits: string[];
  }>;
}

export async function validateDeclarationWithEngine(
  declarationId: string,
  payload: Record<string, unknown>
): Promise<DeclarationValidationResult | null> {
  try {
    const res = await fetchWithTimeout(
      `${DECLARATION_ENGINE_URL}/v1/declarations/${declarationId}/validate`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      }
    );
    if (!res.ok) return null;
    return res.json();
  } catch (err) {
    console.error("[declaration-engine] Validation failed:", err);
    return null;
  }
}

export async function submitDeclarationToEngine(
  declarationId: string,
  payload: Record<string, unknown>
): Promise<{ ucr: string; referenceNumber: string } | null> {
  try {
    const res = await fetchWithTimeout(
      `${DECLARATION_ENGINE_URL}/v1/declarations`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: declarationId, ...payload }),
      }
    );
    if (!res.ok) return null;
    return res.json();
  } catch (err) {
    console.error("[declaration-engine] Submit failed:", err);
    return null;
  }
}

// ─── Cargo Tracking (Go gRPC via HTTP gateway) ───────────────────────────────

export interface CargoPosition {
  ucr: string;
  status: string;
  latitude?: number;
  longitude?: number;
  locationName?: string;
  vesselName?: string;
  containerNumber?: string;
  portOfLoading?: string;
  portOfDischarge?: string;
  eta?: string;
  updatedAt: string;
}

export async function getCargoPosition(ucr: string): Promise<CargoPosition | null> {
  try {
    const res = await fetchWithTimeout(`${CARGO_TRACKING_URL}/v1/cargo/${ucr}`);
    if (!res.ok) return null;
    return res.json();
  } catch (err) {
    console.error("[cargo-tracking] Position fetch failed:", err);
    return null;
  }
}

export async function updateCargoPosition(
  ucr: string,
  update: Partial<CargoPosition>
): Promise<boolean> {
  try {
    const res = await fetchWithTimeout(`${CARGO_TRACKING_URL}/v1/cargo/${ucr}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(update),
    });
    return res.ok;
  } catch {
    return false;
  }
}

// ─── OGA Hub (Go gRPC via HTTP gateway) ──────────────────────────────────────

export interface OGAPermitRequest {
  declarationId: string;
  agencyCode: string;
  permitType: string;
  hsCodes: string[];
  traderTin: string;
  documents: Array<{ type: string; url: string }>;
}

export interface OGAPermitResponse {
  permitId: string;
  agencyCode: string;
  status: "PENDING" | "APPROVED" | "REJECTED" | "REQUIRES_INSPECTION";
  permitNumber?: string;
  expiryDate?: string;
  conditions?: string[];
  rejectionReason?: string;
}

export async function requestOGAPermit(
  request: OGAPermitRequest
): Promise<OGAPermitResponse | null> {
  try {
    const res = await fetchWithTimeout(`${OGA_HUB_URL}/v1/permits`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
    });
    if (!res.ok) return null;
    return res.json();
  } catch (err) {
    console.error("[oga-hub] Permit request failed:", err);
    return null;
  }
}

export async function getOGAPermitStatus(permitId: string): Promise<OGAPermitResponse | null> {
  try {
    const res = await fetchWithTimeout(`${OGA_HUB_URL}/v1/permits/${permitId}`);
    if (!res.ok) return null;
    return res.json();
  } catch {
    return null;
  }
}

// ─── Health aggregator ────────────────────────────────────────────────────────

export interface PolyglotServiceHealth {
  service: string;
  language: string;
  healthy: boolean;
  latencyMs?: number;
  details?: Record<string, unknown>;
}

export async function checkAllPolyglotServices(): Promise<PolyglotServiceHealth[]> {
  const checks: Array<Promise<PolyglotServiceHealth>> = [
    (async () => {
      const start = Date.now();
      const h = await getAiRiskScorerHealth();
      return {
        service: "ai-risk-scorer",
        language: "Python",
        healthy: h.healthy,
        latencyMs: Date.now() - start,
        details: { modelLoaded: h.modelLoaded, modelVersion: h.modelVersion },
      };
    })(),
    (async () => {
      const start = Date.now();
      try {
        const res = await fetchWithTimeout(`${DECLARATION_ENGINE_URL}/health`);
        return {
          service: "declaration-engine",
          language: "Go",
          healthy: res.ok,
          latencyMs: Date.now() - start,
        };
      } catch {
        return { service: "declaration-engine", language: "Go", healthy: false };
      }
    })(),
    (async () => {
      const start = Date.now();
      try {
        const res = await fetchWithTimeout(`${CARGO_TRACKING_URL}/health`);
        return {
          service: "cargo-tracking",
          language: "Go",
          healthy: res.ok,
          latencyMs: Date.now() - start,
        };
      } catch {
        return { service: "cargo-tracking", language: "Go", healthy: false };
      }
    })(),
    (async () => {
      const start = Date.now();
      try {
        const res = await fetchWithTimeout(`${OGA_HUB_URL}/health`);
        return {
          service: "oga-hub",
          language: "Go",
          healthy: res.ok,
          latencyMs: Date.now() - start,
        };
      } catch {
        return { service: "oga-hub", language: "Go", healthy: false };
      }
    })(),
  ];

  return Promise.all(checks);
}
