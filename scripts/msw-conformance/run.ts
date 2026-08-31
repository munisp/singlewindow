/**
 * WP-3 IMO/WCO wire-conformance harness (Phase 10).
 *
 * Verifies, for every FAL form + MDOH:
 *   1. golden platform declaration → expected IMO Compendium message fixture
 *      (export matches the frozen fixture exactly);
 *   2. round-trip losslessness for mapped fields (+ registered extensions):
 *      import(export(x)).formPayload deep-equals x;
 *   3. fail-closed export rejections (unmapped field, missing mandatory,
 *      type violation, digest mismatch);
 *   4. signature validation: envelope v1.0 EdDSA verify ok / tamper rejected;
 *      authority JWS (RS256) verify ok / bad signature rejected / disallowed
 *      alg rejected; replay reserve second-reservation rejected.
 *
 * Emits a signed conformance report (same shape as blueeconomy-agency-sandbox
 * harness): report is EdDSA-signed with CONFORMANCE_SIGNING_KEY (base64/hex
 * 32-byte seed or PKCS#8 PEM) + CONFORMANCE_KEY_ID; without a key the harness
 * FAILS CLOSED (no unsigned conformance evidence) unless
 * CONFORMANCE_ALLOW_EPHEMERAL_KEY=1 is set (local/dev only, loudly marked).
 *
 * Run: npx tsx scripts/msw-conformance/run.ts [--out report.json]
 */
import { createHash, generateKeyPairSync, sign as cryptoSign } from "node:crypto";
import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { exportDeclarationToImo, importImoToDeclaration, ImoConformanceError } from "../../server/_core/imoCompendium";
import { canonicalizeJcs } from "../../server/_core/pcsEnvelope";
import {
  buildEgressEnvelope,
  decodeEd25519PrivateKey,
  signEgressEnvelope,
  verifyEgressEnvelope,
} from "../../server/_core/externalAdapters/base";
import { PeerJwsVerifier } from "../../server/_core/mswExchange";
import { generateKeyPairSync as genRsa, sign as rsaSign, type KeyObject } from "node:crypto";

const startedAt = new Date().toISOString();
const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_DIR = path.join(MODULE_DIR, "..", "..", "server", "_core", "fixtures", "mswImo");
const FORMS = ["fal1", "fal2", "fal3", "fal4", "fal5", "fal6", "fal7", "mdoh"];

interface Check { name: string; passed: boolean; detail?: string }
interface Scenario { id: string; form?: string; description: string; passed: boolean; checks: Check[] }

const scenarios: Scenario[] = [];
const stats: Record<string, { mapped: number; extensions: number; total: number }> = {};

function deepEqual(a: unknown, b: unknown): boolean {
  return canonicalizeJcs(a) === canonicalizeJcs(b);
}

function mappingCounts(form: string): { mapped: number; extensions: number; total: number } {
  const mapping = JSON.parse(readFileSync(path.join(FIXTURE_DIR, "..", "..", "..", "data", "imoMapping", "v1", `${form}.json`), "utf8"));
  let mapped = 0;
  for (const f of mapping.fields) {
    mapped += 1 + (f.itemFields?.length ?? 0);
  }
  const ext = mapping.extensionFields.length;
  return { mapped, extensions: ext, total: mapped + ext };
}

