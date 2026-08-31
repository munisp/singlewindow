/**
 * PRA-096 (Phase 9) — broker-gated end-to-end test for the geo vessel
 * projection consumer: real Kafka (vessels.events + DLQ, fresh per-run
 * topics), real PostgreSQL (fresh migrated database), real Ed25519-signed
 * envelope v1.0 messages. No mocks.
 *
 * Asserts:
 *   1. a validly signed geo.vessel-position.v1 envelope is verified and
 *      projected into vessel_tracking_events (unit-converted, provenance
 *      columns populated);
 *   2. a replay of the same eventId is idempotent (single row);
 *   3. a tampered envelope is NEVER persisted — it is routed to the DLQ
 *      with the rejection reason (fail closed);
 *   4. with no trust keys configured the consumer rejects without
 *      persisting (fail closed on missing keyring).
 *
 * Skips cleanly with a printed reason when Kafka or PostgreSQL is
 * unavailable.
 */
import { describe, it, expect, afterAll } from "vitest";
import * as net from "node:net";
import * as crypto from "node:crypto";
import { createTestDatabase } from "./testutils/pgTestHarness";
import { closePool, getDb } from "./db";
import { vesselTrackingEvents } from "../drizzle/schema";
import { eq } from "drizzle-orm";
import {
  startGeoVesselProjectionConsumer,
  createDrizzleGeoVesselStore,
  type GeoVesselConsumerHandle,
} from "./geoVesselProjection";
import { generateGeoTestKeypair, buildSignedVesselPositionEvent } from "./testutils/geoTestSigner";

function probeTcp(host: string, port: number, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    const done = (ok: boolean) => {
      socket.destroy();
      resolve(ok);
    };
    socket.setTimeout(timeoutMs);
    socket.once("connect", () => done(true));
    socket.once("timeout", () => done(false));
    socket.once("error", () => done(false));
    socket.connect(port, host);
  });
}

const tdb = await createTestDatabase("geo_vessel");
const kafkaUp = await probeTcp("127.0.0.1", 9092, 2_000);
if (!kafkaUp) {
  console.warn("[geo-e2e] skipping broker-gated suite: Kafka unreachable at 127.0.0.1:9092");
}
const gated = tdb && kafkaUp;
if (tdb) process.env.DATABASE_URL = tdb.url;
const describeDb = gated ? describe : describe.skip;

const RUN = crypto.randomBytes(4).toString("hex");
const TOPIC = `vessels.events.p9test.${RUN}`;
const DLQ = `vessels.events.dlq.p9test.${RUN}`;
const BROKERS = ["127.0.0.1:9092"];

let handle: GeoVesselConsumerHandle | null = null;
let noKeyHandle: GeoVesselConsumerHandle | null = null;

afterAll(async () => {
  await handle?.stop();
  await noKeyHandle?.stop();
  // Best-effort topic cleanup.
  try {
    const { Kafka } = await import("kafkajs");
    const admin = new Kafka({ clientId: "p9-geo-test-cleanup", brokers: BROKERS }).admin();
    await admin.connect();
    await admin.deleteTopics({ topics: [TOPIC, DLQ], timeout: 5_000 }).catch(() => {});
    await admin.disconnect();
  } catch { /* cleanup is best-effort */ }
  await closePool();
  await tdb?.close();
});

async function pollUntil<T>(fn: () => Promise<T | null>, timeoutMs: number, intervalMs = 250): Promise<T | null> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await fn();
    if (value) return value;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  return null;
}

