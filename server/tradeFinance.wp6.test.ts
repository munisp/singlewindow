/**
 * tradeFinance.wp6.test.ts — WP-6 trade-finance rail client tests.
 *
 * Covers: fail-closed configuration, envelope v1.0 verification (positive,
 * tamper, untrusted key, wrong artifact), consented-dataset scope checks and
 * transport error mapping. Envelopes are produced with a real Ed25519 key —
 * no mock signatures.
 */
import { describe, it, expect } from "vitest";
import { generateKeyPairSync, sign as ed25519Sign } from "crypto";
import {
  loadTradeFinanceControlsConfig,
  verifyDatasetEnvelope,
  TradeFinanceControlsClient,
  TradeFinanceControlsUnconfiguredError,
  EnvelopeVerificationError,
} from "./integrations/tradeFinanceControlsClient";

// ─── Real Ed25519 envelope fixture (mirrors the Go envelope v1.0) ───────────

const JWS_EXTENSION_URL = "https://blueeconomy.gov.ng/fhir/StructureDefinition/artifact-jws";
const ENVELOPE_PROFILE = "https://blueeconomy.gov.ng/fhir/StructureDefinition/revenue-envelope-1.0";

function makeKey() {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const rawPublic = publicKey.export({ format: "der", type: "spki" }).subarray(-32);
  return { privateKey, rawPublicB64: Buffer.from(rawPublic).toString("base64url") };
}

function signEnvelope(key: ReturnType<typeof makeKey>, kid: string, artifactId: string, payload: unknown) {
  const canonical = JSON.stringify(payload, Object.keys(payload as object).sort());
  const header = Buffer.from(JSON.stringify({ alg: "EdDSA", kid, typ: "JWS" })).toString("base64url");
  const encodedPayload = Buffer.from(canonical).toString("base64url");
  const signature = ed25519Sign(null, Buffer.from(`${header}.${encodedPayload}`, "ascii"), key.privateKey).toString("base64url");
  const jws = `${header}.${encodedPayload}.${signature}`;
  return {
    resourceType: "Bundle",
    id: artifactId,
    meta: { profile: [ENVELOPE_PROFILE], tag: [{ system: "https://blueeconomy.gov.ng/envelope", code: "version", display: "1.0" }] },
    type: "document",
    timestamp: new Date().toISOString(),
    entry: [{
      fullUrl: `urn:uuid:${artifactId}`,
      resource: {
        resourceType: "Basic",
        id: artifactId,
        code: { coding: [{ system: "https://blueeconomy.gov.ng/artifact-types", code: "tradefinance.dataset" }], text: "tradefinance.dataset" },
        extension: [{ url: JWS_EXTENSION_URL, valueString: jws }],
      },
    }],
  };
}

const DATASET_PAYLOAD = {
  bank_id: "bank-gtb",
  consent_id: "tf-con-001",
  dataset_refs: ["sha256:" + "a".repeat(64)],
  expires_at: "2027-01-01T00:00:00Z",
  scope: "DECLARATION_DIGESTS",
  trader_id: "sw-user-7",
};

// ─── Configuration (fail-closed) ────────────────────────────────────────────

describe("loadTradeFinanceControlsConfig", () => {
  const good = {
    FINANCIAL_CONTROLS_TRADEFINANCE_URL: "https://fc.internal:8443",
    FINANCIAL_CONTROLS_TRADEFINANCE_CLIENT_TOKEN: "token-abc",
    FINANCIAL_CONTROLS_TRADEFINANCE_TRUSTED_KEYS_JSON: JSON.stringify({ "fc-k1": makeKey().rawPublicB64 }),
  };

  it("loads a complete configuration", () => {
    const config = loadTradeFinanceControlsConfig(good);
    expect(config.baseUrl).toBe("https://fc.internal:8443");
    expect(Object.keys(config.trustedKeys)).toEqual(["fc-k1"]);
  });

  it.each([
    ["url", { ...good, FINANCIAL_CONTROLS_TRADEFINANCE_URL: "" }],
    ["token", { ...good, FINANCIAL_CONTROLS_TRADEFINANCE_CLIENT_TOKEN: "" }],
    ["keys", { ...good, FINANCIAL_CONTROLS_TRADEFINANCE_TRUSTED_KEYS_JSON: "" }],
    ["keys-not-json", { ...good, FINANCIAL_CONTROLS_TRADEFINANCE_TRUSTED_KEYS_JSON: "nope" }],
    ["keys-empty", { ...good, FINANCIAL_CONTROLS_TRADEFINANCE_TRUSTED_KEYS_JSON: "{}" }],
    ["bad-key-material", { ...good, FINANCIAL_CONTROLS_TRADEFINANCE_TRUSTED_KEYS_JSON: JSON.stringify({ k: "AAAA" }) }],
    ["insecure-url", { ...good, FINANCIAL_CONTROLS_TRADEFINANCE_URL: "http://fc.internal" }],
  ])("fails closed when %s is invalid", (_name, env) => {
    expect(() => loadTradeFinanceControlsConfig(env)).toThrow(TradeFinanceControlsUnconfiguredError);
  });
});

