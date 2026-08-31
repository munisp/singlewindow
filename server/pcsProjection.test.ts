/**
 * pcsProjection.test.ts — Phase 8 PCS read-model projection core tests.
 *
 * The projection core (projectPcsEvent) is a pure function over the
 * PcsProjectionStore interface; these tests use an in-memory store — no
 * PostgreSQL, no Kafka, no fetch mocks. Covers spec §6 unit requirements:
 * milestone mapping, ordering & dedup, projection idempotency on event
 * replay, ownership anchoring (unanchored events are NEVER projected), and
 * billing snapshot provenance (receipt ref, ledger commit hash, lag).
 */

import { describe, expect, it } from "vitest";
import {
  orderMilestones,
  projectPcsEvent,
  type PcsBookingLinkRecord,
  type PcsConsignmentState,
  type PcsProjectionStore,
  type NewPcsConsignment,
} from "./pcsProjection";
import type { PcsEvent } from "./_core/pcsEnvelope";
import type { InsertPcsBillingSnapshot } from "../drizzle/schema";

// ─── In-memory store ─────────────────────────────────────────────────────────

interface MilestoneRow {
  id: number;
  consignmentId: number;
  milestone: string;
  occurredAt: Date;
  sourceTopic: string;
  sourceEventId: string;
  provenanceSignatureVerified: boolean;
}

function makeStore(seedLinks: PcsBookingLinkRecord[] = []) {
  const links = new Map(seedLinks.map((l) => [l.bookingId, { ...l }]));
  const consignments = new Map<number, NewPcsConsignment & { id: number }>();
  const milestones: MilestoneRow[] = [];
  const billing: Array<Omit<InsertPcsBillingSnapshot, "id" | "recordedAt">> = [];
  let nextConsignmentId = 1;
  let nextMilestoneId = 1;

  const store: PcsProjectionStore = {
    async findBookingLink(bookingId) {
      return links.get(bookingId) ?? null;
    },
    async createConsignment(values) {
      const id = nextConsignmentId++;
      consignments.set(id, { ...values, id });
      return id;
    },
    async attachConsignmentToLink(linkId, consignmentId) {
      for (const link of links.values()) {
        if (link.id === linkId) link.consignmentId = consignmentId;
      }
    },
    async getConsignmentState(consignmentId): Promise<PcsConsignmentState | null> {
      const c = consignments.get(consignmentId);
      if (!c) return null;
      return { id: c.id, lastMilestone: c.lastMilestone, lastMilestoneAt: c.lastMilestoneAt, sourceEventIds: c.sourceEventIds };
    },
    async insertMilestone(values) {
      if (milestones.some((m) => m.consignmentId === values.consignmentId && m.sourceEventId === values.sourceEventId)) {
        return false; // uniqueness: (consignment_id, source_event_id)
      }
      milestones.push({ id: nextMilestoneId++, ...values });
      return true;
    },
    async updateConsignmentMilestone(consignmentId, milestone, occurredAt, sourceEventId) {
      const c = consignments.get(consignmentId);
      if (!c) return;
      c.lastMilestone = milestone;
      c.lastMilestoneAt = occurredAt;
      c.sourceEventIds = [...c.sourceEventIds, sourceEventId];
    },
    async insertBillingSnapshot(values) {
      if (billing.some((b) => b.sourceEventId === values.sourceEventId)) return false;
      billing.push(values);
      return true;
    },
  };
  return { store, links, consignments, milestones, billing };
}

// ─── Event factory (pre-verified projection input) ───────────────────────────

let eventSeq = 0;
function makeEvent(overrides: Partial<PcsEvent> & { eventType: string }): PcsEvent {
  eventSeq++;
  return {
    envelope: {} as PcsEvent["envelope"],
    eventId: overrides.eventId ?? `00000000-0000-4000-8000-${String(eventSeq).padStart(12, "0")}`,
    occurredAtMs: Date.parse("2026-09-01T10:00:00.000Z") + eventSeq * 1000,
    correlationId: "corr",
    subjectId: "bk-1",
    payload: {},
    extensions: {},
    ledgerCommitHash: null,
    ...overrides,
  };
}

