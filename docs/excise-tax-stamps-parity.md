# Digital tax stamps / excise traceability: market comparison and design

## 1. What the leading platforms actually do

Reference set (public product documentation, plus the regulatory floor those products are built to):

| Platform | Vendor | Public source |
| --- | --- | --- |
| SICPATRACE® Evo | SICPA | https://www.sicpa.com/solutions/sicpatrace |
| TransAct™ | Authentix | https://authentix-us.com/governments/taxstamp/ |
| DirectTrace excise suite | DirectTrace | https://direct-trace.com/for-excise-tax/ |
| Regulatory floor | EU Commission Implementing Regulation (EU) 2018/574 (TPD Art. 15 traceability), implementing WHO FCTC Illicit Trade Protocol Art. 8 | https://eur-lex.europa.eu/eli/reg/2018/574/oj |

Distilling their published capability sets, a credible excise-traceability platform has to cover
eleven capability areas. `C*` labels are used throughout this document.

- **C1 Licensee / taxpayer administration.** Registration and licensing of manufacturers, importers,
  distributors and retailers of excisable goods, with licence validity and suspension.
- **C2 Facility and production-line registry.** Each production or storage facility and each marking
  machine identified. 2018/574 makes this explicit: economic operator identifier (EOID), facility
  identifier (FID), machine identifier, all issued by an independent **ID issuer**.
- **C3 Product master data and taxation schemes.** Registered SKUs (brand, pack size, strength/volume)
  mapped to an excise scheme — specific (per stick / per litre / per litre of pure alcohol),
  ad valorem, or hybrid.
- **C4 Stamp / mark procurement.** Order → approval → fiscal liability → payment → fulfilment →
  delivery, with stamp stock accounted for at every hop.
- **C5 Unique serialised identifiers.** A non-guessable unique identifier per unit packet, generated
  independently of the manufacturer, resistant to duplication, and recorded with its issuance context.
- **C6 Activation and production reporting.** Marks are activated when applied; wastage, spoilage and
  destruction are declared; issued stamps reconcile against activated stamps and reported production.
- **C7 Aggregation.** Unit → carton → master case → pallet, each aggregate carrying its own unique
  aggregated identifier, so a pallet scan resolves every unit packet inside it (2018/574 Art. 10,
  Annex II).
- **C8 Supply-chain movement events.** Dispatch, arrival, transfer of ownership, export, re-entry,
  destruction — the event stream that turns marks into traceability.
- **C9 Field enforcement.** Inspector scans a mark and gets authenticity plus the mark's full history;
  seizures recorded against the mark. Only authorised enforcement users see the data behind a stamp.
- **C10 Public / consumer authentication.** Anyone can verify a mark; the answer must not leak the
  commercial data behind it.
- **C11 Analytics and revenue reconciliation.** Revenue realised vs. expected, illicit-trade
  indicators, duplicate marks, diversion detection.

## 2. What this platform has today

Searching the repository for the excise domain returns exactly one thing:

```
server/businessRules.ts:275   exciseRate?: number;         // For excisable goods
server/businessRules.ts:290   const excise = (cifValue * (input.exciseRate ?? 0)) / 100;
```

An ad valorem excise term inside `calculateDuty`, and nothing else. There is no stamp, mark, serial,
licensee, facility, SKU or activation concept anywhere in `drizzle/schema.ts` or in the 104 routers.

So the honest comparison is not "which features are missing" but **C1–C11 are all absent**: this is a
customs single-window with no excise-traceability capability at all. What it does bring, and what no
tax-stamp vendor has, is the other half of the problem: declarations, valuation, duty assessment, a
double-entry ledger, payments, risk lanes, manifests and bills of lading, an audit trail, and an
enforcement/officer model. That asymmetry is what section 4 exploits.

| Capability | Leading platforms | This platform (before) | Planned |
| --- | --- | --- | --- |
| C1 Licensee administration | yes | none | excise licences with validity + suspension |
| C2 Facility / machine registry | yes (EOID/FID/machine) | none | facility + machine identifiers, ID-issuer-owned |
| C3 Product master data + schemes | yes | none | SKU registry, specific/ad valorem/hybrid schemes |
| C4 Stamp procurement | yes | none | order → assess → pay → fulfil, ledger-posted |
| C5 Serialised UIDs | yes | none | signed, non-guessable UIDs minted server-side |
| C6 Activation + production reporting | yes | none | activation, wastage, destruction, reconciliation |
| C7 Aggregation | yes | none | unit → carton → case → pallet, resolvable both ways |
| C8 Movement events | yes | none | dispatch/receipt/export/seizure event stream |
| C9 Field enforcement | yes | none | authorised scan with full history + seizure capture |
| C10 Public authentication | yes | none | public rate-limited verify, no commercial data |
| C11 Analytics + reconciliation | yes | none | issued/activated/paid reconciliation + anomalies |