// ─── Envelope verification ──────────────────────────────────────────────────

describe("verifyDatasetEnvelope", () => {
  const key = makeKey();
  const trusted = { "fc-k1": key.rawPublicB64 };

  it("verifies a genuine envelope and returns only the payload", () => {
    const bundle = signEnvelope(key, "fc-k1", "tf-con-001-DECLARATION_DIGESTS", DATASET_PAYLOAD);
    const payload = verifyDatasetEnvelope(bundle, trusted);
    expect(payload.scope).toBe("DECLARATION_DIGESTS");
    expect(payload.trader_id).toBe("sw-user-7");
    expect(payload.dataset_refs).toHaveLength(1);
    expect((payload as any).duty_payment_history).toBeUndefined();
  });

  it("rejects a tampered payload (signature failure)", () => {
    const bundle = signEnvelope(key, "fc-k1", "tf-con-001-DECLARATION_DIGESTS", DATASET_PAYLOAD);
    // Substitute a different payload under the original signature.
    const jws: string = bundle.entry[0].resource.extension[0].valueString;
    const parts = jws.split(".");
    parts[1] = Buffer.from(JSON.stringify({ ...DATASET_PAYLOAD, trader_id: "sw-user-9" })).toString("base64url");
    bundle.entry[0].resource.extension[0].valueString = parts.join(".");
    expect(() => verifyDatasetEnvelope(bundle, trusted)).toThrow(EnvelopeVerificationError);
  });

  it("rejects an untrusted signer kid", () => {
    const bundle = signEnvelope(key, "rogue-key", "tf-con-001-DECLARATION_DIGESTS", DATASET_PAYLOAD);
    expect(() => verifyDatasetEnvelope(bundle, trusted)).toThrow(/not trusted/);
  });

  it("rejects a malformed bundle shape", () => {
    expect(() => verifyDatasetEnvelope({ resourceType: "Bundle" }, trusted)).toThrow(EnvelopeVerificationError);
    expect(() => verifyDatasetEnvelope(null, trusted)).toThrow(EnvelopeVerificationError);
  });

  it("rejects a non-dataset payload", () => {
    const bundle = signEnvelope(key, "fc-k1", "x", { hello: "world" });
    expect(() => verifyDatasetEnvelope(bundle, trusted)).toThrow(EnvelopeVerificationError);
  });
});

// ─── Client behaviour with injected transport ───────────────────────────────

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

describe("TradeFinanceControlsClient", () => {
  const key = makeKey();
  const config = {
    baseUrl: "https://fc.internal:8443",
    clientToken: "token-abc",
    trustedKeys: { "fc-k1": key.rawPublicB64 },
  };

  it("returns the verified consented dataset", async () => {
    const bundle = signEnvelope(key, "fc-k1", "tf-con-001-DECLARATION_DIGESTS", DATASET_PAYLOAD);
    const client = new TradeFinanceControlsClient(config, async () => jsonResponse(200, bundle));
    const payload = await client.getConsentedDataset("sw-user-7", "DECLARATION_DIGESTS");
    expect(payload?.consent_id).toBe("tf-con-001");
  });

  it("fails closed when the rail signs with an unknown key", async () => {
    const rogue = makeKey();
    const bundle = signEnvelope(rogue, "fc-rogue", "tf-con-001-DECLARATION_DIGESTS", DATASET_PAYLOAD);
    const client = new TradeFinanceControlsClient(config, async () => jsonResponse(200, bundle));
    await expect(client.getConsentedDataset("sw-user-7", "DECLARATION_DIGESTS")).rejects.toThrow(EnvelopeVerificationError);
  });

  it("fails closed when the payload trader/scope does not match the request", async () => {
    const bundle = signEnvelope(key, "fc-k1", "tf-con-001-DECLARATION_DIGESTS", {
      ...DATASET_PAYLOAD, scope: "DUTY_PAYMENT_HISTORY",
    });
    const client = new TradeFinanceControlsClient(config, async () => jsonResponse(200, bundle));
    await expect(client.getConsentedDataset("sw-user-7", "DECLARATION_DIGESTS")).rejects.toThrow(EnvelopeVerificationError);
  });

  it("maps 403 to null (no consent oracle)", async () => {
    const client = new TradeFinanceControlsClient(config, async () => jsonResponse(403, { detail: "no active consent" }));
    await expect(client.getConsentedDataset("sw-user-7", "TAX_STAMP_STATUS")).resolves.toBeNull();
  });

  it("sends the bearer token on rail calls", async () => {
    let seenAuth = "";
    const client = new TradeFinanceControlsClient(config, async (_url, init) => {
      seenAuth = String((init.headers as Record<string, string>).Authorization);
      return jsonResponse(200, { consents: [] });
    });
    await client.listConsents("sw-user-7");
    expect(seenAuth).toBe("Bearer token-abc");
  });

  it("maps rail 403 on mutations to FORBIDDEN", async () => {
    const client = new TradeFinanceControlsClient(config, async () => jsonResponse(403, {}));
    await expect(client.requestConsent({ consent_id: "c1" })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
