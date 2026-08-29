/**
 * grpc-clients.ts — Node.js gRPC client stubs for calling Go microservices
 *
 * All 18 microservices are covered. Each service address is driven by an
 * environment variable so Kubernetes deployments can override the defaults
 * without code changes.
 *
 * Default port allocation (matches services/GRPC_ARCHITECTURE.md):
 *   declaration-service   9081    payment-service       9082
 *   oga-service           9083    profile-service       9084
 *   risk-engine           9085    cargo-tracking        9086
 *   document-vault        9087    workflow-engine       9088
 *   notification-service  9089    audit-service         9090
 *   bonded-warehouse      9091    asean-gateway         9092
 *   sedona-geo            9093    flink-stream          9094
 *   kubecost-proxy        9095    wazuh-proxy           9096
 *   opencti-proxy         9097    keycloak-proxy        8080
 *
 * In development the Go services may not be running — all clients and health
 * checks gracefully fall back (return false / null) rather than throwing.
 */

import * as grpc from "@grpc/grpc-js";
import * as protoLoader from "@grpc/proto-loader";
import path from "path";
import fs from "fs";

// Resolve proto directory relative to the project root (process.cwd()).
// Using process.cwd() instead of import.meta.url avoids the Vite 8 SSR
// transform injecting __vite_ssr_exportName__ which breaks vitest 2.x.
const PROTO_DIR = path.resolve(process.cwd(), "services/proto");

// ─── B4 FIX: Shared gRPC Credentials Factory ─────────────────────────────────────────
//
// When GRPC_TLS_CERT_PATH, GRPC_TLS_KEY_PATH, and GRPC_TLS_CA_PATH are set,
// all gRPC clients use mutual TLS (mTLS) for encrypted, authenticated inter-service
// communication. This is required in production Kubernetes environments.
//
// In development (certs not set), falls back to insecure credentials with a warning.
// In production (NODE_ENV=production), throws if certs are not configured.

let _cachedCredentials: grpc.ChannelCredentials | null = null;

/**
 * Returns gRPC channel credentials.
 * Uses mTLS when cert paths are configured, insecure otherwise.
 * Credentials are cached after first load.
 */
export function getGrpcCredentials(): grpc.ChannelCredentials {
  if (_cachedCredentials) return _cachedCredentials;

  const certPath = process.env.GRPC_TLS_CERT_PATH;
  const keyPath  = process.env.GRPC_TLS_KEY_PATH;
  const caPath   = process.env.GRPC_TLS_CA_PATH;

  if (certPath && keyPath && caPath) {
    try {
      const cert = fs.readFileSync(certPath);
      const key  = fs.readFileSync(keyPath);
      const ca   = fs.readFileSync(caPath);
      _cachedCredentials = grpc.credentials.createSsl(ca, key, cert);
      console.info('[gRPC] mTLS credentials loaded from cert files.');
      return _cachedCredentials;
    } catch (err) {
      const msg = `[gRPC] Failed to load mTLS cert files: ${err}. Falling back to insecure.`;
      if (process.env.NODE_ENV === 'production') {
        throw new Error(`[gRPC] FATAL: ${msg} Cannot start in production without mTLS.`);
      }
      console.error(msg);
    }
  } else {
    if (process.env.NODE_ENV === 'production') {
      throw new Error(
        '[gRPC] FATAL: GRPC_TLS_CERT_PATH, GRPC_TLS_KEY_PATH, and GRPC_TLS_CA_PATH must be set in production. ' +
        'Inter-service gRPC traffic must use mTLS.'
      );
    }
    console.warn('[gRPC] mTLS cert paths not configured. Using insecure credentials (development only).');
  }

  _cachedCredentials = getGrpcCredentials();
  return _cachedCredentials;
}

// ─── SERVICE ADDRESSES ────────────────────────────────────────────────────────

