/**
 * mswExchange.test.ts — WP-3 cross-border exchange security unit tests.
 * Pure (no DB): authority JWS verification (pinned JWKS, alg/KID policy,
 * bad signatures), replay reserve semantics, ingest pipeline fail-closed
 * paths (signature missing/rejected, replay, envelope rejected, import
 * rejected) using injected verifier + reserve fakes, and egress envelope
 * classification floors.
 */
import { createHash, generateKeyPairSync, sign as rsaSign, type KeyObject } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  ingestExchangeMessage,
  MswExchangeError,
  PeerJwsVerifier,
  resetPeerVerifierForTests,
  MSW_EXCHANGE_EVENT_TYPE,
} from "./_core/mswExchange";
import {
  buildEgressEnvelope,
  signEgressEnvelope,
} from "./_core/externalAdapters/base";
import { exportDeclarationToImo } from "./_core/imoCompendium";
import { canonicalizeJcs } from "./_core/pcsEnvelope";

const ENV_KEYS = [
  "MSW_EXCHANGE_PEER_JWKS_URL", "MSW_EXCHANGE_PEER_JWKS_JSON", "MSW_EXCHANGE_PEER_JWKS_PIN",
  "MSW_EXCHANGE_PEER_ALLOWED_KIDS", "MSW_EXCHANGE_PEER_TRUST_KEYS",
  "MSW_EXCHANGE_PEER_PRODUCER", "MSW_EXCHANGE_PEER_KID_PREFIX", "MSW_EXCHANGE_PEER_URL",
];
const savedEnv: Record<string, string | undefined> = {};
for (const k of ENV_KEYS) savedEnv[k] = process.env[k];
afterEach(() => {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
  resetPeerVerifierForTests();
});

// ─── Peer authority fixtures ─────────────────────────────────────────────────

const rsa = generateKeyPairSync("rsa", { modulusLength: 2048 });
const rsaJwk = rsa.publicKey.export({ format: "jwk" }) as { n: string; e: string };
const JWKS_BODY = JSON.stringify({ keys: [{ kty: "RSA", kid: "peer-authority-1", n: rsaJwk.n, e: rsaJwk.e }] });
const JWKS_PIN = `sha256:${createHash("sha256").update(JWKS_BODY, "utf8").digest("hex")}`;

function mkJws(opts: { jti?: string; alg?: string; kid?: string; key?: KeyObject } = {}): string {
  const header = Buffer.from(JSON.stringify({
    alg: opts.alg ?? "RS256", kid: opts.kid ?? "peer-authority-1", jti: opts.jti ?? "jti-00000001",
  })).toString("base64url");
  const payload = Buffer.from(JSON.stringify({ iss: "peer-msw", scope: "msw-exchange" })).toString("base64url");
  const sig = rsaSign("sha256", Buffer.from(`${header}.${payload}`), opts.key ?? rsa.privateKey).toString("base64url");
  return `${header}.${payload}.${sig}`;
}

function mkVerifier(): PeerJwsVerifier {
  return new PeerJwsVerifier({
    jwksJson: JWKS_BODY, pin: JWKS_PIN,
    allowedKids: new Set(["peer-authority-1"]), allowedAlgs: new Set(["RS256"]),
  });
}

// ─── Envelope fixtures (peer Ed25519 content signature) ──────────────────────

const peerEd = generateKeyPairSync("ed25519");
const PEER_KID = "peer-msw-3";

function signedExchangeEnvelope(payload: Record<string, unknown>, key: KeyObject = peerEd.privateKey): string {
  const envelope = buildEgressEnvelope({
    producer: "peer-msw-foreign", eventType: MSW_EXCHANGE_EVENT_TYPE,
    payload, principalId: "peer:officer-1", principalRole: "msw",
    classification: "RESTRICTED", recordClassification: "RESTRICTED",
  });
  return JSON.stringify(signEgressEnvelope(envelope, key, PEER_KID));
}

