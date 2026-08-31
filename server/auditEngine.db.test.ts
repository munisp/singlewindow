/**
 * PRA-004 (Phase 9) — REAL DB-gated integration tests for the audit engine.
 *
 * Replaces the previous fake suite (pure in-memory object assertions with no
 * database). Every test here runs the actual auditEngineRouter procedures
 * against a fresh PostgreSQL database carrying the full drizzle migration
 * chain (see server/testutils/pgTestHarness.ts). No mocks anywhere.
 *
 * When PostgreSQL is unavailable the whole suite SKIPS with the reason
 * printed by the harness — it never silently passes.
 */
import { describe, it, expect, afterAll } from "vitest";
import { createTestDatabase } from "./testutils/pgTestHarness";
import { closePool, getDb } from "./db";
import { auditTasks, auditFindings } from "../drizzle/schema";
import { eq } from "drizzle-orm";
import {
  auditEngineRouter,
  selectForAudit,
  calculateDutyDiscrepancy,
} from "./routers/auditEngine";

const tdb = await createTestDatabase("audit_engine");
if (tdb) process.env.DATABASE_URL = tdb.url;
const describeDb = tdb ? describe : describe.skip;

afterAll(async () => {
  await closePool();
  await tdb?.close();
});

const adminCtx = {
  user: { id: 1, role: "admin", openId: "adm-1", name: "Admin" },
  req: {}, res: {},
} as any;
const officerCtx = (id: number) => ({
  user: { id, role: "customs_officer", openId: `off-${id}`, name: `Officer ${id}` },
  req: {}, res: {},
} as any);

