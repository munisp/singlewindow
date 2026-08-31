/**
 * cvContainerConsumer.test.ts — WP-4 cv.container-code.v1 consumer
 *
 * Proves: envelope signature verification (roundtrip + fail-closed
 * rejections), ISO 6346 projection, declaration cross-check, risk signals
 * into declaration risk history, and idempotent replays.
 */
import { describe, expect, it } from "vitest";
import { generateKeyPairSync, sign as cryptoSign, createPublicKey } from "node:crypto";

import {
  EnvelopeRejection,
  jcsCanonicalize,
  parseKeyDirectory,
  verifyEnvelope,
  type KeyDirectory,
  type VerifiedEnvelope,
} from "./_core/cvEnvelope";
import {
  normalizeContainerCode,
  projectContainerCodeRead,
  CV_CONTAINER_TOPIC,
  type ContainerCrossCheckDb,
} from "./cvContainerConsumer";

// ── signing helpers (test-only producer) ─────────────────────────────────────

const { publicKey, privateKey } = generateKeyPairSync("ed25519");
const KID = "blueeconomy-cv-service-0";

function rawPubB64(): string {
  const spki: Buffer = publicKey.export({ format: "der", type: "spki" });
  return spki.subarray(spki.length - 32).toString("base64url");
}

function testDirectory(): KeyDirectory {
  return parseKeyDirectory(JSON.stringify({ [KID]: rawPubB64() }));
}

function signEnvelope(resource: Record<string, unknown>, eventType = CV_CONTAINER_TOPIC): string {
  const envelope: any = {
    envelopeVersion: "1.0",
    eventId: `evt-${Math.random().toString(36).slice(2, 10)}`,
    eventType,
    occurredAt: "2026-08-31T10:00:00.000Z",
    producer: "blueeconomy-cv-service",
    correlationId: "corr-1",
    fhir: {
      resourceType: "Bundle",
      type: "message",
      bundleId: "bdl-1",
      entry: [{ fullUrl: "urn:uuid:1", resource }],
    },
    provenance: { principalId: "cv", principalRole: "SERVICE", ledgerCommitHash: "", signature: "" },
    classification: "INTERNAL",
  };
  // JCS of the full envelope excluding provenance.signature (spec payload).
  const { signature: _drop, ...provenance } = envelope.provenance;
  const payload = Buffer.from(jcsCanonicalize({ ...envelope, provenance }), "utf8");
  const header = Buffer.from(JSON.stringify({ alg: "EdDSA", kid: KID }));
  const input = `${header.toString("base64url")}.${payload.toString("base64url")}`;
  const sig = cryptoSign(null, Buffer.from(input), privateKey);
  envelope.provenance.signature = `${input}.${sig.toString("base64url")}`;
  return JSON.stringify(envelope);
}

function containerResource(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    "@type": "type.googleapis.com/blueeconomy.cv.v1.ContainerCodeRead",
    cameraId: "gate-1",
    code: "CSQU-305438-3",
    status: "confirmed",
    confidence: 0.95,
    checkDigitValid: true,
    ownerLexiconMatch: "CSQ",
    rawOcrText: "CSQU3054383",
    reason: "",
    frameSha256: "abc",
    modelVersion: "paddleocr@x",
    ...overrides,
  };
}

// ── envelope verification ────────────────────────────────────────────────────

describe("verifyEnvelope", () => {
  it("verifies a signed envelope roundtrip", () => {
    const raw = signEnvelope(containerResource());
    const env = verifyEnvelope(raw, testDirectory());
    expect(env.kid).toBe(KID);
    expect(env.eventType).toBe(CV_CONTAINER_TOPIC);
    expect((env.resource as any).code).toBe("CSQU-305438-3");
  });

  it("rejects tampered payloads (payload-mismatch)", () => {
    const raw = JSON.parse(signEnvelope(containerResource()));
    raw.fhir.entry[0].resource.confidence = 0.01;
    expect(() => verifyEnvelope(JSON.stringify(raw), testDirectory())).toThrow(EnvelopeRejection);
    try {
      verifyEnvelope(JSON.stringify(raw), testDirectory());
    } catch (e) {
      expect((e as EnvelopeRejection).reason).toBe("payload-mismatch");
    }
  });

  it("rejects unknown kid", () => {
    const other = generateKeyPairSync("ed25519");
    const raw = signEnvelope(containerResource());
    const spki: Buffer = other.publicKey.export({ format: "der", type: "spki" });
    const dir = parseKeyDirectory(JSON.stringify({ [KID]: spki.subarray(spki.length - 32).toString("base64url") }));
    expect(() => verifyEnvelope(raw, dir)).toThrow(/invalid-signature/);
    const dir2 = parseKeyDirectory(JSON.stringify({ "other-0": rawPubB64() }));
    expect(() => verifyEnvelope(raw, dir2)).toThrow(/unknown-kid/);
  });

  it("rejects unsigned / malformed envelopes", () => {
    expect(() => verifyEnvelope("{}", testDirectory())).toThrow(/malformed-jws/);
    expect(() => verifyEnvelope("not json", testDirectory())).toThrow(/malformed-jws/);
  });

  it("fails closed on bad key directories", () => {
    expect(() => parseKeyDirectory("{}")).toThrow(/key-directory/);
    expect(() => parseKeyDirectory(JSON.stringify({ "bad kid!": "x" }))).toThrow(/key-directory/);
    expect(() => parseKeyDirectory(JSON.stringify({ "a-0": "!!!" }))).toThrow(/malformed-jws|key-directory/);
  });
});

