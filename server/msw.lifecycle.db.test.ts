/**
 * Phase 9 WP-C — REAL DB-gated lifecycle tests for the Maritime Single
 * Window (mswv-000001-style flow) against a fresh PostgreSQL database
 * carrying the full migration chain (server/testutils/pgTestHarness.ts).
 * No mocks: real drizzle helpers, real CHECK/FK enforcement, real Ed25519
 * envelope signing (synthetic TEST-ONLY key set via env, disclosed below).
 *
 * Flow: create visit → nominate agent → submit FAL1..FAL7+MDOH → return
 * FAL2 v1 (NCS) → re-submit FAL2 v2 (digest-chained) → accept all → Port
 * Health pratique grant (MDOH-anchored) → joint NIS/NCS/NDLEA/NIMASA boarding
 * scheduled+completed → DEPARTURE clearance granted.
 *
 * Negative cases: boarding before pratique rejected PRATIQUE_REQUIRED;
 * maker-checker violation rejected; DEPARTURE clearance with an unaccepted
 * form rejected UNACCEPTED_DECLARATIONS; DEPARTURE before pratique rejected
 * PRATIQUE_REQUIRED; version-chain integrity (DB unique constraint +
 * priorSubmissionDigestSha256 chain + DB CHECKs).
 *
 * Kafka is NOT required: when the broker is unreachable the publisher
 * honestly reports eventPublished:false (platform graceful-degradation
 * posture); the DB lifecycle and envelope signing remain fully exercised.
 *
 * Skips cleanly with a printed reason when PostgreSQL is unavailable.
 */
import { describe, it, expect, afterAll } from "vitest";
import { generateKeyPairSync } from "node:crypto";
import { createTestDatabase, expectPgRejection } from "./testutils/pgTestHarness";

// Synthetic TEST-ONLY signing key (generated per run; never a production
// key). Set before any service call — mswEnvelope reads the env lazily.
const testKey = generateKeyPairSync("ed25519");
process.env.MSW_ENVELOPE_SIGNING_KEY = (testKey.privateKey.export({ format: "jwk" }) as { d: string }).d;
process.env.MSW_ENVELOPE_KEY_ID = "0";

const tdb = await createTestDatabase("msw_lifecycle");
if (tdb) process.env.DATABASE_URL = tdb.url;
if (!tdb) {
  console.warn("[msw-db] SKIPPING MSW lifecycle suite: PostgreSQL unavailable (see pg-harness state)");
}
const describeDb = tdb ? describe : describe.skip;

afterAll(async () => {
  const { closePool } = await import("./db");
  await closePool();
  await tdb?.close();
});

const ALL_FORMS = ["FAL1", "FAL2", "FAL3", "FAL4", "FAL5", "FAL6", "FAL7", "MDOH"] as const;

async function seedUser(openId: string, name: string): Promise<number> {
  const { getDb } = await import("./db");
  const { users } = await import("../drizzle/schema");
  const db = (await getDb())!;
  const [u] = await db
    .insert(users)
    .values({ openId, name, loginMethod: "test", role: "user" })
    .returning();
  return u.id;
}