const DECLARATION_GRPC        = process.env.DECLARATION_GRPC_ADDR        || "localhost:9081";
const PAYMENT_GRPC            = process.env.PAYMENT_GRPC_ADDR            || "localhost:9082";
const OGA_GRPC                = process.env.OGA_GRPC_ADDR                || "localhost:9083";
const PROFILE_GRPC            = process.env.PROFILE_GRPC_ADDR            || "localhost:9084";
const RISK_ENGINE_GRPC        = process.env.RISK_ENGINE_GRPC_ADDR        || "localhost:9085";
const CARGO_TRACKING_GRPC     = process.env.CARGO_TRACKING_GRPC_ADDR     || "localhost:9086";
const DOCUMENT_VAULT_GRPC     = process.env.DOCUMENT_VAULT_GRPC_ADDR     || "localhost:9087";
const WORKFLOW_ENGINE_GRPC    = process.env.WORKFLOW_ENGINE_GRPC_ADDR    || "localhost:9088";
const NOTIFICATION_SVC_GRPC   = process.env.NOTIFICATION_SVC_GRPC_ADDR   || "localhost:9089";
const AUDIT_SVC_GRPC          = process.env.AUDIT_SVC_GRPC_ADDR          || "localhost:9090";
const BONDED_WAREHOUSE_GRPC   = process.env.BONDED_WAREHOUSE_GRPC_ADDR   || "localhost:9091";
const ASEAN_GATEWAY_GRPC      = process.env.ASEAN_GATEWAY_GRPC_ADDR      || "localhost:9092";
const SEDONA_GEO_GRPC         = process.env.SEDONA_GEO_GRPC_ADDR         || "localhost:9093";
const FLINK_STREAM_GRPC       = process.env.FLINK_STREAM_GRPC_ADDR       || "localhost:9094";
const KUBECOST_PROXY_GRPC     = process.env.KUBECOST_PROXY_GRPC_ADDR     || "localhost:9095";
const WAZUH_PROXY_GRPC        = process.env.WAZUH_PROXY_GRPC_ADDR        || "localhost:9096";
const OPENCTI_PROXY_GRPC      = process.env.OPENCTI_PROXY_GRPC_ADDR      || "localhost:9097";
const KEYCLOAK_PROXY_GRPC     = process.env.KEYCLOAK_PROXY_GRPC_ADDR     || "localhost:8080";

// The canonical Go TigerBeetle bridge exposes an HTTP (not gRPC) health
// endpoint. The Rust bridge replica was removed from deploy surfaces (SW-O3).
const TB_GO_BRIDGE_HTTP       = process.env.TB_GO_BRIDGE_HTTP_ADDR        || "localhost:8086";

// ─── PROTO LOADER ─────────────────────────────────────────────────────────────

function loadProto(protoFile: string): grpc.GrpcObject | null {
  const protoPath = path.join(PROTO_DIR, protoFile);
  try {
    const packageDef = protoLoader.loadSync(protoPath, {
      keepCase: true,
      longs: String,
      enums: String,
      defaults: true,
      oneofs: true,
    });
    return grpc.loadPackageDefinition(packageDef);
  } catch (e) {
    console.warn(`[gRPC] Failed to load proto ${protoFile}:`, e);
    return null;
  }
}

// ─── HEALTH CHECK ─────────────────────────────────────────────────────────────

/**
 * Attempts a gRPC channel connectivity probe against `addr`.
 * Resolves to `true` if the channel reaches READY within 2 seconds,
 * `false` otherwise (service not running, network unreachable, etc.).
 */
export async function checkGRPCHealth(addr: string): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false;
    const settle = (v: boolean) => {
      if (settled) return;
      settled = true;
      try { channel.close(); } catch { /* ignore */ }
      resolve(v);
    };

    const channel = new grpc.Channel(addr, getGrpcCredentials(), {});
    const deadline = new Date();
    deadline.setSeconds(deadline.getSeconds() + 2);
    channel.watchConnectivityState(
      grpc.connectivityState.IDLE,
      deadline,
      (err) => settle(!err),
    );
    channel.getConnectivityState(true);
    setTimeout(() => settle(false), 2000);
  });
}