const LINK: PcsBookingLinkRecord = { id: 11, traderUserId: 42, bookingId: "bk-1", consignmentId: null };

describe("projectPcsEvent — milestone projection", () => {
  it("projects a customs hold event onto a trader-anchored consignment", async () => {
    const { store, consignments, milestones } = makeStore([LINK]);
    const result = await projectPcsEvent(
      makeEvent({
        eventType: "booking.customs_validation_pending",
        payload: { consignee_id: "acme-ltd", cargo_declaration_ref: "DECL/2026/0001" },
        extensions: { "cargo-declaration-ref": "DECL/2026/0001", "port-code": "NGAPP" },
      }),
      "ports.booking.v1",
      store
    );
    expect(result).toMatchObject({ outcome: "projected", milestone: "customs_hold" });
    expect(milestones).toHaveLength(1);
    expect(milestones[0]).toMatchObject({
      milestone: "customs_hold",
      sourceTopic: "ports.booking.v1",
      provenanceSignatureVerified: true,
    });
    expect(milestones[0].sourceEventId).toBeTruthy();
    // Consignment created with the LINKING trader as owner — ownership is
    // never inferred from consignee strings.
    const consignment = consignments.get(result.consignmentId!)!;
    expect(consignment.traderUserId).toBe(42);
    expect(consignment.declarationUrn).toBe("DECL/2026/0001");
    expect(consignment.blNumber).toBeNull(); // no B/L in booking events — honest null
    expect(consignment.lastMilestone).toBe("customs_hold");
  });

  it("is idempotent on replay (duplicate source_event_id → no duplicate milestone)", async () => {
    const { store, milestones } = makeStore([LINK]);
    const event = makeEvent({ eventType: "booking.customs_validated" });
    const first = await projectPcsEvent(event, "ports.booking.v1", store);
    const replay = await projectPcsEvent(event, "ports.booking.v1", store);
    expect(first.outcome).toBe("projected");
    expect(replay.outcome).toBe("duplicate");
    expect(milestones).toHaveLength(1);
  });

  it("never projects events with no trader-owned booking link (unanchored)", async () => {
    const { store, milestones, consignments } = makeStore([]); // no links
    const result = await projectPcsEvent(makeEvent({ eventType: "booking.customs_validated" }), "ports.booking.v1", store);
    expect(result.outcome).toBe("unanchored");
    expect(milestones).toHaveLength(0);
    expect(consignments.size).toBe(0);
  });

  it("ignores event types with no consignment/billing projection (unmapped)", async () => {
    const { store, milestones } = makeStore([LINK]);
    for (const eventType of ["booking.drafted", "queue.called_up", "queue.arrived", "booking.cancelled"]) {
      const result = await projectPcsEvent(makeEvent({ eventType }), "ports.booking.v1", store);
      expect(result.outcome).toBe("unmapped");
    }
    expect(milestones).toHaveLength(0);
  });

  it("maps gate completion to gate_out and never invents vessel milestones", async () => {
    const { store, milestones } = makeStore([LINK]);
    const result = await projectPcsEvent(makeEvent({ eventType: "booking.completed" }), "ports.booking.v1", store);
    expect(result).toMatchObject({ outcome: "projected", milestone: "gate_out" });
    const scan = await projectPcsEvent(makeEvent({ eventType: "gate.scan_approved" }), "ports.gate.v1", store);
    expect(scan).toMatchObject({ outcome: "projected", milestone: "gate_out" });
    expect(milestones.map((m) => m.milestone)).toEqual(["gate_out", "gate_out"]);
    // Vessel-side milestones are NEVER synthesized from truck-side events.
    expect(milestones.every((m) => !["arrived", "berthed", "departed", "ops_started", "discharging"].includes(m.milestone))).toBe(true);
  });

  it("rolls the consignment pointer forward only (out-of-order events)", async () => {
    const { store, consignments } = makeStore([LINK]);
    const newer = makeEvent({ eventType: "booking.customs_validated", occurredAtMs: Date.parse("2026-09-01T12:00:00Z") });
    const older = makeEvent({ eventType: "booking.customs_validation_pending", occurredAtMs: Date.parse("2026-09-01T09:00:00Z") });
    const first = await projectPcsEvent(newer, "ports.booking.v1", store);
    const second = await projectPcsEvent(older, "ports.booking.v1", store);
    expect(second.outcome).toBe("projected");
    const consignment = consignments.get(first.consignmentId!)!;
    expect(consignment.lastMilestone).toBe("customs_released"); // newer wins
    expect(consignment.lastMilestoneAt).toEqual(new Date("2026-09-01T12:00:00Z"));
  });
});

