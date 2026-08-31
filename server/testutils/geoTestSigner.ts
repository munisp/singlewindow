/**
 * geoTestSigner.ts — test-only producer-side twin of the blueeconomy-geo-service
 * envelope signer (PRA-096). Builds REAL envelope v1.0 messages (RFC 8785 JCS
 * + Ed25519 JWS) exactly as the producer does, so verifier/projection tests
 * exercise the genuine contract — no shortcut fixtures, no pre-baked tokens.
 */
import { generateKeyPairSync, sign as cryptoSign, type KeyObject } from "node:crypto";
import { canonicalizeJcs } from "../_core/pcsEnvelope";
import { GEO_ENVELOPE_VERSION, GEO_PRODUCER, GEO_EVENT_VESSEL_POSITION } from "../_core/geoEnvelope";

export interface GeoTestKeypair {
  privateKey: KeyObject;
  /** base64 (standard) of the raw 32-byte Ed25519 public key. */
  publicKeyBase64: string;
  kid: string;
}

export function generateGeoTestKeypair(kid = "blueeconomy-geo-service-1"): GeoTestKeypair {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const jwk = publicKey.export({ format: "jwk" }) as { x: string };
  return {
    privateKey,
    publicKeyBase64: Buffer.from(jwk.x, "base64url").toString("base64"),
    kid,
  };
}

/** Signs an envelope (without provenance.signature) into the JWS compact form. */
export function signGeoEnvelope(
  envelopeWithoutSignature: Record<string, unknown>,
  privateKey: KeyObject,
  kid: string
): string {
  const header = Buffer.from(JSON.stringify({ alg: "EdDSA", kid }), "utf8").toString("base64url");
  const stripped: Record<string, unknown> = {
    ...envelopeWithoutSignature,
    provenance: { ...(envelopeWithoutSignature.provenance as Record<string, unknown>) },
  };
  delete (stripped.provenance as Record<string, unknown>).signature;
  const payload = Buffer.from(canonicalizeJcs(stripped), "utf8").toString("base64url");
  const signature = cryptoSign(null, Buffer.from(`${header}.${payload}`, "utf8"), privateKey).toString("base64url");
  return `${header}.${payload}.${signature}`;
}

export interface BuildVesselEventOptions {
  eventId?: string;
  correlationId?: string;
  mmsi?: string;
  shipName?: string;
  imo?: string;
  latitudeMicros?: number;
  longitudeMicros?: number;
  speedOverGroundMilliknots?: number;
  courseOverGroundMillidegrees?: number;
  headingMillidegrees?: number;
  observedAt?: string;
  receiverId?: string;
  positionReportId?: string;
  eventType?: string;
  producer?: string;
}

/** Builds a fully-signed geo.vessel-position.v1 envelope (as a JSON string). */
export function buildSignedVesselPositionEvent(
  keypair: GeoTestKeypair,
  options: BuildVesselEventOptions = {}
): string {
  const resource: Record<string, unknown> = {
    "@type": "type.googleapis.com/blueeconomy.contracts.v1.VesselPositionReported",
    positionReportId: options.positionReportId ?? `pr-${Math.random().toString(36).slice(2, 10)}`,
    mmsi: options.mmsi ?? "234567890",
    sourceClass: "A",
    latitudeMicros: options.latitudeMicros ?? 6_453_000, // Lagos roads
    longitudeMicros: options.longitudeMicros ?? 3_402_000,
    speedOverGroundMilliknots: options.speedOverGroundMilliknots ?? 12_400,
    courseOverGroundMillidegrees: options.courseOverGroundMillidegrees ?? 187_500,
    positionAccuracy: "HIGH",
    observedAt: options.observedAt ?? new Date().toISOString(),
    receiverId: options.receiverId ?? "ais-shore-ng-01",
    classification: "OFFICIAL",
  };
  if (options.headingMillidegrees !== undefined) resource.headingMillidegrees = options.headingMillidegrees;
  if (options.shipName !== undefined) resource.shipName = options.shipName;
  if (options.imo !== undefined) resource.imo = options.imo;

  const envelope: Record<string, unknown> = {
    envelopeVersion: GEO_ENVELOPE_VERSION,
    eventId: options.eventId ?? `evt-${Math.random().toString(36).slice(2, 12)}`,
    eventType: options.eventType ?? GEO_EVENT_VESSEL_POSITION,
    occurredAt: new Date().toISOString(),
    producer: options.producer ?? GEO_PRODUCER,
    correlationId: options.correlationId ?? `corr-${Math.random().toString(36).slice(2, 10)}`,
    classification: "OFFICIAL",
    fhir: { resourceType: "Bundle", type: "message", entry: [{ resource }] },
    provenance: { principalId: "blueeconomy-geo-service", principalRole: "producer" },
  };
  (envelope.provenance as Record<string, unknown>).signature = signGeoEnvelope(envelope, keypair.privateKey, keypair.kid);
  return JSON.stringify(envelope);
}
