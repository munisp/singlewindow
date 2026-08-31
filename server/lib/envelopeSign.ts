/**
 * Envelope v1.0 payload signing — JWS compact serialization (RFC 7515) using
 * EdDSA over Ed25519 (RFC 8037), per the normative fleet scheme in
 * blueeconomy-contracts docs/envelope-signature.md.
 *
 *  - Protected header: exactly {"alg":"EdDSA","kid":"<producer>-<epoch>"}
 *  - Payload: JCS-canonicalized (RFC 8785) JSON of the signed object
 *  - Signature input: base64url(header) + "." + base64url(payload)
 *
 * Keys are supplied via environment ONLY (never disk, never committed):
 *   MARKETPLACE_SIGNING_PRIVATE_KEY  — PEM or base64 PKCS8 Ed25519 private key
 *   MARKETPLACE_SIGNING_PUBLIC_KEY   — PEM or base64 SPKI Ed25519 public key
 *
 * FAIL-CLOSED: signing without a configured private key throws; verification
 * without a configured public key returns false. There is no fallback key.
 */
import { createPrivateKey, createPublicKey, sign as edSign, verify as edVerify, createHash, KeyObject } from "crypto";
import { canonicalizeJcs, type JsonValue } from "./jcs";

const b64u = (buf: Buffer | string): string =>
  (typeof buf === "string" ? Buffer.from(buf, "utf8") : buf)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");

function keyFromEnv(envVar: string, kind: "private" | "public"): KeyObject {
  const raw = process.env[envVar];
  if (!raw || raw.trim().length === 0) {
    throw new Error(
      `Envelope signing is unavailable: ${envVar} is not configured (env-only secrets policy, fail-closed).`
    );
  }
  const material = raw.includes("-----BEGIN")
    ? raw
    : Buffer.from(raw, "base64");
  return kind === "private"
    ? createPrivateKey(material as any)
    : createPublicKey(material as any);
}

export interface SignedPayload {
  /** JCS-canonical JSON of the payload object */
  canonicalPayload: string;
  /** sha256 hex digest of the canonical payload bytes */
  sha256: string;
  /** JWS compact serialization */
  jws: string;
  /** key id used for signing */
  kid: string;
}

/**
 * Sign an arbitrary JSON payload object as an envelope v1.0 signed document.
 * Throws (fail-closed) when the private key is not configured.
 */
export function signPayloadJws(payload: JsonValue, kid: string): SignedPayload {
  const privateKey = keyFromEnv("MARKETPLACE_SIGNING_PRIVATE_KEY", "private");
  const header = JSON.stringify({ alg: "EdDSA", kid });
  const canonicalPayload = canonicalizeJcs(payload);
  const signingInput = `${b64u(header)}.${b64u(canonicalPayload)}`;
  const signature = edSign(null, Buffer.from(signingInput, "ascii"), privateKey);
  return {
    canonicalPayload,
    sha256: createHash("sha256").update(canonicalPayload, "utf8").digest("hex"),
    jws: `${signingInput}.${b64u(signature)}`,
    kid,
  };
}

/**
 * Verify a JWS compact serialization against the configured public key.
 * Also re-canonicalizes the decoded payload object and requires a byte-exact
 * match with the payload segment (substitution resistance). Returns false on
 * any failure — never throws for bad input; returns false when no public key
 * is configured (fail-closed).
 */
export function verifyPayloadJws(jws: string, expectedKidPrefix?: string): boolean {
  try {
    const parts = jws.split(".");
    if (parts.length !== 3 || parts.some((p) => p.length === 0)) return false;
    const [h, p, s] = parts;
    const header = JSON.parse(Buffer.from(h, "base64url").toString("utf8"));
    if (header.alg !== "EdDSA" || typeof header.kid !== "string") return false;
    if (expectedKidPrefix && !header.kid.startsWith(expectedKidPrefix)) return false;
    // Byte-exact canonical match requirement
    const decodedPayload = JSON.parse(Buffer.from(p, "base64url").toString("utf8"));
    if (canonicalizeJcs(decodedPayload) !== Buffer.from(p, "base64url").toString("utf8")) return false;
    const publicKey = keyFromEnv("MARKETPLACE_SIGNING_PUBLIC_KEY", "public");
    return edVerify(
      null,
      Buffer.from(`${h}.${p}`, "ascii"),
      publicKey,
      Buffer.from(s, "base64url")
    );
  } catch {
    return false;
  }
}

/** True when a signing key is configured (used to report honest capability state). */
export function signingConfigured(): boolean {
  return Boolean(process.env.MARKETPLACE_SIGNING_PRIVATE_KEY?.trim());
}
