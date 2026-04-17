/**
 * TradeGateway™ NGSWTP — Shared Production Configuration
 *
 * All service URLs, ports, and constants are defined here with sensible defaults.
 * Override any value via environment variables in production.
 *
 * This file is imported by both server and client code (client only uses VITE_ prefixed vars).
 */

// ─── Application Identity ─────────────────────────────────────────────────────
export const APP_NAME = "TradeGateway™ NGSWTP";
export const APP_VERSION = process.env.APP_VERSION ?? "1.0.0";
export const APP_DESCRIPTION = "Next-Generation Single Window Trade Platform";

// ─── PostgreSQL ───────────────────────────────────────────────────────────────
export const POSTGRES_DEFAULT_URL = "postgresql://tradegateway:tradegateway_secure_2026@localhost:5432/tradegateway";
export const POSTGRES_POOL_MAX = parseInt(process.env.POSTGRES_POOL_MAX ?? "20");
export const POSTGRES_POOL_IDLE_TIMEOUT_MS = parseInt(process.env.POSTGRES_POOL_IDLE_TIMEOUT_MS ?? "30000");
export const POSTGRES_POOL_CONNECTION_TIMEOUT_MS = parseInt(process.env.POSTGRES_POOL_CONNECTION_TIMEOUT_MS ?? "5000");

// ─── Redis ────────────────────────────────────────────────────────────────────
export const REDIS_HOST = process.env.REDIS_HOST ?? "localhost";
export const REDIS_PORT = parseInt(process.env.REDIS_PORT ?? "6379");
export const REDIS_PASSWORD = process.env.REDIS_PASSWORD ?? "tradegateway_redis_2026";
export const REDIS_URL = process.env.REDIS_URL ?? `redis://:${REDIS_PASSWORD}@${REDIS_HOST}:${REDIS_PORT}`;
export const REDIS_KEY_PREFIX = "tg:";
export const REDIS_SESSION_TTL_SECONDS = 86400; // 24 hours
export const REDIS_RATE_LIMIT_WINDOW_MS = 60_000; // 1 minute
export const REDIS_RATE_LIMIT_MAX_REQUESTS = 100;

// ─── TigerBeetle ─────────────────────────────────────────────────────────────
export const TIGERBEETLE_BRIDGE_HOST = process.env.TIGERBEETLE_BRIDGE_HOST ?? "localhost";
export const TIGERBEETLE_BRIDGE_PORT = parseInt(process.env.TIGERBEETLE_BRIDGE_PORT ?? "8200");
export const TIGERBEETLE_BRIDGE_URL = `http://${TIGERBEETLE_BRIDGE_HOST}:${TIGERBEETLE_BRIDGE_PORT}`;

// ─── Temporal ─────────────────────────────────────────────────────────────────
export const TEMPORAL_HOST = process.env.TEMPORAL_HOST ?? "localhost";
export const TEMPORAL_PORT = parseInt(process.env.TEMPORAL_PORT ?? "7233");
export const TEMPORAL_NAMESPACE = process.env.TEMPORAL_NAMESPACE ?? "tradegateway";
export const TEMPORAL_TASK_QUEUE = process.env.TEMPORAL_TASK_QUEUE ?? "tradegateway-main";

// ─── Kafka ────────────────────────────────────────────────────────────────────
export const KAFKA_BROKERS = (process.env.KAFKA_BROKERS ?? "localhost:9092").split(",");
export const KAFKA_CLIENT_ID = process.env.KAFKA_CLIENT_ID ?? "tradegateway-server";
export const KAFKA_GROUP_ID = process.env.KAFKA_GROUP_ID ?? "tradegateway-consumers";
export const KAFKA_REST_PORT = parseInt(process.env.KAFKA_REST_PORT ?? "8082");

// ─── Permify ──────────────────────────────────────────────────────────────────
export const PERMIFY_HOST = process.env.PERMIFY_HOST ?? "localhost";
export const PERMIFY_PORT = parseInt(process.env.PERMIFY_PORT ?? "3476");
export const PERMIFY_URL = `http://${PERMIFY_HOST}:${PERMIFY_PORT}`;
export const PERMIFY_TENANT_ID = process.env.PERMIFY_TENANT_ID ?? "tradegateway";

