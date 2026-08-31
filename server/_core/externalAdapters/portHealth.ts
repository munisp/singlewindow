/**
 * portHealth.ts — Port Health Services pratique/MDOH egress adapter
 * (Phase 9 WP-D).
 *
 * ADAPTER-READY ONLY: no wire compatibility with Port Health systems is
 * claimed until counterpart credentials exist (GAP-MSW-PH, FG must-bring —
 * the Port Health endpoint agreement registered with the MSW module).
 * Disabled + fail-closed (ADAPTER_UNCONFIGURED) until PORT_HEALTH_URL /
 * PORT_HEALTH_SIGNING_KEY / PORT_HEALTH_KEY_ID are set. Health-decision
 * records floor at RESTRICTED (NDPA PERSONAL, docs/msw.md). No stub success
 * paths.
 */

import { createExternalAdapter, requireString } from "./base";

export const portHealthAdapter = createExternalAdapter({
  adapterId: "port-health",
  authority: "Port Health Services",
  gapId: "GAP-MSW-PH",
  env: {
    url: "PORT_HEALTH_URL",
    token: "PORT_HEALTH_TOKEN",
    signingKey: "PORT_HEALTH_SIGNING_KEY",
    keyId: "PORT_HEALTH_KEY_ID",
  },
  producer: "blueeconomy-singlewindow-oga-port-health",
});

// ─── Typed request/response surface (adapter posture, not a claimed wire schema) ──

export interface PortHealthPratiqueNotice {
  /** MSW visit the pratique decision relates to. */
  visitId: string;
  /** Declaration id of the MDOH the decision is based on. */
  healthDeclarationReference: string;
  decision: "GRANTED" | "REFUSED";
  /** Digest of the pratique decision record retained in the boundary. */
  pratiqueRecordDigestSha256: string;
  decidedAt: string; // ISO timestamp
}

export interface PortHealthReceipt {
  receiptReference: string;
  status: string;
}

export function parsePortHealthReceipt(body: unknown): PortHealthReceipt {
  return { receiptReference: requireString(body, "receiptReference"), status: requireString(body, "status") };
}

/** Notifies Port Health of a pratique decision recorded in the MSW boundary. */
export async function submitPortHealthPratiqueNotice(
  req: PortHealthPratiqueNotice,
  principal: { principalId: string; principalRole: string }
) {
  return portHealthAdapter.send(
    {
      path: "/v1/pratique-notices",
      eventType: "oga.port_health.pratique_notice_submitted.v1",
      payload: { ...req },
      principalId: principal.principalId,
      principalRole: principal.principalRole,
      classification: "RESTRICTED",
      recordClassification: "RESTRICTED",
    },
    parsePortHealthReceipt
  );
}

/** Builds the signed egress envelope without network I/O (verification/tests). */
export function buildPortHealthPratiqueNoticeEnvelope(
  req: PortHealthPratiqueNotice,
  principal: { principalId: string; principalRole: string }
) {
  return portHealthAdapter.buildSignedRequest({
    eventType: "oga.port_health.pratique_notice_submitted.v1",
    payload: { ...req },
    principalId: principal.principalId,
    principalRole: principal.principalRole,
    classification: "RESTRICTED",
    recordClassification: "RESTRICTED",
  });
}