describe("projectPcsEvent — billing snapshots", () => {
  it("projects booking.paid with receipt + ledger commit hash + projection lag", async () => {
    const { store, billing } = makeStore([LINK]);
    const now = Date.parse("2026-09-01T10:05:00.000Z");
    const result = await projectPcsEvent(
      makeEvent({
        eventType: "booking.paid",
        occurredAtMs: Date.parse("2026-09-01T10:00:00.000Z"),
        ledgerCommitHash: "tb-commit-99",
        extensions: { "amount-kobo": "4500000", "payment-receipt-ref": "rcpt-77" },
        payload: { currency: "NGN" },
      }),
      "ports.booking.v1",
      store,
      now
    );
    expect(result.outcome).toBe("billing_projected");
    expect(billing).toHaveLength(1);
    expect(billing[0]).toMatchObject({
      bookingId: "bk-1",
      amountKobo: 4500000,
      currency: "NGN",
      status: "PAID",
      receiptId: "rcpt-77",
      ledgerCommitHash: "tb-commit-99",
      projectionLagMs: 300_000,
      invoiceId: null, // port-interop events carry no invoice id — never invented
    });
  });

  it("projects booking.refunded as a REFUNDED snapshot", async () => {
    const { store, billing } = makeStore([LINK]);
    await projectPcsEvent(
      makeEvent({ eventType: "booking.refunded", payload: { amount_kobo: 4500000, currency: "NGN" } }),
      "ports.booking.v1",
      store
    );
    expect(billing[0].status).toBe("REFUNDED");
  });

  it("refuses to project a billing event without a positive integer amount", async () => {
    const { store, billing } = makeStore([LINK]);
    const result = await projectPcsEvent(
      makeEvent({ eventType: "booking.paid", payload: { amount_kobo: "not-a-number" } }),
      "ports.booking.v1",
      store
    );
    expect(result.outcome).toBe("invalid_payload");
    expect(billing).toHaveLength(0);
  });

  it("is idempotent on billing replay", async () => {
    const { store, billing } = makeStore([LINK]);
    const event = makeEvent({ eventType: "booking.paid", extensions: { "amount-kobo": "100" } });
    await projectPcsEvent(event, "ports.booking.v1", store);
    const replay = await projectPcsEvent(event, "ports.booking.v1", store);
    expect(replay.outcome).toBe("duplicate");
    expect(billing).toHaveLength(1);
  });
});

describe("orderMilestones", () => {
  it("orders by occurred_at ASC with id tiebreak", () => {
    const rows = [
      { id: 3, occurredAt: new Date("2026-09-01T10:02:00Z") },
      { id: 1, occurredAt: new Date("2026-09-01T10:00:00Z") },
      { id: 2, occurredAt: new Date("2026-09-01T10:00:00Z") },
    ];
    expect(orderMilestones(rows).map((r) => r.id)).toEqual([1, 2, 3]);
  });
});
