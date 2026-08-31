/**
 * gapRegistry.ts — platform-wide integration gap registry (Phase 9 WP-A).
 *
 * Generalises the Phase-8 PCS INTEGRATION_GAPS pattern (pcsGaps.ts) beyond
 * the PCS portal: every external dependency that is not yet integrated, and
 * every deliberate temporary posture, is registered HERE with a stable id —
 * never simulated, never silently degraded. Routers/consumers reference these
 * ids in their honest-empty / fail-closed responses.
 */

export interface PlatformGap {
  /** Stable machine id, e.g. GAP-AIS-FEED. */
  id: string;
  /** One-line operator-facing summary. */
  summary: string;
  /** What is unavailable / degraded while the gap stands. */
  affected: string;
  /** The external capability or remediation that closes the gap. */
  neededUpstream: string;
}

export const PLATFORM_GAPS = {
  /**
   * PRA-096 (Phase 9): the Node cargoTracking read model
   * (vessel_tracking_events) now has a REAL ingestion path — the
   * geoVesselProjection Kafka consumer on `vessels.events` (envelope v1.0
   * JCS+EdDSA verified against GEO_ENVELOPE_TRUST_KEYS). It stays OFF, and
   * the tRPC layer stays honest-empty, until the geo-service publishes real
   * AIS-sourced events AND trust keys are configured. No vessel data is ever
   * seeded or synthesized.
   */
  AIS_FEED: {
    id: "GAP-AIS-FEED",
    summary:
      "No live AIS feed flows into vessel_tracking_events yet: the vessels.events consumer requires GEO_ENVELOPE_TRUST_KEYS and a reachable Kafka, and the upstream blueeconomy-geo-service only emits real positions once an AIS provider is connected.",
    affected: "live vessel positions, routes, port arrivals, vessel stats (cargoTracking.*)",
    neededUpstream:
      "A real AIS provider feed into blueeconomy-geo-service connectors + GEO_ENVELOPE_TRUST_KEYS keyring + KAFKA_BROKERS on the gateway.",
  },
  /**
   * PRA-027 (Phase 9): push-dispatch Kafka publish failures are recorded to
   * the durable kafka_event_log outbox (status=pending) with metric +
   * structured error log, and token registration still commits (documented
   * contract). The outbox is currently write-only from this path: NO drainer
   * worker ships in this repo to replay pending rows.
   */
  PUSH_OUTBOX: {
    id: "GAP-PUSH-OUTBOX",
    summary:
      "Push-dispatch outbox rows (kafka_event_log, topic insider.push.dispatch) are persisted for retry but no outbox drainer worker replays them yet; replay requires operator intervention until an outbox-worker ships.",
    affected: "automatic retry of failed push-dispatch publishes",
    neededUpstream:
      "An outbox drainer worker that republishes kafka_event_log status=pending rows (at-least-once) and marks them published/failed.",
  },
  /**
   * PRA-106 (Phase 9): HS256 islands. User-facing Bearer verification is
   * RS256+audience via Keycloak JWKS (keycloakVerifier.ts). Two deliberate
   * HS256 islands remain, both keyed by the env-only JWT_SECRET:
   *   1. server/_core/sdk.ts — session JWT (cookie session), HS256.
   *   2. server/sse.ts — SSE anomaly-stream ticket, HS256.
   * Migration note: move both to Keycloak-issued RS256 tokens (session
   * cookie carrying the Keycloak access token / short-lived SSE ticket
   * minted as a Keycloak token-exchange) so JWKS rotation covers them; do
   * NOT add new HS256 consumers in the meantime.
   */
  HS256_SESSIONS: {
    id: "GAP-HS256-SESSIONS",
    summary:
      "Session cookies (sdk.ts) and SSE tickets (sse.ts) still use HS256 with JWT_SECRET; user Bearer auth is RS256+aud via Keycloak. No new HS256 usage may be added.",
    affected: "session + SSE token signature algorithm uniformity and JWKS rotation coverage",
    neededUpstream:
      "Migrate session/SSE tokens to Keycloak-issued RS256 (token exchange for SSE tickets), then retire JWT_SECRET signing.",
  },
  /**
   * Phase 9 WP-C (MSW): NPA e-SEN (electronic Ship Entry Notice) integration
   * agreement is an FG must-bring item. The MSW visit surface anchors to
   * port-interop port calls only; no e-SEN wire compatibility is claimed and
   * no stub success path exists (PORT_CALL_UNAVAILABLE fail-closed states).
   */
  MSW_ESEN: {
    id: "GAP-MSW-ESEN",
    summary:
      "NPA e-SEN (electronic Ship Entry Notice) integration agreement is not in place; MSW visits link only to port-interoperability port calls, and unlinked/unverifiable visits are honestly flagged portCallVerified=false.",
    affected: "e-SEN-backed pre-arrival verification for MSW ship visits",
    neededUpstream:
      "NPA e-SEN integration agreement + adapter configuration on the port-interoperability boundary.",
  },
  /** Phase 9 WP-C (MSW): NIS endpoint agreement (FG must-bring). */
  MSW_NIS: {
    id: "GAP-MSW-NIS",
    summary:
      "Nigeria Immigration Service endpoint agreement is not in place; NIS boarding/clearance events are emitted on maritime.msw.v1 but no NIS-side system integration exists.",
    affected: "direct NIS system delivery of MSW boarding/clearance decisions",
    neededUpstream: "NIS endpoint agreement + adapter configuration.",
  },
  /** Phase 9 WP-C (MSW): Port Health endpoint agreement (FG must-bring). */
  MSW_PH: {
    id: "GAP-MSW-PH",
    summary:
      "Port Health Services endpoint agreement is not in place; pratique decisions are recorded in the boundary and emitted on maritime.msw.v1 but no Port Health system integration exists.",
    affected: "direct Port Health system delivery of pratique decisions and MDOH outcomes",
    neededUpstream: "Port Health endpoint agreement + adapter configuration.",
  },
  /** Phase 9 WP-C (MSW): NCS endpoint agreement (FG must-bring). */
  MSW_NCS: {
    id: "GAP-MSW-NCS",
    summary:
      "Nigeria Customs Service endpoint agreement is not in place; customs declaration reviews are recorded in the boundary and emitted on maritime.msw.v1 but no NCS-side system integration exists.",
    affected: "direct NCS system delivery of FAL declaration review decisions",
    neededUpstream: "NCS endpoint agreement + adapter configuration.",
  },
  /**
   * Phase 9 WP-D: NCS B'Odogwu customs-clearance integration is adapter-ready
   * only; no wire compatibility is claimed until counterpart credentials
   * exist. The egress adapter (server/_core/externalAdapters/ncsBodogwu.ts)
   * fails closed ADAPTER_UNCONFIGURED until NCS_BODOGWU_* env is set.
   */
  OGA_BODOGWU: {
    id: "GAP-OGA-BODOGWU",
    summary:
      "NCS B'Odogwu integration agreement is not in place; customs-clearance egress is disabled and fails closed (ADAPTER_UNCONFIGURED) — no stub success paths.",
    affected: "customs clearance submission toward NCS B'Odogwu",
    neededUpstream:
      "NCS B'Odogwu counterpart credentials + endpoint agreement (NCS_BODOGWU_URL / NCS_BODOGWU_SIGNING_KEY / NCS_BODOGWU_KEY_ID).",
  },
  /** Phase 9 WP-D: CBN TMS (e-Form M / PAAR) integration is adapter-ready only. */
  OGA_CBNTMS: {
    id: "GAP-OGA-CBNTMS",
    summary:
      "CBN Trade Monitoring System integration agreement is not in place; e-Form M / PAAR egress is disabled and fails closed (ADAPTER_UNCONFIGURED).",
    affected: "e-Form M registration and PAAR requests toward CBN TMS",
    neededUpstream:
      "CBN TMS counterpart credentials + endpoint agreement (CBN_TMS_URL / CBN_TMS_SIGNING_KEY / CBN_TMS_KEY_ID).",
  },
  /** Phase 9 WP-D: NEPC export-documentation integration is adapter-ready only. */
  OGA_NEPC: {
    id: "GAP-OGA-NEPC",
    summary:
      "NEPC integration agreement is not in place; export-documentation egress is disabled and fails closed (ADAPTER_UNCONFIGURED).",
    affected: "export documentation submission toward NEPC",
    neededUpstream:
      "NEPC counterpart credentials + endpoint agreement (NEPC_URL / NEPC_SIGNING_KEY / NEPC_KEY_ID).",
  },
} as const satisfies Record<string, PlatformGap>;

export type PlatformGapId = keyof typeof PLATFORM_GAPS;
