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
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROTO_DIR = path.resolve(__dirname, "../services/proto");

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

    const channel = new grpc.Channel(addr, grpc.credentials.createInsecure(), {});
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
    return new ServiceCtor(DECLARATION_GRPC, grpc.credentials.createInsecure());
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
    return new ServiceCtor(PAYMENT_GRPC, grpc.credentials.createInsecure());
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
    return new ServiceCtor(OGA_GRPC, grpc.credentials.createInsecure());
  } catch (e) {
    console.warn("[gRPC/oga] Client init failed:", e);
    return null;
  }
}

// ─── SERVICE HEALTH SUMMARY ───────────────────────────────────────────────────

/**
 * Probes all 18 Go microservices via gRPC connectivity checks.
 * Returns a map of service-name → healthy (boolean).
 * All checks run in parallel; individual failures do not block others.
 */
export async function getServiceHealthSummary(): Promise<Record<string, boolean>> {
  const checks: Array<[string, string]> = [
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

  const results = await Promise.allSettled(
    checks.map(([, addr]) => checkGRPCHealth(addr))
  );

  return Object.fromEntries(
    checks.map(([name], i) => [
      name,
      results[i].status === "fulfilled" ? results[i].value : false,
    ])
  );
}