// ── projection + cross-check ─────────────────────────────────────────────────

class MemDb implements ContainerCrossCheckDb {
  declarationsByCode: Record<string, number[]> = {};
  reads: any[] = [];
  signals: any[] = [];
  async findDeclarationsByContainer(code: string) {
    return this.declarationsByCode[code] ?? [];
  }
  async insertOcrRead(row: any) {
    if (this.reads.some((r) => r.eventId === row.eventId)) return "duplicate";
    this.reads.push(row);
    return "inserted";
  }
  async insertRiskSignal(row: any) {
    this.signals.push(row);
  }
}

function verified(resource: Record<string, unknown>): VerifiedEnvelope {
  return verifyEnvelope(signEnvelope(resource), testDirectory());
}

describe("projectContainerCodeRead", () => {
  it("projects a matched confirmed read with no risk signal", async () => {
    const db = new MemDb();
    db.declarationsByCode["CSQU3054383"] = [42];
    const result = await projectContainerCodeRead(verified(containerResource()), db);
    expect(result.projected).toBe(true);
    expect(result.matchStatus).toBe("matched");
    expect(result.declarationId).toBe(42);
    expect(result.riskSignals).toBe(0);
    expect(db.reads[0].containerCode).toBe("CSQU3054383");
  });

  it("flags unmatched confirmed reads (no honest attribution, no signal)", async () => {
    const db = new MemDb();
    const result = await projectContainerCodeRead(verified(containerResource()), db);
    expect(result.matchStatus).toBe("unmatched");
    expect(result.declarationId).toBeNull();
    expect(db.signals).toHaveLength(0);
  });

  it("raises CONTAINER_CHECK_DIGIT_INVALID risk on matched declaration", async () => {
    const db = new MemDb();
    db.declarationsByCode["CSQU3054383"] = [42];
    const result = await projectContainerCodeRead(
      verified(containerResource({ checkDigitValid: false })), db
    );
    expect(result.matchStatus).toBe("invalid_code");
    expect(result.riskSignals).toBe(1);
    expect(db.signals[0].declarationId).toBe(42);
    expect(db.signals[0].triggeredBy).toBe("cv-container-ocr");
    expect(db.signals[0].factors[0].code).toBe("CONTAINER_CHECK_DIGIT_INVALID");
  });

  it("raises CONTAINER_OCR_NEEDS_REVIEW for low-confidence/needs-review reads", async () => {
    const db = new MemDb();
    db.declarationsByCode["CSQU3054383"] = [42];
    const result = await projectContainerCodeRead(
      verified(containerResource({ status: "needs-review", confidence: 0.5 })), db
    );
    expect(result.riskSignals).toBe(1);
    expect(db.signals[0].factors[0].code).toBe("CONTAINER_OCR_NEEDS_REVIEW");
  });

  it("is idempotent on event replay", async () => {
    const db = new MemDb();
    const env = verified(containerResource());
    await projectContainerCodeRead(env, db);
    const second = await projectContainerCodeRead(env, db);
    expect(second.duplicate).toBe(true);
    expect(db.reads).toHaveLength(1);
  });

  it("rejects non-ISO codes and foreign event types", async () => {
    const db = new MemDb();
    await expect(projectContainerCodeRead(verified(containerResource({ code: "XX" })), db))
      .rejects.toThrow(/invalid-payload/);
    const foreign = verifyEnvelope(signEnvelope(containerResource(), "cv.hull-name.v1"), testDirectory());
    await expect(projectContainerCodeRead(foreign, db)).rejects.toThrow(/unknown-event-type/);
  });
});

describe("normalizeContainerCode", () => {
  it("normalizes separators and case", () => {
    expect(normalizeContainerCode("csqu-305438-3")).toBe("CSQU3054383");
    expect(normalizeContainerCode("CSQU3054383")).toBe("CSQU3054383");
  });
});
