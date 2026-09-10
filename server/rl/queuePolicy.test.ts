/**
 * queuePolicy.test.ts — Phase 18 RL queue-policy client contract tests.
 *
 * DB-free: the ml-stack fetch is stubbed (mock upstream fine here — these
 * tests pin OUR fail-closed handling of its honest answers). Covers:
 * config gating, untrained 409/503, shadow-mode enforcement, candidate-set
 * validation, OPE score pass-through, and the /health status probe.
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import {
  QueuePolicyConfigError,
  QueuePolicyInvalidResponseError,
  QueuePolicyUnavailableError,
  QueuePolicyUntrainedError,
  getQueuePolicyStatus,
  requestQueuePolicySuggestion,
  type QueuePolicyCandidate,
} from "./queuePolicy";

const CANDIDATES: QueuePolicyCandidate[] = [
  { declarationId: 11, features: { aeoTierRank: 3, fastLane: 1, submittedAgeMinutes: 40, riskScore: 12 } },
  { declarationId: 22, features: { aeoTierRank: 0, fastLane: 0, submittedAgeMinutes: 90, riskScore: 55 } },
];

function configure() {
  process.env.ML_STACK_HTTP_URL = "http://ml-stack.test:8100";
  process.env.RL_QUEUE_POLICY_SHADOW_ENABLED = "true";
}

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.ML_STACK_HTTP_URL;
  delete process.env.RL_QUEUE_POLICY_SHADOW_ENABLED;
  delete process.env.ML_STACK_SERVICE_TOKEN;
});

describe("queue-policy ml-stack client (Phase 18)", () => {
  it("fails closed when ML_STACK_HTTP_URL is not configured", async () => {
    process.env.RL_QUEUE_POLICY_SHADOW_ENABLED = "true";
    await expect(requestQueuePolicySuggestion(CANDIDATES)).rejects.toBeInstanceOf(QueuePolicyConfigError);
  });

  it("fails closed when the shadow gate is not enabled", async () => {
    process.env.ML_STACK_HTTP_URL = "http://ml-stack.test:8100";
    await expect(requestQueuePolicySuggestion(CANDIDATES)).rejects.toBeInstanceOf(QueuePolicyConfigError);
  });

  it("returns the shadow suggestion with policy version and OPE score", async () => {
    configure();
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          mode: "shadow",
          policy_version: "queue-policy-v0.1.0",
          suggested_order: [22, 11],
          ope_score: 0.83,
          latency_ms: 12,
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )
    );
    vi.stubGlobal("fetch", fetchMock);
    const res = await requestQueuePolicySuggestion(CANDIDATES);
    expect(res.mode).toBe("shadow");
    expect(res.policyVersion).toBe("queue-policy-v0.1.0");
    expect(res.suggestedOrder).toEqual([22, 11]);
    expect(res.opeScore).toBe(0.83);
    // Request contract: POST /score/queue-policy with candidate ids.
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("http://ml-stack.test:8100/score/queue-policy");
    expect(init.method).toBe("POST");
    const body = JSON.parse(String(init.body));
    expect(body.candidates.map((c: { declaration_id: number }) => c.declaration_id)).toEqual([11, 22]);
  });

  it("sends the env-only service token when configured", async () => {
    configure();
    process.env.ML_STACK_SERVICE_TOKEN = "svc-token-1";
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({ mode: "shadow", policy_version: "v1", suggested_order: [11, 22] }),
        { status: 200 }
      )
    );
    vi.stubGlobal("fetch", fetchMock);
    await requestQueuePolicySuggestion(CANDIDATES);
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer svc-token-1");
  });

  it.each([409, 503])("maps HTTP %i to a typed untrained error", async (status) => {
    configure();
    vi.stubGlobal("fetch", vi.fn(async () => new Response("POLICY_NOT_TRAINED", { status })));
    await expect(requestQueuePolicySuggestion(CANDIDATES)).rejects.toBeInstanceOf(QueuePolicyUntrainedError);
  });

  it("treats a non-OK status body as untrained, never as a suggestion", async () => {
    configure();
    vi.stubGlobal("fetch", vi.fn(async () =>
      new Response(JSON.stringify({ status: "SCORING_UNAVAILABLE", detail: "no promoted policy" }), { status: 200 })
    ));
    await expect(requestQueuePolicySuggestion(CANDIDATES)).rejects.toBeInstanceOf(QueuePolicyUntrainedError);
  });

  it("refuses non-shadow modes outright", async () => {
    configure();
    vi.stubGlobal("fetch", vi.fn(async () =>
      new Response(JSON.stringify({ mode: "enforce", policy_version: "v9", suggested_order: [11, 22] }), { status: 200 })
    ));
    await expect(requestQueuePolicySuggestion(CANDIDATES)).rejects.toBeInstanceOf(QueuePolicyInvalidResponseError);
  });

  it("refuses suggestions referencing declarations outside the candidate set", async () => {
    configure();
    vi.stubGlobal("fetch", vi.fn(async () =>
      new Response(JSON.stringify({ mode: "shadow", policy_version: "v1", suggested_order: [11, 999] }), { status: 200 })
    ));
    await expect(requestQueuePolicySuggestion(CANDIDATES)).rejects.toBeInstanceOf(QueuePolicyInvalidResponseError);
  });

  it("maps transport failure to a typed unavailable error", async () => {
    configure();
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("connection refused"); }));
    await expect(requestQueuePolicySuggestion(CANDIDATES)).rejects.toBeInstanceOf(QueuePolicyUnavailableError);
  });

  it("maps 5xx to unavailable", async () => {
    configure();
    vi.stubGlobal("fetch", vi.fn(async () => new Response("boom", { status: 500 })));
    await expect(requestQueuePolicySuggestion(CANDIDATES)).rejects.toBeInstanceOf(QueuePolicyUnavailableError);
  });

  it("rejects an empty candidate set without calling upstream", async () => {
    configure();
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(requestQueuePolicySuggestion([])).rejects.toBeInstanceOf(QueuePolicyUntrainedError);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("queue-policy status probe", () => {
  it("reports untrained when the registry has no queue-policy entry", async () => {
    configure();
    vi.stubGlobal("fetch", vi.fn(async () =>
      new Response(JSON.stringify({ status: "ok", models: { "declaration-fraud": { version: "0.1.0" } } }), { status: 200 })
    ));
    const status = await getQueuePolicyStatus();
    expect(status).toEqual({ trained: false, policyVersion: null, opeScore: null, mode: null });
  });

  it("reports trained with version and OPE score from the registry entry", async () => {
    configure();
    vi.stubGlobal("fetch", vi.fn(async () =>
      new Response(
        JSON.stringify({ status: "ok", models: { "queue-policy": { version: "0.2.1", ope_score: 0.77 } } }),
        { status: 200 }
      )
    ));
    const status = await getQueuePolicyStatus();
    expect(status).toEqual({ trained: true, policyVersion: "0.2.1", opeScore: 0.77, mode: "shadow" });
  });

  it("is unavailable when ml-stack health fails", async () => {
    configure();
    vi.stubGlobal("fetch", vi.fn(async () => new Response("bad", { status: 502 })));
    await expect(getQueuePolicyStatus()).rejects.toBeInstanceOf(QueuePolicyUnavailableError);
  });

  it("is config-gated like the scorer", async () => {
    await expect(getQueuePolicyStatus()).rejects.toBeInstanceOf(QueuePolicyConfigError);
  });
});
