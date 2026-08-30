// ─── SW-MP8: PORT REGISTRY (single source of truth) ─────────────────────────
// Every internal service port used by the Node gateway is declared here once.
// URL defaults below are derived from these constants — never hardcode a port
// literal in this file or in routers; add it here instead. Services that bind
// their own listen port read their own env (documented per service), but any
// gateway-side default MUST come from this registry.
//
// Canonical assignments (docker-compose published ports):
//   8086 tigerbeetle-bridge (CANONICAL money-rail bridge, HTTP /api/ledger/*)
//   9086 tigerbeetle-bridge gRPC health
//   8097 profile-service HTTP (renumbered off 8086 — SW-MP7 collision fix)
//
// ─── SW-CLOSE / PRA-067 reconciliation (contested ports) ─────────────────────
// The root docker-compose.yml microservice block binds/publishes Python
// microservices on ports this registry assigns to Go services. Ownership was
// adjudicated per THIS registry + the real Go bind defaults (fail-closed:
// the gateway never guesses which service answers a contested port):
//   8087 keycloak-svc (Go, KEYCLOAK_SVC_HTTP_PORT default 8087) — compose
//        risk-engine ALSO binds/publishes 8087 → KNOWN COLLISION.
//   8093 cen-service (Go bind default 8093, renumbered per P0-7) — compose
//        hs-classifier ALSO binds/publishes 8093 → KNOWN COLLISION.
//   8096 asean-sw-service (Go bind default 8096) — compose fluvio-consumer
//        ALSO binds/publishes 8096; stale fluvioSvc entry → KNOWN COLLISION.
//   8098 freezone-service (Go bind default 8098) — stale deltaLakeSvc entry
//        → KNOWN COLLISION (deltaLakeSvc deprecated, unassigned).
//   8095 compose vision-service (OCR) vs PORTS.visionService 8105 — KNOWN
//        DIVERGENCE: no real service binds 8105 (microservices/vision-service
//        compose-binds 8095; services/python/vision-service binds 8092 and
//        itself collides with compose gnn-risk). VISION_SERVICE_URL must be
//        set explicitly; 8105 stays a fail-closed placeholder.
// The gateway defaults for the NON-owning services were moved to the
// deliberately-unassigned 8111-8116 block (see below) — connection-refused
// is the honest failure until the operator sets an explicit URL. Compose
// deployments MUST set explicit *_URL env vars using container DNS names
// (e.g. HS_CLASSIFIER_URL=http://hs-classifier:8093), which is unambiguous
// inside the compose network.
export const PORTS = {
  keycloak: 8080,
  keycloakSvc: 8087,
  permify: 3476,
  redis: 6379,
  kafka: 9092,
  temporal: 7233,
  tigerBeetle: 3000,
  fluvio: 9003,
  apisixAdmin: 9180,
  wazuhApi: 55000,
  opencti: 4000,
  kubecost: 9090,
  aseanSwService: 8096, // matches asean-sw-service bind default + aseanSw.ts
  aseanGatewayGrpc: 50091,
  freeZoneService: 8098, // matches freezone-service bind default + freeZone.ts
  cenService: 8093, // cen-service renumbered off 8097 (profile-service collision, P0-7)
  tigerBeetleBridge: 8086, // CANONICAL — the only money-rail bridge
  // DEPRECATED (P0-9): Fluvio is not deployed — these entries are stale and
  // their ports are owned by asean-sw-service (8096) / profile-service (8097).
  fluvioSvc: 8096,
  fluvioWs: 8097,
  deltaLakeSvc: 8098,
  flinkCepSvc: 8099,
  flinkStreamGrpc: 50099,
  sedonaSvc: 8100,
  sedonaGeoGrpc: 50100,
  rustFsSvc: 8101,
  graphBridge: 8102,
  riskScorer: 8103,
  paymentRisk: 8104,
  visionService: 8105,
  warehouseService: 8106,
  mojaloop: 3001,
  declarationGrpc: 50051,
  riskEngineGrpc: 50052,
  paymentGrpc: 50053,
  cargoTrackingGrpc: 50054,
  documentVaultGrpc: 50055,
  profileGrpc: 50056,
  bondedWarehouseGrpc: 50057,
  auditSvcGrpc: 50058,
  profileService: 8097, // HTTP (compose-published; SW-MP7 renumber)
} as const;