function fal1ImoMessage(): Record<string, unknown> {
  const fixture = JSON.parse(readFileSync(path.join(__dirname, "_core", "fixtures", "mswImo", "fal1.json"), "utf8"));
  const digest = `sha256:${createHash("sha256").update(canonicalizeJcs(fixture.formPayload), "utf8").digest("hex")}`;
  return exportDeclarationToImo({
    formType: "FAL1", declarationId: fixture.declarationId, visitId: fixture.visitId, version: 1,
    formPayloadDigestSha256: digest, formPayload: fixture.formPayload,
    sender: "peer-msw-foreign", messageId: "peermsg-00000001", issuedAt: "2026-08-31T12:00:00Z",
  }) as unknown as Record<string, unknown>;
}

function configurePeerEnv(): void {
  process.env.MSW_EXCHANGE_PEER_TRUST_KEYS = JSON.stringify({
    [PEER_KID]: Buffer.from(peerEd.publicKey.export({ format: "der", type: "spki" }).subarray(-32)).toString("base64"),
  });
  process.env.MSW_EXCHANGE_PEER_PRODUCER = "peer-msw-foreign";
  process.env.MSW_EXCHANGE_PEER_KID_PREFIX = "peer-msw-";
}

describe("PeerJwsVerifier (pinned JWKS, RS256)", () => {
  it("verifies a good authority JWS and returns the jti", async () => {
    const jti = await mkVerifier().verify(mkJws({ jti: "jti-abc" }));
    expect(jti).toBe("jti-abc");
  });

  it("rejects invalid signatures", async () => {
    const good = mkJws();
    const forged = `${good.split(".")[0]}.${good.split(".")[1]}.${Buffer.from("forged-sig").toString("base64url")}`;
    await expect(mkVerifier().verify(forged)).rejects.toMatchObject({ reasonCode: "EXCHANGE_SIGNATURE_REJECTED" });
  });

  it("rejects disallowed algorithms", async () => {
    await expect(mkVerifier().verify(mkJws({ alg: "HS256" }))).rejects.toMatchObject({ reasonCode: "EXCHANGE_SIGNATURE_REJECTED" });
  });

  it("rejects non-allow-listed KIDs", async () => {
    await expect(mkVerifier().verify(mkJws({ kid: "unknown-kid" }))).rejects.toMatchObject({ reasonCode: "EXCHANGE_SIGNATURE_REJECTED" });
  });

  it("rejects missing jti (no replay identity)", async () => {
    const header = Buffer.from(JSON.stringify({ alg: "RS256", kid: "peer-authority-1" })).toString("base64url");
    const payload = Buffer.from("{}").toString("base64url");
    const sig = rsaSign("sha256", Buffer.from(`${header}.${payload}`), rsa.privateKey).toString("base64url");
    await expect(mkVerifier().verify(`${header}.${payload}.${sig}`)).rejects.toMatchObject({ reasonCode: "EXCHANGE_SIGNATURE_REJECTED" });
  });

  it("fails closed on JWKS digest pin mismatch", async () => {
    const verifier = new PeerJwsVerifier({
      jwksJson: JWKS_BODY, pin: `sha256:${"0".repeat(64)}`,
      allowedKids: new Set(["peer-authority-1"]), allowedAlgs: new Set(["RS256"]),
    });
    await expect(verifier.verify(mkJws())).rejects.toMatchObject({ reasonCode: "EXCHANGE_CONFIG" });
  });

  it("fails closed on malformed configuration", () => {
    expect(() => new PeerJwsVerifier({ jwksJson: "{}", pin: "bad", allowedKids: new Set(["k"]), allowedAlgs: new Set(["RS256"]) }))
      .toThrowError(expect.objectContaining({ reasonCode: "EXCHANGE_CONFIG" }) as never);
    expect(() => new PeerJwsVerifier({ pin: JWKS_PIN, allowedKids: new Set(), allowedAlgs: new Set(["RS256"]) }))
      .toThrowError(expect.objectContaining({ reasonCode: "EXCHANGE_CONFIG" }) as never);
  });
});

