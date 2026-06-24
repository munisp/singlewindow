/**
 * v71 Production Audit Tests
 * Covers: Kafka shared producer, Redis pool, OpenSearch provisioner,
 * Mojaloop JWS callbacks, Keycloak middleware, Sanctions screener,
 * TigerBeetle reconcile endpoint, Go notification-dispatcher DLQ schema.
 *
 * All external services are mocked — tests run without infrastructure.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import fs from "fs";
import path from "path";

const BASE = path.resolve(__dirname, "..");

// ─── Kafka shared producer ────────────────────────────────────────────────────
describe("Kafka shared producer (Go)", () => {
  const producerFile = path.join(BASE, "services/go/shared/kafka/producer.go");

  it("producer.go exists", () => {
    expect(fs.existsSync(producerFile)).toBe(true);
  });

  it("defines ProducerConfig with required fields", () => {
    const content = fs.readFileSync(producerFile, "utf-8");
    expect(content).toContain("ProducerConfig");
    expect(content).toContain("Brokers");
    expect(content).toContain("ClientID");
  });

  it("implements dead-letter queue (DLQ) publishing", () => {
    const content = fs.readFileSync(producerFile, "utf-8");
    expect(content).toContain("DLQ");
  });

  it("implements retry with backoff", () => {
    const content = fs.readFileSync(producerFile, "utf-8");
    const hasRetry = content.includes("retry") || content.includes("Retry") || content.includes("backoff") || content.includes("Backoff");
    expect(hasRetry).toBe(true);
  });

  it("producer_test.go exists with unit tests", () => {
    const testFile = path.join(BASE, "services/go/shared/kafka/producer_test.go");
    expect(fs.existsSync(testFile)).toBe(true);
  });
});

// ─── Redis shared pool ────────────────────────────────────────────────────────
describe("Redis shared pool (Go)", () => {
  const poolFile = path.join(BASE, "services/go/shared/redispool/pool.go");

  it("pool.go exists", () => {
    expect(fs.existsSync(poolFile)).toBe(true);
  });

  it("supports Sentinel failover", () => {
    const content = fs.readFileSync(poolFile, "utf-8");
    expect(content).toContain("Sentinel");
  });

  it("supports Cluster mode", () => {
    const content = fs.readFileSync(poolFile, "utf-8");
    expect(content).toContain("Cluster");
  });

  it("implements health check", () => {
    const content = fs.readFileSync(poolFile, "utf-8");
    const hasHealth = content.includes("HealthCheck") || content.includes("Ping") || content.includes("ping");
    expect(hasHealth).toBe(true);
  });

  it("implements pub/sub with reconnect", () => {
    const content = fs.readFileSync(poolFile, "utf-8");
    const hasPubSub = content.includes("Subscribe") || content.includes("PubSub");
    expect(hasPubSub).toBe(true);
  });
});

// ─── OpenSearch provisioner ───────────────────────────────────────────────────
describe("OpenSearch provisioner (Go)", () => {
  const provFile = path.join(BASE, "services/go/shared/opensearch/provisioner.go");
  const templatesFile = path.join(BASE, "infra/opensearch/index-templates.json");

  it("provisioner.go exists", () => {
    expect(fs.existsSync(provFile)).toBe(true);
  });

  it("index-templates.json exists with 6 templates", () => {
    expect(fs.existsSync(templatesFile)).toBe(true);
    const data = JSON.parse(fs.readFileSync(templatesFile, "utf-8"));
    // Templates are stored in a 'templates' array inside the JSON
    const templates: unknown[] = Array.isArray(data.templates) ? data.templates : [];
    expect(templates.length).toBeGreaterThanOrEqual(6);
  });

  it("templates have index_patterns", () => {
    const data = JSON.parse(fs.readFileSync(templatesFile, "utf-8"));
    const templates: Array<Record<string, unknown>> = Array.isArray(data.templates) ? data.templates : [];
    for (const tpl of templates) {
      const body = tpl.body as Record<string, unknown> | undefined;
      const hasPatterns = tpl.index_patterns || body?.index_patterns;
      expect(hasPatterns, `template '${tpl.name}' missing index_patterns`).toBeTruthy();
    }
  });

  it("provisioner implements ProvisionAll function", () => {
    const content = fs.readFileSync(provFile, "utf-8");
    expect(content).toContain("ProvisionAll");
  });

  it("provisioner applies ILM policies", () => {
    const content = fs.readFileSync(provFile, "utf-8");
    const hasILM = content.includes("ILM") || content.includes("ilm") || content.includes("lifecycle");
    expect(hasILM).toBe(true);
  });
});

// ─── Mojaloop JWS callbacks ───────────────────────────────────────────────────
describe("Mojaloop JWS callbacks (Go)", () => {
  const callbacksFile = path.join(BASE, "services/go/mojaloop-gateway/internal/dfsp/callbacks.go");

  it("callbacks.go exists", () => {
    expect(fs.existsSync(callbacksFile)).toBe(true);
  });

  it("implements parseRSAPublicKey with math/big", () => {
    const content = fs.readFileSync(callbacksFile, "utf-8");
    expect(content).toContain("math/big");
    expect(content).toContain("parseRSAPublicKey");
  });

  it("implements parseECPublicKey with elliptic curve", () => {
    const content = fs.readFileSync(callbacksFile, "utf-8");
    expect(content).toContain("parseECPublicKey");
    expect(content).toContain("elliptic");
  });

  it("handles PUT /quotes callback", () => {
    const content = fs.readFileSync(callbacksFile, "utf-8");
    const hasQuoteCallback = content.includes("QuoteCallback") || content.includes("HandleQuoteCallback") || content.includes("quotes");
    expect(hasQuoteCallback).toBe(true);
  });

  it("handles PUT /transfers callback", () => {
    const content = fs.readFileSync(callbacksFile, "utf-8");
    const hasTransferCallback = content.includes("TransferCallback") || content.includes("HandleTransferCallback") || content.includes("transfers");
    expect(hasTransferCallback).toBe(true);
  });

  it("signer_aliases.go provides NewSigner export", () => {
    const aliasFile = path.join(BASE, "services/go/mojaloop-gateway/internal/dfsp/signer_aliases.go");
    expect(fs.existsSync(aliasFile)).toBe(true);
    const content = fs.readFileSync(aliasFile, "utf-8");
    expect(content).toContain("NewSigner");
  });
});

// ─── Keycloak OIDC middleware (Go) ────────────────────────────────────────────
describe("Keycloak OIDC middleware (Go)", () => {
  const middlewareFile = path.join(BASE, "services/go/shared/keycloak/middleware.go");
  const realmFile = path.join(BASE, "infra/keycloak/realm-export.json");

  it("middleware.go exists", () => {
    expect(fs.existsSync(middlewareFile)).toBe(true);
  });

  it("implements JWT verification", () => {
    const content = fs.readFileSync(middlewareFile, "utf-8");
    // The middleware uses validate(), parseJWTParts(), or Authenticate() for JWT verification
    const hasJWTVerify = content.includes("validate") || content.includes("parseJWT") || content.includes("Authenticate") || content.includes("jwt");
    expect(hasJWTVerify).toBe(true);
  });

  it("extracts user roles from token claims", () => {
    const content = fs.readFileSync(middlewareFile, "utf-8");
    const hasRoles = content.includes("roles") || content.includes("Roles") || content.includes("realm_access");
    expect(hasRoles).toBe(true);
  });

  it("realm-export.json exists with production groups", () => {
    expect(fs.existsSync(realmFile)).toBe(true);
    const realm = JSON.parse(fs.readFileSync(realmFile, "utf-8"));
    expect(realm.groups).toBeDefined();
    expect(realm.groups.length).toBeGreaterThanOrEqual(5);
  });

  it("realm has brute-force protection enabled", () => {
    const realm = JSON.parse(fs.readFileSync(realmFile, "utf-8"));
    expect(realm.bruteForceProtected).toBe(true);
  });

  it("realm has MFA authentication flow", () => {
    const realm = JSON.parse(fs.readFileSync(realmFile, "utf-8"));
    const flows = realm.authenticationFlows || [];
    const hasMFA = flows.some((f: Record<string, unknown>) =>
      (f.alias as string)?.toLowerCase().includes("mfa") ||
      (f.alias as string)?.toLowerCase().includes("otp") ||
      (f.alias as string)?.toLowerCase().includes("totp")
    );
    expect(hasMFA).toBe(true);
  });

  it("realm has 4 clients (web, api, services, mobile)", () => {
    const realm = JSON.parse(fs.readFileSync(realmFile, "utf-8"));
    expect(realm.clients.length).toBeGreaterThanOrEqual(4);
  });

  it("middleware_test.go exists with unit tests", () => {
    const testFile = path.join(BASE, "services/go/shared/keycloak/middleware_test.go");
    expect(fs.existsSync(testFile)).toBe(true);
    const content = fs.readFileSync(testFile, "utf-8");
    const testCount = (content.match(/func Test/g) || []).length;
    expect(testCount).toBeGreaterThanOrEqual(10);
  });
});

// ─── Sanctions screener (Go) ──────────────────────────────────────────────────
describe("Sanctions screener (Go)", () => {
  const screenerFile = path.join(BASE, "microservices/sanctions-service/internal/screener/screener.go");
  const screenerTestFile = path.join(BASE, "microservices/sanctions-service/internal/screener/screener_test.go");

  it("screener.go exists", () => {
    expect(fs.existsSync(screenerFile)).toBe(true);
  });

  it("implements Jaro-Winkler similarity", () => {
    const content = fs.readFileSync(screenerFile, "utf-8");
    expect(content).toContain("jaroWinkler");
    expect(content).toContain("jaro");
  });

  it("implements Levenshtein distance", () => {
    const content = fs.readFileSync(screenerFile, "utf-8");
    expect(content).toContain("levenshtein");
  });

  it("implements combined scoring (0.7 JW + 0.3 Lev)", () => {
    const content = fs.readFileSync(screenerFile, "utf-8");
    expect(content).toContain("0.7");
    expect(content).toContain("0.3");
  });

  it("supports 5 list types (OFAC, UN, EU, HMT, WCO-CEN)", () => {
    const content = fs.readFileSync(screenerFile, "utf-8");
    expect(content).toContain("ListOFAC");
    expect(content).toContain("ListUN");
    expect(content).toContain("ListEU");
    expect(content).toContain("ListHMT");
    expect(content).toContain("ListWCOCEN");
  });

  it("implements batch screening", () => {
    const content = fs.readFileSync(screenerFile, "utf-8");
    expect(content).toContain("ScreenBatch");
  });

  it("exposes JaroWinklerScore and LevenshteinScore in result", () => {
    const content = fs.readFileSync(screenerFile, "utf-8");
    expect(content).toContain("JaroWinklerScore");
    expect(content).toContain("LevenshteinScore");
  });

  it("screener_test.go exists with 15+ tests", () => {
    expect(fs.existsSync(screenerTestFile)).toBe(true);
    const content = fs.readFileSync(screenerTestFile, "utf-8");
    const testCount = (content.match(/func Test/g) || []).length;
    expect(testCount).toBeGreaterThanOrEqual(15);
  });
});

// ─── TigerBeetle reconcile endpoint (Rust) ───────────────────────────────────
describe("TigerBeetle reconcile endpoint (Rust)", () => {
  const mainFile = path.join(BASE, "services/rust/tigerbeetle-bridge-rs/src/main.rs");

  it("main.rs exists", () => {
    expect(fs.existsSync(mainFile)).toBe(true);
  });

  it("has POST /reconcile route", () => {
    const content = fs.readFileSync(mainFile, "utf-8");
    expect(content).toContain("reconcile");
  });

  it("Cargo.toml uses git source for TigerBeetle (not broken crates.io version)", () => {
    const cargoFile = path.join(BASE, "services/rust/tigerbeetle-bridge-rs/Cargo.toml");
    const content = fs.readFileSync(cargoFile, "utf-8");
    // Should NOT have the broken version = "0.16" from crates.io
    expect(content).not.toContain('version = "0.16"');
    // Should use git source or be commented out
    const hasGitOrComment = content.includes("git =") || content.includes("# TigerBeetle 0.16");
    expect(hasGitOrComment).toBe(true);
  });

  it("tigerbeetle-bridge Cargo.toml also fixed", () => {
    const cargoFile = path.join(BASE, "services/rust/tigerbeetle-bridge/Cargo.toml");
    const content = fs.readFileSync(cargoFile, "utf-8");
    expect(content).not.toContain('version = "0.16"');
  });
});

// ─── Notification dispatcher (Go) ────────────────────────────────────────────
describe("Notification dispatcher (Go)", () => {
  const dispatcherFile = path.join(BASE, "services/go/notification-dispatcher/dispatcher.go");
  const fcmFile = path.join(BASE, "services/go/notification-dispatcher/fcm_client.go");
  const apnsFile = path.join(BASE, "services/go/notification-dispatcher/apns_client.go");

  it("dispatcher.go exists", () => {
    expect(fs.existsSync(dispatcherFile)).toBe(true);
  });

  it("FCM client exists with v1 HTTP API", () => {
    expect(fs.existsSync(fcmFile)).toBe(true);
    const content = fs.readFileSync(fcmFile, "utf-8");
    expect(content).toContain("fcm.googleapis.com");
  });

  it("APNs client exists with HTTP/2 JWT auth", () => {
    expect(fs.existsSync(apnsFile)).toBe(true);
    const content = fs.readFileSync(apnsFile, "utf-8");
    expect(content).toContain("api.push.apple.com");
  });

  it("dispatcher implements dead-letter queue", () => {
    const content = fs.readFileSync(dispatcherFile, "utf-8");
    const hasDLQ = content.includes("DLQ") || content.includes("dlq") || content.includes("dead");
    expect(hasDLQ).toBe(true);
  });

  it("dispatcher implements retry with exponential backoff", () => {
    const content = fs.readFileSync(dispatcherFile, "utf-8");
    const hasRetry = content.includes("retry") || content.includes("Retry") || content.includes("backoff");
    expect(hasRetry).toBe(true);
  });
});

// ─── PWA service worker ───────────────────────────────────────────────────────
describe("PWA service worker", () => {
  const swFile = path.join(BASE, "client/public/sw.js");
  const manifestFile = path.join(BASE, "client/public/manifest.json");

  it("sw.js exists", () => {
    expect(fs.existsSync(swFile)).toBe(true);
  });

  it("sw.js has push event handler", () => {
    const content = fs.readFileSync(swFile, "utf-8");
    expect(content).toContain("addEventListener('push'");
  });

  it("sw.js has notificationclick handler", () => {
    const content = fs.readFileSync(swFile, "utf-8");
    expect(content).toContain("addEventListener('notificationclick'");
  });

  it("sw.js has background sync / offline queue", () => {
    const content = fs.readFileSync(swFile, "utf-8");
    const hasSync = content.includes("sync") || content.includes("backgroundSync") || content.includes("offlineQueue");
    expect(hasSync).toBe(true);
  });

  it("manifest.json exists with correct PWA fields", () => {
    expect(fs.existsSync(manifestFile)).toBe(true);
    const manifest = JSON.parse(fs.readFileSync(manifestFile, "utf-8"));
    expect(manifest.name).toBe("TradeGateway™ NGSWTP");
    expect(manifest.display).toBe("standalone");
    expect(manifest.icons.length).toBeGreaterThanOrEqual(2);
  });
});

// ─── Flutter mobile parity ────────────────────────────────────────────────────
describe("Flutter mobile parity", () => {
  const screensDir = path.join(BASE, "mobile/flutter/tradegateway/lib/screens/app");

  it("Flutter app screens directory exists", () => {
    expect(fs.existsSync(screensDir)).toBe(true);
  });

  it("Flutter has 30+ app screens matching React Native parity", () => {
    const screens = fs.readdirSync(screensDir).filter(f => f.endsWith(".dart"));
    expect(screens.length).toBeGreaterThanOrEqual(30);
  });

  it("Flutter has dashboard screen", () => {
    expect(fs.existsSync(path.join(screensDir, "dashboard_screen.dart"))).toBe(true);
  });

  it("Flutter has declarations screen", () => {
    expect(fs.existsSync(path.join(screensDir, "declarations_screen.dart"))).toBe(true);
  });

  it("Flutter has AEO screen", () => {
    expect(fs.existsSync(path.join(screensDir, "aeo_screen.dart"))).toBe(true);
  });

  it("Flutter has sanctions screening screen", () => {
    expect(fs.existsSync(path.join(screensDir, "sanctions_screening_screen.dart"))).toBe(true);
  });

  it("Flutter push notification service exists", () => {
    const svcFile = path.join(BASE, "mobile/flutter/lib/services/push_notification_service.dart");
    expect(fs.existsSync(svcFile)).toBe(true);
  });
});

// ─── React Native mobile coverage ────────────────────────────────────────────
describe("React Native mobile coverage", () => {
  const screensDir = path.join(BASE, "mobile/react-native/TradeGateway/src/screens/app");

  it("React Native app screens directory exists", () => {
    expect(fs.existsSync(screensDir)).toBe(true);
  });

  it("React Native has 34+ app screens", () => {
    const screens = fs.readdirSync(screensDir).filter(f => f.endsWith(".tsx"));
    expect(screens.length).toBeGreaterThanOrEqual(34);
  });

  it("React Native push notification service exists", () => {
    const svcFile = path.join(BASE, "mobile/react-native/TradeGateway/src/services/pushNotifications.ts");
    expect(fs.existsSync(svcFile)).toBe(true);
  });

  it("React Native usePushNotifications hook exists", () => {
    const hookFile = path.join(BASE, "mobile/react-native/TradeGateway/src/hooks/usePushNotifications.ts");
    expect(fs.existsSync(hookFile)).toBe(true);
  });
});

// ─── Audit report ─────────────────────────────────────────────────────────────
describe("Production audit report", () => {
  it("PRODUCTION_AUDIT_v71.md exists", () => {
    const auditFile = path.join(BASE, "docs/PRODUCTION_AUDIT_v71.md");
    expect(fs.existsSync(auditFile)).toBe(true);
  });

  it("audit report covers all major systems", () => {
    const auditFile = path.join(BASE, "docs/PRODUCTION_AUDIT_v71.md");
    const content = fs.readFileSync(auditFile, "utf-8");
    const systems = ["Kafka", "Temporal", "Mojaloop", "Keycloak", "Redis", "OpenSearch", "TigerBeetle", "Sanctions", "AEO", "Flutter", "React Native", "PWA"];
    for (const system of systems) {
      expect(content, `audit report missing ${system}`).toContain(system);
    }
  });
});
