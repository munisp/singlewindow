/**
 * seafarerRegistryClient.ts — config-gated client for the port-interop
 * seafarer/STCW registry (Phase 19, F5a / A5-C5).
 *
 * The port-interoperability service is the SYSTEM OF RECORD for seafarers
 * and STCW certificates (`internal/registry/seafarer.go`). singlewindow
 * consumes exactly one read for the shore-pass workflow:
 *
 *   GET /v1/registry/certificates/verify?certificateNumber=…
 *     → 200 { certificateNumber, outcome: VALID|EXPIRED|SUSPENDED|REVOKED|NOT_FOUND, … }
 *
 * Fail-closed doctrine (mirrors portInteropClient.ts):
 *   - PORT_INTEROP_URL unset/invalid      → PortInteropConfigError
 *     (router surfaces the honest CREW_REGISTRY_NOT_CONFIGURED state — the
 *     application is recorded with verificationStatus=NOT_CONFIGURED and can
 *     NEVER be approved while upstream crew data is unreachable),
 *   - network/timeout/5xx                 → PortInteropUnavailableError,
 *   - 4xx                                 → PortInteropRejectedError,
 *   - 200 with an unrecognised outcome    → PortInteropUnavailableError
 *     ("invalid_response") — never guessed, never fabricated.
 */
import {
  PortInteropConfigError,
  PortInteropRejectedError,
  PortInteropUnavailableError,
} from "./portInteropClient";

export const STCW_VERIFICATION_OUTCOMES = ["VALID", "EXPIRED", "SUSPENDED", "REVOKED", "NOT_FOUND"] as const;
export type StcwVerificationOutcome = (typeof STCW_VERIFICATION_OUTCOMES)[number];

export interface StcwVerification {
  certificateNumber: string;
  outcome: StcwVerificationOutcome;
  certificateType: string | null;
}

const DEFAULT_TIMEOUT_MS = 5_000;

function normalizeBaseUrl(raw: string): string {
  const trimmed = (raw ?? "").trim();
  if (!trimmed) {
    throw new PortInteropConfigError(
      "PORT_INTEROP_URL is not configured — the seafarer/STCW registry is unreachable and shore-pass certificate verification fails closed."
    );
  }
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new PortInteropConfigError(`PORT_INTEROP_URL '${trimmed}' is not a valid URL — verification fails closed.`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new PortInteropConfigError(`PORT_INTEROP_URL must be http(s), got '${url.protocol}' — verification fails closed.`);
  }
  return url.origin;
}

function parseVerification(payload: unknown): StcwVerification {
  const p = payload as { certificateNumber?: unknown; outcome?: unknown; certificateType?: unknown } | null;
  if (!p || typeof p !== "object") throw new Error("verification payload is not an object");
  if (typeof p.certificateNumber !== "string" || !p.certificateNumber) {
    throw new Error("missing certificateNumber");
  }
  if (typeof p.outcome !== "string" || !(STCW_VERIFICATION_OUTCOMES as readonly string[]).includes(p.outcome)) {
    throw new Error(`unrecognised outcome '${String(p.outcome)}'`);
  }
  return {
    certificateNumber: p.certificateNumber,
    outcome: p.outcome as StcwVerificationOutcome,
    certificateType: typeof p.certificateType === "string" ? p.certificateType : null,
  };
}

export interface VerifyOptions {
  /** The authenticated caller's subject — asserted as X-Authenticated-Principal. */
  principal: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

/**
 * Verify an STCW certificate against the port-interop seafarer registry.
 * Throws PortInteropConfigError / PortInteropUnavailableError /
 * PortInteropRejectedError — the router maps each to an honest state.
 */
export async function verifyStcwCertificate(
  certificateNumber: string,
  options: VerifyOptions
): Promise<StcwVerification> {
  const cert = (certificateNumber ?? "").trim();
  if (cert.length < 4 || cert.length > 64) {
    throw new PortInteropRejectedError("certificateNumber must be 4–64 characters", 400);
  }
  const principal = (options.principal ?? "").trim();
  if (!principal) {
    throw new PortInteropConfigError("refusing to assert an empty X-Authenticated-Principal");
  }
  // Config is read at call time (never cached at import): a deployment that
  // loses its registry config must fail closed on the very next call.
  const baseUrl = normalizeBaseUrl(process.env.PORT_INTEROP_URL ?? "");
  const token = (process.env.PORT_INTEROP_TOKEN ?? "").trim();
  if (!token) {
    throw new PortInteropConfigError(
      "PORT_INTEROP_TOKEN is not configured — the seafarer/STCW registry is unreachable and verification fails closed."
    );
  }
  const fetchImpl = options.fetchImpl ?? fetch;
  const path = `/v1/registry/certificates/verify?certificateNumber=${encodeURIComponent(cert)}`;

  let response: Response;
  try {
    response = await fetchImpl(`${baseUrl}${path}`, {
      method: "GET",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${token}`,
        "X-Trusted-Proxy": "loopback",
        "X-Authenticated-Principal": principal,
      },
      signal: AbortSignal.timeout(options.timeoutMs ?? DEFAULT_TIMEOUT_MS),
      redirect: "manual",
    });
  } catch (err) {
    throw new PortInteropUnavailableError(
      `seafarer registry unreachable (${err instanceof Error ? err.message : String(err)})`,
      "network",
      1,
      { cause: err }
    );
  }

  if (response.status >= 400) {
    const text = await response.text().catch(() => "");
    throw response.status >= 500
      ? new PortInteropUnavailableError(`seafarer registry answered HTTP ${response.status}`, "upstream_5xx", 1)
      : new PortInteropRejectedError(
          `seafarer registry rejected verification (HTTP ${response.status})${text.trim() ? `: ${text.trim().slice(0, 200)}` : ""}`,
          response.status
        );
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch (err) {
    throw new PortInteropUnavailableError("seafarer registry returned an unparseable body", "invalid_response", 1, {
      cause: err,
    });
  }
  try {
    return parseVerification(payload);
  } catch (err) {
    throw new PortInteropUnavailableError(
      `seafarer registry response failed shape validation: ${err instanceof Error ? err.message : String(err)}`,
      "invalid_response",
      1,
      { cause: err }
    );
  }
}