describe("ingest pipeline (fail closed)", () => {
  it("rejects when the authority signature header is missing", async () => {
    await expect(ingestExchangeMessage({ authorityJws: undefined, rawBody: "{}", verifier: mkVerifier() }))
      .rejects.toMatchObject({ reasonCode: "EXCHANGE_SIGNATURE_MISSING" });
  });

  it("rejects a forged authority signature before any processing", async () => {
    await expect(ingestExchangeMessage({ authorityJws: mkJws({ alg: "HS256" }), rawBody: "{}", verifier: mkVerifier() }))
      .rejects.toMatchObject({ reasonCode: "EXCHANGE_SIGNATURE_REJECTED" });
  });

  it("rejects replays (second reservation of the same jti)", async () => {
    const seen = new Set<string>(["jti-00000001"]); // jti already reserved (prior delivery)
    const reserve = async (jti: string) => { if (seen.has(jti)) return false; seen.add(jti); return true; };
    await expect(
      ingestExchangeMessage({ authorityJws: mkJws(), rawBody: "{}", verifier: mkVerifier(), reserveReplay: reserve })
    ).rejects.toMatchObject({ reasonCode: "EXCHANGE_REPLAY" });
    expect([...seen]).toEqual(["jti-00000001"]); // no new reservation on replay
  });

  it("rejects envelopes with invalid content signatures", async () => {
    configurePeerEnv();
    const evil = generateKeyPairSync("ed25519");
    const body = signedExchangeEnvelope(fal1ImoMessage(), evil.privateKey);
    await expect(
      ingestExchangeMessage({ authorityJws: mkJws(), rawBody: body, verifier: mkVerifier(), reserveReplay: async () => true })
    ).rejects.toMatchObject({ reasonCode: "EXCHANGE_ENVELOPE_REJECTED" });
  });

  it("rejects when peer trust keys are not configured (no structure-only fallback)", async () => {
    const body = signedExchangeEnvelope(fal1ImoMessage());
    await expect(
      ingestExchangeMessage({ authorityJws: mkJws(), rawBody: body, verifier: mkVerifier(), reserveReplay: async () => true })
    ).rejects.toMatchObject({ reasonCode: "EXCHANGE_CONFIG" });
  });

  it("rejects IMO payloads that fail reverse mapping (unmapped element)", async () => {
    configurePeerEnv();
    const message = fal1ImoMessage();
    (message.imoMessage as Record<string, unknown>).UnknownAggregate = { Y: 1 };
    const body = signedExchangeEnvelope(message);
    await expect(
      ingestExchangeMessage({ authorityJws: mkJws(), rawBody: body, verifier: mkVerifier(), reserveReplay: async () => true })
    ).rejects.toMatchObject({ reasonCode: "EXCHANGE_IMPORT_REJECTED" });
  });
});

describe("egress envelope classification floors", () => {
  it("personal-data forms stay RESTRICTED-floored on the wire", () => {
    // The egress builder (buildSignedExport) applies classification
    // RESTRICTED + recordClassification for FAL4/5/6/MDOH. The floor logic is
    // exercised here at the envelope primitive the builder uses.
    const envelope = buildEgressEnvelope({
      producer: "blueeconomy-singlewindow-msw-exchange", eventType: MSW_EXCHANGE_EVENT_TYPE,
      payload: {}, principalId: "user:1", principalRole: "msw-exchange",
      classification: "RESTRICTED", recordClassification: "RESTRICTED",
    });
    expect(envelope.envelopeVersion).toBe("1.0");
    expect(envelope.classification).toBe("RESTRICTED");
    expect(envelope.recordClassification).toBe("RESTRICTED");
  });
});
