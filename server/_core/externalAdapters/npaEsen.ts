/**
 * npaEsen.ts — NPA e-SEN (electronic Ship Entry Notice) egress adapter
 * (Phase 9 WP-D).
 *
 * ADAPTER-READY ONLY: no wire compatibility with the NPA e-SEN system is
 * claimed until the integration agreement exists (GAP-MSW-ESEN, FG
 * must-bring — registered with the MSW module). Disabled + fail-closed
 * (ADAPTER_UNCONFIGURED) until NPA_ESEN_URL / NPA_ESEN_SIGNING_KEY /
 * NPA_ESEN_KEY_ID are set.
 *
 * This adapter is the CONCRETE FAIL-CLOSED IMPLEMENTATION behind the MSW
 * module's PORT_CALL_UNAVAILABLE / GAP-MSW-ESEN path: when the
 * port-interoperability boundary cannot verify a visit's port call,
 * server/mswService.createVisit consults this adapter as the designated
 * e-SEN upstream; with no e-SEN credentials the visit is honestly created
 * with portCallVerified=false and the GAP-MSW-ESEN disclosure — never
 * presented as verified, never fabricated.
 */

import { createExternalAdapter, requireString } from "./base";

export const npaEsenAdapter = createExternalAdapter({
  adapterId: "npa-esen",
  authority: "NPA e-SEN (electronic Ship Entry Notice)",
  gapId: "GAP-MSW-ESEN",
  env: {
    url: "NPA_ESEN_URL",
    token: "NPA_ESEN_TOKEN",
    signingKey: "NPA_ESEN_SIGNING_KEY",
    keyId: "NPA_ESEN_KEY_ID",
  },
  producer: "blueeconomy-singlewindow-oga-npa-esen",
});

// ─── Typed request/response surface (adapter posture, not a claimed wire schema) ──

export interface EsenShipEntryNotice {
  /** Port-call / entry reference the notice is filed under. */
  portCallId: string;
  vesselImoNumber: string; // 7 digits, no prefix
  portCode: string; // UN/LOCODE
  eta: string; // ISO timestamp, declared by the agent — never fabricated
  agentReference: string;
  submittedAt: string;
}

export interface EsenNoticeStatus {
  reference: string;
  vesselImoNumber: string;
  portCode: string;
  status: string;
}

export interface EsenReceipt {
  receiptReference: string;
  status: string;
}

export function parseEsenReceipt(body: unknown): EsenReceipt {
  return { receiptReference: requireString(body, "receiptReference"), status: requireString(body, "status") };
}

export function parseEsenNoticeStatus(body: unknown): EsenNoticeStatus {
  return {
    reference: requireString(body, "reference"),
    vesselImoNumber: requireString(body, "vesselImoNumber"),
    portCode: requireString(body, "portCode"),
    status: requireString(body, "status"),
  };
}

/** Files an electronic Ship Entry Notice for a declared visit. */
export async function submitEsenShipEntryNotice(
  req: EsenShipEntryNotice,
  principal: { principalId: string; principalRole: string }
) {
  return npaEsenAdapter.send(
    {
      path: "/v1/ship-entry-notices",
      eventType: "oga.npa.esen.ship_entry_notice_submitted.v1",
      payload: { ...req },
      principalId: principal.principalId,
      principalRole: principal.principalRole,
      classification: "INTERNAL",
    },
    parseEsenReceipt
  );
}

/**
 * Fetches an e-SEN record by reference — the real verification source behind
 * the MSW port-call fallback path. Fail closed: unconfigured →
 * AdapterUnconfiguredError (GAP-MSW-ESEN); transport → AdapterTransportError.
 */
export async function fetchEsenShipEntryNotice(
  reference: string,
  principal: { principalId: string; principalRole: string }
) {
  return npaEsenAdapter.send(
    {
      path: "/v1/ship-entry-notices/query",
      eventType: "oga.npa.esen.ship_entry_notice_queried.v1",
      payload: { reference },
      principalId: principal.principalId,
      principalRole: principal.principalRole,
      classification: "INTERNAL",
    },
    parseEsenNoticeStatus
  );
}

/** Builds the signed egress envelope without network I/O (verification/tests). */
export function buildEsenShipEntryNoticeEnvelope(
  req: EsenShipEntryNotice,
  principal: { principalId: string; principalRole: string }
) {
  return npaEsenAdapter.buildSignedRequest({
    eventType: "oga.npa.esen.ship_entry_notice_submitted.v1",
    payload: { ...req },
    principalId: principal.principalId,
    principalRole: principal.principalRole,
    classification: "INTERNAL",
  });
}
