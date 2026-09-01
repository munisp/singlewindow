/**
 * crm/cases.ts — Stakeholder-360 case/ticket workflow (Phase 12).
 *
 * State machine (fail-closed — any non-listed transition is refused):
 *   open → triaged → in_progress → resolved → closed
 *
 * Maker-checker on resolution for dispute-type cases: the officer who
 * resolves (maker) cannot approve their own resolution; a DIFFERENT officer
 * (checker) must approve before the case can close. Non-dispute cases close
 * directly from resolved.
 *
 * SLA timestamps are stamped at creation (triage + resolution due) and
 * triage time; breaches are derivable from those columns.
 *
 * Every lifecycle step appends an immutable crm_case_events row and emits a
 * signed crm.case.v1 envelope event (event publication failure is surfaced
 * honestly via eventPublished; signing misconfiguration throws fail-closed).
 */
import { and, desc, eq, sql, type SQL } from "drizzle-orm";
import { getDb } from "../db";
import { crmCaseEvents, crmCases, type CrmCase } from "../../drizzle/schema";
import { emitCrmCaseEvent } from "./publisher";
import type { CrmCaseEventType } from "./envelope";

export const CRM_CASE_STATUSES = ["open", "triaged", "in_progress", "resolved", "closed"] as const;
export type CrmCaseStatus = (typeof CRM_CASE_STATUSES)[number];

export const CRM_CASE_TYPES = ["general", "declaration", "payment", "verification", "dispute"] as const;
export type CrmCaseType = (typeof CRM_CASE_TYPES)[number];

/** Fail-closed transition table. */
const ALLOWED_TRANSITIONS: Readonly<Record<CrmCaseStatus, readonly CrmCaseStatus[]>> = {
  open: ["triaged"],
  triaged: ["in_progress"],
  in_progress: ["resolved"],
  resolved: ["closed"],
  closed: [],
};

export class CaseTransitionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CaseTransitionError";
  }
}

/** Pure transition guard — fully unit-testable. */
export function assertTransitionAllowed(from: string, to: string): void {
  const allowed = ALLOWED_TRANSITIONS[from as CrmCaseStatus];
  if (!allowed || !allowed.includes(to as CrmCaseStatus)) {
    throw new CaseTransitionError(
      `Illegal case transition "${from}" → "${to}"; allowed from "${from}": [${(allowed ?? []).join(", ")}]`
    );
  }
}

/**
 * Pure close guard — maker-checker for dispute-type cases.
 * Returns an error string when closing is refused, null when allowed.
 */
export function closeBlocker(c: Pick<CrmCase, "status" | "caseType" | "resolutionApprovedBy">): string | null {
  if (c.status !== "resolved") return `Only a resolved case can close (current: ${c.status})`;
  if (c.caseType === "dispute" && c.resolutionApprovedBy == null) {
    return "Dispute cases require maker-checker resolution approval before close";
  }
  return null;
}

/** SLA deadlines by priority (pure). */
export function slaDeadlines(priority: string, now: Date = new Date()): { triageDue: Date; resolutionDue: Date } {
  const triageHours = priority === "critical" ? 1 : priority === "high" ? 4 : priority === "low" ? 72 : 24;
  const resolutionHours = priority === "critical" ? 8 : priority === "high" ? 24 : priority === "low" ? 240 : 96;
  return {
    triageDue: new Date(now.getTime() + triageHours * 3600_000),
    resolutionDue: new Date(now.getTime() + resolutionHours * 3600_000),
  };
}

export interface CreateCaseInput {
  subject: string;
  description?: string;
  caseType: CrmCaseType;
  priority: "low" | "medium" | "high" | "critical";
  stakeholderProfileId?: number;
  declarationId?: number;
  tenantId?: string;
  actorId: number;
  actorRole: string;
}

export interface CaseMutationResult {
  case: CrmCase;
  eventPublished: boolean;
}

