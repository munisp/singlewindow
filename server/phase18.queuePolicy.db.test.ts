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
async function seedUser(role: "user" | "customs_officer" = "user") {
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
        declarationId: 1,
        policyVersion: "v1",
        suggestedPosition: 1,
        authoritativePosition: 1,
        decision: "accepted",
      })
    ).rejects.toThrow(/Officer role required/);
  });

  it("logs accept/override decisions append-only for future reward joins", async () => {
    const officer = await seedUser("customs_officer");
    const trader = await seedUser();
    const decl = await seedDeclaration(trader.id, "D");
    const caller = appRouter.createCaller(makeCtx(officer));
    const accepted = await caller.queuePolicy.recordDecision({
      declarationId: decl.id,
      policyVersion: "queue-policy-v0.1.0",
      suggestedPosition: 2,
      authoritativePosition: 3,
      decision: "accepted",
    });
    const overrode = await caller.queuePolicy.recordDecision({
      declarationId: decl.id,
      policyVersion: "queue-policy-v0.1.0",
      suggestedPosition: 2,
      authoritativePosition: 4,
      decision: "overrode",
    });
    expect(accepted.recorded).toBe(true);
    expect(overrode.id).toBeGreaterThan(accepted.id);
    const db = (await getDb())!;
    const rows = await db
      .select()
      .from(queuePolicyDecisions)
      .where(eq(queuePolicyDecisions.declarationId, decl.id));
    expect(rows.map((r) => r.decision).sort()).toEqual(["accepted", "overrode"]);
    expect(rows.every((r) => r.officerId === officer.id)).toBe(true);
  });
});
