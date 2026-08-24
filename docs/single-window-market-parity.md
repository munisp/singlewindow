# Single-window market comparison: gaps and innovations

## 1. Reference set

| Platform | Operator | Public source |
| --- | --- | --- |
| TradeNet / Networked Trade Platform (NTP) | Singapore Customs | https://www.customs.gov.sg/doing-business/quick-links-for-traders/tradenet/what-you-need-to-know-about-tradenet/ |
| EU Single Window Environment for Customs / CSW-CERTEX | European Commission (DG TAXUD) | https://taxation-customs.ec.europa.eu/customs/customs-controls/eu-single-window-environment-customs_en |
| ASYCUDAWorld national/regional single window | UNCTAD | https://asycuda.org/ |
| Regulatory floor | Regulation (EU) 2022/2399 + Delegated Reg. (EU) 2024/2514; WTO TFA Arts. 3, 4, 7, 10.4; WCO Data Model | https://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=CELEX:02022R2399-20241017 |

Capability areas distilled from those sources, labelled `SW*` below.

## 2. Comparison

Verified against the repository, not against its own marketing components.

| # | Capability | Reference platforms | This platform | Verdict |
| --- | --- | --- | --- | --- |
| SW1 | Single declaration serving all agencies | TradeNet: one submission, all controlling agencies | declarations + `ogaPermits` per declaration | **present** |
| SW2 | Declaring-agent model (submission on behalf of a principal) | TradeNet DA functions | `stakeholderMandates`, principal/acting-agent on declarations | **present** (added in the parity work) |
| SW3 | Amendment / cancellation / refund of a lodged declaration | TradeNet: amendment, cancellation **and** refund applications | `declarationAmendments` (request/review only); `drawback` covers duty drawback on re-export | **partial** — no cancellation, no overpayment refund |
| SW4 | Formalities catalogue: which non-customs permits a consignment actually needs | CSW-CERTEX's core purpose — automatic verification of non-customs formalities against declaration data at clearance | nothing; a grep for `requiredPermits`/`permitRequirement` across `server/` returns one unrelated type field in `server/_core/polyglotClients.ts:178` | **absent** |
| SW5 | Prohibitions & restrictions register keyed by HS code / origin / regime | standard in all three | no register; only incidental mentions in `vision.ts`, `auditEngine.ts` | **absent** |
| SW6 | Tariff quotas / quantitative restrictions with balance drawdown | ASYCUDA, EU | none | **absent** |
| SW7 | Right of appeal against a customs decision (TFA Art. 4) | all three; a treaty obligation | none — no appeals router or table | **absent** |
| SW8 | Advance rulings | TFA Art. 3 | `advanceRuling` (submit, issue decision) | **present**, but rulings are not binding on later assessment and are not published |
| SW9 | Machine-to-machine channel for approved trader front-ends | TradeNet front-end providers; NTP API/SFTP | `devPortal` (scoped API keys, rate limits, sandbox) | **present** |
| SW10 | Standards-based messaging (WCO Data Model, EDIFACT CUSDEC/CUSRES) | all three | `ncsNrs.ingestEDI` accepts EDIFACT, but the mapping lives behind an external gateway, not in this repo | **partial / unverifiable here** |
| SW11 | Cross-border exchange with partner administrations | NTP↔foreign customs; CSW-CERTEX; ASYCUDA regional | `aseanSw` adapter exists and now honestly reports unavailable (the fabricated data was removed in the audit remediation) | **surface only** |
| SW12 | AEO / trusted trader | all three | `aeo`, `aeoRenewals`, MRA partners | **present** |
| SW13 | Risk management, valuation, origin, post-clearance audit | all three | `riskModel`, `valuation`, `wtoValuation`, `rulesOfOrigin`, `postAudit` | **present, ahead** |
| SW14 | Payment, ledger, reconciliation | GIRO / banking APIs | Mojaloop + TigerBeetle double-entry, fail-closed after remediation | **present, ahead** |

So on the classic single-window core this platform is at or ahead of the reference set. The gaps are
concentrated in the **regulatory-obligation layer** — SW4, SW5, SW6, SW7 — plus SW3's missing halves.
That is a coherent pattern: the platform automates the *customs* decision well and has almost nothing
that tells it what the *law* requires for a given consignment, or that gives a trader recourse when
the decision goes against them.

### A confirmed defect found while comparing

`server/businessRules.ts:517-560` presents itself as a live exchange-rate service:

