/**
 * grpc-clients.ts — Node.js gRPC client stubs for calling Go microservices
 *
 * The tRPC API server calls these clients to delegate business logic to the
 * specialized Go services. Each client connects to the corresponding gRPC port:
 *   declaration-service: 9081
 *   payment-service:     9082
 *   oga-service:         9083
 *   profile-service:     9084
 *
 * In development, the Go services may not be running — all clients gracefully
 * fall back to direct DB operations in that case.
 */

import * as grpc from "@grpc/grpc-js";
import * as protoLoader from "@grpc/proto-loader";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROTO_DIR = path.resolve(__dirname, "../services/proto");

// ─── SERVICE ADDRESSES ────────────────────────────────────────────────────────

const DECLARATION_GRPC = process.env.DECLARATION_GRPC_ADDR || "localhost:9081";
const PAYMENT_GRPC = process.env.PAYMENT_GRPC_ADDR || "localhost:9082";
const OGA_GRPC = process.env.OGA_GRPC_ADDR || "localhost:9083";
const PROFILE_GRPC = process.env.PROFILE_GRPC_ADDR || "localhost:9084";

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

export async function checkGRPCHealth(addr: string): Promise<boolean> {
  return new Promise((resolve) => {
    const channel = new grpc.Channel(addr, grpc.credentials.createInsecure(), {});
    const deadline = new Date();
    deadline.setSeconds(deadline.getSeconds() + 2);
    channel.watchConnectivityState(
      grpc.connectivityState.IDLE,
      deadline,
      (err) => {
        channel.close();
        resolve(!err);
      }
    );
    channel.getConnectivityState(true);
    setTimeout(() => {
      try { channel.close(); } catch { /* ignore */ }
      resolve(false);
    }, 2000);
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

export async function getServiceHealthSummary(): Promise<Record<string, boolean>> {
  const [decl, pay, oga, prof] = await Promise.allSettled([
    checkGRPCHealth(DECLARATION_GRPC),
    checkGRPCHealth(PAYMENT_GRPC),
    checkGRPCHealth(OGA_GRPC),
    checkGRPCHealth(PROFILE_GRPC),
  ]);

  return {
    "declaration-service": decl.status === "fulfilled" ? decl.value : false,
    "payment-service": pay.status === "fulfilled" ? pay.value : false,
    "oga-service": oga.status === "fulfilled" ? oga.value : false,
    "profile-service": prof.status === "fulfilled" ? prof.value : false,
  };
}