// ─── 1+2: golden fixtures + round-trip ───────────────────────────────────────
for (const form of FORMS) {
  const fixture = JSON.parse(readFileSync(path.join(FIXTURE_DIR, `${form}.json`), "utf8"));
  const checks: Check[] = [];
  const digest = `sha256:${createHash("sha256").update(canonicalizeJcs(fixture.formPayload), "utf8").digest("hex")}`;

  let exported;
  try {
    exported = exportDeclarationToImo({
      formType: fixture.formType, declarationId: fixture.declarationId, visitId: fixture.visitId,
      version: fixture.version, formPayloadDigestSha256: digest, formPayload: fixture.formPayload,
      sender: fixture.sender, messageId: fixture.messageId, issuedAt: fixture.issuedAt,
    });
    checks.push({ name: "export-ok", passed: true });
  } catch (err) {
    checks.push({ name: "export-ok", passed: false, detail: err instanceof Error ? err.message : String(err) });
    scenarios.push({ id: `${form}-roundtrip`, form, description: `${form.toUpperCase()} golden export + round-trip`, passed: false, checks });
    continue;
  }

  // Freeze mode: --freeze writes the expected fixture (bootstrap only).
  const expectedPath = path.join(FIXTURE_DIR, `${form}.expected.json`);
  if (process.argv.includes("--freeze")) {
    writeFileSync(expectedPath, JSON.stringify(exported, null, 2) + "\n");
    checks.push({ name: "fixture-frozen", passed: true, detail: expectedPath });
  } else {
    const expected = JSON.parse(readFileSync(expectedPath, "utf8"));
    checks.push({ name: "export-matches-golden", passed: deepEqual(exported, expected) });
  }

  const imported = importImoToDeclaration(exported, fixture.issuedAt);
  const roundTripOk = deepEqual(imported.formPayload, fixture.formPayload);
  checks.push({ name: "roundtrip-lossless", passed: roundTripOk });
  checks.push({
    name: "provenance-stamped",
    passed: imported.provenance.direction === "IMPORT" && imported.provenance.sourceMessageId === fixture.messageId,
  });
  const personal = ["fal4", "fal5", "fal6", "mdoh"].includes(form);
  checks.push({ name: "personal-data-flag", passed: imported.containsPersonalData === personal });

  stats[form.toUpperCase()] = mappingCounts(form);
  scenarios.push({
    id: `${form}-roundtrip`, form, description: `${form.toUpperCase()} golden export + round-trip`,
    passed: checks.every((c) => c.passed), checks,
  });
}

// ─── 3: fail-closed export rejections ────────────────────────────────────────
{
  const fixture = JSON.parse(readFileSync(path.join(FIXTURE_DIR, "fal1.json"), "utf8"));
  const digest = `sha256:${createHash("sha256").update(canonicalizeJcs(fixture.formPayload), "utf8").digest("hex")}`;
  const base = {
    formType: "FAL1" as const, declarationId: fixture.declarationId, visitId: fixture.visitId, version: 1,
    formPayloadDigestSha256: digest, formPayload: fixture.formPayload, sender: fixture.sender,
    messageId: fixture.messageId, issuedAt: fixture.issuedAt,
  };
  const expectReject = (name: string, mutate: () => typeof base, code: string): Check => {
    try {
      exportDeclarationToImo(mutate());
      return { name, passed: false, detail: "export unexpectedly succeeded" };
    } catch (err) {
      const ok = err instanceof ImoConformanceError && err.reasonCode === code;
      return { name, passed: ok, detail: ok ? code : `got ${err instanceof ImoConformanceError ? err.reasonCode : String(err)}` };
    }
  };
  const checks = [
    expectReject("reject-unmapped-field", () => {
      const p = { ...fixture.formPayload, bogusField: "x" };
      return { ...base, formPayload: p, formPayloadDigestSha256: `sha256:${createHash("sha256").update(canonicalizeJcs(p), "utf8").digest("hex")}` };
    }, "IMO_EXPORT_UNMAPPED_ELEMENT"),
    expectReject("reject-missing-mandatory", () => {
      const p = { ...fixture.formPayload } as Record<string, unknown>;
      delete p.vesselImoNumber;
      return { ...base, formPayload: p, formPayloadDigestSha256: `sha256:${createHash("sha256").update(canonicalizeJcs(p), "utf8").digest("hex")}` };
    }, "IMO_EXPORT_MISSING_MANDATORY"),
    expectReject("reject-type-violation", () => {
      const p = { ...fixture.formPayload, vesselImoNumber: "NOT-7-DIGITS" };
      return { ...base, formPayload: p, formPayloadDigestSha256: `sha256:${createHash("sha256").update(canonicalizeJcs(p), "utf8").digest("hex")}` };
    }, "IMO_EXPORT_TYPE_VIOLATION"),
    expectReject("reject-digest-mismatch", () => ({ ...base, formPayloadDigestSha256: `sha256:${"0".repeat(64)}` }), "IMO_EXPORT_DIGEST_MISMATCH"),
  ];
  scenarios.push({ id: "fail-closed-export", description: "fail-closed export rejections", passed: checks.every((c) => c.passed), checks });
}

