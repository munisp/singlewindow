/**
 * queuePolicy.ts — config-gated client for the ml-stack RL queue-policy
 * scorer (Phase 18, POST /score/queue-policy).
 *
 * Doctrine:
 *   - SHADOW ONLY. The policy SUGGESTS an order for the officer export
 *     queue; the FIFO/AEO-prioritized order computed by the aeoFastLane
 *     router remains authoritative. Nothing here ever reorders the real
 *     queue automatically.
 *   - Fail-closed and config-gated: without ML_STACK_HTTP_URL AND
 *     RL_QUEUE_POLICY_SHADOW_ENABLED=true the module refuses to call
 *     anything (QueuePolicyConfigError). No suggestion is ever fabricated.
 *   - Untrained policy is a first-class honest state: ml-stack answers
 *     409/503 (or a non-shadow/error body) when no eval-gated policy has
 *     been promoted; that surfaces as QueuePolicyUntrainedError.
 *   - Auth: ml-stack verifies Keycloak JWKS; the caller authenticates with
 *     the env-only service token ML_STACK_SERVICE_TOKEN (same pattern as
 *     the Phase 16 congestion-forecast client). Secrets are env-only.
 *
 * Wire contract (Phase 18 plan):
 *   POST {ML_STACK_HTTP_URL}/score/queue-policy
 *     body: { entity_id, candidates: [{ declaration_id, features }] }
 *   200:  { mode: "shadow", policy_version, suggested_order: [declaration_id...],
 *           ope_score?: number }
 *   409/503: policy not trained / scoring unavailable (honest refusal).
 */

const ML_STACK_TIMEOUT_MS = 5_000;

/** A candidate queue entry with only real, observable features. */
export interface QueuePolicyCandidate {
  declarationId: number;
  features: {
    /** 3=gold, 2=silver, 1=standard/uncertified tier rank; 0 = not AEO-certified. */
    aeoTierRank: number;
    /** 1 when the exporter is authority-certified AEO (fast-lane flag). */
    fastLane: number;
    /** Minutes since submission (real clock math, never fabricated). */
    submittedAgeMinutes: number;
    /** Numeric risk score when the pipeline produced one; 0 otherwise. */
    riskScore: number;
  };
}

export interface QueuePolicySuggestion {
  mode: "shadow";
  policyVersion: string;
  /** Declaration ids in the policy's suggested processing order. */
  suggestedOrder: number[];
  /** Off-policy evaluation score, only when the serving payload carries it. */
  opeScore: number | null;
  latencyMs: number | null;
}

export class QueuePolicyConfigError extends Error {
  constructor(detail: string) {
    super(`QUEUE_POLICY_NOT_CONFIGURED: ${detail}`);
    this.name = "QueuePolicyConfigError";
  }
}

export class QueuePolicyUntrainedError extends Error {
  readonly status?: number;
  constructor(detail: string, status?: number) {
    super(`QUEUE_POLICY_NOT_TRAINED: ${detail}`);
    this.name = "QueuePolicyUntrainedError";
    this.status = status;
  }
}

export class QueuePolicyUnavailableError extends Error {
  constructor(detail: string) {
    super(`QUEUE_POLICY_UNAVAILABLE: ${detail}`);
    this.name = "QueuePolicyUnavailableError";
  }
}

export class QueuePolicyInvalidResponseError extends Error {
  constructor(detail: string) {
    super(`QUEUE_POLICY_INVALID_RESPONSE: ${detail}`);
    this.name = "QueuePolicyInvalidResponseError";
  }
}

/**
 * Resolve the configured ml-stack base URL, reading live env (not an
 * import-time snapshot) so the gate reflects the current deployment.
 */
export function queuePolicyBaseUrl(): string {
  const url = (process.env.ML_STACK_HTTP_URL ?? "").trim();
  if (!url) {
    throw new QueuePolicyConfigError(
      "ML_STACK_HTTP_URL is not configured — refusing to fabricate a queue suggestion (fail closed)."
    );
  }
  if ((process.env.RL_QUEUE_POLICY_SHADOW_ENABLED ?? "").trim() !== "true") {
    throw new QueuePolicyConfigError(
      "RL_QUEUE_POLICY_SHADOW_ENABLED is not 'true' — the shadow queue policy is disabled in this deployment."
    );
  }
  return url.replace(/\/+$/, "");
}

function parseSuggestion(data: unknown, candidateIds: ReadonlySet<number>): QueuePolicySuggestion {
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    throw new QueuePolicyInvalidResponseError("response body is not an object");
  }
  const body = data as Record<string, unknown>;
  // Honest-refusal bodies (model undeployed / not promoted) may come back
  // with HTTP 200 in some gateway setups — treat any non-shadow payload as
  // an untrained/unavailable policy, never as a suggestion.
  if (body.status !== undefined && body.status !== "OK") {
    throw new QueuePolicyUntrainedError(
      typeof body.detail === "string" ? body.detail : `status=${String(body.status)}`
    );
  }
  if (body.mode !== "shadow") {
    throw new QueuePolicyInvalidResponseError(
      `mode must be "shadow" (got ${JSON.stringify(body.mode)}) — RL output is advisory only`
    );
  }
  if (typeof body.policy_version !== "string" || body.policy_version.trim() === "") {
    throw new QueuePolicyInvalidResponseError("policy_version must be a non-empty string");
  }
  if (!Array.isArray(body.suggested_order)) {
    throw new QueuePolicyInvalidResponseError("suggested_order must be an array");
  }
  const suggestedOrder = body.suggested_order.map((v, i) => {
    if (typeof v !== "number" || !Number.isInteger(v)) {
      throw new QueuePolicyInvalidResponseError(`suggested_order[${i}] must be an integer declaration id`);
    }
    return v;
  });
  // Fail closed on suggestions referencing declarations outside the
  // candidate set we sent — the policy may only permute what it was shown.
  for (const id of suggestedOrder) {
    if (!candidateIds.has(id)) {
      throw new QueuePolicyInvalidResponseError(
        `suggested_order references declaration ${id} which was not a candidate — refusing to display it`
      );
    }
  }
  const opeScore =
    typeof body.ope_score === "number" && Number.isFinite(body.ope_score) ? body.ope_score : null;
  const latencyMs =
    typeof body.latency_ms === "number" && Number.isFinite(body.latency_ms) ? body.latency_ms : null;
  return {
    mode: "shadow",
    policyVersion: body.policy_version,
    suggestedOrder,
    opeScore,
    latencyMs,
  };
}

