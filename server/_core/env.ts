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
};

// ─── Production validation — logs warnings for missing secrets ────────────────
if (ENV.isProduction) {
  const required: [string, string][] = [
    ["KEYCLOAK_CLIENT_SECRET", ENV.keycloakClientSecret],
    ["NIGERIA_ID_CLIENT_ID", ENV.nigeriaIdClientId],
    ["NIGERIA_ID_CLIENT_SECRET", ENV.nigeriaIdClientSecret],
    ["PERMIFY_API_KEY", ENV.permifyApiKey],
    ["SENDGRID_API_KEY", ENV.sendgridApiKey],
    ["REDIS_PASSWORD", ENV.redisPassword],
  ];
  for (const [name, val] of required) {
    if (!val) console.warn(`[ENV] WARNING: ${name} is not set in production`);
  }
}