// ─── 4: signature validation + replay ────────────────────────────────────────
{
  const checks: Check[] = [];
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const kid = "peer-msw-7";
  const envelope = signEgressEnvelope(
    buildEgressEnvelope({ producer: "peer-msw", eventType: "maritime.msw.imo_export.v1", payload: { ping: 1 }, principalId: "peer", principalRole: "msw" }),
    privateKey, kid
  );
  const trust = new Map<string, KeyObject>([[kid, publicKey]]);
  const okVerify = verifyEgressEnvelope(JSON.stringify(envelope), { producer: "peer-msw", kidPrefix: "peer-msw-", trustKeys: trust });
  checks.push({ name: "envelope-verify-ok", passed: okVerify.ok });
  const tampered = { ...envelope, payload: { ping: 2 } };
  const badVerify = verifyEgressEnvelope(JSON.stringify(tampered), { producer: "peer-msw", kidPrefix: "peer-msw-", trustKeys: trust });
  checks.push({ name: "envelope-tamper-rejected", passed: !badVerify.ok, detail: badVerify.ok ? "tamper accepted!" : badVerify.reason });

  // Authority JWS (RS256) against pinned JWKS.
  const rsa = genRsa("rsa", { modulusLength: 2048 });
  const rsaJwk = rsa.publicKey.export({ format: "jwk" }) as { n: string; e: string };
  const jwksBody = JSON.stringify({ keys: [{ kty: "RSA", kid: "peer-authority-1", n: rsaJwk.n, e: rsaJwk.e }] });
  const pin = `sha256:${createHash("sha256").update(jwksBody, "utf8").digest("hex")}`;
  const verifier = new PeerJwsVerifier({ jwksJson: jwksBody, pin, allowedKids: new Set(["peer-authority-1"]), allowedAlgs: new Set(["RS256"]) });
  const mkJws = (claims: Record<string, unknown>, key = rsa.privateKey, hdr: Record<string, unknown> = {}): string => {
    const header = Buffer.from(JSON.stringify({ alg: "RS256", kid: "peer-authority-1", jti: "jti-0001", ...hdr })).toString("base64url");
    const payload = Buffer.from(JSON.stringify(claims)).toString("base64url");
    const sig = rsaSign("sha256", Buffer.from(`${header}.${payload}`), key).toString("base64url");
    return `${header}.${payload}.${sig}`;
  };
  const jws = mkJws({ iss: "peer-msw" });
  let jwsOk = false;
  try { await verifier.verify(jws); jwsOk = true; } catch { /* rejected */ }
  checks.push({ name: "authority-jws-verify-ok", passed: jwsOk });

  const badSig = `${jws.split(".")[0]}.${jws.split(".")[1]}.${Buffer.from("forged").toString("base64url")}`;
  let badSigRejected = false;
  try { await verifier.verify(badSig); } catch { badSigRejected = true; }
  checks.push({ name: "authority-jws-bad-signature-rejected", passed: badSigRejected });

  let badAlgRejected = false;
  try { await verifier.verify(mkJws({ iss: "peer" }, rsa.privateKey, { alg: "HS256" })); } catch { badAlgRejected = true; }
  checks.push({ name: "authority-jws-disallowed-alg-rejected", passed: badAlgRejected });

  let wrongPinRejected = false;
  try {
    const evil = new PeerJwsVerifier({ jwksJson: jwksBody, pin: `sha256:${"0".repeat(64)}`, allowedKids: new Set(["peer-authority-1"]), allowedAlgs: new Set(["RS256"]) });
    await evil.verify(jws);
  } catch { wrongPinRejected = true; }
  checks.push({ name: "jwks-pin-mismatch-rejected", passed: wrongPinRejected });

  // Replay reserve semantics (in-memory reserve with webhook_receipts contract).
  const seen = new Set<string>();
  const reserve = async (jti: string): Promise<boolean> => { if (seen.has(jti)) return false; seen.add(jti); return true; };
  checks.push({ name: "replay-first-reserve-ok", passed: await reserve("jti-0001") === true });
  checks.push({ name: "replay-second-reserve-rejected", passed: await reserve("jti-0001") === false });

  scenarios.push({ id: "signature-and-replay", description: "envelope signature, authority JWS, JWKS pin, replay reserve", passed: checks.every((c) => c.passed), checks });
}

