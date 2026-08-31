/**
 * ncsBodogwu.ts — NCS B'Odogwu customs-clearance egress adapter (Phase 9 WP-D).
 *
 * ADAPTER-READY ONLY: no wire compatibility with the Nigeria Customs Service
 * B'Odogwu platform is claimed until counterpart credentials exist
 * (GAP-OGA-BODOGWU, FG must-bring). Disabled + fail-closed
 * (ADAPTER_UNCONFIGURED) until NCS_BODOGWU_URL / NCS_BODOGWU_SIGNING_KEY /
 * NCS_BODOGWU_KEY_ID are set. No stub success paths, no fabricated responses.
 */

import { createExternalAdapter, requireString } from "./base";

export const ncsBodogwuAdapter = createExternalAdapter({
  adapterId: "ncs-bodogwu",
  authority: "NCS B'Odogwu",
  gapId: "GAP-OGA-BODOGWU",
  env: {
    url: "NCS_BODOGWU_URL",
    token: "NCS_BODOGWU_TOKEN",
    signingKey: "NCS_BODOGWU_SIGNING_KEY",
    keyId: "NCS_BODOGWU_KEY_ID",
  },
  producer: "blueeconomy-singlewindow-oga-ncs-bodogwu",
});

// ─── Typed request/response surface (adapter posture, not a claimed wire schema) ──

export interface BodogwuClearanceRequest {
  /** Platform declaration reference (the local system of record id). */
  declarationReference: string;
  /** Tokenized customs-broker organization reference. */
  customsBrokerReference: string;
  hsCode: string;
  /** Digest of the duty assessment record retained in the boundary. */
  dutyAssessmentDigestSha256: string;
  requestedAt: string; // ISO timestamp
}

export interface BodogwuReceipt {
  receiptReference: string;
  status: string;
}

export function parseBodogwuReceipt(body: unknown): BodogwuReceipt {
  return { receiptReference: requireString(body, "receiptReference"), status: requireString(body, "status") };
}

/** Submits a customs-clearance request for an assessed declaration. */
export async function submitBodogwuClearanceRequest(
  req: BodogwuClearanceRequest,
  principal: { principalId: string; principalRole: string }
) {
  return ncsBodogwuAdapter.send(
    {
      path: "/v1/clearance-requests",
      eventType: "oga.ncs.bodogwu.clearance_requested.v1",
      payload: { ...req },
      principalId: principal.principalId,
      principalRole: principal.principalRole,
      classification: "CONFIDENTIAL",
      recordClassification: "CONFIDENTIAL",
    },
    parseBodogwuReceipt
  );
}

/** Builds the signed egress envelope without network I/O (verification/tests). */
export function buildBodogwuClearanceEnvelope(
  req: BodogwuClearanceRequest,
  principal: { principalId: string; principalRole: string }
) {
  return ncsBodogwuAdapter.buildSignedRequest({
    eventType: "oga.ncs.bodogwu.clearance_requested.v1",
    payload: { ...req },
    principalId: principal.principalId,
    principalRole: principal.principalRole,
    classification: "CONFIDENTIAL",
    recordClassification: "CONFIDENTIAL",
  });
}
