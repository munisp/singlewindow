# WCO CEN / ASEAN Single Window alignment — IMO wire layer (Phase 10 WP-3)

Status: informative alignment note; the normative artefacts are
blueeconomy-contracts `docs/imo-wco-conformance.md` + `mappings/msw/v1/*` and
the implementation in `server/_core/imoCompendium.ts` /
`server/_core/mswExchange.ts`. **No live CEN or ASEAN connectivity is claimed
or faked here.**

## What exists today

- `server/routers/cen.ts` — tRPC proxy to the Go `cen-service`
  (`CEN_SERVICE_URL`): WCO Customs Enforcement Network alert surfaces
  (RISK_PROFILE / SEIZURE / WANTED_PERSON / VESSEL_WATCH / GENERAL).
- `server/routers/aseanSw.ts` — tRPC proxy to the Go `asean-sw-service`
  (`ASEAN_SW_SERVICE_URL`): ASEAN Single Window G2G message dispatch, WCO XML
  formatting, inbound acknowledgements, bilateral connection status
  (ACDD/SSTC/ATIGA document types).

Both are pass-through routers; neither consumes IMO Compendium-shaped
content today.

## How the WP-3 layer feeds them

The WP-3 export layer (`exportDeclarationToImo` +
`buildSignedExport`, digest-bound, fail closed) is the **single source of
internationally-shaped MSW content**. Alignment points:

1. **ASEAN SW (G2G dispatch).** `asean-sw-service` formats outbound G2G
   documents as WCO XML. When an ASEAN exchange requires ship/cargo content
   that also exists as an MSW declaration, the IMO export message
   (`IMO-MSW-FAL-EXPORT`, `mappings/msw/v1` `wcoPath` cross-references) is
   the content source — the WCO XML mapper consumes `imoMessage` aggregates
   via the documented `wcoPath` hints rather than re-deriving field semantics
   from platform-internal payloads.
   *Extension point (not wired — no fake connectivity):* an adapter function
   `asean-sw-service` side that accepts the WP-3 signed envelope, verifies
   the EdDSA provenance signature against the published platform JWKS, and
   maps `imoMessage` → WCO XML. Until that service-side consumer exists, the
   tRPC router is untouched.
2. **WCO CEN (enforcement).** CEN VESSEL_WATCH / RISK_PROFILE alerts
   reference vessels by IMO number. The mapping tables fix the canonical
   cross-reference: platform `vesselImoNumber` ↔
   `IMOCompendium/<Message>/Ship/IMONumber` ↔ WCO
   `Declaration/Consignment/TransportMeans/Identification`. CEN alert
   correlation against MSW visits MUST key on this element (already the
   platform's vessel identity field) — no code change required; the
   conformance layer guarantees the same 7-digit identifier survives
   cross-border exchange unaltered (round-trip tested).
3. **Classification floors.** Any future CEN/ASEAN feed built on the WP-3
   export inherits the envelope v1.0 floors: FAL4/5/6/MDOH content is
   RESTRICTED with `recordClassification` set; G2G dispatchers must not widen
   it (enforced at `buildSignedExport`).

## Explicit non-goals / honesty

- No CEN nCEN connection, no ASEAN SW member-state connection is
  established, tested, or implied by this layer.
- `wcoPath` values in the mapping tables are populated only where a WCO Data
  Model element is established for the concept; `null` means "no established
  cross-reference" and must not be treated as a defect to paper over.
