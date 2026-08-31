/**
 * nis.ts — NIS (Nigeria Immigration Service) border-notice egress adapter
 * (Phase 9 WP-D).
 *
 * ADAPTER-READY ONLY: no wire compatibility with NIS systems is claimed
 * until counterpart credentials exist (GAP-MSW-NIS, FG must-bring — the NIS
 * endpoint agreement registered with the MSW module). Disabled + fail-closed
 * (ADAPTER_UNCONFIGURED) until NIS_URL / NIS_SIGNING_KEY / NIS_KEY_ID are
 * set. No stub success paths, no fabricated responses.
 */

import { createExternalAdapter, requireString } from "./base";

export const nisAdapter = createExternalAdapter({
  adapterId: "nis",
  authority: "Nigeria Immigration Service",
  gapId: "GAP-MSW-NIS",
  env: {
    url: "NIS_URL",
    token: "NIS_TOKEN",
    signingKey: "NIS_SIGNING_KEY",
    keyId: "NIS_KEY_ID",
  },
  producer: "blueeconomy-singlewindow-oga-nis",
});

// ─── Typed request/response surface (adapter posture, not a claimed wire schema) ──

export const NIS_NOTICE_KINDS = ["CREW_LIST", "PASSENGER_LIST", "BORDER_CLEARANCE"] as const;
export type NisNoticeKind = (typeof NIS_NOTICE_KINDS)[number];

export interface NisBorderNotice {
  /** MSW visit the notice relates to. */
  visitId: string;
  noticeKind: NisNoticeKind;
  /** Digest of the crew/passenger list retained in the boundary (personal
   *  data stays in the boundary; the digest travels). */
  listDigestSha256: string;
  submittedAt: string; // ISO timestamp
}

export interface NisReceipt {
  receiptReference: string;
  status: string;
}

export function parseNisReceipt(body: unknown): NisReceipt {
  return { receiptReference: requireString(body, "receiptReference"), status: requireString(body, "status") };
}

/** Submits a border notice (crew/passenger list digest or border clearance) to NIS. */
export async function submitNisBorderNotice(
  req: NisBorderNotice,
  principal: { principalId: string; principalRole: string }
) {
  return nisAdapter.send(
    {
      path: "/v1/border-notices",
      eventType: "oga.nis.border_notice_submitted.v1",
      payload: { ...req },
      principalId: principal.principalId,
      principalRole: principal.principalRole,
      // Crew/passenger personal data is NDPA PERSONAL → RESTRICTED floor.
      classification: req.noticeKind === "BORDER_CLEARANCE" ? "CONFIDENTIAL" : "RESTRICTED",
      recordClassification: req.noticeKind === "BORDER_CLEARANCE" ? "CONFIDENTIAL" : "RESTRICTED",
    },
    parseNisReceipt
  );
}

/** Builds the signed egress envelope without network I/O (verification/tests). */
export function buildNisBorderNoticeEnvelope(
  req: NisBorderNotice,
  principal: { principalId: string; principalRole: string }
) {
  return nisAdapter.buildSignedRequest({
    eventType: "oga.nis.border_notice_submitted.v1",
    payload: { ...req },
    principalId: principal.principalId,
    principalRole: principal.principalRole,
    classification: req.noticeKind === "BORDER_CLEARANCE" ? "CONFIDENTIAL" : "RESTRICTED",
    recordClassification: req.noticeKind === "BORDER_CLEARANCE" ? "CONFIDENTIAL" : "RESTRICTED",
  });
}