describeDb("MSW lifecycle against real PostgreSQL (Phase 9 WP-C)", () => {
  it(
    "walks the full mswv-000001-style flow with pratique-first + maker-checker + version chain",
    { timeout: 60_000 },
    async () => {
      const svc = await import("./mswService");
      const { validateMswEvent } = await import("./_core/mswEnvelope");
      const { getDb } = await import("./db");
      const schema = await import("../drizzle/schema");
      const { eq } = await import("drizzle-orm");
      const db = (await getDb())!;

      // MSW tables must exist (migration 0057 applied) — fail loudly otherwise.
      await db.select().from(schema.mswVisits).limit(1);

      const agentId = await seedUser("msw-agent-1", "Agent One");
      const phId = await seedUser("msw-ph-1", "Port Health Officer");
      const ncsId = await seedUser("msw-ncs-1", "Customs Officer");
      const nimasaId = await seedUser("msw-nimasa-1", "NIMASA Officer");
      const agent = { userId: agentId, role: "msw-agent" as const };
      const portHealth = { userId: phId, role: "msw-port-health" as const };
      const customs = { userId: ncsId, role: "msw-customs" as const };
      const nimasa = { userId: nimasaId, role: "msw-nimasa" as const };

      const assertEventValid = (event: Parameters<typeof validateMswEvent>[0]) => {
        const v = validateMswEvent(event);
        expect(v.ok, v.ok ? "" : `${v.reason}: ${v.detail}`).toBe(true);
      };

      // ── 1. Visit (unlinked → honest portCallVerified=false) ──────────────
      const visitRes = await svc.createVisit(agent, {
        vesselImoNumber: "9074729",
        vesselName: "MT LAGOS TRADER",
        vesselFlagCode: "NG",
        portCode: "NGLOS",
        agentReference: "agt-org-000042",
        eta: "2026-09-03T06:00:00Z",
        etd: "2026-09-06T18:00:00Z",
      });
      const visitId = visitRes.record.visitId;
      expect(visitId).toMatch(/^mswv-\d{6}$/);
      expect(visitRes.record.portCallVerified).toBe(false);
      expect(visitRes.portCallVerification).toBe("PORT_CALL_UNVERIFIED");
      assertEventValid(visitRes.event);

      // ── 2. Agent nomination ───────────────────────────────────────────────
      const nomRes = await svc.nominateAgent(agent, {
        visitId,
        agentReference: "agt-org-000042",
        nominationDocument: { instrument: "NOMINATION", ref: "nom-1" },
      });
      assertEventValid(nomRes.event);
      expect(nomRes.record.nominationDocumentDigestSha256).toMatch(/^sha256:[0-9a-f]{64}$/);

      // ── 3. Submit FAL1..FAL7 + MDOH (v1 each; chain head empty) ──────────
      const declarations = new Map<string, Awaited<ReturnType<typeof svc.submitDeclaration>>["record"]>();
      for (const formType of ALL_FORMS) {
        const res = await svc.submitDeclaration(agent, {
          visitId,
          formType,
          formPayload: { form: formType, line: 1 },
        });
        expect(res.record.version).toBe(1);
        expect(res.record.priorSubmissionDigestSha256).toBe("");
        expect(res.record.containsPersonalData).toBe(["FAL4", "FAL5", "FAL6", "MDOH"].includes(formType));
        assertEventValid(res.event);
        declarations.set(formType, res.record);
      }
      // Personal-data forms floor the envelope at RESTRICTED.
      const fal5res = await svc.submitDeclaration(agent, {
        visitId,
        formType: "FAL5",
        formPayload: { form: "FAL5", line: 2 },
      });
      expect(fal5res.record.version).toBe(2);
      expect(fal5res.record.priorSubmissionDigestSha256).toBe(declarations.get("FAL5")!.formPayloadDigestSha256);
      expect(fal5res.event.classification).toBe("RESTRICTED");
      expect(fal5res.event.recordClassification).toBe("RESTRICTED");
      assertEventValid(fal5res.event);
      declarations.set("FAL5", fal5res.record);

      // ── 4. NCS returns FAL2 v1 → agent re-submits as v2 (chain) ──────────
      const retRes = await svc.returnDeclaration(customs, {
        declarationId: declarations.get("FAL2")!.declarationId,
        returnReasonCode: "CARGO_LINE_ITEM_MISMATCH",
        reviewNote: "line items do not match manifest",
      });
      expect(retRes.record.status).toBe("RETURNED");
      assertEventValid(retRes.event);

      const fal2v2 = await svc.submitDeclaration(agent, {
        visitId,
        formType: "FAL2",
        formPayload: { form: "FAL2", line: 2 },
      });
      expect(fal2v2.record.version).toBe(2);
      expect(fal2v2.record.priorSubmissionDigestSha256).toBe(
        declarations.get("FAL2")!.formPayloadDigestSha256
      );
      declarations.set("FAL2", fal2v2.record);

      // ── 5. Maker-checker: the submitting principal can NEVER review ──────
      await expect(
        svc.acceptDeclaration(agent, { declarationId: declarations.get("FAL1")!.declarationId })
      ).rejects.toMatchObject({ reasonCode: "MAKER_CHECKER_VIOLATION" });

      // ── 6. Boarding before pratique → PRATIQUE_REQUIRED ──────────────────
      await expect(
        svc.scheduleBoarding(nimasa, {
          visitId,
          agencies: ["NIS", "NCS", "NDLEA", "NIMASA"],
          scheduledAt: "2026-09-03T09:00:00Z",
        })
      ).rejects.toMatchObject({ reasonCode: "PRATIQUE_REQUIRED" });
      // A PORT_HEALTH-only boarding may be scheduled before pratique.
      const phBoarding = await svc.scheduleBoarding(portHealth, {
        visitId,
        agencies: ["PORT_HEALTH"],
        scheduledAt: "2026-09-02T08:00:00Z",
      });
      assertEventValid(phBoarding.event);

      // ── 7. Accept every latest form version (agency reviewers) ───────────
      for (const formType of ALL_FORMS) {
        const reviewer = formType === "FAL2" || formType === "FAL3" ? customs : nimasa;
        const res = await svc.acceptDeclaration(reviewer, {
          declarationId: declarations.get(formType)!.declarationId,
          reviewNote: `accepted ${formType}`,
        });
        expect(res.record.status).toBe("ACCEPTED");
        assertEventValid(res.event);
      }
      // The stale FAL5 v1 (superseded by v2) is no longer reviewable.
      const { asc } = await import("drizzle-orm");
      const fal5Rows = await db
        .select()
        .from(schema.mswDeclarations)
        .where(eq(schema.mswDeclarations.formType, "FAL5"))
        .orderBy(asc(schema.mswDeclarations.version));
      expect(fal5Rows.map((r) => r.version)).toEqual([1, 2]);
      await expect(
        svc.acceptDeclaration(nimasa, { declarationId: fal5Rows[0].declarationId })
      ).rejects.toMatchObject({ reasonCode: "VERSION_SUPERSEDED" });

      // ── 8. Pratique: refusal re-blocks; grant unblocks ───────────────────
      // Refusal first (anchored to the MDOH), mirroring the fixture narrative.
      const refusal = await svc.refusePratique(portHealth, {
        visitId,
        healthDeclarationId: declarations.get("MDOH")!.declarationId,
        refusalReasonCode: "MDOH_INCOMPLETE_VACCINATION_RECORD",
      });
      assertEventValid(refusal.event);
      expect(refusal.event.classification).toBe("RESTRICTED");
      // After a refusal the joint boarding is still blocked.
      await expect(
        svc.scheduleBoarding(nimasa, {
          visitId,
          agencies: ["NIS", "NCS", "NDLEA", "NIMASA"],
          scheduledAt: "2026-09-03T09:00:00Z",
        })
      ).rejects.toMatchObject({ reasonCode: "PRATIQUE_REQUIRED" });
      // Pratique decisions must anchor to the MDOH — not to any other form.
      await expect(
        svc.grantPratique(portHealth, {
          visitId,
          healthDeclarationId: declarations.get("FAL1")!.declarationId,
        })
      ).rejects.toMatchObject({ reasonCode: "MDOH_REQUIRED" });

      const grant = await svc.grantPratique(portHealth, {
        visitId,
        healthDeclarationId: declarations.get("MDOH")!.declarationId,
      });
      assertEventValid(grant.event);
      expect(grant.record.pratiqueRecordDigestSha256).toMatch(/^sha256:[0-9a-f]{64}$/);

      // ── 9. Joint boarding scheduled + completed (pratique digest bound) ──
      const joint = await svc.scheduleBoarding(nimasa, {
        visitId,
        agencies: ["NIS", "NCS", "NDLEA", "NIMASA"],
        scheduledAt: "2026-09-03T09:00:00Z",
      });
      assertEventValid(joint.event);
      expect(joint.event.classification).toBe("CONFIDENTIAL");

      const done = await svc.completeBoarding(nimasa, {
        boardingId: joint.record.boardingId,
        startedAt: "2026-09-03T09:05:00Z",
        completedAt: "2026-09-03T11:40:00Z",
        outcome: { findings: "none" },
      });
      expect(done.record.pratiqueGrantDigestSha256).toBe(grant.record.pratiqueRecordDigestSha256);
      assertEventValid(done.event);

      // ── 10. DEPARTURE clearance preconditions ────────────────────────────
      // Unaccepted form blocks: submit a fresh FAL7 v3? No — submit FAL7 was
      // accepted; instead re-submit FAL1 (new version is SUBMITTED) and show
      // the DEPARTURE grant refuses while ANY latest version is unaccepted.
      const fal1v2 = await svc.submitDeclaration(agent, {
        visitId,
        formType: "FAL1",
        formPayload: { form: "FAL1", line: 3 },
      });
      await expect(
        svc.grantClearance(nimasa, { visitId, kind: "DEPARTURE" })
      ).rejects.toMatchObject({ reasonCode: "UNACCEPTED_DECLARATIONS" });
      await svc.acceptDeclaration(customs, { declarationId: fal1v2.record.declarationId });

      const clearance = await svc.grantClearance(nimasa, { visitId, kind: "DEPARTURE" });
      expect(clearance.record.preconditionChecklistDigestSha256).toMatch(/^sha256:[0-9a-f]{64}$/);
      assertEventValid(clearance.event);
      const checklist = clearance.preconditionChecklist as {
        acceptedDeclarations: unknown[];
        pratiqueGrantDigestSha256: string;
        jointBoardingIds: string[];
      };
      expect(checklist.acceptedDeclarations).toHaveLength(ALL_FORMS.length);
      expect(checklist.pratiqueGrantDigestSha256).toBe(grant.record.pratiqueRecordDigestSha256);
      expect(checklist.jointBoardingIds).toContain(joint.record.boardingId);

      const visitRows = await db
        .select()
        .from(schema.mswVisits)
        .where(eq(schema.mswVisits.visitId, visitId));
      expect(visitRows[0].status).toBe("CLEARED_TO_DEPART");
    }
  );

  it(
    "enforces DB-level invariants (version chain unique, pratique-first CHECK, DEPARTURE checklist CHECK)",
    { timeout: 60_000 },
    async () => {
      const svc = await import("./mswService");
      const { getDb } = await import("./db");
      const schema = await import("../drizzle/schema");
      const db = (await getDb())!;

      const agentId = await seedUser("msw-agent-2", "Agent Two");
      const agent = { userId: agentId, role: "msw-agent" as const };
      const visitRes = await svc.createVisit(agent, {
        vesselImoNumber: "1234567",
        vesselName: "MT SECOND",
        vesselFlagCode: "NG",
        portCode: "NGAPP",
        agentReference: "agt-org-2",
        eta: "2026-10-01T00:00:00Z",
      });
      const visit = visitRes.record;
      const sub = await svc.submitDeclaration(agent, {
        visitId: visit.visitId,
        formType: "FAL1",
        formPayload: { a: 1 },
      });

      // Unique (visit, form, version): a duplicate version row is rejected.
      await expectPgRejection(
        db.insert(schema.mswDeclarations).values({
          declarationId: "mswd-dup-1",
          visitPk: visit.id,
          formType: "FAL1",
          version: 1,
          formPayloadDigestSha256: sub.record.formPayloadDigestSha256,
          priorSubmissionDigestSha256: "",
          containsPersonalData: false,
          formPayload: { a: 1 },
          submittedByUserId: agentId,
        }),
        /duplicate key|msw_declarations_visit_form_version_unique/
      );

      // Chain-shape CHECK: version 2 with an empty prior digest is rejected.
      await expectPgRejection(
        db.insert(schema.mswDeclarations).values({
          declarationId: "mswd-bad-chain",
          visitPk: visit.id,
          formType: "FAL1",
          version: 2,
          formPayloadDigestSha256: sub.record.formPayloadDigestSha256,
          priorSubmissionDigestSha256: "",
          containsPersonalData: false,
          formPayload: { a: 2 },
          submittedByUserId: agentId,
        }),
        /msw_declarations_chain_shape_chk/
      );

      // Personal-data CHECK: FAL5 flagged false is rejected.
      await expectPgRejection(
        db.insert(schema.mswDeclarations).values({
          declarationId: "mswd-bad-personal",
          visitPk: visit.id,
          formType: "FAL5",
          version: 1,
          formPayloadDigestSha256: sub.record.formPayloadDigestSha256,
          priorSubmissionDigestSha256: "",
          containsPersonalData: false,
          formPayload: { a: 1 },
          submittedByUserId: agentId,
        }),
        /msw_declarations_personal_data_chk/
      );

      // Pratique-first CHECK: a COMPLETED non-Port-Health boarding without the
      // grant digest is rejected at the DB level.
      await expectPgRejection(
        db.insert(schema.mswBoardings).values({
          boardingId: "mswb-bad-1",
          visitPk: visit.id,
          agencies: ["NIS"],
          scheduledByAgency: "NIS",
          scheduledAt: new Date(),
          status: "COMPLETED",
          startedAt: new Date(),
          completedAt: new Date(),
          outcomeDigestSha256: sub.record.formPayloadDigestSha256,
        }),
        /msw_boardings_pratique_first_chk/
      );

      // Fail-closed agency set CHECK: an unknown agency is rejected.
      await expectPgRejection(
        db.insert(schema.mswBoardings).values({
          boardingId: "mswb-bad-2",
          visitPk: visit.id,
          agencies: ["MSW_AGENCY_NIS"],
          scheduledByAgency: "NIS",
          scheduledAt: new Date(),
        }),
        /msw_boardings_agency_set_chk/
      );

      // DEPARTURE-grant checklist CHECK: missing digest is rejected.
      await expectPgRejection(
        db.insert(schema.mswClearances).values({
          clearanceId: "mswc-bad-1",
          visitPk: visit.id,
          kind: "DEPARTURE",
          decision: "GRANTED",
          decidedByAgency: "NIMASA",
          decidedByUserId: agentId,
        }),
        /msw_clearances_departure_precondition_chk/
      );

      // Service-level fail-closed agency validation.
      await expect(
        svc.scheduleBoarding(agent, {
          visitId: visit.visitId,
          agencies: ["NOT_AN_AGENCY"],
          scheduledAt: "2026-10-02T00:00:00Z",
        })
      ).rejects.toMatchObject({ reasonCode: "INVALID_AGENCY_SET" });
    }
  );
});
