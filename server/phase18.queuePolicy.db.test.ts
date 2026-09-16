/**
 * phase18.queuePolicy.db.test.ts — REAL DB-gated integration tests for
 * Phase 18 W3: migration 0070 (queue_policy_decisions), the queuePolicy
 * shadow router (suggestion against a stubbed ml-stack, officer RBAC,
 * untrained honesty) and the append-only decision log.
 *
 * Skips cleanly with a printed reason when PostgreSQL is unavailable
 * (pgTestHarness precedent) — never a fake pass. The ml-stack fetch is
 * stubbed: these tests pin OUR shadow-mode handling of its contract.
 */
import { describe, it, expect, afterAll, afterEach, vi } from "vitest";
import { createTestDatabase } from "./testutils/pgTestHarness";
import type { TrpcContext } from "./_core/context";
import {
  declarations,
  queuePolicyDecisions,
  queuePolicySuggestions,
  stakeholderProfiles,
  users,
} from "../drizzle/schema";
import { eq } from "drizzle-orm";

const tdb = await createTestDatabase("phase18q");
if (tdb) process.env.DATABASE_URL = tdb.url;
const describeDb = tdb ? describe : describe.skip;

const { closePool, getDb } = await import("./db");
const { appRouter } = await import("./routers");

afterAll(async () => {
  await closePool();
  await tdb?.close();
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.ML_STACK_HTTP_URL;
  delete process.env.RL_QUEUE_POLICY_SHADOW_ENABLED;
});

let seq = 0;
async function seedUser(role: string = "user") {
  const db = (await getDb())!;
  seq += 1;
  const [u] = await db
    .insert(users)
    .values({ openId: `phase18q-${Date.now()}-${seq}`, name: `P18 User ${seq}`, role })
    .returning();
  return u;
}

async function seedDeclaration(traderId: number, suffix: string) {
  const db = (await getDb())!;
  const [d] = await db
    .insert(declarations)
    .values({
      declarationNumber: `EXP-P18-${Date.now()}-${suffix}`,
      traderId,
      declarationType: "export",
      status: "submitted",
    })
    .returning();
  return d;
}

function makeCtx(user: { id: number; openId: string; role: string }): TrpcContext {
  return {
    user: {
      ...user,
      email: `u${user.id}@example.com`,
      name: `U${user.id}`,
      loginMethod: "keycloak",
      createdAt: new Date(),
      updatedAt: new Date(),
      lastSignedIn: new Date(),
    } as TrpcContext["user"],
    keycloakRoles: [],
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: { clearCookie: () => {} } as unknown as TrpcContext["res"],
  };
}

function stubMlStack(body: unknown, status = 200) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      new Response(typeof body === "string" ? body : JSON.stringify(body), {
        status,
        headers: { "Content-Type": "application/json" },
      })
    )
  );
}

function enableShadow() {
  process.env.ML_STACK_HTTP_URL = "http://ml-stack.test:8100";
  process.env.RL_QUEUE_POLICY_SHADOW_ENABLED = "true";
}

