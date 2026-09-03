/**
 * pcsGaps.ts — PCS INTEGRATION_GAPS registry (Phase 8; spec §5.3).
 *
 * Mirrors the blueeconomy-mobile INTEGRATION_GAPS pattern (gap id + summary +
 * needed upstream endpoint). The PCS portal is a read/projection layer with
 * KNOWN missing upstream feeds; instead of fabricating data it renders the
 * honest gap. Gap objects are returned by the pcs.* router and rendered
 * verbatim by the UI (never silently dropped, never substituted with
 * synthetic data).
 */

export interface PcsIntegrationGap {
  /** Stable machine id, e.g. GAP-PCS-AIS. */
  id: string;
  /** One-line operator-facing summary. */
  summary: string;
  /** What the UI cannot show while the gap stands. */
  affected: string;
  /** The upstream capability that would close the gap. */
  neededUpstream: string;
}

export const PCS_INTEGRATION_GAPS = {
  /** Spec seed: no live AIS feed → no positions or predictive ETAs. */
  AIS: {
    id: "GAP-PCS-AIS",
    summary:
      "No live AIS feed is integrated. Vessel positions and predictive ETAs are unavailable; only authority-submitted port-call milestones are shown.",
    affected: "vessel positions, predictive ETA",
    neededUpstream: "A real AIS provider feed (the simulated cargoTracking module is NOT a data source).",
  },
  /** Spec seed: no terminal TOS integration → no ops milestones. */
  BERTH_OPS: {
    id: "GAP-PCS-BERTH-OPS",
    summary:
      "No terminal operating system (TOS) integration exists. Operations-started and discharging milestones are unavailable until terminals publish events.",
    affected: "ops_started / discharging milestones, berth operations detail",
    neededUpstream: "Terminal TOS event publication onto the ports.*.v1 event contract.",
  },
  /** Spec seed: no published tariff endpoint → invoiced amounts only. */
  TARIFF: {
    id: "GAP-PCS-TARIFF",
    summary:
      "No published port tariff endpoint exists. Billing shows only invoiced amounts from the ledger projection — never estimates.",
    affected: "charge estimates, pre-invoice billing forecasts",
    neededUpstream: "A published port tariff endpoint on port-interop.",
  },
  /**
   * Port-call linkage: port-interop exposes no list-by-declaration port-call
   * endpoint, so vessel visits are shown only for consignments whose
   * port_call_id was established by an authority event.
   */
  PORTCALL_LINKAGE: {
    id: "GAP-PCS-PORTCALL-LINKAGE",
    summary:
      "Port calls can only be read by call id. Consignments without an authority-linked port call show no vessel visit rather than a guessed one.",
    affected: "automatic port-call association for all consignments",
    neededUpstream: "A port-interop endpoint listing port calls by declaration reference or B/L.",
  },
  /**
   * Receipt read-through: port-interop exposes no GET receipt endpoint (its
   * server routes cover bookings/slots/gate/queue only), so receipt detail is
   * served from the verified outbox projection and labelled with its
   * projection lag — never re-fetched or reconstructed.
   */
  RECEIPT_READTHROUGH: {
    id: "GAP-PCS-RECEIPT-READTHROUGH",
    summary:
      "The port system exposes no receipt read endpoint. Receipt detail is shown from the verified event projection with its recorded projection lag; dispute resolution happens in the port system.",
    affected: "pcs.billing.receipt live read-through",
    neededUpstream: "A port-interop GET receipt/invoice endpoint.",
  },
} as const satisfies Record<string, PcsIntegrationGap>;

export type PcsGapId = keyof typeof PCS_INTEGRATION_GAPS;

export function pcsGap(id: PcsGapId): PcsIntegrationGap {
  return { ...PCS_INTEGRATION_GAPS[id] };
}

export function pcsGaps(ids: readonly PcsGapId[]): PcsIntegrationGap[] {
  return ids.map((id) => pcsGap(id));
}
