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
  redisUrl: process.env.REDIS_URL ?? "redis://:tradegateway_redis_2026@localhost:6379",
  redisPassword: process.env.REDIS_PASSWORD ?? "tradegateway_redis_2026",

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
  aseanSwServiceUrl: process.env.ASEAN_SW_SERVICE_URL ?? process.env.ASEAN_SW_URL ?? "http://localhost:8096", // asean-sw-service bind default
  aseanGatewayGrpcAddr: process.env.ASEAN_GATEWAY_GRPC_ADDR ?? "localhost:50091",

  // ─── Free Zone Service ────────────────────────────────────────────────────
  freeZoneServiceUrl: process.env.FREEZONE_SERVICE_URL ?? "http://localhost:8098", // freezone-service bind default

  // ─── CEN (WCO) Service ────────────────────────────────────────────────────
  cenServiceUrl: process.env.CEN_SERVICE_URL ?? "http://localhost:8093",

  // ─── TigerBeetle Bridge ───────────────────────────────────────────────────
  // SW-MP8/MP9: the canonical money-rail bridge is the Go service on 8086
  // (HTTP /api/ledger/*). The old 8094 default was stale, and the Rust
  // bridge alias was removed entirely (dev-only per SW-A/SW-O3).
  tbBridgeUrl: process.env.TB_BRIDGE_URL ?? process.env.TB_GO_BRIDGE_HTTP_ADDR ?? `http://localhost:${PORTS.tigerBeetleBridge}`,

  // ─── Fluvio Extended ──────────────────────────────────────────────────────
  fluvioSvcUrl: process.env.FLUVIO_SVC_URL ?? "http://localhost:8096",
  fluvioWsUrl: process.env.FLUVIO_WS_URL ?? "ws://localhost:8097",

  // ─── Delta Lake / Flink Analytics ────────────────────────────────────────
  deltaLakeSvcUrl: process.env.DELTALAKE_SVC_URL ?? "http://localhost:8098",
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

  // ─── Sanctions Webhook ────────────────────────────────────────────────────
  sanctionsWebhookSecret: process.env.SANCTIONS_WEBHOOK_SECRET ?? "",

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
  riskEngineUrl: process.env.RISK_ENGINE_URL ?? "http://localhost:8087",
  cargoTrackingServiceUrl: process.env.CARGO_TRACKING_SERVICE_URL ?? "http://localhost:8088",
  sanctionsServiceUrl: process.env.SANCTIONS_SERVICE_URL ?? "http://localhost:8089",
  temporalWorkerUrl: process.env.TEMPORAL_WORKER_URL ?? "http://localhost:8090",
  // Python microservices
  anomalyDetectionUrl: process.env.ANOMALY_DETECTION_URL ?? "http://localhost:8091",
  gnnRiskUrl: process.env.GNN_RISK_URL ?? "http://localhost:8092",
  hsClassifierUrl: process.env.HS_CLASSIFIER_URL ?? "http://localhost:8093",
  riskAiUrl: process.env.RISK_AI_URL ?? "http://localhost:8094",
  visionSvcUrl: process.env.VISION_SVC_URL ?? "http://localhost:8095",
  fluvioConsumerUrl: process.env.FLUVIO_CONSUMER_URL ?? "http://localhost:8096",

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
    ["PERMIFY_URL", config.permifyUrl],
    ["PERMIFY_API_KEY", config.permifyApiKey],
    ["REDIS_URL", config.redisUrl],
    ["REDIS_PASSWORD", config.redisPassword],
    ["MOJALOOP_URL", config.mojaloopUrl],
    ["TARIFF_SERVICE_URL", config.tariffServiceUrl],
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