/**
 * Request a shadow suggestion for the officer export queue. FAIL-CLOSED:
 * throws QueuePolicyConfigError / QueuePolicyUntrainedError /
 * QueuePolicyUnavailableError / QueuePolicyInvalidResponseError — callers
 * must surface these honestly and keep the authoritative order.
 */
export async function requestQueuePolicySuggestion(
  candidates: QueuePolicyCandidate[]
): Promise<QueuePolicySuggestion> {
  const baseUrl = queuePolicyBaseUrl();
  if (candidates.length === 0) {
    throw new QueuePolicyUntrainedError("no queue candidates supplied — nothing to score");
  }

  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const serviceToken = (process.env.ML_STACK_SERVICE_TOKEN ?? "").trim();
  if (serviceToken) headers["Authorization"] = `Bearer ${serviceToken}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ML_STACK_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(`${baseUrl}/score/queue-policy`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        entity_id: "officer-export-queue",
        candidates: candidates.map((c) => ({
          declaration_id: c.declarationId,
          features: c.features,
        })),
      }),
      signal: controller.signal,
    });
  } catch (err) {
    const timedOut = err instanceof Error && (err.name === "AbortError" || err.name === "TimeoutError");
    throw new QueuePolicyUnavailableError(
      `ml-stack ${timedOut ? "timed out" : "unreachable"}: ${err instanceof Error ? err.message : String(err)}`
    );
  } finally {
    clearTimeout(timer);
  }

  if (res.status === 409 || res.status === 503) {
    const body = (await res.text().catch(() => "")).slice(0, 300);
    throw new QueuePolicyUntrainedError(
      `ml-stack honestly refused (HTTP ${res.status}): ${body || "policy not trained / not promoted"}`,
      res.status
    );
  }
  if (res.status >= 400 && res.status < 500) {
    const body = (await res.text().catch(() => "")).slice(0, 300);
    throw new QueuePolicyUnavailableError(`ml-stack rejected the request (HTTP ${res.status}): ${body || "no detail"}`);
  }
  if (!res.ok) {
    throw new QueuePolicyUnavailableError(`ml-stack upstream error: HTTP ${res.status}`);
  }
  const data = await res.json().catch(() => null);
  if (data === null) {
    throw new QueuePolicyInvalidResponseError("response body is not valid JSON");
  }
  return parseSuggestion(data, new Set(candidates.map((c) => c.declarationId)));
}

/**
 * Status probe for the ministry RL-insights surface (Phase 18): reads the
 * ml-stack registry via /health and reports whether a queue-policy model
 * is promoted. Honest states only — untrained is data, not an error.
 */
export interface QueuePolicyStatus {
  trained: boolean;
  policyVersion: string | null;
  opeScore: number | null;
  mode: "shadow" | null;
}

export async function getQueuePolicyStatus(): Promise<QueuePolicyStatus> {
  const baseUrl = queuePolicyBaseUrl();
  let res: Response;
  try {
    res = await fetch(`${baseUrl}/health`, { signal: AbortSignal.timeout(ML_STACK_TIMEOUT_MS) });
  } catch (err) {
    throw new QueuePolicyUnavailableError(
      `ml-stack unreachable: ${err instanceof Error ? err.message : String(err)}`
    );
  }
  if (!res.ok) {
    throw new QueuePolicyUnavailableError(`ml-stack health error: HTTP ${res.status}`);
  }
  const data = (await res.json().catch(() => null)) as Record<string, unknown> | null;
  if (!data || data.status !== "ok" || typeof data.models !== "object" || data.models === null) {
    throw new QueuePolicyUnavailableError("ml-stack reports not-ok or an unreadable registry");
  }
  const entry = (data.models as Record<string, unknown>)["queue-policy"];
  if (entry === undefined || entry === null) {
    // Honest untrained state: no promoted queue-policy in the registry.
    return { trained: false, policyVersion: null, opeScore: null, mode: null };
  }
  const rec = typeof entry === "object" ? (entry as Record<string, unknown>) : {};
  const version =
    typeof rec.version === "string" ? rec.version
    : typeof rec.policy_version === "string" ? rec.policy_version
    : typeof entry === "string" ? entry
    : null;
  const opeScore =
    typeof rec.ope_score === "number" && Number.isFinite(rec.ope_score) ? rec.ope_score : null;
  return { trained: true, policyVersion: version, opeScore, mode: "shadow" };
}
