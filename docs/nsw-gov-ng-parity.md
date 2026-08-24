# nsw.gov.ng parity analysis

Comparison of the live Nigeria National Single Window portal (`https://nsw.gov.ng`, public surface
observed 2026-08-24, including the `cusLogin/login.cl` landing page) against this platform.

Only the public surface of nsw.gov.ng is observable — the portal is a login wall, so its eServices
catalogue, "Facts and Figures" panel and public utility tiles are the evidence base. Anything behind
authentication (the actual declaration and manifest screens) cannot be compared and is not claimed
about below.

## What NSW exposes publicly

| NSW eService tile | Nature |
|---|---|
| Importer/Exporter Registration | Self-service party registration |
| Licensed Customs / Freight Forwarding Agent Registration | Self-service party registration, licence-backed |
| Shipping Lines Registration | Self-service party registration |
| Shipping Company Registration | Self-service party registration |
| Airlines / GHA Registration | Self-service party registration |
| Freight Forwarders Registration | Self-service party registration |
| LCFFA Authorization Registration | Principal→agent mandate creation |
| LCFFA Authorization De-Registration | Principal→agent mandate revocation |
| Track your Application | Unauthenticated status lookup by reference |
| Cargo Tracking | Unauthenticated cargo status lookup |
| Permit/COO Validation | Unauthenticated document authenticity check |

## Gap assessment

### G1 — Only one party type can register. CONFIRMED gap

Onboarding is a single trader/company wizard: `server/routers/onboarding.ts` drives the five steps of
`onboardingStepEnum` (`company_profile`, `kyc_documents`, `bank_account`, `test_declaration`,
`aeo_eligibility`) and `selectRole` now accepts only `z.enum(["user"])`. There is no registration path
for a licensed customs/freight-forwarding agent, shipping line, shipping company, or airline/GHA.

`stakeholderTypeEnum` (`drizzle/schema.ts:11`) does contain `freight_forwarder`, `bank_officer` and
`port_authority`, but no registration flow, licence capture, or approval queue references them — the
values are unreachable. Six of the NSW eServices tiles have no counterpart here.

Consequence: a carrier cannot become a user of this platform at all, yet `manifests.submit`
(`server/routers/manifests.ts:41`) is a plain `protectedProcedure` that any authenticated user may
call — so the party type that *should* file manifests cannot register, while every party type that
should not can file them.

### G2 — No agent mandate model. CONFIRMED gap, and it now blocks a legitimate flow

NSW treats agent authorization as two first-class eServices; here there is no concept of one party
acting for another. `declarant` appears in the codebase only as a display string on audit tasks
(`drizzle/schema.ts:1874`), never as an authorization relationship.

This is now load-bearing: the ownership hardening in PR #33 derives trader identity from
`ctx.user.id` for declarations, trade finance and payments. That is correct as a default and closed a
real horizontal-privilege hole, but with no mandate model the platform cannot express the single most
common real-world customs arrangement — an importer engaging a licensed agent to clear on their
behalf. The honest fix is a mandate, not a relaxation of the ownership check.

### G3 — No "Track your Application". CONFIRMED gap

The only unauthenticated routes are `/verify/:certNumber`, `/status` and `/specification`
(`client/src/App.tsx:167-186`). There is no reference-number status lookup, and no user-facing
reference number is minted for a registration or permit application in the first place.

### G4 — Permit validation is COO-only. PARTIAL gap

`/verify/:certNumber` covers AfCFTA certificates of origin
(`rulesOfOrigin.verifyCertificate`), which is half of the NSW "Permit/COO Validation" tile. OGA
permits — the other half — have no public validation: every procedure in `server/routers/oga.ts` is
`protectedProcedure`, and `ogaPermits` (`drizzle/schema.ts:206`) already carries the
`permitNumber` and `expiresAt` a validation check needs.

### G5 — Public cargo tracking is fabricated, and for the wrong country. CONFIRMED defect

`cargoTracking.getLiveVessels`, `getVesselRoute`, `getShipmentPosition`, `getPortArrivals` and
`searchVessels` are `publicProcedure`s served from the hardcoded `BASE_VESSELS` array
(`server/routers/cargoTracking.ts:56`) — `MSC NAIROBI`, `coverageArea: "Indian Ocean — East Africa
Corridor"`, `port: "Mombasa International Port"`, `portCode: "KEMBA"`, positions synthesised by
`driftVessel()` from the wall clock.

Two problems, in order of severity. First, this is the same fabricated-operational-data family the
PR #33 audit remediated elsewhere: an unauthenticated caller asking where their cargo is receives an
invented vessel position. Second, the data is Kenyan — Mombasa, an East-Africa corridor, and a Kenyan
port code — in a platform whose declarations, duties and FSPs are Nigerian. The audit's currency
incoherence finding (GHS/NGN/USD) and this are the same underlying issue: the demo content was never
localised to the jurisdiction the platform claims to serve.

### Not gaps

- **Declarations, duty/tax assessment, risk lanes, manifests, OGA permits, AEO, drawback, bonded
  warehousing, free zones, payments.** This platform goes substantially *beyond* the observable NSW
  surface here; NSW's own portal lists Declarations as "Coming Soon" for Q1-2026.
- **The published statistics panel.** NSW renders `Active Users 0`, `Uptime 0%`, `Daily Volume ₦0`
  alongside hardcoded-looking quarterly counts. Not a gap to close — a reminder that this platform's
  own dashboards must not do the same, which is what the PR #33 remediation enforced.