async function publishCaseEvent(
  eventType: CrmCaseEventType,
  c: CrmCase,
  actor: { id: number; role: string },
  extra: Record<string, unknown> = {}
): Promise<boolean> {
  try {
    const res = await emitCrmCaseEvent({
      eventType,
      aggregateId: c.caseNumber,
      principalId: String(actor.id),
      principalRole: actor.role,
      resource: {
        "@type": "type.googleapis.com/blueeconomy.crm.v1.CrmCase",
        caseNumber: c.caseNumber,
        caseId: c.id,
        status: c.status,
        caseType: c.caseType,
        priority: c.priority,
        stakeholderProfileId: c.stakeholderProfileId,
        assignedTo: c.assignedTo,
        ...extra,
      },
    });
    return res.published;
  } catch (err) {
    // Signing misconfiguration is fail-closed (throws); Kafka outage degrades.
    if (err instanceof Error && err.name === "CrmSigningConfigError") throw err;
    return false;
  }
}

export async function createCase(input: CreateCaseInput): Promise<CaseMutationResult> {
  const db = (await getDb())!;
  const { triageDue, resolutionDue } = slaDeadlines(input.priority);
  return db.transaction(async (tx) => {
    const [row] = await tx
      .insert(crmCases)
      .values({
        caseNumber: "CRM-PENDING", // placeholder replaced below with the real id
        subject: input.subject,
        description: input.description ?? null,
        caseType: input.caseType,
        priority: input.priority,
        stakeholderProfileId: input.stakeholderProfileId ?? null,
        declarationId: input.declarationId ?? null,
        tenantId: input.tenantId ?? null,
        createdBy: input.actorId,
        slaTriageDue: triageDue,
        slaResolutionDue: resolutionDue,
      })
      .returning();
    const caseNumber = `CRM-${String(row.id).padStart(6, "0")}`;
    const [c] = await tx
      .update(crmCases)
      .set({ caseNumber })
      .where(eq(crmCases.id, row.id))
      .returning();
    await tx.insert(crmCaseEvents).values({
      caseId: c.id,
      eventType: "created",
      toStatus: "open",
      actorId: input.actorId,
      note: input.subject,
    });
    const eventPublished = await publishCaseEvent("crm.case.created.v1", c, { id: input.actorId, role: input.actorRole });
    return { case: c, eventPublished };
  });
}

export interface ListCasesFilter {
  status?: CrmCaseStatus;
  caseType?: CrmCaseType;
  assignedTo?: number;
  stakeholderProfileId?: number;
  tenantId?: string;
  /** Hard pagination caps — page size never exceeds MAX_PAGE_SIZE. */
  limit?: number;
  offset?: number;
}

export const MAX_PAGE_SIZE = 100;

export async function listCases(filter: ListCasesFilter): Promise<{ items: CrmCase[]; total: number }> {
  const db = (await getDb())!;
  const conds: SQL[] = [];
  if (filter.status) conds.push(eq(crmCases.status, filter.status));
  if (filter.caseType) conds.push(eq(crmCases.caseType, filter.caseType));
  if (filter.assignedTo != null) conds.push(eq(crmCases.assignedTo, filter.assignedTo));
  if (filter.stakeholderProfileId != null) conds.push(eq(crmCases.stakeholderProfileId, filter.stakeholderProfileId));
  if (filter.tenantId) conds.push(eq(crmCases.tenantId, filter.tenantId));
  const where = conds.length ? and(...conds) : undefined;
  const limit = Math.min(Math.max(filter.limit ?? 25, 1), MAX_PAGE_SIZE);
  const offset = Math.max(filter.offset ?? 0, 0);
  const [items, countRows] = await Promise.all([
    db.select().from(crmCases).where(where).orderBy(desc(crmCases.createdAt)).limit(limit).offset(offset),
    db.select({ count: sql<number>`count(*)::int` }).from(crmCases).where(where),
  ]);
  return { items, total: Number(countRows[0]?.count ?? 0) };
}

export async function getCaseById(id: number): Promise<CrmCase | null> {
  const db = (await getDb())!;
  const [c] = await db.select().from(crmCases).where(eq(crmCases.id, id)).limit(1);
  return c ?? null;
}

export async function getCaseTimeline(caseId: number) {
  const db = (await getDb())!;
  return db
    .select()
    .from(crmCaseEvents)
    .where(eq(crmCaseEvents.caseId, caseId))
    .orderBy(crmCaseEvents.createdAt);
}