```
// ─── 11. Live Exchange Rate Fetcher (R2 FIX) ─────────────────────────────────
// Replaces the previously hardcoded USD conversion rates with a live fetch
// from the European Central Bank (ECB) XML feed — free, no API key required.
// Falls back to a conservative in-memory cache on network failure.

const FALLBACK_RATES_TO_EUR: Record<string, number> = {
  USD: 1.08, GBP: 0.86, GHS: 16.5, RWF: 1430, KES: 140, NGN: 1680, ...
```

The ECB daily reference feed does not publish NGN, GHS, RWF, KES, XOF or XAF. Fetched just now, the
feed carries 29 currencies: USD JPY CZK DKK GBP HUF PLN RON SEK CHF ISK NOK TRY AUD BRL CAD CNY HKD
IDR ILS INR KRW MXN MYR NZD PHP SGD THB ZAR — `grep -c NGN` returns `0`.

So for **every** currency this platform actually operates in, the "live" fetch always misses and the
hardcoded constant is always used. A duty assessment in Nigeria is being computed at a rate hardcoded
in source in mid-2026, labelled as live, with no staleness surfaced to the officer or the trader — and
for NGN the legally correct source is the CBN rate, which the codebase already knows about
(`ncsNrs.updateCBNRate`) and does not consult here. Same family as the audit's fabricated-success
findings: the number is plausible, wrong, and presented as authoritative.

## 3. Gaps to close

- **SW4 formalities catalogue.** A register of non-customs formalities keyed by HS code, origin,
  destination and regime, which derives the required permits at submission, routes to the right
  agencies, and blocks release while a required formality is unsatisfied. Mirrors CSW-CERTEX: the
  permit is *verified against the declaration data*, not merely attached to it — quantity decremented,
  validity checked, consignee matched.
- **SW5 prohibitions & restrictions.** Prohibited and restricted goods keyed by classification and
  origin, evaluated at submission, with the legal instrument cited on refusal.
- **SW6 tariff quotas.** Quota periods with balances, allocation on a first-come basis, and drawdown
  that cannot go negative or double-spend under concurrency.
- **SW7 appeals.** A right-of-appeal workflow against a customs decision (assessment, seizure,
  classification, refusal), with statutory deadlines, independent reviewer separation from the
  original decision-maker, and an outcome that can actually reverse the decision it appeals.
- **SW3 completion.** Declaration cancellation, and refund of overpaid duty, distinct from drawback.
- **SW8 hardening.** Advance rulings become binding: a ruling on the same HS code/goods for the same
  trader is applied to later assessment, and diverging from it requires a recorded justification.
- **FX fail-closed.** Stated in section 2. No authoritative rate for the valuation date means the
  assessment refuses, using the CBN rate as the Nigerian source of truth.

## 4. The six innovations for this track

**J1 — Formality-aware clearance graph.** Compute, at submission, the exact set of formalities a
consignment needs (SW4/SW5/SW6 evaluated together) and expose it as a dependency graph the trader can
see: what is required, what is satisfied, what is blocking, and which legal instrument imposes it.
Reference platforms tell a trader their declaration was rejected; this tells them the specific
unsatisfied obligation before they submit.

**J2 — Quota drawdown on the double-entry ledger.** Tariff-quota balances are held as ledger accounts
rather than a counter column, so allocation is atomic, auditable and impossible to double-spend under
concurrent submissions — the same property the platform already relies on for money. Quota fraud in
practice *is* concurrency fraud, and a `UPDATE ... SET balance = balance - n` column loses that race.

**J3 — Binding advance rulings enforced at assessment time.** A ruling is not a document, it is a
constraint: when a declaration matches an issued ruling's scope, the assessment must follow it, and an
officer departing from it must record a justification that is itself appealable. Turns TFA Art. 3 from
a filing cabinet into a control.

**J4 — Appeal that reverses through the ledger.** An upheld appeal against an assessment issues the
corrective ledger entries (refund, quota restoration, seizure release) as part of the appeal outcome,
rather than leaving a human to remember. Independence is enforced structurally: the reviewer cannot be
the original decision-maker, and the platform's insider-threat surface already gives us the primitives.

**J5 — Staleness-aware valuation.** Every assessment records the exchange rate it used, its source,
and the age of that rate; an assessment computed on a rate older than its permitted window is refused
rather than silently produced. The FX defect above becomes structurally impossible instead of
individually patched.

**J6 — Regulatory-change replay.** Formalities, P&R entries, quotas and tariff rates are all
effective-dated. That makes it possible to ask what a past declaration *would* have been assessed at
under today's rules, and — more usefully for a revenue authority — to quantify the exposure of a rule
change before enacting it, over real historical declarations rather than a projection.