describeDb("audit engine lifecycle against real PostgreSQL (PRA-004)", () => {
  it("persists the full create → assign → findings → close lifecycle", async () => {
    const admin = auditEngineRouter.createCaller(adminCtx);

    const task = await admin.createAuditTask({
      declarationId: "DCL-9001",
      declarantName: "Apapa Traders Ltd",
      hsCode: "8703",
      declaredValueUsd: 250_000,
      dutyPaidUsd: 18_750,
      selectionReason: "risk_score_high",
      riskScore: 88,
    });
    expect(task.id).toMatch(/^audit-/);
    expect(task.status).toBe("pending");

    // Row is really in PostgreSQL.
    const db = await getDb();
    expect(db).not.toBeNull();
    const [persisted] = await db!.select().from(auditTasks).where(eq(auditTasks.id, task.id));
    expect(persisted.declarantName).toBe("Apapa Traders Ltd");
    expect(Number(persisted.declaredValueUsd)).toBeCloseTo(250_000, 2);

    const assigned = await admin.assignAuditTask({
      auditId: task.id, officerId: "42", officerName: "Officer 42",
    });
    expect(assigned.status).toBe("assigned");
    expect(assigned.assignedOfficerId).toBe("42");

    // The assigned officer submits findings; discrepancy is computed and stored.
    const officer = auditEngineRouter.createCaller(officerCtx(42));
    const submitted = await officer.submitFindings({
      auditId: task.id,
      findings: [
        { findingType: "undervaluation", description: "Invoice undervalued vs reference price", amountUsd: 12_500.5, evidenceUrl: "" },
        { findingType: "no_finding", description: "HS classification verified", amountUsd: 0, evidenceUrl: "" },
      ],
    });
    expect(submitted.status).toBe("findings_submitted");
    expect(Number(submitted.dutyDiscrepancyUsd)).toBeCloseTo(12_500.5, 2);

    const findingsRows = await db!.select().from(auditFindings).where(eq(auditFindings.auditTaskId, task.id));
    expect(findingsRows).toHaveLength(2);

    const closed = await admin.closeAudit({ auditId: task.id });
    expect(closed.status).toBe("closed");
    expect(closed.closedAt).toBeTruthy();
  });

  it("forbids findings submission by a non-assigned officer (ownership scoping)", async () => {
    const admin = auditEngineRouter.createCaller(adminCtx);
    const task = await admin.createAuditTask({
      declarationId: "DCL-9002",
      declarantName: "Tin Can Imports",
      declaredValueUsd: 40_000,
      dutyPaidUsd: 3_000,
      selectionReason: "random_sample",
      riskScore: 12,
    });
    await admin.assignAuditTask({ auditId: task.id, officerId: "42", officerName: "Officer 42" });

    const intruder = auditEngineRouter.createCaller(officerCtx(77));
    await expect(
      intruder.submitFindings({
        auditId: task.id,
        findings: [{ findingType: "duty_evasion", description: "fabricated", amountUsd: 1, evidenceUrl: "" }],
      })
    ).rejects.toThrow(/assigned officer/);

    // The rejected submission must not have touched the findings table.
    const db = await getDb();
    const rows = await db!.select().from(auditFindings).where(eq(auditFindings.auditTaskId, task.id));
    expect(rows).toHaveLength(0);
  });

  it("aggregates duty discrepancy across audited tasks (getDutyDiscrepancyReport)", async () => {
    const admin = auditEngineRouter.createCaller(adminCtx);
    const mk = async (declId: string, amounts: number[]) => {
      const t = await admin.createAuditTask({
        declarationId: declId, declarantName: "Report Co",
        declaredValueUsd: 100_000, dutyPaidUsd: 7_500,
        selectionReason: "value_threshold", riskScore: 55,
      });
      await admin.submitFindings({
        auditId: t.id,
        findings: amounts.map((a) => ({
          findingType: "misclassification" as const, description: "reclassified", amountUsd: a, evidenceUrl: "",
        })),
      });
      return t;
    };
    await mk("DCL-RPT-1", [1_000, 250]);
    await mk("DCL-RPT-2", [500]);

    const report = await admin.getDutyDiscrepancyReport({});
    // Report covers the whole fresh database: tasks from the earlier tests
    // are in statuses closed/findings_submitted too, so assert the seeded
    // contribution is present with at-least semantics.
    expect(report.totalAudited).toBeGreaterThanOrEqual(2);
    expect(report.totalDiscrepancyUsd).toBeGreaterThanOrEqual(1_750);
    expect(report.byFindingType.misclassification ?? 0).toBeGreaterThanOrEqual(1_750);
  });

  it("runAuditSelection persists only selected declarations", async () => {
    const admin = auditEngineRouter.createCaller(adminCtx);
    const result = await admin.runAuditSelection({
      declarations: [
        { declarationId: "DCL-SEL-1", declarantName: "High Risk", hsCode: "8703", declaredValueUsd: 10_000, dutyPaidUsd: 750, riskScore: 95, traderTier: "standard", laneAssigned: "YELLOW" },
        { declarationId: "DCL-SEL-2", declarantName: "Sensitive HS", hsCode: "2402", declaredValueUsd: 10_000, dutyPaidUsd: 750, riskScore: 10, traderTier: "aeo", laneAssigned: "GREEN" },
        { declarationId: "DCL-SEL-3", declarantName: "Clean AEO", hsCode: "0401", declaredValueUsd: 10_000, dutyPaidUsd: 750, riskScore: 5, traderTier: "aeo", laneAssigned: "GREEN" },
      ],
    });
    const ids = result.tasks.map((t) => t.declarationId);
    expect(ids).toContain("DCL-SEL-1"); // risk_score_high (deterministic)
    expect(ids).toContain("DCL-SEL-2"); // hs_chapter_sensitive (deterministic)
    // DCL-SEL-3 may only be selected by the random lanes — never assert it.

    const db = await getDb();
    const [sel1] = await db!.select().from(auditTasks).where(eq(auditTasks.declarationId, "DCL-SEL-1"));
    expect(sel1.selectionReason).toBe("risk_score_high");
    expect(sel1.status).toBe("pending");
  });

  it("selection and discrepancy helpers stay consistent with persisted data", async () => {
    expect(selectForAudit({
      riskScore: 70, declaredValueUsd: 1, traderTier: "aeo", hsChapter: "01", laneAssigned: "RED", randomSeed: 0.99,
    })).toBe("risk_score_high");
    expect(selectForAudit({
      riskScore: 10, declaredValueUsd: 100, traderTier: "aeo", hsChapter: "01", laneAssigned: "GREEN", randomSeed: 0.99,
    })).toBeNull();
    expect(calculateDutyDiscrepancy([
      { findingType: "undervaluation", amountUsd: "100.25" },
      { findingType: "no_finding", amountUsd: 999 },
    ])).toBeCloseTo(100.25, 2);
  });

  it("getAuditTask returns the task with its findings from the real join", async () => {
    const admin = auditEngineRouter.createCaller(adminCtx);
    const task = await admin.createAuditTask({
      declarationId: "DCL-9003", declarantName: "Join Check Ltd",
      declaredValueUsd: 5_000, dutyPaidUsd: 375,
      selectionReason: "trader_tier_review", riskScore: 45,
    });
    await admin.submitFindings({
      auditId: task.id,
      findings: [{ findingType: "origin_mismatch", description: "origin docs inconsistent", amountUsd: 750, evidenceUrl: "" }],
    });
    const fetched = await admin.getAuditTask({ auditId: task.id });
    expect(fetched.findings).toHaveLength(1);
    expect(fetched.findings[0].findingType).toBe("origin_mismatch");
    expect(Number(fetched.findings[0].amountUsd)).toBeCloseTo(750, 2);
  });
});