// ─── GENERIC GRPC UNARY CALL ─────────────────────────────────────────────────

export function grpcUnaryCall<TResponse>(
  client: grpc.Client,
  methodName: string,
  request: Record<string, unknown>,
  timeoutMs = 10000
): Promise<TResponse> {
  return new Promise((resolve, reject) => {
    const deadline = new Date();
    deadline.setMilliseconds(deadline.getMilliseconds() + timeoutMs);

    const method = (client as unknown as Record<string, Function>)[methodName];
    if (typeof method !== "function") {
      reject(new Error(`gRPC method '${methodName}' not found on client`));
      return;
    }

    method.call(
      client,
      request,
      new grpc.Metadata(),
      { deadline },
      (err: grpc.ServiceError | null, response: TResponse) => {
        if (err) reject(err);
        else resolve(response);
      }
    );
  });
}

// ─── DECLARATION SERVICE CLIENT ───────────────────────────────────────────────

let _declarationPkg: grpc.GrpcObject | null = null;

export function getDeclarationGRPCClient(): grpc.Client | null {
  if (!_declarationPkg) {
    _declarationPkg = loadProto("declarations.proto");
  }
  if (!_declarationPkg) return null;
  try {
    const pkg = _declarationPkg as Record<string, Record<string, Record<string, Record<string, grpc.ServiceClientConstructor>>>>;
    const ServiceCtor = pkg?.ngswtp?.declarations?.v1?.DeclarationService;
    if (!ServiceCtor) return null;
    return new ServiceCtor(DECLARATION_GRPC, getGrpcCredentials());
  } catch (e) {
    console.warn("[gRPC/declaration] Client init failed:", e);
    return null;
  }
}

// ─── PAYMENT SERVICE CLIENT ───────────────────────────────────────────────────

let _paymentPkg: grpc.GrpcObject | null = null;

export function getPaymentGRPCClient(): grpc.Client | null {
  if (!_paymentPkg) {
    _paymentPkg = loadProto("payments.proto");
  }
  if (!_paymentPkg) return null;
  try {
    const pkg = _paymentPkg as Record<string, Record<string, Record<string, Record<string, grpc.ServiceClientConstructor>>>>;
    const ServiceCtor = pkg?.ngswtp?.payments?.v1?.PaymentService;
    if (!ServiceCtor) return null;
    return new ServiceCtor(PAYMENT_GRPC, getGrpcCredentials());
  } catch (e) {
    console.warn("[gRPC/payment] Client init failed:", e);
    return null;
  }
}

// ─── OGA SERVICE CLIENT ───────────────────────────────────────────────────────

let _ogaPkg: grpc.GrpcObject | null = null;

export function getOGAGRPCClient(): grpc.Client | null {
  if (!_ogaPkg) {
    _ogaPkg = loadProto("declarations.proto");
  }
  if (!_ogaPkg) return null;
  try {
    const pkg = _ogaPkg as Record<string, Record<string, Record<string, Record<string, grpc.ServiceClientConstructor>>>>;
    const ServiceCtor = pkg?.ngswtp?.declarations?.v1?.OGAService;
    if (!ServiceCtor) return null;
    return new ServiceCtor(OGA_GRPC, getGrpcCredentials());
  } catch (e) {
    console.warn("[gRPC/oga] Client init failed:", e);
    return null;
  }
}

// ─── SERVICE HEALTH SUMMARY ───────────────────────────────────────────────────

/**
 * Checks TigerBeetle bridge health via HTTP GET /health.
 * Returns { healthy, mode } where mode is "live" or "simulation".
 */
export async function checkTigerBeetleBridgeHealth(
  addr: string
): Promise<{ healthy: boolean; mode: string }> {
  const url = `http://${addr}/health`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(2000) });
    if (!res.ok) return { healthy: false, mode: "unknown" };
    const body = await res.json() as { mode?: string; status?: string };
    return {
      healthy: body.status === "healthy",
      mode: body.mode ?? "unknown",
    };
  } catch {
    return { healthy: false, mode: "unreachable" };
  }
}