## 3. Design rules carried over from the audit

This module is built under the same rules the fail-closed remediation established, because an excise
system is a money system:

1. **No fabricated authenticity.** A verification result is `authentic`, `unknown`, `suspect` or
   `unavailable`. A dependency outage never renders as "authentic", and never as "counterfeit" either —
   accusing a legitimate trader on the strength of a Redis timeout is the same defect in the other
   direction.
2. **No fabricated reconciliation.** Unreconciled variance is reported as variance. It is never
   rounded to zero and never suppressed.
3. **Fail closed on money.** Stamps are not released, and marks are not activated, when the ledger,
   database or payment path is unavailable.
4. **UIDs are minted server-side and are unguessable.** A licensee cannot choose its own serials, and
   a serial cannot be derived from another serial.
5. **Public endpoints disclose status only.** No brand, licensee, volume, consignee, value or route on
   a public scan.
6. **Unknown is nullable.** No zero-valued or empty-string placeholders standing in for absent data.

## 4. The six innovations

These are deliberately *not* reimplementations of vendor features. Each one exists only because this
platform holds both halves of the data — the customs/fiscal side and the mark side — which the
standalone tax-stamp platforms do not.

**I1 — Declaration-linked stamp issuance, gated on settled duty.**
For imported excisable goods, a stamp order is bound to the customs declaration (and through the
linkage added for shipment tracking, to its bill of lading and manifest). Stamps are released only
when the declaration's duty is *settled in the ledger* — not merely marked paid. This closes the
leak every standalone stamp platform lives with: the stamp programme and the customs programme are
different systems, so goods can clear customs and never be stamped, or be stamped and never declared.
Here the two are the same transaction.

**I2 — Offline-verifiable marks.**
Each UID carries a truncated HMAC over the serial payload, keyed by a server-held secret with a key
identifier in the mark. An inspector's device holds a verification key and can distinguish a
well-formed mark from an invented one *with no connectivity*, then reconcile the scan on reconnect.
The offline answer is explicitly labelled `signature_valid_pending_reconciliation` — it proves the
mark was minted by the authority, and does not claim the pack is legitimate, because a genuine mark
can still be cloned onto illicit product. That distinction is the entire point, and it is the one
thing offline verification usually gets dishonestly wrong.

**I3 — Impossible-travel detection on scans.**
The same UID scanned in two places implies a speed between them. Above a physical threshold, one of
the two marks is a clone. This is the mobile-money fraud-detection pattern applied to fiscal marks,
using the platform's existing geospatial data. It flags the *mark*, not the trader, and it records
both scans as evidence rather than deleting the "wrong" one.

**I4 — Stamp liability on the double-entry ledger.**
Stamp orders post to the existing ledger, so at any moment `stamps issued × unit liability` is
reconcilable against `paid`, `activated` and `reported production`. Vendors report stamp counts;
posting the liability into the same ledger that carries duty and VAT means excise revenue is
auditable by the same reconciliation that covers everything else, and a variance cannot hide in a
spreadsheet between two systems.

**I5 — Consumer scan as an enforcement sensor.**
Public verification is anonymous and discloses nothing commercial, but the scan itself is retained as
a signal feeding I3 and the risk model. Consumers become a national sensor network for illicit trade
without surrendering any personal data and without being told anything about the supply chain.

**I6 — Seizure-to-source graph traversal.**
From a seized unit packet, resolve upward through aggregation (carton → case → pallet) to the
production or import event, the declaration, the manifest, the importer and the mandate-holding agent
who filed it — and back down to every sibling mark from the same batch that is still in the market.
Enforcement's real question is not "is this pack fake" but "where did it come from and what else came
with it", and answering that needs both the aggregation tree and the customs record.

## 5. Also closing: two residual findings from the audit

Both were left open in the audit's residual register as policy decisions. They are closed here as
*mechanism* — configuration replaces hardcoded constants, and absence fails closed — without inventing
Nigerian or Ghanaian rates, which remains the authority's data to load:

- **Flat 10% duty / 15% VAT.** Replaced by a persisted tariff schedule keyed by HS code and effective
  date. A declaration whose HS code has no effective rate is **rejected**, not assessed at a default.
  A wrong-but-plausible assessment is worse than a refusal.
- **GHS/NGN/USD incoherence.** Replaced by an explicit jurisdiction configuration (customs accounting
  currency plus permitted settlement currencies) and a persisted FX rate with a source and timestamp.
  No rate on the valuation date means the assessment fails closed rather than silently mixing
  currencies.