export const ENV = {
  cookieSecret: process.env.JWT_SECRET ?? "",
  apiKeyHashSecret: process.env.API_KEY_HASH_SECRET ?? "",
  databaseUrl: process.env.DATABASE_URL ?? "",
  bootstrapOwnerOpenId: process.env.BOOTSTRAP_OWNER_OPEN_ID ?? "",
  isProduction: process.env.NODE_ENV === "production",
  externalProviderUrl: process.env.EXTERNAL_PROVIDER_API_URL ?? "",
  externalProviderApiKey: process.env.EXTERNAL_PROVIDER_API_KEY ?? "",

  // ─── Keycloak ─────────────────────────────────────────────────────────────
  keycloakUrl: process.env.KEYCLOAK_URL ?? "http://localhost:8080",
  keycloakRealm: process.env.KEYCLOAK_REALM ?? "tradegateway",
  keycloakClientId: process.env.KEYCLOAK_CLIENT_ID ?? "tradegateway-api",
  keycloakClientSecret: process.env.KEYCLOAK_CLIENT_SECRET ?? "",
  keycloakAdminUser: process.env.KEYCLOAK_ADMIN_USER ?? "admin",
  keycloakAdminPassword: process.env.KEYCLOAK_ADMIN_PASSWORD ?? "",
  // Canonical owner of 8087 per PORTS.keycloakSvc (Go keycloak-svc bind
  // default KEYCLOAK_SVC_HTTP_PORT=8087). KNOWN COLLISION: compose
  // risk-engine also binds/publishes 8087 — RISK_ENGINE_URL was moved off
  // this port (8112); see the registry header.
  keycloakSvcUrl: process.env.KEYCLOAK_SVC_URL ?? "http://localhost:8087",

  // ─── Nigeria National Identity (NIN) Identity Provider ───────────────────
  nigeriaIdClientId: process.env.NIGERIA_ID_CLIENT_ID ?? "",
  nigeriaIdClientSecret: process.env.NIGERIA_ID_CLIENT_SECRET ?? "",
  nigeriaIdBaseUrl: process.env.NIGERIA_ID_BASE_URL ?? "https://api.nimc.gov.ng",
  nigeriaIdAuthorizationUrl: process.env.NIGERIA_ID_AUTHORIZATION_URL ?? "https://api.nimc.gov.ng/oauth/authorize",
  nigeriaIdTokenUrl: process.env.NIGERIA_ID_TOKEN_URL ?? "https://api.nimc.gov.ng/oauth/token",
  nigeriaIdUserInfoUrl: process.env.NIGERIA_ID_USERINFO_URL ?? "https://api.nimc.gov.ng/oauth/userinfo",

  // ─── Permify ──────────────────────────────────────────────────────────────
  permifyUrl: process.env.PERMIFY_URL ?? "http://localhost:3476",
  permifyTenantId: process.env.PERMIFY_TENANT_ID ?? "tradegateway",
  permifyApiKey: process.env.PERMIFY_API_KEY ?? "",

  // ─── Redis ────────────────────────────────────────────────────────────────
  // PRA-115 (Phase 9): NO credential defaults anywhere. The dev default is a
  // passwordless localhost URL; every real environment (staging/prod) must set
  // REDIS_URL + REDIS_PASSWORD explicitly. Production boot refuses missing,
  // local, or known-dev-placeholder values (validateProductionConfig below).
  redisUrl: process.env.REDIS_URL ?? "redis://localhost:6379",
  redisPassword: process.env.REDIS_PASSWORD ?? "",

  // ─── Kafka ────────────────────────────────────────────────────────────────
  kafkaBrokers: (process.env.KAFKA_BROKERS ?? "localhost:9092").split(","),
  kafkaClientId: process.env.KAFKA_CLIENT_ID ?? "tradegateway-api",
  kafkaSaslUsername: process.env.KAFKA_SASL_USERNAME ?? "",
  kafkaSaslPassword: process.env.KAFKA_SASL_PASSWORD ?? "",

  // ─── Temporal ─────────────────────────────────────────────────────────────
  temporalAddress: process.env.TEMPORAL_ADDRESS ?? "localhost:7233",
  temporalNamespace: process.env.TEMPORAL_NAMESPACE ?? "tradegateway",
  temporalTlsCertPath: process.env.TEMPORAL_TLS_CERT_PATH ?? "",
  temporalTlsKeyPath: process.env.TEMPORAL_TLS_KEY_PATH ?? "",

  // ─── TigerBeetle ─────────────────────────────────────────────────────────
  tigerBeetleAddresses: (process.env.TIGERBEETLE_ADDRESSES ?? "localhost:3000").split(","),
  tigerBeetleClusterId: parseInt(process.env.TIGERBEETLE_CLUSTER_ID ?? "0"),

  // ─── Fluvio ───────────────────────────────────────────────────────────────
  fluvioEndpoint: process.env.FLUVIO_ENDPOINT ?? "localhost:9003",

  // ─── APISIX ───────────────────────────────────────────────────────────────
  apisixAdminUrl: process.env.APISIX_ADMIN_URL ?? "http://localhost:9180",
  apisixAdminKey: process.env.APISIX_ADMIN_KEY ?? "",

  // ─── SendGrid ─────────────────────────────────────────────────────────────
  sendgridApiKey: process.env.SENDGRID_API_KEY ?? "",
  sendgridFromEmail: process.env.SENDGRID_FROM_EMAIL ?? "noreply@tradegateway.gov.ng",
  sendgridFromName: process.env.SENDGRID_FROM_NAME ?? "TradeGateway\u2122 NGSWTP",

  // ─── Wazuh ────────────────────────────────────────────────────────────────
  wazuhApiUrl: process.env.WAZUH_API_URL ?? "https://localhost:55000",
  wazuhApiUser: process.env.WAZUH_API_USER ?? "wazuh",
  wazuhApiPassword: process.env.WAZUH_API_PASSWORD ?? "",

  // ─── OpenCTI ──────────────────────────────────────────────────────────────
  openctiUrl: process.env.OPENCTI_URL ?? "http://localhost:4000",
  openctiToken: process.env.OPENCTI_TOKEN ?? "",

  // ─── Kubecost ─────────────────────────────────────────────────────────────
  kubecostUrl: process.env.KUBECOST_URL ?? "http://localhost:9090",

  // ─── ASEAN Single Window ──────────────────────────────────────────────────
  // Canonical owner of 8096 per PORTS.aseanSwService (Go bind default 8096).
  // KNOWN COLLISION: compose fluvio-consumer also publishes 8096, and the
  // deprecated fluvioSvc default pointed here too — both moved off (see the
  // registry header and the Fluvio Extended section).
  aseanSwServiceUrl: process.env.ASEAN_SW_SERVICE_URL ?? process.env.ASEAN_SW_URL ?? "http://localhost:8096", // asean-sw-service bind default
  aseanGatewayGrpcAddr: process.env.ASEAN_GATEWAY_GRPC_ADDR ?? "localhost:50091",

  // ─── Free Zone Service ────────────────────────────────────────────────────
  // Canonical owner of 8098 per PORTS.freeZoneService (Go bind default 8098).
  // The deprecated deltaLakeSvc default was moved off this port (8116).
  freeZoneServiceUrl: process.env.FREEZONE_SERVICE_URL ?? "http://localhost:8098", // freezone-service bind default

  // ─── CEN (WCO) Service ────────────────────────────────────────────────────
  // Canonical owner of 8093 per PORTS.cenService (Go cen-service bind default
  // 8093). KNOWN COLLISION: compose hs-classifier also publishes 8093 — see
  // the registry header. HS_CLASSIFIER_URL was moved off this port.
  cenServiceUrl: process.env.CEN_SERVICE_URL ?? "http://localhost:8093",

  // ─── TigerBeetle Bridge ───────────────────────────────────────────────────
  // SW-MP8/MP9: the canonical money-rail bridge is the Go service on 8086
  // (HTTP /api/ledger/*). The old 8094 default was stale, and the Rust
  // bridge alias was removed entirely (dev-only per SW-A/SW-O3).
  tbBridgeUrl: process.env.TB_BRIDGE_URL ?? process.env.TB_GO_BRIDGE_HTTP_ADDR ?? `http://localhost:${PORTS.tigerBeetleBridge}`,

  // ─── Fluvio Extended ──────────────────────────────────────────────────────
  // DEPRECATED (P0-9): Fluvio is not deployed. The old defaults collided with
  // the canonical owners (asean-sw-service 8096, profile-service 8097); they
  // now point at the deliberately-unassigned 811x block so a stale consumer
  // fails closed (connection refused) instead of silently hitting the wrong
  // service. routers/stream.ts still reads FLUVIO_SVC_URL directly with its
  // own stale 8093 literal — KNOWN STRAGGLER, flagged for the next wave.
  fluvioSvcUrl: process.env.FLUVIO_SVC_URL ?? "http://localhost:8113",
  fluvioWsUrl: process.env.FLUVIO_WS_URL ?? "ws://localhost:8115",

  // ─── Delta Lake / Flink Analytics ────────────────────────────────────────
  // DEPRECATED: deltalake-svc is not deployed; the old 8098 default collided
  // with the canonical owner freezone-service (Go bind default 8098).
  deltaLakeSvcUrl: process.env.DELTALAKE_SVC_URL ?? "http://localhost:8116",
  flinkCepSvcUrl: process.env.FLINK_CEP_SVC_URL ?? "http://localhost:8099",
  flinkStreamGrpcAddr: process.env.FLINK_STREAM_GRPC_ADDR ?? "localhost:50099",

  // ─── Apache Sedona (Geospatial) ───────────────────────────────────────────
  sedonaSvcUrl: process.env.SEDONA_SVC_URL ?? "http://localhost:8100",
  sedonaGeoGrpcAddr: process.env.SEDONA_GEO_GRPC_ADDR ?? "localhost:50100",

  // ─── Rust File Storage (RustFS) ───────────────────────────────────────────
  rustFsSvcUrl: process.env.RUSTFS_SVC_URL ?? "http://localhost:8101",

  // ─── Knowledge Graph Bridge ───────────────────────────────────────────────
  graphBridgeUrl: process.env.GRAPH_BRIDGE_URL ?? "http://localhost:8102",

  // ─── Risk Engine ──────────────────────────────────────────────────────────
  riskScorerUrl: process.env.RISK_SCORER_URL ?? "http://localhost:8103",
  paymentRiskUrl: process.env.PAYMENT_RISK_URL ?? "http://localhost:8104",

  // ─── Vision / Document AI ─────────────────────────────────────────────────
  // KNOWN DIVERGENCE (PRA-067): no real service binds PORTS.visionService
  // (8105) — microservices/vision-service compose-binds 8095 (see
  // visionSvcUrl, used for the vision-ocr health probe) and
  // services/python/vision-service binds 8092 (itself colliding with compose
  // gnn-risk). 8105 remains a fail-closed placeholder: set VISION_SERVICE_URL
  // explicitly to the real NLP/vision endpoint. routers/vision.ts still
  // hardcodes its own stale 8092 literal — KNOWN STRAGGLER, flagged.
  visionServiceUrl: process.env.VISION_SERVICE_URL ?? "http://localhost:8105",

  // ─── Warehouse Service ────────────────────────────────────────────────────
  warehouseServiceUrl: process.env.WAREHOUSE_SERVICE_URL ?? "http://localhost:8106",

  // ─── Mojaloop ─────────────────────────────────────────────────────────────
  mojaloopUrl: process.env.MOJALOOP_URL ?? "http://localhost:3001",

  // ─── Tariff Engine (blueeconomy-financial-controls W-FEAT-4) ──────────────
  // PRA-100: authoritative statutory tariff assessment upstream. NO local
  // default — an unset URL must fail closed (explicit configuration error),
  // never fall back to a phantom endpoint or a fabricated rate. The bearer
  // token authenticates the gateway to the engine; in production it must be
  // a Keycloak-verifiable service token (the engine verifies RS256 against
  // KEYCLOAK_BASE_URL/REALM; non-production engine profiles accept any
  // bearer as the requester subject).
  tariffServiceUrl: process.env.TARIFF_SERVICE_URL ?? "",
  tariffServiceToken: process.env.TARIFF_SERVICE_TOKEN ?? "",
  // Keycloak client-credentials token flow (SW-CLOSE, PRA-100r deferred
  // remainder): when ALL THREE of KEYCLOAK_TOKEN_URL /
  // TARIFF_SERVICE_CLIENT_ID / TARIFF_SERVICE_CLIENT_SECRET are set, the
  // tariff client obtains + caches + refreshes an access token via the
  // client_credentials grant and uses it as the bearer; the static
  // TARIFF_SERVICE_TOKEN above is the documented fallback when the Keycloak
  // env is absent. A PARTIAL set is a misconfiguration and fails closed at
  // call time with a classified error — never a silent fallback.
  keycloakTokenUrl: process.env.KEYCLOAK_TOKEN_URL ?? "",
  // PRA-106 (Phase 9): expected `aud` for user-facing Keycloak tokens verified
  // by server/_core/keycloakVerifier.ts. REQUIRED in production (boot refusal
  // via validateProductionConfig); optional in dev with a loud warning. A
  // token whose aud does not include this value is rejected on every request.
  keycloakTokenAudience: process.env.KEYCLOAK_TOKEN_AUDIENCE ?? "",
  tariffServiceClientId: process.env.TARIFF_SERVICE_CLIENT_ID ?? "",
  tariffServiceClientSecret: process.env.TARIFF_SERVICE_CLIENT_SECRET ?? "",

  // ─── Port Interoperability (PCS trader-portal upstream; Phase 8) ──────────
  // blueeconomy-port-interoperability is the system of record for port calls,
  // eCallUp bookings, slots, gate scans and billing. NO local default for the
  // base URL — an unset URL must fail closed (explicit configuration error),
  // never fall back to a phantom endpoint or fabricated rows (mirrors the
  // tariff-engine contract). Auth resolution mirrors tariffClient: ALL of
  // KEYCLOAK_TOKEN_URL / PORT_INTEROP_CLIENT_ID / PORT_INTEROP_CLIENT_SECRET
  // set → client_credentials token flow; a PARTIAL set is a misconfiguration
  // that fails closed at call time; none set → static PORT_INTEROP_TOKEN
  // (documented non-production fallback).
  portInteropUrl: process.env.PORT_INTEROP_URL ?? "",
  portInteropToken: process.env.PORT_INTEROP_TOKEN ?? "",
  portInteropClientId: process.env.PORT_INTEROP_CLIENT_ID ?? "",
  portInteropClientSecret: process.env.PORT_INTEROP_CLIENT_SECRET ?? "",
  // Booking INITIATION (spec R3 write path) is gated on an EXTERNAL product
  // decision. The portal is read-only unless operators explicitly opt in;
  // when disabled the mutation returns a typed INTEGRATION_GAPS disclosure,
  // never a fake success.
  pcsBookingInitiationEnabled:
    (process.env.PCS_BOOKING_INITIATION_ENABLED ?? "").trim().toLowerCase() === "true",
  // Trusted Ed25519 public keys for the envelope v1.0 provenance JWS on
  // ports.*.v1 Kafka events: a JSON object mapping the JWS kid
  // ("port-interoperability-<epoch>") to the base64/hex public key. Unset or
  // unparseable → every consumed event is rejected (fail closed; mirrors the
  // data-platform consumer). Secrets/key material are env-only.
  pcsEnvelopeTrustKeys: process.env.PCS_ENVELOPE_TRUST_KEYS ?? "",

  // ─── Sanctions Webhook ────────────────────────────────────────────────────
  sanctionsWebhookSecret: process.env.SANCTIONS_WEBHOOK_SECRET ?? "",

  // ─── Caddy On-Demand TLS ask endpoint (PRA-015, Phase 9) ─────────────────
  // Shared secret gating tenant.validateHostname (Caddy's on_demand_tls.ask).
  // REQUIRED in production (boot refusal below) — an unset secret must never
  // disable the check; the endpoint itself also fails closed when unset.
  caddyAskSecret: process.env.CADDY_ASK_SECRET ?? "",

  // ─── Service-to-service auth: TigerBeetle bridge (PRA-012, Phase 9) ──────
  // Keycloak client-credentials for money-rail HTTP hops. REQUIRED in
  // production (boot refusal). TB_BRIDGE_SHARED_SECRET is the documented
  // non-production fallback the bridge accepts only when APP_ENV!=production.
  tbBridgeClientId: process.env.TB_BRIDGE_CLIENT_ID ?? "",
  tbBridgeClientSecret: process.env.TB_BRIDGE_CLIENT_SECRET ?? "",

  // ─── Email Digest ─────────────────────────────────────────────────────────
  digestFromEmail: process.env.DIGEST_FROM_EMAIL ?? "digest@tradegateway.gov.ng",
  digestRecipients: (process.env.DIGEST_RECIPIENTS ?? "").split(",").filter(Boolean),

  // ─── gRPC Service Addresses ───────────────────────────────────────────────
  declarationGrpcAddr: process.env.DECLARATION_GRPC_ADDR ?? "localhost:50051",
  riskEngineGrpcAddr: process.env.RISK_ENGINE_GRPC_ADDR ?? "localhost:50052",
  paymentGrpcAddr: process.env.PAYMENT_GRPC_ADDR ?? "localhost:50053",
  cargoTrackingGrpcAddr: process.env.CARGO_TRACKING_GRPC_ADDR ?? "localhost:50054",
  documentVaultGrpcAddr: process.env.DOCUMENT_VAULT_GRPC_ADDR ?? "localhost:50055",
  profileGrpcAddr: process.env.PROFILE_GRPC_ADDR ?? "localhost:50056",
  bondedWarehouseGrpcAddr: process.env.BONDED_WAREHOUSE_GRPC_ADDR ?? "localhost:50057",
  auditSvcGrpcAddr: process.env.AUDIT_SVC_GRPC_ADDR ?? "localhost:50058",
  workflowEngineGrpcAddr: process.env.WORKFLOW_ENGINE_GRPC_ADDR ?? "localhost:50059",
  keycloakProxyGrpcAddr: process.env.KEYCLOAK_PROXY_GRPC_ADDR ?? "localhost:50060",
  openctiProxyGrpcAddr: process.env.OPENCTI_PROXY_GRPC_ADDR ?? "localhost:50061",
  wazuhProxyGrpcAddr: process.env.WAZUH_PROXY_GRPC_ADDR ?? "localhost:50062",
  kubecostProxyGrpcAddr: process.env.KUBECOST_PROXY_GRPC_ADDR ?? "localhost:50063",

  // ─── Microservice HTTP URLs (match docker-compose port assignments) ─────────
  // Go microservices
  declarationServiceUrl: process.env.DECLARATION_SERVICE_URL ?? "http://localhost:8083",
  paymentServiceUrl: process.env.PAYMENT_SERVICE_URL ?? "http://localhost:8082",
  ogaServiceUrl: process.env.OGA_SERVICE_URL ?? "http://localhost:8084",
  analyticsServiceUrl: process.env.ANALYTICS_SERVICE_URL ?? "http://localhost:8085",
  profileServiceUrl: process.env.PROFILE_SERVICE_URL ?? "http://localhost:8097",
  // KNOWN COLLISION: compose risk-engine binds 8087, but PORTS.keycloakSvc is
  // the canonical owner of 8087 (Go keycloak-svc bind default). The gateway
  // default is moved to the deliberately-unassigned 8112 — set RISK_ENGINE_URL
  // explicitly (compose: http://risk-engine:8087); a contested default would
  // silently route risk scoring to the Keycloak admin service or vice versa.
  riskEngineUrl: process.env.RISK_ENGINE_URL ?? "http://localhost:8112",
  cargoTrackingServiceUrl: process.env.CARGO_TRACKING_SERVICE_URL ?? "http://localhost:8088",
  sanctionsServiceUrl: process.env.SANCTIONS_SERVICE_URL ?? "http://localhost:8089",
  temporalWorkerUrl: process.env.TEMPORAL_WORKER_URL ?? "http://localhost:8090",
  // Python microservices
  anomalyDetectionUrl: process.env.ANOMALY_DETECTION_URL ?? "http://localhost:8091",
  gnnRiskUrl: process.env.GNN_RISK_URL ?? "http://localhost:8092",
  // KNOWN COLLISION: compose hs-classifier binds 8093, but PORTS.cenService
  // is the canonical owner of 8093 (Go cen-service bind default; P0-7
  // renumber). The gateway default is moved to the deliberately-unassigned
  // 8111 — set HS_CLASSIFIER_URL explicitly (compose:
  // http://hs-classifier:8093). A contested default would silently route HS
  // classification to the WCO CEN service or vice versa (duty-relevant).
  // NOTE: routers/insiderThreat.ts reads HS_CLASSIFIER_URL with its own stale
  // http://hs-classifier:8090 literal — KNOWN STRAGGLER, flagged.
  hsClassifierUrl: process.env.HS_CLASSIFIER_URL ?? "http://localhost:8111",
  riskAiUrl: process.env.RISK_AI_URL ?? "http://localhost:8094",
  visionSvcUrl: process.env.VISION_SVC_URL ?? "http://localhost:8095",
  // KNOWN COLLISION: compose fluvio-consumer binds 8096, whose canonical
  // owner per PORTS is asean-sw-service (Go bind default). Default moved to
  // the deliberately-unassigned 8114 — set FLUVIO_CONSUMER_URL explicitly.
  fluvioConsumerUrl: process.env.FLUVIO_CONSUMER_URL ?? "http://localhost:8114",

  // ─── App Version ──────────────────────────────────────────────────────────
  appVersion: process.env.APP_VERSION ?? "1.0.0",
};

