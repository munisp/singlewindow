/**
 * mswService.ts — Maritime Single Window (MSW / IMO FAL) lifecycle service
 * (Phase 9 WP-C; producing boundary blueeconomy-singlewindow-msw, topic
 * maritime.msw.v1).
 *
 * Contract (blueeconomy-contracts commit eb6b1ae, NORMATIVE):
 * proto/blueeconomy/msw/v1/msw.proto + docs/msw.md.
 *
 * Enforced here (service-enforced invariants the DB cannot express
 * statically; see drizzle/migrations/0057_p9_msw.sql for the DB-level ones):
 *   - PRATIQUE-FIRST (NPPM 2021): non-Port-Health boardings may only be
 *     scheduled/completed after a pratique grant with no later refusal
 *     (PRATIQUE_REQUIRED); completions bind the grant digest.
 *   - MAKER-CHECKER: the reviewing principal is never the submitting
 *     principal (MAKER_CHECKER_VIOLATION).
 *   - SINGLE-SUBMISSION VERSIONING: monotonic per-(visit, form) version with
 *     a priorSubmissionDigestSha256 chain; returned versions are never edited.
 *   - DEPARTURE clearance preconditions: every submitted form version
 *     accepted + pratique granted + joint NIS/NCS/NDLEA/NIMASA boarding
 *     completed; the evaluated checklist is digest-bound.
 *   - DATA MINIMIZATION: form payloads / notes / instruments stay in the
 *     boundary; events carry identifiers + sha256 digests only.
 *   - FAIL CLOSED: port-call verification is real or honestly flagged
 *     (PORT_CALL_UNAVAILABLE / PORT_CALL_UNVERIFIED), signing keys are
 *     env-only (MswSigningConfigError), agency sets are fail-closed, and no
 *     ETA/vessel/port-call data is ever fabricated.
 */

import { createHash } from "node:crypto";
import { and, desc, eq, sql } from "drizzle-orm";
import { getDb, type AppDatabase } from "./db";
import {
  mswAgentNominations,
  mswBoardings,
  mswClearances,
  mswDeclarations,
  mswPratique,
  mswVisits,
  type MswBoarding,
  type MswClearance,
  type MswDeclaration,
  type MswVisit,
} from "../drizzle/schema";
import { canonicalizeJcs } from "./_core/pcsEnvelope";
import {
  MSW_AGENCIES,
  MSW_FORM_TYPES,
  MSW_JOINT_BOARDING_AGENCIES,
  MSW_PERSONAL_DATA_FORMS,
  type MswAgency,
  type MswClearanceKind,
  type MswFormType,
  type MswSignedEnvelope,
} from "./_core/mswEnvelope";
import { emitMswEvent } from "./_core/mswPublisher";
import {
  getPortInteropClient,
  PortInteropConfigError,
  PortInteropRejectedError,
  PortInteropUnavailableError,
} from "./_core/portInteropClient";
import {
  AdapterTransportError,
  AdapterUnconfiguredError,
} from "./_core/externalAdapters/base";
import { fetchEsenShipEntryNotice, npaEsenAdapter } from "./_core/externalAdapters/npaEsen";

// ─── Reason codes (stable, machine-readable) ─────────────────────────────────

export const MSW_REASON_CODES = [
  "DATABASE_UNAVAILABLE",
  "VISIT_NOT_FOUND",
  "DECLARATION_NOT_FOUND",
  "BOARDING_NOT_FOUND",
  "PORT_CALL_UNAVAILABLE",
  "PORT_CALL_UNVERIFIED",
  "INVALID_AGENCY_SET",
  "INVALID_FORM_TYPE",
  "MDOH_REQUIRED",
  "PRATIQUE_REQUIRED",
  "MAKER_CHECKER_VIOLATION",
  "DECLARATION_NOT_SUBMITTED",
  "BOARDING_NOT_SCHEDULED",
  "UNACCEPTED_DECLARATIONS",
  "JOINT_BOARDING_INCOMPLETE",
  "REASON_CODE_REQUIRED",
  "INVALID_INPUT",
  "VERSION_SUPERSEDED",
] as const;
export type MswReasonCode = (typeof MSW_REASON_CODES)[number];

export class MswServiceError extends Error {
  constructor(
    public readonly reasonCode: MswReasonCode,
    message: string
  ) {
    super(message);
    this.name = "MswServiceError";
  }
}

// ─── PBAC roles → agencies ───────────────────────────────────────────────────

export const MSW_ROLES = [
  "msw-port-health", "msw-nis", "msw-customs", "msw-ndlea", "msw-nimasa", "msw-npa", "msw-agent",
] as const;
export type MswRole = (typeof MSW_ROLES)[number];

