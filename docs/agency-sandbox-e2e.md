# Agency Sandbox End-to-End Evidence (Phase 10 WP-2b)

This document describes how the singlewindow platform's six external agency
adapters (`server/_core/externalAdapters/`: NCS B'Odogwu, CBN TMS, NEPC, NIS,
Port Health, NPA e-SEN) are proven **end-to-end against the live
[blueeconomy-agency-sandbox](https://github.com/munisp/blueeconomy-agency-sandbox)**
— real Go simulator processes, real HTTP, real Ed25519/JWS envelope
signatures. **No mocks of the sandbox exist anywhere in the evidence path.**

> **Production posture is unchanged.** Every adapter remains fail-closed:
> without real counterpart credentials (`*_URL` / `*_SIGNING_KEY` /
> `*_KEY_ID`) each call rejects with `ADAPTER_UNCONFIGURED` before any
> network I/O, and the registered GAP ids (GAP-OGA-BODOGWU, GAP-OGA-CBNTMS,
> GAP-OGA-NEPC, GAP-MSW-NIS, GAP-MSW-PH, GAP-MSW-ESEN) **remain in the gap
> registry until the real counterpart integration agreements and credentials
> exist.** The sandbox endpoints are configured via env in TEST scope only,
> exactly as a staging counterpart would be. A green sandbox run is evidence
> of adapter behavior, envelope wire-compatibility, and resilience — not of
> production connectivity to any government system.

## One-command reproduction

Prerequisites: Go 1.25+, Node 20+, `npm install` done, and a checkout of the
sandbox repository. PostgreSQL is optional but recommended (enables the MSW
port-call e2e against a real database; without it that suite skips with a
printed reason).

```sh
git clone https://github.com/munisp/blueeconomy-agency-sandbox
SANDBOX_DIR=$PWD/blueeconomy-agency-sandbox \
  scripts/agency-sandbox-e2e.sh conformance-report.wp2b.json
```

The script:

1. Generates **per-run TEST-ONLY Ed25519 key material in memory** (platform
   egress key, per-agency sandbox keys, rogue keys, conformance-report key —
   nothing secret touches disk).
2. Builds and boots **12 sandbox processes**: the six agency simulators on
   `:8081–8086` (trusted; `SANDBOX_TRUST_KEYS` configured so they *really*
   verify the platform's Ed25519 egress JWS, kid
   `blueeconomy-singlewindow-oga-<adapter>-1`), plus six **rogue** instances
   on `:8091–8096` signed with unknown keys at epoch `99` (kid
   `<agency>-sandbox-99` — not in the trusted JWKS set).
3. Runs vitest on:
   - `server/externalAdapters.test.ts` — the pre-existing fail-closed unit
     suite (16 tests, unconditional);
   - `server/externalAdapters.e2e.test.ts` — the live suite below;
   - `server/mswPortCall.e2e.test.ts` — the MSW port-call flow (DB-gated).
4. Signs the collected evidence into the **conformance report**
   (`scripts/signAgencyConformanceReport.ts`): JWS EdDSA over the RFC 8785
   (JCS) canonical report, kid
   `blueeconomy-singlewindow-oga-conformance-<epoch>`, with the report
   public key embedded for offline verification. The committed artifact is
   `docs/conformance/wp2b-agency-sandbox-e2e.report.json`.
5. Tears everything down.

## What is proven, per adapter (all six)

| Path | Proof |
| --- | --- |
| **Happy** | Adapter `send()` → sandbox verifies the signed egress envelope (`signatureVerified: true` in the signed response payload) → typed receipt (`receiptReference`, agency status) → the sandbox-signed `responseEnvelope` (kid `<agency>-sandbox-<epoch>`) verifies via `verifyEgressEnvelope` against the sandbox's own live JWKS. The exported helper every production call site uses is smoke-checked too. |
| **Refusal** | `X-Sandbox-Scenario: REFUSE` (test/sandbox-scope header, plumbed via `SendOptions.headers`) → the adapter surfaces the agency's typed refusal status honestly (`REJECTED`, with the realistic refusal reason inside the signed response payload) — HTTP 200, no error, no fabrication. |
| **Fault** | `FAULT` → HTTP 503 → `AdapterTransportError(UPSTREAM_ERROR, statusCode=503)`. `TIMEOUT` (sandbox hangs 30 s) → the adapter's own 10 s deadline trips → `AdapterTransportError(TIMEOUT)` — no hang, no fabricated success. |
| **Trust** | The same call against the rogue instance returns a well-formed envelope signed by `<agency>-sandbox-99`; verification against the **trusted** JWKS set rejects with `untrusted_kid`, while the same envelope verifies under the rogue JWKS — proving the rejection is about trust, not format. |
| **Unconfigured (regression)** | With the sandbox reachable but adapter env absent, every adapter rejects `ADAPTER_UNCONFIGURED` + its gap id and a counting fetch stub proves **zero network attempts**. The unconditional 16-test fail-closed suite stays green in the same run. |

## MSW port-call verification (GAP-MSW-ESEN / PORT_CALL_UNAVAILABLE)

`server/mswService.createVisit` consults the NPA e-SEN adapter as the
designated upstream when port-interop is unavailable. The adapter now calls
the sandbox's purpose-built `/v1/port-calls/verify` endpoint
(`verifyEsenPortCall` in `npaEsen.ts`), which returns `verified: true` only
when a registered e-SEN matches **both** the IMO number and the UN/LOCODE.

`server/mswPortCall.e2e.test.ts` proves, against the live sandbox **and a
real PostgreSQL database**:

1. env absent (sandbox up) → `PORT_CALL_UNAVAILABLE`, gap `GAP-MSW-ESEN`
   disclosed, visit honestly created with `portCallVerified=false`;
2. e-SEN registered in the sandbox + env configured → the visit flow
   advances to **`VERIFIED`** (`portCallUpstream: "npa-esen"`,
   `portCallVerified=true`);
3. IMO/port with no matching e-SEN → honest `PORT_CALL_UNVERIFIED`
   (`verified:false`/`NOT_FOUND` from the sandbox — not an error);
4. sandbox down (connection refused) → fail-closed `PORT_CALL_UNAVAILABLE`
   again — the visit is still created, honestly unverified.

## Conformance report (audit artifact)

`docs/conformance/wp2b-agency-sandbox-e2e.report.json` records all 40
scenarios (6 adapters × 6 paths + 4 MSW port-call scenarios) with request /
response sha256 digests captured live, the response kids, the
`signatureVerified` flags, and a `scenariosDigestSha256` over the
JCS-canonical scenario set. The report is JWS-signed (EdDSA/Ed25519 over RFC
8785 JCS); verify it offline with the embedded public key, e.g.:

```sh
npx tsx scripts/signAgencyConformanceReport.ts --help 2>/dev/null || true
# verification is plain JWS-over-JCS: strip provenance.signature, JCS-canonicalize,
# verify Ed25519 against provenance.publicKeyBase64Url (kid blueeconomy-singlewindow-oga-conformance-1)
```

Because all key material is per-run and ephemeral, a re-run produces a
differently-signed report over the same scenario set — the evidence is the
*run*, and the signature binds the scenario digests to that run.

## Honest limits

- The sandbox is a simulator. `signatureVerified: true` proves the sandbox
  cryptographically verified the platform's egress JWS with a key it was
  configured to trust — the production trust exchange with each real agency
  is still outstanding (FG must-bring).
- Without PostgreSQL the MSW port-call suite skips (printed reason); the
  adapter-level e2e and the fail-closed suites are unaffected.