// ─── Wazuh SIEM ───────────────────────────────────────────────────────────────
export const WAZUH_HOST = process.env.WAZUH_HOST ?? "localhost";
export const WAZUH_PORT = parseInt(process.env.WAZUH_PORT ?? "55000");
export const WAZUH_URL = process.env.WAZUH_URL ?? `https://${WAZUH_HOST}:${WAZUH_PORT}`;
export const WAZUH_USERNAME = process.env.WAZUH_USERNAME ?? "wazuh-api";
export const WAZUH_PASSWORD = process.env.WAZUH_PASSWORD ?? "TradeGateway@Wazuh2026!";
export const WAZUH_INDEXER_URL = process.env.WAZUH_INDEXER_URL ?? "https://localhost:9200";

// ─── OpenCTI Threat Intelligence ─────────────────────────────────────────────
export const OPENCTI_URL = process.env.OPENCTI_URL ?? "http://localhost:8080";
export const OPENCTI_TOKEN = process.env.OPENCTI_TOKEN ?? "opencti-admin-token-2026";

// ─── ASEAN Single Window ──────────────────────────────────────────────────────
export const ASEAN_SW_URL = process.env.ASEAN_SW_URL ?? "http://localhost:8098";
export const ASEAN_SW_API_KEY = process.env.ASEAN_SW_API_KEY ?? "asean-sw-api-key-2026";
export const ASEAN_SW_MEMBER_COUNTRY = process.env.ASEAN_SW_MEMBER_COUNTRY ?? "GH"; // Ghana

// ─── WCO CEN Network ─────────────────────────────────────────────────────────
export const CEN_SERVICE_URL = process.env.CEN_SERVICE_URL ?? "http://localhost:8097";
export const CEN_API_KEY = process.env.CEN_API_KEY ?? "wco-cen-api-key-2026";
export const CEN_MEMBER_CODE = process.env.CEN_MEMBER_CODE ?? "GH"; // Ghana Customs

// ─── Mojaloop ─────────────────────────────────────────────────────────────────
export const MOJALOOP_HOST = process.env.MOJALOOP_HOST ?? "localhost";
export const MOJALOOP_PORT = parseInt(process.env.MOJALOOP_PORT ?? "3001");
export const MOJALOOP_URL = process.env.MOJALOOP_URL ?? `http://${MOJALOOP_HOST}:${MOJALOOP_PORT}`;
export const MOJALOOP_FSPIOP_SOURCE = process.env.MOJALOOP_FSPIOP_SOURCE ?? "tradegateway";

// ─── Apache APISIX ────────────────────────────────────────────────────────────
export const APISIX_ADMIN_URL = process.env.APISIX_ADMIN_URL ?? "http://localhost:9180";
export const APISIX_ADMIN_KEY = process.env.APISIX_ADMIN_KEY ?? "edd1c9f034335f136f87ad84b625c8f1";
export const APISIX_GATEWAY_URL = process.env.APISIX_GATEWAY_URL ?? "http://localhost:9080";

// ─── Keycloak ─────────────────────────────────────────────────────────────────
export const KEYCLOAK_URL = process.env.KEYCLOAK_URL ?? "http://localhost:8180";
export const KEYCLOAK_REALM = process.env.KEYCLOAK_REALM ?? "tradegateway";
export const KEYCLOAK_CLIENT_ID = process.env.KEYCLOAK_CLIENT_ID ?? "tradegateway-app";
export const KEYCLOAK_CLIENT_SECRET = process.env.KEYCLOAK_CLIENT_SECRET ?? "tradegateway-keycloak-secret-2026";

// ─── Fluvio Streaming ─────────────────────────────────────────────────────────
export const FLUVIO_HOST = process.env.FLUVIO_HOST ?? "localhost";
export const FLUVIO_PORT = parseInt(process.env.FLUVIO_PORT ?? "9003");
export const FLUVIO_URL = `http://${FLUVIO_HOST}:${FLUVIO_PORT}`;

// ─── OpenSearch ───────────────────────────────────────────────────────────────
export const OPENSEARCH_URL = process.env.OPENSEARCH_URL ?? "http://localhost:9200";
export const OPENSEARCH_USERNAME = process.env.OPENSEARCH_USERNAME ?? "admin";
export const OPENSEARCH_PASSWORD = process.env.OPENSEARCH_PASSWORD ?? "TradeGateway@OpenSearch2026!";

// ─── Dapr ─────────────────────────────────────────────────────────────────────
export const DAPR_HTTP_PORT = parseInt(process.env.DAPR_HTTP_PORT ?? "3500");
export const DAPR_GRPC_PORT = parseInt(process.env.DAPR_GRPC_PORT ?? "50001");
export const DAPR_APP_ID = process.env.DAPR_APP_ID ?? "tradegateway-api";