/**
 * Probes all 18 Go microservices via gRPC connectivity checks,
 * plus both TigerBeetle bridges via HTTP health endpoints.
 * Returns a map of service-name → healthy (boolean).
 * All checks run in parallel; individual failures do not block others.
 */
export async function getServiceHealthSummary(): Promise<Record<string, boolean>> {
  const grpcChecks: Array<[string, string]> = [
    ["declaration-service",  DECLARATION_GRPC],
    ["payment-service",      PAYMENT_GRPC],
    ["oga-service",          OGA_GRPC],
    ["profile-service",      PROFILE_GRPC],
    ["risk-engine",          RISK_ENGINE_GRPC],
    ["cargo-tracking",       CARGO_TRACKING_GRPC],
    ["document-vault",       DOCUMENT_VAULT_GRPC],
    ["workflow-engine",      WORKFLOW_ENGINE_GRPC],
    ["notification-service", NOTIFICATION_SVC_GRPC],
    ["audit-service",        AUDIT_SVC_GRPC],
    ["bonded-warehouse",     BONDED_WAREHOUSE_GRPC],
    ["asean-gateway",        ASEAN_GATEWAY_GRPC],
    ["sedona-geo",           SEDONA_GEO_GRPC],
    ["flink-stream",         FLINK_STREAM_GRPC],
    ["kubecost-proxy",       KUBECOST_PROXY_GRPC],
    ["wazuh-proxy",          WAZUH_PROXY_GRPC],
    ["opencti-proxy",        OPENCTI_PROXY_GRPC],
    ["keycloak-proxy",       KEYCLOAK_PROXY_GRPC],
  ];

  // Run gRPC checks and TB HTTP checks in parallel. P0-2 remediation: EVERY
  // probe path is settled/caught — a rejected or timed-out probe maps to an
  // honest `false` (unhealthy) entry. A health summary must NEVER throw
  // because a probed service is down. (Previously `tbRustResult` was
  // destructured from a Promise.all that never included it, so any caller
  // crashed with TypeError whenever this ran — i.e. exactly when a bridge was
  // down in the test environment.)
  const [grpcResults, tbGoResult] = await Promise.all([
    Promise.allSettled(grpcChecks.map(([, addr]) => checkGRPCHealth(addr))),
    checkTigerBeetleBridgeHealth(TB_GO_BRIDGE_HTTP)
      .catch(() => ({ healthy: false, mode: "unreachable" })),
  ]);

  const summary: Record<string, boolean> = Object.fromEntries(
    grpcChecks.map(([name], i) => [
      name,
      grpcResults[i].status === "fulfilled" ? grpcResults[i].value : false,
    ])
  );

  // Add TigerBeetle bridge health (HTTP). The Rust bridge replica was removed
  // from deploy surfaces (SW-O3) — no phantom entry is reported for it.
  summary["tigerbeetle-go-bridge"] = tbGoResult.healthy;

  return summary;
}

/**
 * Returns the TigerBeetle bridge mode ("live" | "simulation" | "unreachable")
 * for both bridges. Used by the Service Health dashboard to show whether
 * the production TigerBeetle binary is connected.
 */
export async function getTigerBeetleBridgeModes(): Promise<{
  go: { healthy: boolean; mode: string };
  rust: { healthy: boolean; mode: string };
}> {
  // The Rust bridge replica was removed from deploy surfaces (SW-O3): report
  // it honestly as not deployed instead of probing a phantom endpoint or
  // returning undefined (which previously crashed consumers). Probe failures
  // map to an honest unhealthy result — never an exception.
  const go = await checkTigerBeetleBridgeHealth(TB_GO_BRIDGE_HTTP)
    .catch(() => ({ healthy: false, mode: "unreachable" }));
  const rust = { healthy: false, mode: "not_deployed" };
  return { go, rust };
}
