/**
 * signAgencyConformanceReport.ts — Phase 10 WP-2b: signs the live
 * agency-sandbox e2e evidence into the end-to-end conformance report (the
 * audit artifact).
 *
 * Input:  evidence JSON written by server/externalAdapters.e2e.test.ts +
 *         server/mswPortCall.e2e.test.ts (AGENCY_SANDBOX_EVIDENCE_OUT).
 * Output: signed conformance report JSON:
 *   - every scenario record (adapter × path, outcome, detail)
 *   - scenario request/response sha256 digests as captured live
 *   - scenariosDigestSha256 over the JCS-canonical scenario set
 *   - provenance.signature: JWS compact (EdDSA/Ed25519) over the
 *     RFC 8785 (JCS) canonical report minus the signature field, kid
 *     blueeconomy-singlewindow-oga-conformance-<epoch> — the same envelope
 *     v1.0 signing discipline as the platform egress adapters.
 *
 * Key: env-only AGENCY_CONFORMANCE_SIGNING_KEY (base64url Ed25519 seed,
 * generated per run by scripts/agency-sandbox-e2e.sh) +
 * AGENCY_CONFORMANCE_KEY_EPOCH (default "1"). The public key is embedded in
 * the report so any verifier can check the signature offline.
 *
 * Usage: npx tsx scripts/signAgencyConformanceReport.ts <evidence.json> <report-out.json>
 */
import { createHash, createPublicKey, sign as cryptoSign } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { canonicalizeJcs } from "../server/_core/pcsEnvelope";
import { decodeEd25519PrivateKey } from "../server/_core/externalAdapters/base";

const [evidencePath, outPath] = process.argv.slice(2);
if (!evidencePath || !outPath) {
  console.error("usage: npx tsx scripts/signAgencyConformanceReport.ts <evidence.json> <report-out.json>");
  process.exit(2);
}

const seed = (process.env.AGENCY_CONFORMANCE_SIGNING_KEY ?? "").trim();
if (!seed) {
  console.error("AGENCY_CONFORMANCE_SIGNING_KEY unset — refusing to sign (fail closed)");
  process.exit(1);
}
const epoch = (process.env.AGENCY_CONFORMANCE_KEY_EPOCH ?? "1").trim();
if (!/^\d+$/.test(epoch)) {
  console.error("AGENCY_CONFORMANCE_KEY_EPOCH must be a decimal epoch");
  process.exit(1);
}

const evidence = JSON.parse(readFileSync(evidencePath, "utf8")) as {
  evidenceVersion: string;
  generatedAt: string;
  scenarios: Array<Record<string, unknown>>;
};

const privateKey = decodeEd25519PrivateKey(seed, "AGENCY_CONFORMANCE_SIGNING_KEY");
const publicKeyRaw = createPublicKey(privateKey).export({ format: "jwk" }) as { x: string };
const kid = `blueeconomy-singlewindow-oga-conformance-${epoch}`;

const scenariosDigestSha256 = createHash("sha256")
  .update(canonicalizeJcs(evidence.scenarios), "utf8")
  .digest("hex");

const report: Record<string, unknown> = {
  reportVersion: "1.0",
  reportType: "agency-sandbox-e2e-conformance",
  generatedAt: new Date().toISOString(),
  evidenceGeneratedAt: evidence.generatedAt,
  suite: "singlewindow server/externalAdapters.e2e.test.ts + server/mswPortCall.e2e.test.ts (live blueeconomy-agency-sandbox)",
  scenarioCount: evidence.scenarios.length,
  scenariosPassed: evidence.scenarios.filter((s) => s.outcome === "pass").length,
  scenariosDigestSha256,
  scenarios: evidence.scenarios,
  provenance: {
    principalId: "blueeconomy-singlewindow-wp2b",
    principalRole: "CONFORMANCE_HARNESS",
    kid,
    publicKeyBase64Url: publicKeyRaw.x,
  },
};

const header = Buffer.from(JSON.stringify({ alg: "EdDSA", kid }), "utf8").toString("base64url");
const payload = Buffer.from(canonicalizeJcs(report), "utf8").toString("base64url");
const signature = cryptoSign(null, Buffer.from(`${header}.${payload}`, "utf8"), privateKey).toString("base64url");
(report.provenance as Record<string, unknown>).signature = `${header}.${payload}.${signature}`;

writeFileSync(outPath, JSON.stringify(report, null, 2));
console.log(
  `[conformance] signed report → ${outPath} (kid ${kid}, scenarios ${evidence.scenarios.length}, ` +
    `passed ${report.scenariosPassed}, digest sha256:${scenariosDigestSha256})`
);