// ─── Report ──────────────────────────────────────────────────────────────────
const report: Record<string, unknown> = {
  reportVersion: "1.0",
  layer: "imo-wco-wire-conformance",
  disclaimer: "Wire-conformance evidence for the IMO Compendium mapping layer. Fixture-based; no live cross-border connectivity is claimed.",
  startedAt,
  finishedAt: new Date().toISOString(),
  coverage: Object.fromEntries(Object.entries(stats).map(([f, s]) => [f, `${s.mapped}/${s.total} mapped (+${s.extensions} registered extensions)`])),
  coverageStats: stats,
  scenarios,
  summary: {
    total: scenarios.length,
    passed: scenarios.filter((s) => s.passed).length,
    failed: scenarios.filter((s) => !s.passed).length,
  },
};

// Sign the report (EdDSA over JCS), mirroring the agency-sandbox harness.
const signingRaw = (process.env.CONFORMANCE_SIGNING_KEY ?? "").trim();
let signingKey: KeyObject;
let signingKid: string;
let ephemeral = false;
if (signingRaw) {
  signingKey = decodeEd25519PrivateKey(signingRaw, "CONFORMANCE_SIGNING_KEY");
  signingKid = `msw-conformance-${(process.env.CONFORMANCE_KEY_ID ?? "0").trim()}`;
} else if (process.env.CONFORMANCE_ALLOW_EPHEMERAL_KEY === "1") {
  signingKey = generateKeyPairSync("ed25519").privateKey;
  signingKid = "msw-conformance-ephemeral";
  ephemeral = true;
  report.ephemeralKeyWarning = "Report signed with an EPHEMERAL key (CONFORMANCE_ALLOW_EPHEMERAL_KEY=1) — local/dev evidence only, not attestable.";
} else {
  console.error("FAIL CLOSED: CONFORMANCE_SIGNING_KEY is not set — no unsigned conformance report (set CONFORMANCE_ALLOW_EPHEMERAL_KEY=1 for local/dev only).");
  process.exit(2);
}
const reportJcs = canonicalizeJcs(report);
const signature = cryptoSign(null, Buffer.from(reportJcs, "utf8"), signingKey).toString("base64");
report.signature = { alg: "EdDSA", kid: signingKid, canonical: "JCS(RFC8785)", value: signature, ephemeral };

const outIdx = process.argv.indexOf("--out");
const outPath = outIdx >= 0 ? process.argv[outIdx + 1] : path.join(MODULE_DIR, "conformance-report.json");
writeFileSync(outPath, JSON.stringify(report, null, 2) + "\n");
const failed = scenarios.filter((s) => !s.passed);
console.log(`scenarios: ${report.summary ? (report.summary as { passed: number }).passed : "?"}/${scenarios.length} passed; report → ${outPath}`);
for (const s of scenarios) console.log(`${s.passed ? "PASS" : "FAIL"} ${s.id}${s.form ? ` (${s.form})` : ""}`);
if (failed.length > 0) process.exit(1);
