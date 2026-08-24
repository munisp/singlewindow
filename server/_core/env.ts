export const ENV = {
  appId: process.env.VITE_APP_ID ?? "",
  cookieSecret: process.env.JWT_SECRET ?? "",
  databaseUrl: process.env.DATABASE_URL ?? "",
  oAuthServerUrl: process.env.OAUTH_SERVER_URL ?? "",
  ownerOpenId: process.env.OWNER_OPEN_ID ?? "",
  isProduction: process.env.NODE_ENV === "production",
  forgeApiUrl: process.env.BUILT_IN_FORGE_API_URL ?? "",
  forgeApiKey: process.env.BUILT_IN_FORGE_API_KEY ?? "",

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
  aseanSwServiceUrl: process.env.ASEAN_SW_SERVICE_URL ?? process.env.ASEAN_SW_URL ?? "http://localhost:8091",
  aseanGatewayGrpcAddr: process.env.ASEAN_GATEWAY_GRPC_ADDR ?? "localhost:50091",

  // ─── Free Zone Service ────────────────────────────────────────────────────
  freeZoneServiceUrl: process.env.FREEZONE_SERVICE_URL ?? "http://localhost:8092",

  // ─── CEN (WCO) Service ────────────────────────────────────────────────────
  cenServiceUrl: process.env.CEN_SERVICE_URL ?? "http://localhost:8093",

  // ─── TigerBeetle Bridge ───────────────────────────────────────────────────
  tbBridgeUrl: process.env.TB_BRIDGE_URL ?? process.env.TB_GO_BRIDGE_HTTP_ADDR ?? "http://localhost:8094",
  tbRustBridgeUrl: process.env.TB_RUST_BRIDGE_HTTP_ADDR ?? "http://localhost:8095",

  // ─── Fluvio Extended ──────────────────────────────────────────────────────
  fluvioSvcUrl: process.env.FLUVIO_SVC_URL ?? "http://localhost:8096",
  fluvioWsUrl: process.env.FLUVIO_WS_URL ?? "ws://localhost:8097",

  // ─── Delta Lake / Flink Analytics ────────────────────────────────────────
  deltaLakeSvcUrl: process.env.DELTALAKE_SVC_URL ?? "http://localhost:8103",
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
  profileServiceUrl: process.env.PROFILE_SERVICE_URL ?? "http://localhost:8086",
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

// ─── Production validation — logs warnings for missing secrets ────────────────
if (ENV.isProduction) {
  const required: [string, string][] = [
    ["JWT_SECRET", ENV.cookieSecret],
    ["KEYCLOAK_CLIENT_SECRET", ENV.keycloakClientSecret],
    ["NIGERIA_ID_CLIENT_ID", ENV.nigeriaIdClientId],
    ["NIGERIA_ID_CLIENT_SECRET", ENV.nigeriaIdClientSecret],
    ["PERMIFY_API_KEY", ENV.permifyApiKey],
    ["SENDGRID_API_KEY", ENV.sendgridApiKey],
    ["REDIS_PASSWORD", ENV.redisPassword],
  ];
  for (const [name, val] of required) {
    if (!val) throw new Error(`[ENV] ${name} is required in production`);
  }
}
