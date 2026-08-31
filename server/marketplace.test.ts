/**
 * WP-8 marketplace + KPI tests.
 *
 *  - JCS canonicalization (RFC 8785 vectors)
 *  - Envelope v1.0 JWS sign/verify, tamper-evidence, fail-closed without keys
 *  - API catalogue: sha256 digests, tamper-evidence on mutation
 *  - Sandbox routing: sandbox key CANNOT reach production upstream (negative)
 *  - KPI correctness on seeded, clearly test-scoped event rows with known
 *    expected percentiles; INSUFFICIENT_DATA below thresholds (no zeros-as-real)
 *
 * All rows below are synthetic TEST fixtures — never production data.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { generateKeyPairSync } from "crypto";
import { canonicalizeJcs } from "./lib/jcs";
import { signPayloadJws, verifyPayloadJws, signingConfigured } from "./lib/envelopeSign";
import { buildApiCatalogue, buildSignedCatalogue } from "./marketplace/apiCatalogue";
import { resolveUpstreamForKey, keyHasScope } from "./marketplace/sandboxRouting";
import {
  computeClearanceTimePercentiles,
  computeDeclarationsByLane,
  computeFeedFreshness,
  computePaperVisitAvoidance,
  computePaymentVolumes,
  computePermitsPerHour,
  percentile,
} from "./marketplace/kpiCompute";

// ─── JCS ─────────────────────────────────────────────────────────────────────

describe("JCS canonicalization (RFC 8785)", () => {
  it("sorts object keys and removes whitespace", () => {
    expect(canonicalizeJcs({ b: 1, a: 2 })).toBe('{"a":2,"b":1}');
  });
  it("handles nested structures deterministically", () => {
    const v = { z: [1, "a", true, null], a: { b: 1.5 } };
    expect(canonicalizeJcs(v)).toBe('{"a":{"b":1.5},"z":[1,"a",true,null]}');
  });
  it("rejects non-finite numbers", () => {
    expect(() => canonicalizeJcs(Infinity as any)).toThrow();
  });
});

// ─── Envelope v1.0 JWS ───────────────────────────────────────────────────────

describe("envelope v1.0 signing (EdDSA/Ed25519 + JCS)", () => {
  let privPem: string;
  let pubPem: string;
  beforeEach(() => {
    const { privateKey, publicKey } = generateKeyPairSync("ed25519");
    privPem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
    pubPem = publicKey.export({ type: "spki", format: "pem" }).toString();
    process.env.MARKETPLACE_SIGNING_PRIVATE_KEY = privPem;
    process.env.MARKETPLACE_SIGNING_PUBLIC_KEY = pubPem;
  });
  afterEach(() => {
    delete process.env.MARKETPLACE_SIGNING_PRIVATE_KEY;
    delete process.env.MARKETPLACE_SIGNING_PUBLIC_KEY;
  });

  it("round-trips sign → verify with correct kid", () => {
    const signed = signPayloadJws({ hello: "world", n: 42 }, "singlewindow-0");
    expect(signed.jws.split(".")).toHaveLength(3);
    expect(verifyPayloadJws(signed.jws, "singlewindow")).toBe(true);
  });

  it("detects payload tampering (modified payload segment fails)", () => {
    const signed = signPayloadJws({ amount: 100 }, "singlewindow-0");
    const [h, , s] = signed.jws.split(".");
    const forgedPayload = Buffer.from('{"amount":999}', "utf8").toString("base64url");
    expect(verifyPayloadJws(`${h}.${forgedPayload}.${s}`)).toBe(false);
  });

  it("rejects wrong alg and non-canonical payloads", () => {
    const signed = signPayloadJws({ a: 1 }, "singlewindow-0");
    const [, p, s] = signed.jws.split(".");
    const badHeader = Buffer.from(JSON.stringify({ alg: "HS256", kid: "x" })).toString("base64url");
    expect(verifyPayloadJws(`${badHeader}.${p}.${s}`)).toBe(false);
    const nonCanonical = Buffer.from('{ "a": 1 }', "utf8").toString("base64url");
    expect(verifyPayloadJws(`${badHeader}.${nonCanonical}.${s}`)).toBe(false);
  });

  it("fails closed when no private key is configured", () => {
    delete process.env.MARKETPLACE_SIGNING_PRIVATE_KEY;
    expect(signingConfigured()).toBe(false);
    expect(() => signPayloadJws({ a: 1 }, "singlewindow-0")).toThrow(/fail-closed|not configured/i);
  });
});

// ─── API catalogue tamper-evidence ───────────────────────────────────────────

describe("signed API catalogue", () => {
  beforeEach(() => {
    const { privateKey, publicKey } = generateKeyPairSync("ed25519");
    process.env.MARKETPLACE_SIGNING_PRIVATE_KEY = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
    process.env.MARKETPLACE_SIGNING_PUBLIC_KEY = publicKey.export({ type: "spki", format: "pem" }).toString();
  });
  afterEach(() => {
    delete process.env.MARKETPLACE_SIGNING_PRIVATE_KEY;
    delete process.env.MARKETPLACE_SIGNING_PUBLIC_KEY;
  });

  it("registers every catalogue entry with sha256 spec digest and metadata", () => {
    const cat = buildApiCatalogue(new Date("2026-09-01T00:00:00Z"));
    expect(cat.entryCount).toBeGreaterThan(5);
    for (const e of cat.entries) {
      expect(e.specDigest).toMatch(/^[0-9a-f]{64}$/);
      expect(e.owner).toBeTruthy();
      expect(["PUBLIC", "PARTNER", "RESTRICTED"]).toContain(e.classification);
      expect(e.version).toBeTruthy();
      expect(e.sla.availabilityPct).toBeGreaterThan(0);
      expect(e.openapiRef).toBeTruthy();
    }
  });

  it("is deterministic and tamper-evident: mutating an entry changes the digest", () => {
    const a = buildSignedCatalogue(new Date("2026-09-01T00:00:00Z"));
    expect(a.signatureStatus).toBe("SIGNED");
    expect(a.jws).toBeTruthy();
    expect(verifyPayloadJws(a.jws!, "singlewindow")).toBe(true);
    // Tamper: alter an entry's SLA and recompute what a verifier would see.
    const tampered = structuredClone(a.catalogue);
    tampered.entries[0].sla.availabilityPct = 100;
    const recomputed = require("crypto")
      .createHash("sha256")
      .update(canonicalizeJcs(tampered as any), "utf8")
      .digest("hex");
    expect(recomputed).not.toBe(a.catalogueDigest);
  });

  it("honestly reports UNSIGNED_NO_KEY when signing key is absent", () => {
    delete process.env.MARKETPLACE_SIGNING_PRIVATE_KEY;
    const c = buildSignedCatalogue(new Date("2026-09-01T00:00:00Z"));
    expect(c.signatureStatus).toBe("UNSIGNED_NO_KEY");
    expect(c.jws).toBeUndefined();
  });
});

// ─── Sandbox routing ─────────────────────────────────────────────────────────

describe("sandbox toggle routing", () => {
  const prodUpstream = { id: "declarations-core", sandbox: false };
  const sandboxUpstream = { id: "agency-sandbox", sandbox: true };

  it("sandbox key CANNOT reach production upstream (negative test)", () => {
    const d = resolveUpstreamForKey({ keyId: 1, sandboxMode: true, status: "active" }, prodUpstream);
    expect(d.allowed).toBe(false);
    if (!d.allowed) expect(d.reason).toMatch(/cannot reach production/);
  });

  it("production key NEVER sees sandbox data (negative test)", () => {
    const d = resolveUpstreamForKey({ keyId: 2, sandboxMode: false, status: "active" }, sandboxUpstream);
    expect(d.allowed).toBe(false);
    if (!d.allowed) expect(d.reason).toMatch(/never see sandbox/);
  });

  it("sandbox key → sandbox upstream carries X-Sandbox: true", () => {
    const d = resolveUpstreamForKey({ keyId: 1, sandboxMode: true, status: "active" }, sandboxUpstream);
    expect(d.allowed).toBe(true);
    if (d.allowed) expect(d.headers["X-Sandbox"]).toBe("true");
  });

  it("production key → production upstream allowed without sandbox header", () => {
    const d = resolveUpstreamForKey({ keyId: 2, sandboxMode: false, status: "active" }, prodUpstream);
    expect(d.allowed).toBe(true);
    if (d.allowed) expect(d.headers["X-Sandbox"]).toBeUndefined();
  });

  it("revoked keys and unregistered upstreams are refused (fail-closed)", () => {
    expect(resolveUpstreamForKey({ keyId: 1, sandboxMode: false, status: "revoked" }, prodUpstream).allowed).toBe(false);
    expect(resolveUpstreamForKey({ keyId: 1, sandboxMode: true, status: "active" }, undefined).allowed).toBe(false);
  });

  it("scope checks honour exact scopes and admin:all", () => {
    expect(keyHasScope("declarations:read,payments:read", "payments:read")).toBe(true);
    expect(keyHasScope("declarations:read", "payments:write")).toBe(false);
    expect(keyHasScope("admin:all", "payments:write")).toBe(true);
  });
});

// ─── KPI correctness (seeded TEST rows) ──────────────────────────────────────

const W = { from: new Date("2026-09-01T00:00:00Z"), to: new Date("2026-09-02T00:00:00Z") };
const NOW = new Date("2026-09-02T00:00:00Z");
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000);

describe("KPI computation on seeded test rows", () => {
  it("nearest-rank percentiles are correct", () => {
    expect(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 50)).toBe(5);
    expect(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 90)).toBe(9);
    expect(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 95)).toBe(10);
  });

  it("clearance time percentiles match known expected values", () => {
    // TEST rows with clearance durations of exactly 1,2,3,4,5,6,7,8,9,10 hours.
    const rows = Array.from({ length: 10 }, (_, i) => ({
      submittedAt: hoursAgo((i + 1) + 1),
      clearedAt: hoursAgo(1),
    }));
    const kpi = computeClearanceTimePercentiles(rows, W, NOW);
    expect(kpi.status).toBe("OK");
    expect(kpi.provenance.n).toBe(10);
    expect(kpi.provenance.sources).toContain("declarations.submitted_at");
    expect(kpi.value).toEqual({ p50: 5, p90: 9, p95: 10, mean: 5.5 });
  });

  it("reports INSUFFICIENT_DATA below the minimum sample — never zeros", () => {
    const rows = [
      { submittedAt: hoursAgo(5), clearedAt: hoursAgo(3) },
      { submittedAt: hoursAgo(4), clearedAt: hoursAgo(2) },
    ];
    const kpi = computeClearanceTimePercentiles(rows, W, NOW);
    expect(kpi.status).toBe("INSUFFICIENT_DATA");
    expect(kpi.value).toBeNull();
    expect(kpi.provenance.n).toBe(2);
  });

  it("permits/hour divides by the true window length", () => {
    const kpi = computePermitsPerHour(48, W, NOW); // 24h window
    expect(kpi.status).toBe("OK");
    expect(kpi.value).toBeCloseTo(2);
  });

  it("declarations by lane returns real counts with zero-filled lanes", () => {
    const kpi = computeDeclarationsByLane({ green: 7, red: 2 }, W, NOW);
    expect(kpi.status).toBe("OK");
    expect(kpi.value).toEqual({ green: 7, yellow: 0, red: 2 });
  });

  it("paper-visit avoidance carries the estimation methodology label", () => {
    const kpi = computePaperVisitAvoidance(10, W, NOW);
    expect(kpi.status).toBe("OK");
    expect(kpi.value).toBe(5);
    expect(kpi.methodology).toMatch(/ESTIMATE/);
  });

  it("payment volumes aggregate per currency; empty set is INSUFFICIENT_DATA", () => {
    const ok = computePaymentVolumes({ NGN: 1_000_000, USD: 2500 }, 12, W, NOW);
    expect(ok.status).toBe("OK");
    expect(ok.value).toEqual({ NGN: 1_000_000, USD: 2500 });
    const none = computePaymentVolumes({}, 0, W, NOW);
    expect(none.status).toBe("INSUFFICIENT_DATA");
    expect(none.value).toBeNull();
  });

  it("feed freshness reports real age and honest -1 for never-seen feeds", () => {
    const kpi = computeFeedFreshness(
      [
        { feedId: "ais", lastEventAt: new Date(NOW.getTime() - 60_000), eventCount: 100 },
        { feedId: "metocean", lastEventAt: null, eventCount: 0 },
      ],
      W,
      NOW
    );
    expect(kpi.status).toBe("OK");
    expect(kpi.value).toEqual({ ais: 60, metocean: -1 });
  });
});