// ─── Kubecost ─────────────────────────────────────────────────────────────────
export const KUBECOST_URL = process.env.KUBECOST_URL ?? "http://localhost:9090";

// ─── Rate Limiting ────────────────────────────────────────────────────────────
export const RATE_LIMIT_WINDOW_MS = parseInt(process.env.RATE_LIMIT_WINDOW_MS ?? "60000");
export const RATE_LIMIT_MAX = parseInt(process.env.RATE_LIMIT_MAX ?? "100");
export const RATE_LIMIT_API_MAX = parseInt(process.env.RATE_LIMIT_API_MAX ?? "300");

// ─── File Upload ──────────────────────────────────────────────────────────────
export const MAX_FILE_SIZE_BYTES = parseInt(process.env.MAX_FILE_SIZE_BYTES ?? String(50 * 1024 * 1024)); // 50MB
export const ALLOWED_DOCUMENT_MIME_TYPES = [
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "text/plain",
  "text/csv",
];

// ─── Declaration Processing ───────────────────────────────────────────────────
export const DECLARATION_SLA_GREEN_HOURS = 4;
export const DECLARATION_SLA_YELLOW_HOURS = 24;
export const DECLARATION_SLA_RED_HOURS = 72;
export const DECLARATION_AUTO_APPROVE_RISK_THRESHOLD = 25; // risk score < 25 = auto-approve
export const DECLARATION_RISK_SCORE_RED_THRESHOLD = 70;
export const DECLARATION_RISK_SCORE_YELLOW_THRESHOLD = 40;

// ─── AEO Programme ────────────────────────────────────────────────────────────
export const AEO_RENEWAL_REMINDER_DAYS = 90;
export const AEO_CERTIFICATE_VALIDITY_YEARS = 3;

// ─── Notification Digest ──────────────────────────────────────────────────────
export const NOTIFICATION_DIGEST_DAILY_HOUR_UTC = 7;
export const NOTIFICATION_DIGEST_WEEKLY_DAY = 1; // Monday
export const NOTIFICATION_DIGEST_WEEKLY_HOUR_UTC = 8;

// ─── Cron Schedules ───────────────────────────────────────────────────────────
export const CRON_RISK_SCAN_INTERVAL_MINUTES = 5;
export const CRON_OGA_EXPIRY_CHECK_HOUR_UTC = 6;
export const CRON_SLA_BREACH_INTERVAL_MINUTES = 15;
export const CRON_DOCUMENT_EXPIRY_HOUR_UTC = 3;
export const CRON_PORT_CONGESTION_INTERVAL_MINUTES = 10;
export const CRON_PAYMENT_RECONCILE_HOUR_UTC = 2;
export const CRON_WEEKLY_ANALYTICS_DAY = 1; // Monday
export const CRON_WEEKLY_ANALYTICS_HOUR_UTC = 8;

// ─── Security ─────────────────────────────────────────────────────────────────
export const JWT_ALGORITHM = "HS256";
export const JWT_EXPIRY_SECONDS = 86400; // 24 hours
export const BCRYPT_ROUNDS = 12;
export const CSRF_TOKEN_LENGTH = 32;
export const SESSION_COOKIE_NAME = "tg_session";
export const SESSION_COOKIE_MAX_AGE_MS = 86400 * 1000; // 24 hours

// ─── Pagination ───────────────────────────────────────────────────────────────
export const DEFAULT_PAGE_SIZE = 20;
export const MAX_PAGE_SIZE = 100;

// ─── Geospatial ───────────────────────────────────────────────────────────────
export const DEFAULT_MAP_CENTER_LAT = 5.6037; // Accra, Ghana
export const DEFAULT_MAP_CENTER_LNG = -0.1870;
export const DEFAULT_MAP_ZOOM = 7;

// ─── Compliance ───────────────────────────────────────────────────────────────
export const SANCTIONS_CHECK_PROVIDERS = ["UN", "EU", "OFAC", "UK", "AU"];
export const HS_CODE_VERSION = "2022";
export const WCO_DATA_MODEL_VERSION = "3.10";

// ─── Demo Mode ────────────────────────────────────────────────────────────────
export const DEMO_ADMIN_OPEN_ID = "demo-admin";
export const DEMO_TRADER_OPEN_ID = "demo-trader";
export const DEMO_CUSTOMS_OPEN_ID = "demo-customs";
export const DEMO_OGA_OPEN_ID = "demo-oga";
export const DEMO_SECURITY_OPEN_ID = "demo-security";
export const DEMO_DEVELOPER_OPEN_ID = "demo-developer";