// ─── Production validation — fail closed on unsafe configuration ─────────────

function isUnsafeProductionEndpoint(value: string): boolean {
  return value.split(",").some((rawEndpoint) => {
    const endpoint = rawEndpoint.trim();
    if (!endpoint) return false;
    try {
      const hostname = endpoint.includes("://")
        ? new URL(endpoint).hostname
        : endpoint.replace(/^\[/, "").split("]")[0].split(":")[0];
      return ["localhost", "127.0.0.1", "0.0.0.0", "::1"].includes(hostname.toLowerCase());
    } catch {
      // Fail closed when an endpoint cannot be parsed as either a URL or host:port.
      return true;
    }
  });
}

/**
 * Known development placeholder values that must NEVER pass production
 * validation (SW-MP14). A secret set to one of these is worse than unset
 * because it looks configured while being publicly known.
 */
const KNOWN_DEV_SECRET_VALUES: Record<string, string[]> = {
  REDIS_PASSWORD: ["tradegateway_redis_2026"],
  REDIS_URL: ["redis://:tradegateway_redis_2026@localhost:6379"],
  JWT_SECRET: ["dev-secret", "changeme", "secret", "password", "tradegateway-jwt-dev"],
  API_KEY_HASH_SECRET: ["dev-secret", "changeme", "secret", "password"],
  KEYCLOAK_CLIENT_SECRET: ["dev-secret", "changeme", "secret", "password", "admin"],
  PERMIFY_API_KEY: ["dev-secret", "changeme", "secret", "password", "key1"],
};

/**
 * Rejects missing secrets and local/default endpoints before a production process
 * can serve traffic. Tests and local development retain explicit local defaults.
 */
export function validateProductionConfig(config = ENV): void {
  const required: [string, string][] = [
    ["DATABASE_URL", config.databaseUrl],
    ["JWT_SECRET", config.cookieSecret],
    ["API_KEY_HASH_SECRET or JWT_SECRET", config.apiKeyHashSecret || config.cookieSecret],
    ["KEYCLOAK_URL", config.keycloakUrl],
    ["KEYCLOAK_CLIENT_SECRET", config.keycloakClientSecret],
    ["KEYCLOAK_TOKEN_AUDIENCE", config.keycloakTokenAudience],
    ["CADDY_ASK_SECRET", config.caddyAskSecret],
    // PRA-012: money-rail service-to-service auth (TigerBeetle bridge hops).
    ["TB_BRIDGE_CLIENT_ID", config.tbBridgeClientId],
    ["TB_BRIDGE_CLIENT_SECRET", config.tbBridgeClientSecret],
    ["PERMIFY_URL", config.permifyUrl],
    ["PERMIFY_API_KEY", config.permifyApiKey],
    ["REDIS_URL", config.redisUrl],
    ["REDIS_PASSWORD", config.redisPassword],
    ["MOJALOOP_URL", config.mojaloopUrl],
    ["TARIFF_SERVICE_URL", config.tariffServiceUrl],
    ["PORT_INTEROP_URL", config.portInteropUrl],
    ["TEMPORAL_ADDRESS", config.temporalAddress],
    ["TIGERBEETLE_ADDRESSES", config.tigerBeetleAddresses.join(",")],
  ];
  const missing = required.filter(([, value]) => !value.trim()).map(([name]) => name);

  // SW-MP14: reject known development secret values even though they are non-empty.
  const configByEnvVar: Record<string, string> = {
    REDIS_PASSWORD: config.redisPassword,
    REDIS_URL: config.redisUrl,
    JWT_SECRET: config.cookieSecret,
    API_KEY_HASH_SECRET: config.apiKeyHashSecret,
    KEYCLOAK_CLIENT_SECRET: config.keycloakClientSecret,
    PERMIFY_API_KEY: config.permifyApiKey,
  };
  const knownDevValues = Object.entries(KNOWN_DEV_SECRET_VALUES)
    .filter(([envVar, devValues]) => {
      const actual = (configByEnvVar[envVar] ?? "").trim();
      return actual !== "" && devValues.includes(actual);
    })
    .map(([envVar]) => envVar);
  const unsafeEndpoints = [
    ["DATABASE_URL", config.databaseUrl],
    ["KEYCLOAK_URL", config.keycloakUrl],
    ["PERMIFY_URL", config.permifyUrl],
    ["REDIS_URL", config.redisUrl],
    ["MOJALOOP_URL", config.mojaloopUrl],
    ["TARIFF_SERVICE_URL", config.tariffServiceUrl],
    ["PORT_INTEROP_URL", config.portInteropUrl],
    ["TEMPORAL_ADDRESS", config.temporalAddress],
    ["TIGERBEETLE_ADDRESSES", config.tigerBeetleAddresses.join(",")],
  ].filter(([, value]) => isUnsafeProductionEndpoint(value)).map(([name]) => name);

  if (missing.length || unsafeEndpoints.length || knownDevValues.length) {
    const details = [
      missing.length ? `missing: ${missing.join(", ")}` : "",
      unsafeEndpoints.length ? `unsafe local endpoint: ${unsafeEndpoints.join(", ")}` : "",
      knownDevValues.length ? `known dev placeholder value: ${knownDevValues.join(", ")}` : "",
    ].filter(Boolean).join("; ");
    throw new Error(`[ENV] Production configuration rejected (${details}).`);
  }
}

if (ENV.isProduction) validateProductionConfig();

// ─── Service-URL collision validation (SW-CLOSE / PRA-067) ───────────────────
// Inter-service base URLs whose RESOLVED values must never share a host:port.
// Two gateway clients resolving to the same host:port for different services
// is exactly the PRA-067 defect class: miswired clients boot "healthy" and
// route duty/risk/ledger calls to the wrong service. We refuse to boot
// instead (fail-closed). Endpoint-path URLs of a single logical service
// (NIMC OAuth endpoints on api.nimc.gov.ng, KEYCLOAK_TOKEN_URL on the
// Keycloak origin) are deliberately NOT in this list — sharing an origin
// with their own service is correct. Non-URL values and empty strings
// (e.g. an unset TARIFF_SERVICE_URL) are skipped here; their own
// fail-closed paths handle them.
const SERVICE_URL_ENV_VARS: [string, (config: typeof ENV) => string][] = [
  ["KEYCLOAK_URL", (c) => c.keycloakUrl],
  ["KEYCLOAK_SVC_URL", (c) => c.keycloakSvcUrl],
  ["PERMIFY_URL", (c) => c.permifyUrl],
  ["APISIX_ADMIN_URL", (c) => c.apisixAdminUrl],
  ["WAZUH_API_URL", (c) => c.wazuhApiUrl],
  ["OPENCTI_URL", (c) => c.openctiUrl],
  ["KUBOCOST_URL", (c) => c.kubecostUrl],
  ["ASEAN_SW_SERVICE_URL", (c) => c.aseanSwServiceUrl],
  ["FREEZONE_SERVICE_URL", (c) => c.freeZoneServiceUrl],
  ["CEN_SERVICE_URL", (c) => c.cenServiceUrl],
  ["TB_BRIDGE_URL", (c) => c.tbBridgeUrl],
  ["FLUVIO_SVC_URL", (c) => c.fluvioSvcUrl],
  ["FLUVIO_WS_URL", (c) => c.fluvioWsUrl],
  ["DELTALAKE_SVC_URL", (c) => c.deltaLakeSvcUrl],
  ["FLINK_CEP_SVC_URL", (c) => c.flinkCepSvcUrl],
  ["SEDONA_SVC_URL", (c) => c.sedonaSvcUrl],
  ["RUSTFS_SVC_URL", (c) => c.rustFsSvcUrl],
  ["GRAPH_BRIDGE_URL", (c) => c.graphBridgeUrl],
  ["RISK_SCORER_URL", (c) => c.riskScorerUrl],
  ["PAYMENT_RISK_URL", (c) => c.paymentRiskUrl],
  ["VISION_SERVICE_URL", (c) => c.visionServiceUrl],
  ["WAREHOUSE_SERVICE_URL", (c) => c.warehouseServiceUrl],
  ["MOJALOOP_URL", (c) => c.mojaloopUrl],
  ["TARIFF_SERVICE_URL", (c) => c.tariffServiceUrl],
  ["PORT_INTEROP_URL", (c) => c.portInteropUrl],
  ["DECLARATION_SERVICE_URL", (c) => c.declarationServiceUrl],
  ["PAYMENT_SERVICE_URL", (c) => c.paymentServiceUrl],
  ["OGA_SERVICE_URL", (c) => c.ogaServiceUrl],
  ["ANALYTICS_SERVICE_URL", (c) => c.analyticsServiceUrl],
  ["PROFILE_SERVICE_URL", (c) => c.profileServiceUrl],
  ["RISK_ENGINE_URL", (c) => c.riskEngineUrl],
  ["CARGO_TRACKING_SERVICE_URL", (c) => c.cargoTrackingServiceUrl],
  ["SANCTIONS_SERVICE_URL", (c) => c.sanctionsServiceUrl],
  ["TEMPORAL_WORKER_URL", (c) => c.temporalWorkerUrl],
  ["ANOMALY_DETECTION_URL", (c) => c.anomalyDetectionUrl],
  ["GNN_RISK_URL", (c) => c.gnnRiskUrl],
  ["HS_CLASSIFIER_URL", (c) => c.hsClassifierUrl],
  ["RISK_AI_URL", (c) => c.riskAiUrl],
  ["VISION_SVC_URL", (c) => c.visionSvcUrl],
  ["FLUVIO_CONSUMER_URL", (c) => c.fluvioConsumerUrl],
];

/**
 * Throws when two resolved service URLs share a host:port. Runs at module
 * load (every environment — a collision is a configuration error in dev just
 * as much as in prod) and is exported for tests.
 */
export function assertNoServiceUrlCollisions(config = ENV): void {
  const byHostPort = new Map<string, string[]>();
  for (const [name, read] of SERVICE_URL_ENV_VARS) {
    const value = read(config).trim();
    if (!value) continue;
    let url: URL;
    try {
      url = new URL(value);
    } catch {
      continue; // unparseable values are rejected by their own validators
    }
    const defaultPort = url.protocol === "https:" || url.protocol === "wss:" ? "443" : "80";
    const hostPort = `${url.hostname.toLowerCase()}:${url.port || defaultPort}`;
    const list = byHostPort.get(hostPort) ?? [];
    list.push(name);
    byHostPort.set(hostPort, list);
  }
  const collisions = [...byHostPort.entries()].filter(([, names]) => names.length > 1);
  if (collisions.length > 0) {
    const details = collisions
      .map(([hostPort, names]) => `${hostPort} ← ${names.join(", ")}`)
      .join("; ");
    throw new Error(
      `[ENV] Service URL collision (${details}). Two gateway clients would resolve to the same ` +
      `host:port for different services — refusing to boot rather than risk misrouted calls ` +
      `(PRA-067). Set explicit distinct URLs per service.`
    );
  }
}

assertNoServiceUrlCollisions();
