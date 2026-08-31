/**
 * cbnTms.ts — CBN Trade Monitoring System (e-Form M / PAAR) egress adapter
 * (Phase 9 WP-D).
 *
 * ADAPTER-READY ONLY: no wire compatibility with the CBN TMS is claimed
 * until counterpart credentials exist (GAP-OGA-CBNTMS, FG must-bring).
 * Disabled + fail-closed (ADAPTER_UNCONFIGURED) until CBN_TMS_URL /
 * CBN_TMS_SIGNING_KEY / CBN_TMS_KEY_ID are set. No stub success paths.
 */

import { createExternalAdapter, requireString } from "./base";

export const cbnTmsAdapter = createExternalAdapter({
  adapterId: "cbn-tms",
  authority: "CBN Trade Monitoring System",
  gapId: "GAP-OGA-CBNTMS",
  env: {
    url: "CBN_TMS_URL",
    token: "CBN_TMS_TOKEN",
    signingKey: "CBN_TMS_SIGNING_KEY",
    keyId: "CBN_TMS_KEY_ID",
  },
  producer: "blueeconomy-singlewindow-oga-cbn-tms",
});

// ─── Typed request/response surface (adapter posture, not a claimed wire schema) ──

export interface TmsFormMSubmission {
  /** e-Form M number assigned by the platform's form-M workflow. */
  formMNumber: string;
  /** Tokenized importer organization reference. */
  importerReference: string;
  hsCode: string;
  currency: string; // ISO 4217
  /** Digest of the pro-forma invoice document retained in the boundary. */
  invoiceDocumentDigestSha256: string;
  submittedAt: string; // ISO timestamp
}

export interface TmsPaarRequest {
  /** The e-Form M the PAAR is requested against. */
  formMNumber: string;
  /** Digest of the final shipping documents retained in the boundary. */
  shippingDocumentsDigestSha256: string;
  requestedAt: string;
}

export interface TmsReceipt {
  receiptReference: string;
  status: string;
}

export function parseTmsReceipt(body: unknown): TmsReceipt {
  return { receiptReference: requireString(body, "receiptReference"), status: requireString(body, "status") };
}

/** Submits an e-Form M registration to the TMS. */
export async function submitTmsFormM(
  req: TmsFormMSubmission,
  principal: { principalId: string; principalRole: string }
) {
  return cbnTmsAdapter.send(
    {
      path: "/v1/form-m",
      eventType: "oga.cbn.tms.form_m_submitted.v1",
      payload: { ...req },
      principalId: principal.principalId,
      principalRole: principal.principalRole,
      classification: "CONFIDENTIAL",
      recordClassification: "CONFIDENTIAL",
    },
    parseTmsReceipt
  );
}

/** Requests a PAAR (Pre-Arrival Assessment Report) against an e-Form M. */
export async function requestTmsPaar(
  req: TmsPaarRequest,
  principal: { principalId: string; principalRole: string }
) {
  return cbnTmsAdapter.send(
    {
      path: "/v1/paar-requests",
      eventType: "oga.cbn.tms.paar_requested.v1",
      payload: { ...req },
      principalId: principal.principalId,
      principalRole: principal.principalRole,
      classification: "CONFIDENTIAL",
      recordClassification: "CONFIDENTIAL",
    },
    parseTmsReceipt
  );
}

/** Builds the signed egress envelope without network I/O (verification/tests). */
export function buildTmsFormMEnvelope(
  req: TmsFormMSubmission,
  principal: { principalId: string; principalRole: string }
) {
  return cbnTmsAdapter.buildSignedRequest({
    eventType: "oga.cbn.tms.form_m_submitted.v1",
    payload: { ...req },
    principalId: principal.principalId,
    principalRole: principal.principalRole,
    classification: "CONFIDENTIAL",
    recordClassification: "CONFIDENTIAL",
  });
}