describeDb("Phase 18 queue-policy shadow router against real PostgreSQL", () => {
  it("migration 0070 created queue_policy_decisions with the decision check", async () => {
    const db = (await getDb())!;
    const officer = await seedUser("customs_officer");
    const decl = await seedDeclaration(officer.id, "M");
    const [row] = await db
      .insert(queuePolicyDecisions)
      .values({
        officerId: officer.id,
        declarationId: decl.id,
        policyVersion: "v-test",
        suggestedPosition: 1,
        authoritativePosition: 1,
        decision: "accepted",
      })
      .returning();
    expect(row.id).toBeGreaterThan(0);
    await expect(
      db.insert(queuePolicyDecisions).values({
        officerId: officer.id,
        declarationId: decl.id,
        policyVersion: "v-test",
        suggestedPosition: 1,
        authoritativePosition: 1,
        decision: "bogus",
      })
    ).rejects.toThrow(/queue_policy_decisions_decision_check|Failed query/);
  });

  it("returns the shadow suggestion alongside the authoritative order", async () => {
    const officer = await seedUser("customs_officer");
    const trader = await seedUser();
    const a = await seedDeclaration(trader.id, "A");
    const b = await seedDeclaration(trader.id, "B");
    enableShadow();
    stubMlStack({
      mode: "shadow",
      policy_version: "queue-policy-v0.1.0",
      suggested_order: [b.id, a.id],
      ope_score: 0.71,
    });
    const caller = appRouter.createCaller(makeCtx(officer));
    const res = await caller.queuePolicy.suggestion({});
    expect(res.mode).toBe("shadow");
    expect(res.policyVersion).toBe("queue-policy-v0.1.0");
    expect(res.opeScore).toBe(0.71);
    expect(res.authoritativeOrder).toContain(a.id);
    expect(res.authoritativeOrder).toContain(b.id);
    expect(res.suggestedOrder).toEqual([b.id, a.id]);
    // Authoritative order is unchanged by the suggestion.
    expect(res.authoritativeOrder).not.toEqual(res.suggestedOrder);
  });

  it("honestly reports an untrained policy (ml-stack 409)", async () => {
    const officer = await seedUser("customs_officer");
    const trader = await seedUser();
    await seedDeclaration(trader.id, "C");
    enableShadow();
    stubMlStack("POLICY_NOT_TRAINED: no promoted queue policy", 409);
    const caller = appRouter.createCaller(makeCtx(officer));
    await expect(caller.queuePolicy.suggestion({})).rejects.toThrow(/QUEUE_POLICY_NOT_TRAINED/);
  });

  it("fails closed when the shadow surface is not configured", async () => {
    const officer = await seedUser("customs_officer");
    const caller = appRouter.createCaller(makeCtx(officer));
    await expect(caller.queuePolicy.suggestion({})).rejects.toThrow(/QUEUE_POLICY_NOT_CONFIGURED/);
  });

  it("rejects non-officer callers on both procedures", async () => {
    const trader = await seedUser();
    const caller = appRouter.createCaller(makeCtx(trader));
    await expect(caller.queuePolicy.suggestion({})).rejects.toThrow(/Officer role required/);
    await expect(
      caller.queuePolicy.recordDecision({
        suggestionId: 1,
        declarationId: 1,
        decision: "accepted",
      })
    ).rejects.toThrow(/Officer role required/);
  });

  it("admits every OFFICER_QUEUE_ROLES member (M4)", async () => {
    for (const role of ["admin", "customs_officer", "inspector", "finance"] as const) {
      const officer = await seedUser(role);
      const caller = appRouter.createCaller(makeCtx(officer));
      // Not configured here (shadow disabled in afterEach) — a PRECONDITION_FAILED
      // proves the caller passed the RBAC gate.
      await expect(caller.queuePolicy.suggestion({})).rejects.toThrow(/QUEUE_POLICY_NOT_CONFIGURED/);
    }
  });

  async function serveSuggestion() {
    const officer = await seedUser("customs_officer");
    const trader = await seedUser();
    const a = await seedDeclaration(trader.id, "S1");
    const b = await seedDeclaration(trader.id, "S2");
    enableShadow();
    stubMlStack({
      mode: "shadow",
      policy_version: "queue-policy-v0.1.0",
      suggested_order: [b.id, a.id],
      ope_score: 0.71,
    });
    const caller = appRouter.createCaller(makeCtx(officer));
    const res = await caller.queuePolicy.suggestion({});
    expect(res.suggestionId).toBeGreaterThan(0);
    return { officer, a, b, res, caller };
  }

  it("suggestion persists a served EPISODE (M1/M2) with both orders + candidates", async () => {
    const { res, a, b } = await serveSuggestion();
    const db = (await getDb())!;
    const [episode] = await db
      .select()
      .from(queuePolicySuggestions)
      .where(eq(queuePolicySuggestions.id, res.suggestionId));
    expect(episode.policyVersion).toBe("queue-policy-v0.1.0");
    expect(episode.suggestedOrder).toEqual([b.id, a.id]);
    expect(episode.authoritativeOrder).toContain(a.id);
    expect(episode.authoritativeOrder).toContain(b.id);
    expect(episode.candidateIds).toEqual(expect.arrayContaining([a.id, b.id]));
    expect(episode.featureSnapshot).toBeTruthy();
  });

  it("recordDecision derives positions server-side and logs accepted/overrode", async () => {
    const { officer, a, b, res, caller } = await serveSuggestion();
    const accepted = await caller.queuePolicy.recordDecision({
      suggestionId: res.suggestionId,
      declarationId: b.id, // suggested position 1
      decision: "accepted",
    });
    const overrode = await caller.queuePolicy.recordDecision({
      suggestionId: res.suggestionId,
      declarationId: a.id, // suggested position 2
      decision: "overrode",
    });
    expect(accepted.recorded).toBe(true);
    expect(accepted.duplicate).toBe(false);
    expect(overrode.id).toBeGreaterThan(accepted.id);
    const db = (await getDb())!;
    const rows = await db
      .select()
      .from(queuePolicyDecisions)
      .where(eq(queuePolicyDecisions.suggestionId, res.suggestionId));
    expect(rows).toHaveLength(2);
    const byDecl = new Map(rows.map((r) => [r.declarationId, r]));
    // Server-derived: b was suggested first; a's authoritative position >= 1.
    expect(byDecl.get(b.id)!.suggestedPosition).toBe(1);
    expect(byDecl.get(a.id)!.suggestedPosition).toBe(2);
    expect(byDecl.get(a.id)!.authoritativePosition).toBeGreaterThanOrEqual(1);
    expect(rows.every((r) => r.officerId === officer.id)).toBe(true);
    expect(rows.every((r) => r.policyVersion === "queue-policy-v0.1.0")).toBe(true);
  });

  it("duplicate recordDecision folds via the unique index (23505 cause-chain walk)", async () => {
    const { b, res, caller } = await serveSuggestion();
    const first = await caller.queuePolicy.recordDecision({
      suggestionId: res.suggestionId,
      declarationId: b.id,
      decision: "accepted",
    });
    const again = await caller.queuePolicy.recordDecision({
      suggestionId: res.suggestionId,
      declarationId: b.id,
      decision: "accepted",
    });
    expect(again.recorded).toBe(true);
    expect(again.duplicate).toBe(true);
    expect(again.id).toBe(first.id);
    const db = (await getDb())!;
    const rows = await db
      .select()
      .from(queuePolicyDecisions)
      .where(eq(queuePolicyDecisions.suggestionId, res.suggestionId));
    expect(rows).toHaveLength(1);
  });

  it("recordDecision refuses unknown episodes and non-member declarations", async () => {
    const { b, res, caller } = await serveSuggestion();
    await expect(
      caller.queuePolicy.recordDecision({
        suggestionId: 999_999,
        declarationId: b.id,
        decision: "accepted",
      })
    ).rejects.toThrow(/not found/);
    const outsider = await seedUser();
    const foreign = await seedDeclaration(outsider.id, "F");
    await expect(
      caller.queuePolicy.recordDecision({
        suggestionId: res.suggestionId,
        declarationId: foreign.id,
        decision: "overrode",
      })
    ).rejects.toThrow(/not in the scored candidate set/);
  });
});
