/**
 * PRA-004 (Phase 9) — REAL DB-gated integration tests for Temporal workflow
 * persistence (server/routers/temporal.ts).
 *
 * Replaces the previous fake suite (vi.mock("../db") with a null DB, asserting
 * only that helpers "do not throw"). Every test here round-trips through the
 * real saveWorkflowToDb / getWorkflowFromDb / getWorkflowsFromDb helpers
 * against a fresh PostgreSQL database with the full migration chain applied
 * (server/testutils/pgTestHarness.ts). No mocks.
 *
 * Skips cleanly with a printed reason when PostgreSQL is unavailable.
 */
import { describe, it, expect, afterAll } from "vitest";
import { createTestDatabase, expectPgRejection } from "./testutils/pgTestHarness";
import { closePool, getDb } from "./db";
import { temporalWorkflows } from "../drizzle/schema";
import { eq } from "drizzle-orm";
import {
  saveWorkflowToDb,
  getWorkflowFromDb,
  getWorkflowsFromDb,
} from "./routers/temporal";

const tdb = await createTestDatabase("temporal_wf");
if (tdb) process.env.DATABASE_URL = tdb.url;
const describeDb = tdb ? describe : describe.skip;

afterAll(async () => {
  await closePool();
  await tdb?.close();
});

describeDb("temporal workflow DB persistence against real PostgreSQL (PRA-004)", () => {
  it("saveWorkflowToDb + getWorkflowFromDb round-trip a running workflow", async () => {
    await saveWorkflowToDb({
      workflowId: "DCL-1001-run-a",
      runId: "run-a",
      workflowType: "DeclarationClearanceWorkflow",
      declarationId: 1001,
      status: "RUNNING",
      startedAt: new Date().toISOString(),
      currentStep: "risk_assessment",
      activities: [{ name: "RiskAssessment", status: "COMPLETED" }],
      memo: { trader: "Apapa Traders" },
    });

    const row = await getWorkflowFromDb("DCL-1001-run-a");
    expect(row).not.toBeNull();
    expect(row!.runId).toBe("run-a");
    expect(row!.workflowType).toBe("DeclarationClearanceWorkflow");
    expect(row!.declarationId).toBe(1001);
    expect(row!.status).toBe("RUNNING");
    expect(row!.currentStep).toBe("risk_assessment");
    expect((row!.steps as unknown[]).length).toBe(1);
    expect((row!.metadata as Record<string, unknown>).trader).toBe("Apapa Traders");
  });

  it("re-saving the same workflowId upserts status, step and closeTime", async () => {
    await saveWorkflowToDb({
      workflowId: "DCL-1002-run", runId: "run-b",
      workflowType: "PaymentProcessingWorkflow", declarationId: 1002, status: "RUNNING",
    });
    await saveWorkflowToDb({
      workflowId: "DCL-1002-run", runId: "run-b",
      workflowType: "PaymentProcessingWorkflow", declarationId: 1002, status: "COMPLETED",
      completedAt: new Date().toISOString(), currentStep: "settled",
    });

    const row = await getWorkflowFromDb("DCL-1002-run");
    expect(row!.status).toBe("COMPLETED");
    expect(row!.closeTime).not.toBeNull();
    expect(row!.currentStep).toBe("settled");

    // Upsert, not duplicate: exactly one row for the workflowId.
    const db = await getDb();
    const rows = await db!.select().from(temporalWorkflows)
      .where(eq(temporalWorkflows.workflowId, "DCL-1002-run"));
    expect(rows).toHaveLength(1);
  });

  it("skips persistence when runId is missing (documented guard)", async () => {
    await saveWorkflowToDb({
      workflowId: "DCL-NORUN", runId: undefined,
      workflowType: "DeclarationClearanceWorkflow", status: "RUNNING",
    });
    expect(await getWorkflowFromDb("DCL-NORUN")).toBeNull();
  });

  it("getWorkflowsFromDb filters by declaration and status, newest first", async () => {
    const base = Date.now();
    await saveWorkflowToDb({
      workflowId: "DCL-2001-old", runId: "r1", workflowType: "DeclarationClearanceWorkflow",
      declarationId: 2001, status: "COMPLETED",
      startedAt: new Date(base - 60_000).toISOString(), completedAt: new Date(base - 50_000).toISOString(),
    });
    await saveWorkflowToDb({
      workflowId: "DCL-2001-new", runId: "r2", workflowType: "DeclarationClearanceWorkflow",
      declarationId: 2001, status: "RUNNING", startedAt: new Date(base).toISOString(),
    });
    await saveWorkflowToDb({
      workflowId: "DCL-2002-other", runId: "r3", workflowType: "KYCVerificationWorkflow",
      declarationId: 2002, status: "RUNNING", startedAt: new Date(base).toISOString(),
    });

    const forDecl = await getWorkflowsFromDb(2001);
    expect(forDecl.map((w) => w.workflowId)).toEqual(["DCL-2001-new", "DCL-2001-old"]);

    const runningOnly = await getWorkflowsFromDb(2001, "RUNNING");
    expect(runningOnly).toHaveLength(1);
    expect(runningOnly[0].workflowId).toBe("DCL-2001-new");

    const completedOnly = await getWorkflowsFromDb(undefined, "COMPLETED");
    expect(completedOnly.some((w) => w.workflowId === "DCL-2001-old")).toBe(true);
    expect(completedOnly.some((w) => w.workflowId === "DCL-2001-new")).toBe(false);
  });

  it("signal-to-status mapping persists terminal states (oga_approved → COMPLETED, cancel → CANCELLED)", async () => {
    // The router maps signal names to terminal statuses before saving; assert
    // the persisted mapping contract at the persistence boundary.
    const signalToStatus = (signal: string) =>
      signal === "payment_confirmed" || signal === "oga_approved" ? "COMPLETED"
        : signal === "cancel_workflow" ? "CANCELLED" : "RUNNING";

    for (const [signal, expected] of [["oga_approved", "COMPLETED"], ["cancel_workflow", "CANCELLED"]] as const) {
      const workflowId = `DCL-SIG-${signal}`;
      await saveWorkflowToDb({
        workflowId, runId: `run-${signal}`, workflowType: "MultiAgencyApprovalWorkflow",
        declarationId: 3001, status: signalToStatus(signal),
        completedAt: new Date().toISOString(),
      });
      const row = await getWorkflowFromDb(workflowId);
      expect(row!.status).toBe(expected);
      expect(row!.closeTime).not.toBeNull();
    }
  });

  it("the temporal_workflow_status enum rejects invalid statuses (fail-closed schema)", async () => {
    const db = await getDb();
    await expectPgRejection(
      db!.insert(temporalWorkflows).values({
        workflowId: "DCL-BAD-STATUS", runId: "run-x",
        workflowType: "DeclarationClearanceWorkflow",
        status: "BOGUS" as any,
      }),
      /invalid input value for enum temporal_workflow_status/i
    );
    expect(await getWorkflowFromDb("DCL-BAD-STATUS")).toBeNull();
  });

  it("workflowId uniqueness is enforced at the database level", async () => {
    const db = await getDb();
    const row = {
      workflowId: "DCL-UNIQ", runId: "run-1",
      workflowType: "DeclarationClearanceWorkflow", status: "RUNNING" as const,
    };
    await db!.insert(temporalWorkflows).values(row);
    await expect(
      db!.insert(temporalWorkflows).values({ ...row, runId: "run-2" })
    ).rejects.toThrow();
  });
});
