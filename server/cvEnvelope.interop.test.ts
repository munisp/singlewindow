/**
 * cvEnvelope.interop.test.ts — cross-estate signature interop proof.
 *
 * The fixture was produced by the PYTHON signer (blueeconomy-ml-stack /
 * blueeconomy-cv-service envelope implementation, RFC 8785 JCS + EdDSA).
 * The TypeScript consumer verifier must accept it byte-for-byte semantics —
 * proving the two AI estates share one envelope contract.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { parseKeyDirectory, verifyEnvelope } from "./_core/cvEnvelope";

const fixture = JSON.parse(
  readFileSync(join(__dirname, "fixtures", "cv-envelope-python-signed.json"), "utf8")
);

describe("Python-signed envelope interop", () => {
  it("verifies an envelope signed by the Python producer", () => {
    const dir = parseKeyDirectory(JSON.stringify({ [fixture.kid]: fixture.pubkey }));
    const env = verifyEnvelope(JSON.stringify(fixture.envelope), dir);
    expect(env.kid).toBe("blueeconomy-cv-service-0");
    expect(env.eventType).toBe("cv.container-code.v1");
    expect((env.resource as any).code).toBe("CSQU-305438-3");
    expect(env.envelopeVersion).toBe("1.0");
  });
});