export async function assignCase(caseId: number, assigneeId: number, actor: { id: number; role: string }): Promise<CaseMutationResult> {
  const db = (await getDb())!;
  const existing = await getCaseById(caseId);
  if (!existing) throw new CaseTransitionError(`Case ${caseId} not found`);
  if (existing.status === "closed") throw new CaseTransitionError("Closed cases cannot be reassigned");
  const [c] = await db
    .update(crmCases)
    .set({ assignedTo: assigneeId, updatedAt: new Date() })
    .where(eq(crmCases.id, caseId))
    .returning();
  await db.insert(crmCaseEvents).values({
    caseId,
    eventType: "assigned",
    actorId: actor.id,
    note: `Assigned to user ${assigneeId}`,
  });
  const eventPublished = await publishCaseEvent("crm.case.assigned.v1", c, actor);
  return { case: c, eventPublished };
}

export interface TransitionInput {
  caseId: number;
  toStatus: CrmCaseStatus;
  actor: { id: number; role: string };
  note?: string;
  /** Required when resolving. */
  resolutionSummary?: string;
}

export async function transitionCase(input: TransitionInput): Promise<CaseMutationResult> {
  const db = (await getDb())!;
  const existing = await getCaseById(input.caseId);
  if (!existing) throw new CaseTransitionError(`Case ${input.caseId} not found`);
  assertTransitionAllowed(existing.status, input.toStatus);

  const patch: Partial<typeof crmCases.$inferInsert> = { status: input.toStatus, updatedAt: new Date() };
  let eventType: CrmCaseEventType = "crm.case.transitioned.v1";

  if (input.toStatus === "triaged") {
    patch.triagedAt = new Date();
  } else if (input.toStatus === "resolved") {
    if (!input.resolutionSummary || input.resolutionSummary.trim().length < 10) {
      throw new CaseTransitionError("Resolving a case requires a resolution summary (min 10 chars)");
    }
    patch.resolvedBy = input.actor.id;
    patch.resolvedAt = new Date();
    patch.resolutionSummary = input.resolutionSummary;
    // Maker-checker: dispute resolutions reset any stale approval.
    patch.resolutionApprovedBy = null;
    patch.resolutionApprovedAt = null;
    eventType = "crm.case.resolved.v1";
  } else if (input.toStatus === "closed") {
    // Transition guard already enforced resolved → closed; the close guard
    // additionally enforces maker-checker approval for dispute cases.
    const blocker = closeBlocker(existing);
    if (blocker) throw new CaseTransitionError(blocker);
    patch.closedAt = new Date();
    eventType = "crm.case.closed.v1";
  }

  const [c] = await db.update(crmCases).set(patch).where(eq(crmCases.id, input.caseId)).returning();
  await db.insert(crmCaseEvents).values({
    caseId: input.caseId,
    eventType: input.toStatus === "closed" ? "closed" : "transition",
    fromStatus: existing.status,
    toStatus: input.toStatus,
    actorId: input.actor.id,
    note: input.note ?? null,
  });
  const eventPublished = await publishCaseEvent(eventType, c, input.actor, {
    fromStatus: existing.status,
    toStatus: input.toStatus,
  });
  return { case: c, eventPublished };
}

/**
 * Maker-checker: approve a dispute resolution. The checker MUST differ from
 * the maker (resolvedBy) — self-approval is refused.
 */
export async function approveResolution(caseId: number, actor: { id: number; role: string }): Promise<CaseMutationResult> {
  const db = (await getDb())!;
  const existing = await getCaseById(caseId);
  if (!existing) throw new CaseTransitionError(`Case ${caseId} not found`);
  if (existing.status !== "resolved") {
    throw new CaseTransitionError(`Only a resolved case can be approved (current: ${existing.status})`);
  }
  if (existing.resolvedBy === actor.id) {
    throw new CaseTransitionError("Maker-checker violation: the resolving officer cannot approve their own resolution");
  }
  const [c] = await db
    .update(crmCases)
    .set({ resolutionApprovedBy: actor.id, resolutionApprovedAt: new Date(), updatedAt: new Date() })
    .where(eq(crmCases.id, caseId))
    .returning();
  await db.insert(crmCaseEvents).values({
    caseId,
    eventType: "resolution_approved",
    actorId: actor.id,
  });
  const eventPublished = await publishCaseEvent("crm.case.resolution_approved.v1", c, actor);
  return { case: c, eventPublished };
}