describeDb("geo vessel projection end-to-end: real Kafka + real PostgreSQL (PRA-096)", () => {
  it("projects verified envelopes, dedupes replays, and DLQs tampered messages", async () => {
    const kp = generateGeoTestKeypair("blueeconomy-geo-service-1");
    const trustKeysRaw = `${kp.kid}=${kp.publicKeyBase64}`;

    const { Kafka } = await import("kafkajs");
    const kafka = new Kafka({ clientId: "p9-geo-test", brokers: BROKERS });
    const admin = kafka.admin();
    await admin.connect();
    await admin.createTopics({ topics: [{ topic: TOPIC }, { topic: DLQ }] });
    await admin.disconnect();

    handle = await startGeoVesselProjectionConsumer({
      brokers: BROKERS,
      groupId: `p9-geo-test-${RUN}`,
      topic: TOPIC,
      dlqTopic: DLQ,
      trustKeysRaw,
      fromBeginning: true,
    });

    const producer = kafka.producer();
    await producer.connect();

    // 1. Valid signed envelope → projected row.
    const eventId = `evt-e2e-${RUN}`;
    const observedAt = "2026-08-31T12:00:00.000Z";
    const valid = buildSignedVesselPositionEvent(kp, {
      eventId,
      mmsi: "657000111",
      shipName: "MV APAPA STAR",
      imo: "9074729",
      latitudeMicros: 6_400_000,
      longitudeMicros: 3_350_000,
      speedOverGroundMilliknots: 8_250,
      courseOverGroundMillidegrees: 270_000,
      observedAt,
      positionReportId: `pr-${RUN}`,
    });
    await producer.send({ topic: TOPIC, messages: [{ key: eventId, value: valid }] });

    const db = (await getDb())!;
    const store = createDrizzleGeoVesselStore(db);
    const row = await pollUntil(() => store.findBySourceEventId(eventId), 20_000);
    expect(row, "verified envelope was not projected within 20s").not.toBeNull();
    expect(row!.mmsi).toBe("657000111");
    expect(row!.vesselName).toBe("MV APAPA STAR");
    expect(row!.imoNumber).toBe("9074729");
    expect(row!.latitude).toBeCloseTo(6.4, 5);
    expect(row!.longitude).toBeCloseTo(3.35, 5);
    expect(row!.speed).toBeCloseTo(8.25, 3);
    expect(row!.heading).toBeCloseTo(270, 3);
    expect(row!.recordedAt.toISOString()).toBe(observedAt);
    expect(row!.sourceKid).toBe(kp.kid);
    expect(row!.positionReportId).toBe(`pr-${RUN}`);

    // 2. Replay (same eventId) → idempotent, still exactly one row.
    await producer.send({ topic: TOPIC, messages: [{ key: eventId, value: valid }] });
    await new Promise((r) => setTimeout(r, 3_000));
    const dupes = await db.select().from(vesselTrackingEvents)
      .where(eq(vesselTrackingEvents.sourceEventId, eventId));
    expect(dupes).toHaveLength(1);

    // 3. Tampered envelope → DLQ, never persisted.
    const tamperedId = `evt-tampered-${RUN}`;
    const tampered = buildSignedVesselPositionEvent(kp, { eventId: tamperedId, mmsi: "657000222" })
      .replace("657000222", "657000999"); // post-signature mutation
    await producer.send({ topic: TOPIC, messages: [{ key: tamperedId, value: tampered }] });

    const dlqConsumer = kafka.consumer({ groupId: `p9-geo-dlq-check-${RUN}` });
    await dlqConsumer.connect();
    await dlqConsumer.subscribe({ topic: DLQ, fromBeginning: true });
    const dlqMessages: string[] = [];
    await dlqConsumer.run({ eachMessage: async ({ message }) => {
      if (message.value) dlqMessages.push(message.value.toString("utf8"));
    } });
    const dlqHit = await pollUntil(async () => dlqMessages.find((m) => m.includes(tamperedId)) ?? null, 20_000);
    await dlqConsumer.stop().catch(() => {});
    await dlqConsumer.disconnect().catch(() => {});

    expect(dlqHit, "tampered message never reached the DLQ").toBeTruthy();
    expect(dlqHit!).toContain("payload_mismatch");
    expect(await store.findBySourceEventId(tamperedId)).toBeNull();

    await producer.disconnect();
  }, 60_000);

  it("fails closed without trust keys: rejects, never persists", async () => {
    const kp = generateGeoTestKeypair("blueeconomy-geo-service-1");
    const orphanId = `evt-nokey-${RUN}`;

    noKeyHandle = await startGeoVesselProjectionConsumer({
      brokers: BROKERS,
      groupId: `p9-geo-test-nokey-${RUN}`,
      topic: TOPIC,
      dlqTopic: DLQ,
      trustKeysRaw: "", // keyring absent — every event must be rejected
      fromBeginning: true,
    });

    const { Kafka } = await import("kafkajs");
    const producer = new Kafka({ clientId: "p9-geo-test-nokey", brokers: BROKERS }).producer();
    await producer.connect();
    await producer.send({
      topic: TOPIC,
      messages: [{ key: orphanId, value: buildSignedVesselPositionEvent(kp, { eventId: orphanId }) }],
    });
    await new Promise((r) => setTimeout(r, 3_000));
    await producer.disconnect();

    const db = (await getDb())!;
    const store = createDrizzleGeoVesselStore(db);
    expect(await store.findBySourceEventId(orphanId)).toBeNull();
  }, 30_000);
});
