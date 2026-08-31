/**
 * nepc.ts — NEPC (Nigerian Export Promotion Council) export-documentation
 * egress adapter (Phase 9 WP-D).
 *
 * ADAPTER-READY ONLY: no wire compatibility with NEPC systems is claimed
 * until counterpart credentials exist (GAP-OGA-NEPC, FG must-bring).
 * Disabled + fail-closed (ADAPTER_UNCONFIGURED) until NEPC_URL /
 * NEPC_SIGNING_KEY / NEPC_KEY_ID are set. No stub success paths.
 */

import { createExternalAdapter, requireString } from "./base";

export const nepcAdapter = createExternalAdapter({
  adapterId: "nepc",
  authority: "Nigerian Export Promotion Council",
  gapId: "GAP-OGA-NEPC",
  env: {
    url: "NEPC_URL",
    token: "NEPC_TOKEN",
    signingKey: "NEPC_SIGNING_KEY",
    keyId: "NEPC_KEY_ID",
  },
  producer: "blueeconomy-singlewindow-oga-nepc",
});

// ─── Typed request/response surface (adapter posture, not a claimed wire schema) ──

export interface NepcExportDocumentationRequest {
  /** Tokenized exporter organization reference. */
  exporterReference: string;
  /** NEPC exporter-certificate reference held by the exporter. */
  exporterCertificateReference: string;
  productHsCode: string;
  destinationCountryCode: string; // ISO 3166-1 alpha-2
  /** Digest of the export documentation pack retained in the boundary. */
  exportDocumentDigestSha256: string;
  submittedAt: string; // ISO timestamp
}

export interface NepcReceipt {
  receiptReference: string;
  status: string;
}

export function parseNepcReceipt(body: unknown): NepcReceipt {
  return { receiptReference: requireString(body, "receiptReference"), status: requireString(body, "status") };
}

/** Submits an export-documentation pack to NEPC. */
export async function submitNepcExportDocumentation(
  req: NepcExportDocumentationRequest,
  principal: { principalId: string; principalRole: string }
) {
  return nepcAdapter.send(
    {
      path: "/v1/export-documentation",
      eventType: "oga.nepc.export_documentation_submitted.v1",
      payload: { ...req },
      principalId: principal.principalId,
      principalRole: principal.principalRole,
      classification: "CONFIDENTIAL",
      recordClassification: "CONFIDENTIAL",
    },
    parseNepcReceipt
  );
}

/** Builds the signed egress envelope without network I/O (verification/tests). */
export function buildNepcExportDocumentationEnvelope(
  req: NepcExportDocumentationRequest,
  principal: { principalId: string; principalRole: string }
) {
  return nepcAdapter.buildSignedRequest({
    eventType: "oga.nepc.export_documentation_submitted.v1",
    payload: { ...req },
    principalId: principal.principalId,
    principalRole: principal.principalRole,
    classification: "CONFIDENTIAL",
    recordClassification: "CONFIDENTIAL",
  });
}