export const MSW_AGENCY_ROLES: readonly MswRole[] = [
  "msw-port-health", "msw-nis", "msw-customs", "msw-ndlea", "msw-nimasa", "msw-npa",
];

export const MSW_ROLE_TO_AGENCY: Record<string, MswAgency> = {
  "msw-port-health": "PORT_HEALTH",
  "msw-nis": "NIS",
  "msw-customs": "NCS",
  "msw-ndlea": "NDLEA",
  "msw-nimasa": "NIMASA",
  "msw-npa": "NPA",
};

export interface MswPrincipal {
  userId: number;
  /** The PBAC role the caller exercised (carried into envelope provenance). */
  role: MswRole;
}

function agencyOf(principal: MswPrincipal): MswAgency {
  const agency = MSW_ROLE_TO_AGENCY[principal.role];
  if (!agency) {
    throw new MswServiceError("INVALID_AGENCY_SET", `role ${principal.role} maps to no MSW agency`);
  }
  return agency;
}

function principalIdOf(principal: MswPrincipal): string {
  return `msw-user:${principal.userId}`;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function requireDb(): Promise<AppDatabase> {
  const db = await getDb();
  if (!db) {
    throw new MswServiceError("DATABASE_UNAVAILABLE", "PostgreSQL is unavailable for the MSW boundary");
  }
  return db;
}

/** "sha256:<64 lowercase hex>" of the JCS-canonicalized value (data minimization). */
export function mswDigestOf(value: unknown): string {
  return `sha256:${createHash("sha256").update(canonicalizeJcs(value), "utf8").digest("hex")}`;
}

type PublicSeq = "msw_visit_public_seq" | "msw_declaration_public_seq" | "msw_boarding_public_seq" | "msw_clearance_public_seq";

async function nextPublicId(db: AppDatabase, seq: PublicSeq, prefix: string): Promise<string> {
  const rows = await db.execute(sql`SELECT nextval(${seq}::regclass) AS n`);
  const n = Number((rows.rows[0] as { n: number | string }).n);
  return `${prefix}-${String(n).padStart(6, "0")}`;
}

async function requireVisit(db: AppDatabase, visitId: string): Promise<MswVisit> {
  const rows = await db.select().from(mswVisits).where(eq(mswVisits.visitId, visitId)).limit(1);
  if (!rows[0]) throw new MswServiceError("VISIT_NOT_FOUND", `visit '${visitId}' does not exist`);
  return rows[0];
}

/** The latest pratique decision for a visit (by insertion order). */
async function latestPratique(db: AppDatabase, visitPk: number) {
  const rows = await db
    .select()
    .from(mswPratique)
    .where(eq(mswPratique.visitPk, visitPk))
    .orderBy(desc(mswPratique.id))
    .limit(1);
  return rows[0] ?? null;
}

/**
 * Pratique-first gate (NPPM 2021): returns the antecedent GRANT row only when
 * the visit's LATEST pratique decision is a grant (a later refusal re-blocks).
 */
async function requirePratiqueGranted(db: AppDatabase, visitPk: number) {
  const latest = await latestPratique(db, visitPk);
  if (!latest || latest.decision !== "GRANTED") {
    throw new MswServiceError(
      "PRATIQUE_REQUIRED",
      "no antecedent pratique grant is in force for this visit (Port Health boards first — NPPM 2021)"
    );
  }
  return latest;
}

function assertAgencySet(agencies: string[]): asserts agencies is MswAgency[] {
  if (
    agencies.length === 0 ||
    !agencies.every((a) => (MSW_AGENCIES as readonly string[]).includes(a))
  ) {
    throw new MswServiceError(
      "INVALID_AGENCY_SET",
      `boarding agencies must be a non-empty subset of ${MSW_AGENCIES.join("/")} (fail-closed set)`
    );
  }
}

export interface MswServiceResult<T> {
  record: T;
  event: MswSignedEnvelope;
  /** False when Kafka is unreachable (honest; never a fake "published"). */
  eventPublished: boolean;
}

// ─── createVisit ─────────────────────────────────────────────────────────────

export type PortCallVerification = "VERIFIED" | "PORT_CALL_UNVERIFIED" | "PORT_CALL_UNAVAILABLE";

/** The upstream actually consulted for port-call verification (honest). */
export type PortCallUpstream = "port-interop" | "npa-esen" | "none";

export interface CreateVisitInput {
  portCallId?: string;
  vesselImoNumber: string;
  vesselName: string;
  vesselFlagCode: string;
  portCode: string;
  agentReference: string;
  eta: string; // ISO timestamp, declared by the agent — never fabricated
  etd?: string;
}

export async function createVisit(
  principal: MswPrincipal,
  input: CreateVisitInput
): Promise<
  MswServiceResult<MswVisit> & {
    portCallVerification: PortCallVerification;
    portCallUpstream: PortCallUpstream;
    /** Registered gap id disclosed when verification was unavailable (e.g. GAP-MSW-ESEN). */
    portCallGapId: string | null;
  }
> {
  const db = await requireDb();
  if (!/^[0-9]{7}$/.test(input.vesselImoNumber)) {
    throw new MswServiceError("INVALID_INPUT", "vesselImoNumber must be 7 decimal digits (IMO, no prefix)");
  }

  // Port-call linkage: verified=true ONLY on a real upstream verification.
  let portCallVerified = false;
  let portCallVerification: PortCallVerification = "PORT_CALL_UNVERIFIED";
  let portCallUpstream: PortCallUpstream = "none";
  if (input.portCallId) {
    try {
      const client = getPortInteropClient();
      const portCall = await client.getPortCall(input.portCallId, { principal: principalIdOf(principal) });
      portCallVerified =
        portCall.vessel_imo === input.vesselImoNumber && portCall.port_code === input.portCode;
      portCallVerification = portCallVerified ? "VERIFIED" : "PORT_CALL_UNVERIFIED";
      portCallUpstream = "port-interop";
    } catch (err) {
      if (
        err instanceof PortInteropConfigError ||
        err instanceof PortInteropUnavailableError ||
        err instanceof PortInteropRejectedError
      ) {
        // Designated e-SEN upstream (GAP-MSW-ESEN; Phase 9 WP-D): the
        // concrete fail-closed implementation behind PORT_CALL_UNAVAILABLE.
        // With no e-SEN credentials the visit is honestly created unverified
        // and the gap is surfaced — never presented as verified.
        try {
          const esen = await fetchEsenShipEntryNotice(input.portCallId, {
            principalId: principalIdOf(principal),
            principalRole: principal.role,
          });
          portCallVerified =
            esen.response.vesselImoNumber === input.vesselImoNumber &&
            esen.response.portCode === input.portCode;
          portCallVerification = portCallVerified ? "VERIFIED" : "PORT_CALL_UNVERIFIED";
          portCallUpstream = "npa-esen";
        } catch (esenErr) {
          if (esenErr instanceof AdapterUnconfiguredError || esenErr instanceof AdapterTransportError) {
            // Honest fail-closed state: the visit is created unverified and
            // the reason + gap id are surfaced — never fabricated.
            portCallVerified = false;
            portCallVerification = "PORT_CALL_UNAVAILABLE";
          } else {
            throw esenErr;
          }
        }
      } else {
        throw err;
      }
    }
  }

  const now = new Date();
  const visitId = await nextPublicId(db, "msw_visit_public_seq", "mswv");
  const [visit] = await db
    .insert(mswVisits)
    .values({
      visitId,
      portCallId: input.portCallId ?? null,
      portCallVerified,
      vesselImoNumber: input.vesselImoNumber,
      vesselName: input.vesselName,
      vesselFlagCode: input.vesselFlagCode,
      portCode: input.portCode,
      agentReference: input.agentReference,
      eta: new Date(input.eta),
      etd: input.etd ? new Date(input.etd) : null,
      status: "SUBMITTED",
      declaredByUserId: principal.userId,
      declaredAt: now,
      createdAt: now,
      updatedAt: now,
    })
    .returning();

  const { envelope, published } = await emitMswEvent({
    eventType: "maritime.msw.visit_created.v1",
    resource: {
      visitId: visit.visitId,
      ...(input.portCallId ? { portCallId: input.portCallId } : {}),
      portCallVerified,
      vesselImoNumber: input.vesselImoNumber,
      vesselName: input.vesselName,
      vesselFlagCode: input.vesselFlagCode,
      portCode: input.portCode,
      agentReference: input.agentReference,
      eta: new Date(input.eta).toISOString(),
      ...(input.etd ? { etd: new Date(input.etd).toISOString() } : {}),
      status: "SUBMITTED",
      declaredAt: now.toISOString(),
    },
    principalId: principalIdOf(principal),
    principalRole: principal.role,
    aggregateId: visit.visitId,
    correlationId: `corr-${visit.visitId}`,
    occurredAt: now.toISOString(),
  });
  return {
    record: visit,
    event: envelope,
    eventPublished: published,
    portCallVerification,
    portCallUpstream,
    portCallGapId: portCallVerification === "PORT_CALL_UNAVAILABLE" ? npaEsenAdapter.gapId : null,
  };
}

// ─── nominateAgent ───────────────────────────────────────────────────────────

export interface NominateAgentInput {
  visitId: string;
  agentReference: string;
  /** The nomination instrument (retained in the boundary; digest on the wire). */
  nominationDocument: unknown;
}

export async function nominateAgent(
  principal: MswPrincipal,
  input: NominateAgentInput
) {
  const db = await requireDb();
  const visit = await requireVisit(db, input.visitId);
  const now = new Date();
  const digest = mswDigestOf(input.nominationDocument);
  const [nomination] = await db
    .insert(mswAgentNominations)
    .values({
      visitPk: visit.id,
      agentReference: input.agentReference,
      nominationDocumentDigestSha256: digest,
      nominationDocument: input.nominationDocument as Record<string, unknown>,
      nominatedByUserId: principal.userId,
      nominatedAt: now,
    })
    .returning();

  const { envelope, published } = await emitMswEvent({
    eventType: "maritime.msw.agent_nominated.v1",
    resource: {
      visitId: visit.visitId,
      agentReference: input.agentReference,
      nominationDocumentDigestSha256: digest,
      nominatedAt: now.toISOString(),
    },
    principalId: principalIdOf(principal),
    principalRole: principal.role,
    aggregateId: visit.visitId,
    correlationId: `corr-${visit.visitId}`,
    occurredAt: now.toISOString(),
  });
  return { record: nomination, event: envelope, eventPublished: published };
}

// ─── submitDeclaration (single-submission versioning + digest chain) ─────────

export interface SubmitDeclarationInput {
  visitId: string;
  formType: MswFormType;
  /** Schema-validated form payload (retained in the boundary; digest on the wire). */
  formPayload: unknown;
}

export async function submitDeclaration(
  principal: MswPrincipal,
  input: SubmitDeclarationInput
): Promise<MswServiceResult<MswDeclaration>> {
  const db = await requireDb();
  if (!(MSW_FORM_TYPES as readonly string[]).includes(input.formType)) {
    throw new MswServiceError("INVALID_FORM_TYPE", `formType ${input.formType} is not a wire MswFormType`);
  }
  const visit = await requireVisit(db, input.visitId);

  // Monotonic per-(visit, form) version chained to the prior submission.
  const prior = await db
    .select()
    .from(mswDeclarations)
    .where(and(eq(mswDeclarations.visitPk, visit.id), eq(mswDeclarations.formType, input.formType)))
    .orderBy(desc(mswDeclarations.version))
    .limit(1);
  const version = (prior[0]?.version ?? 0) + 1;
  const priorDigest = prior[0]?.formPayloadDigestSha256 ?? "";

  const now = new Date();
  const digest = mswDigestOf(input.formPayload);
  const declarationId = await nextPublicId(db, "msw_declaration_public_seq", "mswd");
  const [declaration] = await db
    .insert(mswDeclarations)
    .values({
      declarationId,
      visitPk: visit.id,
      formType: input.formType,
      version,
      formPayloadDigestSha256: digest,
      priorSubmissionDigestSha256: priorDigest,
      containsPersonalData: MSW_PERSONAL_DATA_FORMS.has(input.formType),
      formPayload: input.formPayload as Record<string, unknown>,
      status: "SUBMITTED",
      submittedByUserId: principal.userId,
      submittedAt: now,
    })
    .returning();

  const { envelope, published } = await emitMswEvent({
    eventType: "maritime.msw.declaration_submitted.v1",
    resource: {
      declarationId: declaration.declarationId,
      visitId: visit.visitId,
      formType: input.formType,
      version,
      formPayloadDigestSha256: digest,
      priorSubmissionDigestSha256: priorDigest,
      containsPersonalData: declaration.containsPersonalData,
      submittedAt: now.toISOString(),
    },
    principalId: principalIdOf(principal),
    principalRole: principal.role,
    aggregateId: visit.visitId,
    correlationId: `corr-${visit.visitId}`,
    occurredAt: now.toISOString(),
  });
  return { record: declaration, event: envelope, eventPublished: published };
}

// ─── acceptDeclaration / returnDeclaration (MAKER-CHECKER) ───────────────────

export interface ReviewDeclarationInput {
  declarationId: string;
  /** Review note retained in the boundary (digest on the wire). */
  reviewNote?: string;
}

async function reviewDeclaration(
  principal: MswPrincipal,
  input: ReviewDeclarationInput,
  decision: "ACCEPTED" | "RETURNED",
  returnReasonCode?: string
): Promise<MswServiceResult<MswDeclaration>> {
  const db = await requireDb();
  const rows = await db
    .select()
    .from(mswDeclarations)
    .where(eq(mswDeclarations.declarationId, input.declarationId))
    .limit(1);
  const declaration = rows[0];
  if (!declaration) {
    throw new MswServiceError("DECLARATION_NOT_FOUND", `declaration '${input.declarationId}' does not exist`);
  }
  // A superseded version is never reviewable: review targets the latest
  // version of the (visit, form) pair only (single-submission principle).
  const newer = await db
    .select({ id: mswDeclarations.id })
    .from(mswDeclarations)
    .where(
      and(
        eq(mswDeclarations.visitPk, declaration.visitPk),
        eq(mswDeclarations.formType, declaration.formType),
        sql`${mswDeclarations.version} > ${declaration.version}`
      )
    )
    .limit(1);
  if (newer[0]) {
    throw new MswServiceError(
      "VERSION_SUPERSEDED",
      `declaration '${input.declarationId}' is superseded by a newer version; only the latest version can be reviewed`
    );
  }
  if (declaration.status !== "SUBMITTED") {
    throw new MswServiceError(
      "DECLARATION_NOT_SUBMITTED",
      `declaration '${input.declarationId}' is ${declaration.status}; only SUBMITTED versions can be reviewed (a returned declaration is re-submitted as a new version)`
    );
  }
  // Maker-checker: the reviewing principal is never the submitting principal.
  if (declaration.submittedByUserId === principal.userId) {
    throw new MswServiceError(
      "MAKER_CHECKER_VIOLATION",
      "the reviewing principal must differ from the submitting principal (maker-checker)"
    );
  }
  const reviewingAgency = agencyOf(principal);
  const now = new Date();
  const reviewNoteDigest = mswDigestOf({
    declarationId: declaration.declarationId,
    version: declaration.version,
    decision,
    note: input.reviewNote ?? null,
    reviewedBy: principalIdOf(principal),
    decidedAt: now.toISOString(),
  });
  const [updated] = await db
    .update(mswDeclarations)
    .set({
      status: decision,
      reviewingAgency,
      reviewedByUserId: principal.userId,
      returnReasonCode: decision === "RETURNED" ? returnReasonCode ?? null : null,
      reviewNote: input.reviewNote ?? null,
      reviewNoteDigestSha256: reviewNoteDigest,
      decidedAt: now,
    })
    .where(eq(mswDeclarations.id, declaration.id))
    .returning();

  const visitRows = await db.select().from(mswVisits).where(eq(mswVisits.id, declaration.visitPk)).limit(1);
  const visit = visitRows[0];
  const baseResource = {
    declarationId: declaration.declarationId,
    visitId: visit.visitId,
    formType: declaration.formType,
    version: declaration.version,
    reviewingAgency,
    reviewNoteDigestSha256: reviewNoteDigest,
    decidedAt: now.toISOString(),
  };
  const { envelope, published } = await emitMswEvent({
    eventType:
      decision === "ACCEPTED"
        ? "maritime.msw.declaration_accepted.v1"
        : "maritime.msw.declaration_returned.v1",
    resource:
      decision === "ACCEPTED"
        ? baseResource
        : { ...baseResource, returnReasonCode: returnReasonCode ?? "" },
    principalId: principalIdOf(principal),
    principalRole: principal.role,
    aggregateId: visit.visitId,
    correlationId: `corr-${visit.visitId}`,
    occurredAt: now.toISOString(),
  });
  return { record: updated, event: envelope, eventPublished: published };
}

export async function acceptDeclaration(principal: MswPrincipal, input: ReviewDeclarationInput) {
  return reviewDeclaration(principal, input, "ACCEPTED");
}

export async function returnDeclaration(
  principal: MswPrincipal,
  input: ReviewDeclarationInput & { returnReasonCode: string }
) {
  if (!input.returnReasonCode) {
    throw new MswServiceError("REASON_CODE_REQUIRED", "returnReasonCode is mandatory on a return");
  }
  return reviewDeclaration(principal, input, "RETURNED", input.returnReasonCode);
}

// ─── grantPratique / refusePratique (anchored to an MDOH declaration) ────────

export interface PratiqueInput {
  visitId: string;
  /** Declaration identifier of the MDOH the decision is based on. */
  healthDeclarationId: string;
  officerReference?: string;
}

async function decidePratique(
  principal: MswPrincipal,
  input: PratiqueInput,
  decision: "GRANTED" | "REFUSED",
  refusalReasonCode?: string
) {
  const db = await requireDb();
  const visit = await requireVisit(db, input.visitId);
  const mdoh = await db
    .select()
    .from(mswDeclarations)
    .where(eq(mswDeclarations.declarationId, input.healthDeclarationId))
    .limit(1);
  if (!mdoh[0] || mdoh[0].visitPk !== visit.id || mdoh[0].formType !== "MDOH") {
    throw new MswServiceError(
      "MDOH_REQUIRED",
      "a pratique decision must be anchored to a Maritime Declaration of Health submitted for this visit"
    );
  }
  const officerReference = input.officerReference ?? principalIdOf(principal);
  const now = new Date();
  const recordDigest = mswDigestOf({
    visitId: visit.visitId,
    healthDeclarationReference: input.healthDeclarationId,
    officerReference,
    decision,
    decidedAt: now.toISOString(),
  });
  const [pratique] = await db
    .insert(mswPratique)
    .values({
      visitPk: visit.id,
      decision,
      healthDeclarationPk: mdoh[0].id,
      officerReference,
      refusalReasonCode: decision === "REFUSED" ? refusalReasonCode ?? null : null,
      pratiqueRecordDigestSha256: recordDigest,
      decidedByUserId: principal.userId,
      decidedAt: now,
    })
    .returning();

  const { envelope, published } = await emitMswEvent({
    eventType:
      decision === "GRANTED" ? "maritime.msw.pratique_granted.v1" : "maritime.msw.pratique_refused.v1",
    resource:
      decision === "GRANTED"
        ? {
            visitId: visit.visitId,
            healthDeclarationReference: input.healthDeclarationId,
            grantedByReference: officerReference,
            grantedAt: now.toISOString(),
          }
        : {
            visitId: visit.visitId,
            healthDeclarationReference: input.healthDeclarationId,
            refusedByReference: officerReference,
            refusalReasonCode: refusalReasonCode ?? "",
            refusalRecordDigestSha256: recordDigest,
            refusedAt: now.toISOString(),
          },
    principalId: principalIdOf(principal),
    principalRole: principal.role,
    aggregateId: visit.visitId,
    correlationId: `corr-${visit.visitId}`,
    occurredAt: now.toISOString(),
  });
  return { record: pratique, event: envelope, eventPublished: published };
}

export async function grantPratique(principal: MswPrincipal, input: PratiqueInput) {
  return decidePratique(principal, input, "GRANTED");
}

export async function refusePratique(
  principal: MswPrincipal,
  input: PratiqueInput & { refusalReasonCode: string }
) {
  if (!input.refusalReasonCode) {
    throw new MswServiceError("REASON_CODE_REQUIRED", "refusalReasonCode is mandatory on a pratique refusal");
  }
  return decidePratique(principal, input, "REFUSED", input.refusalReasonCode);
}

// ─── scheduleBoarding / completeBoarding (pratique-first, fail-closed set) ───

export interface ScheduleBoardingInput {
  visitId: string;
  agencies: string[];
  scheduledAt: string; // ISO timestamp
  scheduleNote?: string;
}

export async function scheduleBoarding(
  principal: MswPrincipal,
  input: ScheduleBoardingInput
): Promise<MswServiceResult<MswBoarding>> {
  const db = await requireDb();
  assertAgencySet(input.agencies);
  const visit = await requireVisit(db, input.visitId);
  // NPPM 2021: Port Health boards first — any non-Port-Health party requires
  // an antecedent pratique grant with no later refusal.
  if (input.agencies.some((a) => a !== "PORT_HEALTH")) {
    await requirePratiqueGranted(db, visit.id);
  }
  const now = new Date();
  const noteDigest = input.scheduleNote
    ? mswDigestOf({ boardingFor: visit.visitId, note: input.scheduleNote, scheduledAt: input.scheduledAt })
    : "";
  const boardingId = await nextPublicId(db, "msw_boarding_public_seq", "mswb");
  const [boarding] = await db
    .insert(mswBoardings)
    .values({
      boardingId,
      visitPk: visit.id,
      agencies: input.agencies,
      scheduledByAgency: agencyOf(principal),
      scheduledAt: new Date(input.scheduledAt),
      scheduleNoteDigestSha256: noteDigest,
      status: "SCHEDULED",
    })
    .returning();

  const { envelope, published } = await emitMswEvent({
    eventType: "maritime.msw.boarding_scheduled.v1",
    resource: {
      boardingId,
      visitId: visit.visitId,
      agencies: input.agencies,
      scheduledByAgency: boarding.scheduledByAgency,
      scheduledAt: new Date(input.scheduledAt).toISOString(),
      scheduleNoteDigestSha256: noteDigest,
    },
    principalId: principalIdOf(principal),
    principalRole: principal.role,
    aggregateId: visit.visitId,
    correlationId: `corr-${visit.visitId}`,
    occurredAt: now.toISOString(),
  });
  return { record: boarding, event: envelope, eventPublished: published };
}

export interface CompleteBoardingInput {
  boardingId: string;
  /** Agencies that actually boarded; defaults to the scheduled party. */
  agencies?: string[];
  startedAt: string;
  completedAt: string;
  /** Boarding outcome/findings retained in the boundary (digest on the wire). */
  outcome: unknown;
}

export async function completeBoarding(
  principal: MswPrincipal,
  input: CompleteBoardingInput
): Promise<MswServiceResult<MswBoarding>> {
  const db = await requireDb();
  const rows = await db.select().from(mswBoardings).where(eq(mswBoardings.boardingId, input.boardingId)).limit(1);
  const boarding = rows[0];
  if (!boarding) {
    throw new MswServiceError("BOARDING_NOT_FOUND", `boarding '${input.boardingId}' does not exist`);
  }
  if (boarding.status !== "SCHEDULED") {
    throw new MswServiceError("BOARDING_NOT_SCHEDULED", `boarding '${input.boardingId}' is already ${boarding.status}`);
  }
  const agencies = input.agencies ?? boarding.agencies;
  assertAgencySet(agencies);

  // Pratique-first: a non-Port-Health completion binds the antecedent grant.
  let pratiqueGrantDigest = "";
  if (agencies.some((a) => a !== "PORT_HEALTH")) {
    const grant = await requirePratiqueGranted(db, boarding.visitPk);
    pratiqueGrantDigest = grant.pratiqueRecordDigestSha256;
  }
  const now = new Date();
  const outcomeDigest = mswDigestOf(input.outcome);
  const [updated] = await db
    .update(mswBoardings)
    .set({
      status: "COMPLETED",
      agencies,
      startedAt: new Date(input.startedAt),
      completedAt: new Date(input.completedAt),
      pratiqueGrantDigestSha256: pratiqueGrantDigest,
      outcomeDigestSha256: outcomeDigest,
    })
    .where(eq(mswBoardings.id, boarding.id))
    .returning();

  const visitRows = await db.select().from(mswVisits).where(eq(mswVisits.id, boarding.visitPk)).limit(1);
  const { envelope, published } = await emitMswEvent({
    eventType: "maritime.msw.boarding_completed.v1",
    resource: {
      boardingId: boarding.boardingId,
      visitId: visitRows[0].visitId,
      agencies,
      startedAt: new Date(input.startedAt).toISOString(),
      completedAt: new Date(input.completedAt).toISOString(),
      pratiqueGrantDigestSha256: pratiqueGrantDigest,
      outcomeDigestSha256: outcomeDigest,
    },
    principalId: principalIdOf(principal),
    principalRole: principal.role,
    aggregateId: visitRows[0].visitId,
    correlationId: `corr-${visitRows[0].visitId}`,
    occurredAt: now.toISOString(),
  });
  return { record: updated, event: envelope, eventPublished: published };
}

// ─── grantClearance / refuseClearance ────────────────────────────────────────

export interface ClearanceInput {
  visitId: string;
  kind: MswClearanceKind;
  /** Clearance conditions retained in the boundary (digest on the wire). */
  conditions?: unknown;
}

/**
 * Evaluates the DEPARTURE precondition set (docs/msw.md): every submitted
 * form version accepted, pratique granted, joint boarding completed. Returns
 * the evaluated checklist; its digest binds the grant on the wire.
 */
async function evaluateDeparturePreconditions(db: AppDatabase, visit: MswVisit) {
  // Every (visit, form) latest version must be ACCEPTED.
  const declarations = await db
    .select()
    .from(mswDeclarations)
    .where(eq(mswDeclarations.visitPk, visit.id))
    .orderBy(desc(mswDeclarations.version));
  const latestByForm = new Map<string, MswDeclaration>();
  for (const d of declarations) {
    if (!latestByForm.has(d.formType)) latestByForm.set(d.formType, d);
  }
  const unaccepted = [...latestByForm.values()].filter((d) => d.status !== "ACCEPTED");
  if (latestByForm.size === 0 || unaccepted.length > 0) {
    throw new MswServiceError(
      "UNACCEPTED_DECLARATIONS",
      `DEPARTURE clearance requires every submitted form version accepted; not accepted: ${
        unaccepted.map((d) => `${d.formType}v${d.version}(${d.status})`).join(", ") || "none submitted"
      }`
    );
  }
  // Pratique granted (latest decision, no later refusal).
  const grant = await requirePratiqueGranted(db, visit.id);
  // Joint NIS/NCS/NDLEA/NIMASA boarding completed.
  const boardings = await db
    .select()
    .from(mswBoardings)
    .where(and(eq(mswBoardings.visitPk, visit.id), eq(mswBoardings.status, "COMPLETED")));
  const joint = boardings.filter((b) =>
    MSW_JOINT_BOARDING_AGENCIES.every((a) => b.agencies.includes(a))
  );
  if (joint.length === 0) {
    throw new MswServiceError(
      "JOINT_BOARDING_INCOMPLETE",
      "DEPARTURE clearance requires the joint NIS/NCS/NDLEA/NIMASA boarding completed (NPPM 2021)"
    );
  }
  return {
    visitId: visit.visitId,
    kind: "DEPARTURE",
    acceptedDeclarations: [...latestByForm.values()]
      .map((d) => ({ formType: d.formType, version: d.version, digest: d.formPayloadDigestSha256 }))
      .sort((a, b) => a.formType.localeCompare(b.formType)),
    pratiqueGrantDigestSha256: grant.pratiqueRecordDigestSha256,
    jointBoardingIds: joint.map((b) => b.boardingId).sort(),
  };
}

export async function grantClearance(
  principal: MswPrincipal,
  input: ClearanceInput
): Promise<MswServiceResult<MswClearance> & { preconditionChecklist?: unknown }> {
  const db = await requireDb();
  const visit = await requireVisit(db, input.visitId);
  const now = new Date();
  let checklistDigest = "";
  let checklist: unknown;
  if (input.kind === "DEPARTURE") {
    checklist = await evaluateDeparturePreconditions(db, visit);
    checklistDigest = mswDigestOf(checklist);
  }
  const conditionsDigest = input.conditions !== undefined ? mswDigestOf(input.conditions) : "";
  const clearanceId = await nextPublicId(db, "msw_clearance_public_seq", "mswc");
  const [clearance] = await db
    .insert(mswClearances)
    .values({
      clearanceId,
      visitPk: visit.id,
      kind: input.kind,
      decision: "GRANTED",
      decidedByAgency: agencyOf(principal),
      preconditionChecklistDigestSha256: checklistDigest,
      conditionsDigestSha256: conditionsDigest,
      decidedByUserId: principal.userId,
      decidedAt: now,
    })
    .returning();
  await db
    .update(mswVisits)
    .set({
      status: input.kind === "ARRIVAL" ? "CLEARED_TO_ENTER" : "CLEARED_TO_DEPART",
      updatedAt: now,
    })
    .where(eq(mswVisits.id, visit.id));

  const { envelope, published } = await emitMswEvent({
    eventType: "maritime.msw.clearance_granted.v1",
    resource: {
      clearanceId,
      visitId: visit.visitId,
      kind: input.kind,
      decidedByAgency: clearance.decidedByAgency,
      preconditionChecklistDigestSha256: checklistDigest,
      conditionsDigestSha256: conditionsDigest,
      decidedAt: now.toISOString(),
    },
    principalId: principalIdOf(principal),
    principalRole: principal.role,
    aggregateId: visit.visitId,
    correlationId: `corr-${visit.visitId}`,
    occurredAt: now.toISOString(),
  });
  return { record: clearance, event: envelope, eventPublished: published, preconditionChecklist: checklist };
}

export async function refuseClearance(
  principal: MswPrincipal,
  input: ClearanceInput & { refusalReasonCode: string }
) {
  const db = await requireDb();
  if (!input.refusalReasonCode) {
    throw new MswServiceError("REASON_CODE_REQUIRED", "refusalReasonCode is mandatory on a clearance refusal");
  }
  const visit = await requireVisit(db, input.visitId);
  const now = new Date();
  const refusalRecordDigest = mswDigestOf({
    visitId: visit.visitId,
    kind: input.kind,
    refusalReasonCode: input.refusalReasonCode,
    decidedBy: principalIdOf(principal),
    decidedAt: now.toISOString(),
  });
  const clearanceId = await nextPublicId(db, "msw_clearance_public_seq", "mswc");
  const [clearance] = await db
    .insert(mswClearances)
    .values({
      clearanceId,
      visitPk: visit.id,
      kind: input.kind,
      decision: "REFUSED",
      decidedByAgency: agencyOf(principal),
      refusalReasonCode: input.refusalReasonCode,
      refusalRecordDigestSha256: refusalRecordDigest,
      decidedByUserId: principal.userId,
      decidedAt: now,
    })
    .returning();

  const { envelope, published } = await emitMswEvent({
    eventType: "maritime.msw.clearance_refused.v1",
    resource: {
      clearanceId,
      visitId: visit.visitId,
      kind: input.kind,
      decidedByAgency: clearance.decidedByAgency,
      refusalReasonCode: input.refusalReasonCode,
      refusalRecordDigestSha256: refusalRecordDigest,
      decidedAt: now.toISOString(),
    },
    principalId: principalIdOf(principal),
    principalRole: principal.role,
    aggregateId: visit.visitId,
    correlationId: `corr-${visit.visitId}`,
    occurredAt: now.toISOString(),
  });
  return { record: clearance, event: envelope, eventPublished: published };
}
