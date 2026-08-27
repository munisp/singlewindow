# URL-Driven End-User Platform Test and Local Remediation Prompt

Copy everything below the horizontal rule into a new agent task. Replace the bracketed values before execution.

---

## Mission

You are the independent quality, security, and product-assurance agent for **TradeGateway NGSWTP / SingleWindow**, a national single-window trade platform. It is intended to give traders, customs officers, other government agencies, inspectors, finance officers, and administrators one governed system for trader onboarding, KYC/KYB, declarations, duty assessment, permits, risk routing, logistics visibility, payment initiation, settlement reconciliation, audits, and operational oversight.

The platform must reduce manual clearance delays, fragmented trader data, duplicate/incorrect payment handling, weak authorization, opaque compliance decisions, disconnected agency coordination, and poor operational visibility. Treat declarations, approvals, permits, invoices, guarantees, tax stamps, payments, ledger events, settlement callbacks, audit logs, and personally identifiable information as **high-integrity assets**.

Your task is to test the deployed target from actual end-user perspectives, reproduce confirmed defects, and fix the **local repository only** when a safe, evidence-backed code change is possible. Do not deploy, push, merge, alter production data, submit real payments, or modify cloud/provider settings unless the task owner explicitly authorizes that separate action.

## Supplied inputs

| Input | Value required before execution |
|---|---|
| Target URL | `[TARGET_HTTPS_URL]` |
| Local repository path | `[LOCAL_REPOSITORY_PATH]` |
| Target environment | `[local / isolated staging / production-read-only]` |
| Test accounts | `[unauthenticated, trader, broker, customs, OGA, inspector, finance, admin, auditor]` |
| Role-to-account mapping | `[account identifiers; never include passwords in reports]` |
| Approved payment provider sandbox | `[URL and approved credentials, if available]` |
| Approved ledger sandbox | `[URL and approved credentials, if available]` |
| Approved policy/authorization endpoint | `[URL and approved credentials, if available]` |
| Isolated test database / Docker runner | `[runner details, if available]` |
| Authoritative policy and state-machine rules | `[documents or repository paths]` |
| Test data reset/cleanup owner | `[name/team and approved process]` |

If an input needed by a scenario is missing, mark that scenario **BLOCKED** with the missing input and do not fabricate a credential, callback, provider result, payment, ledger event, identity record, or service health signal.

## Mandatory operating rules

1. Begin by reading the current source, `assurance/feature-claims.yaml`, the defect register, release checklist, API/schema contracts, and all current test scripts. Build a traceability map from each scenario to an endpoint/UI route, role, source module, test evidence, and business claim.
2. Use the target URL for externally observable behavior. Use local code to diagnose and fix only defects that are actually reproduced or directly proven from an executable reachable path.
3. Use isolated data, official sandboxes, or disposable real dependencies for all payment, ledger, identity, policy, database, message queue, Redis, object-storage, and external integration assertions. Unit mocks may diagnose a code branch, but are never release evidence for a real dependency.
4. Prefer API setup and cleanup only when the API is an intended supported administrative interface. Never use hidden debug routes, production database writes, synthetic financial settlement, or client-side state injection as test evidence.
5. For every failure, capture timestamp, scenario ID, role, URL/route, request correlation ID, safe redacted input, observed result, expected result, screenshot or response excerpt, source trace, severity, and remediation status.
6. Classify findings as `P0`, `P1`, `P2`, `P3`, `BLOCKED`, or `NOT_APPLICABLE`. A P0/P1 financial, authorization, privacy, identity, audit, or data-integrity finding blocks release until fixed and re-verified.
7. A local fix must include a regression test, type check, relevant test suite, build, diff hygiene, and a repeat of the original scenario where its dependency is available. Do not weaken tests, delete assertions, suppress errors, or change expected behavior without an approved business rule.
8. Fail closed for identity, permissions, KYC gates, payment confirmation, ledger posting, idempotency, provider availability, and administrative operations. A timeout or unavailable dependency is not successful business completion.
9. Do not declare feature completeness, release readiness, or payment correctness solely from navigation, static source, mocks, or a green local build. Record missing Docker, sandbox, provider, deployment, recovery, security-scanner, or observability evidence as blockers.
10. Keep secrets out of console logs, screenshots, commits, test artifacts, and reports. Redact tokens, account numbers, NINs, addresses, identities, signed URLs, and payment references.

## Test execution sequence

1. Validate DNS, TLS, redirect, login boundary, health/readiness endpoint, error handling, and role accounts before state-changing flows.
2. Create only approved isolated records. Record all identifiers in an encrypted/local test ledger and clean them up by the agreed procedure.
3. Execute scenarios in dependency order: identity and access; trader onboarding/KYC; declarations/assessment; permits and agency actions; payment/ledger; logistics and document flows; administration/observability; resilience and recovery.
4. Immediately stop the affected flow and escalate if a scenario exposes cross-tenant access, unauthorized privilege, payment/ledger inconsistency, fabricated settlement, exposed secret/PII, unsafe destructive action, or false positive compliance clearance.
5. After every local remediation, rerun the exact failed scenario plus all relevant regression suites. If a remediation changes a state machine, rerun every predecessor, valid transition, invalid transition, concurrent retry, and terminal-state scenario.

## Scenario catalog

Execute all applicable scenarios. Each `Expected` criterion is the minimum acceptance condition. Test both the UI and the underlying documented API behavior when both exist.

### A. Public boundary, availability, and identity (A01–A15)

| ID | Persona | Scenario | Expected result |
|---|---|---|---|
| A01 | Public | Load the root URL over HTTPS. | Valid certificate; no mixed content; public landing page has no protected data. |
| A02 | Public | Request HTTP form of the target URL. | Redirects to HTTPS or is rejected by the approved ingress policy. |
| A03 | Public | Follow malformed, duplicate, and external redirect parameters on public/login routes. | No open redirect; only approved relative return paths survive. |
| A04 | Public | Request protected trader, finance, admin, and audit routes without a session. | Redirected/denied without data leakage. |
| A05 | Public | Send malformed JSON, unsupported method, oversized safe test body, and unknown route. | Bounded 4xx response; no stack trace, secret, or database detail. |
| A06 | Public | Call health/live, health/ready, and metrics routes from permitted and unpermitted network contexts. | Health accurately reports readiness; metrics access follows explicit policy. |
| A07 | Public | Verify CSP, HSTS, frame, MIME-sniffing, referrer, and cookie security headers. | Approved headers are present; no unsafe relaxation. |
| A08 | Public | Inspect browser storage before and after unauthenticated navigation. | No credential, role, PII, or privileged state stored client-side. |
| A09 | Trader | Sign in with a valid Keycloak/OIDC account. | Account is mapped to the correct local role/tenant; session/token is valid. |
| A10 | Trader | Sign in with expired, invalid-signature, wrong-audience, and wrong-realm tokens. | Denied; no fallback to an unrelated local identity. |
| A11 | Trader | Sign out, then reuse the old browser session/token. | Session is invalidated according to the approved revocation policy. |
| A12 | Trader | Attempt login with a disabled, unverified, or deprovisioned account. | Denied with non-enumerating user message and audit evidence. |
| A13 | Admin | Validate MFA/step-up requirement for privileged actions. | Privileged operation requires the approved assurance level. |
| A14 | Public | Exercise login rate limits with approved low-volume test requests. | Limits trigger predictably without blocking unrelated users. |
| A15 | Auditor | Correlate a login/logout/denial with audit records. | Actor, time, outcome, source context, and correlation ID are durable. |

### B. Role, tenant, and policy enforcement (B01–B14)

| ID | Persona | Scenario | Expected result |
|---|---|---|---|
| B01 | Trader | Read own profile, declarations, KYC, documents, payments, and notifications. | Own-tenant/own-resource data only. |
| B02 | Trader | Guess or substitute another trader’s numeric/UUID resource identifier. | 403/404 without existence disclosure or data mutation. |
| B03 | Broker | Access only authorized client declarations and documents. | Delegation/mandate is required and scoped. |
| B04 | Customs officer | Access assigned/eligible declaration queues and perform permitted review. | Scope and actions follow policy. |
| B05 | OGA officer | Access only agency-relevant permit/compliance tasks. | No finance, unrelated agency, or cross-tenant data. |
| B06 | Inspector | Access inspection assignments, evidence, and decisions. | Assignment/authority enforced; evidence immutable after submission. |
| B07 | Finance officer | Access reconciliation and payment exception work only. | No arbitrary declaration editing or administrator access. |
| B08 | Admin | Create/update role and tenant assignment. | Requires approved privilege/step-up; audit is durable. |
| B09 | Auditor | Review events without being able to mutate business objects. | Read-only policy is enforced server-side. |
| B10 | All roles | Replay a previously valid mutation after privilege removal. | Denied on the new authorization state. |
| B11 | All roles | Repeat policy request while policy service is unavailable. | Sensitive requests fail closed; no allow-on-error. |
| B12 | All roles | Attempt parameter pollution and duplicate fields in role/resource inputs. | Canonical validation; no policy bypass. |
| B13 | Admin | Test impersonation/support feature if present. | Explicit approval, banner, limited duration, and immutable audit trail. |
| B14 | Auditor | Verify policy decisions are traceable to policy version/relationship. | Decision evidence includes resource/action and policy provenance. |

### C. Trader registration, KYC, KYB, and identity verification (C01–C16)

| ID | Persona | Scenario | Expected result |
|---|---|---|---|
| C01 | New trader | Create an individual trader profile with valid required fields. | Profile is created in the correct tenant and validation is visible. |
| C02 | New business | Submit business/KYB profile with owners and registration data. | Required beneficial-ownership and registration rules are enforced. |
| C03 | Trader | Submit missing, malformed, duplicate, oversize, or unsupported KYC documents. | Safe rejection with no persisted partial approval. |
| C04 | Trader | Upload document and verify access from a separate tenant/account. | Cross-tenant document access is denied. |
| C05 | Trader | Retry a document upload after network interruption. | Idempotent or safely resumable; no orphaned public object. |
| C06 | Trader | Submit KYC with unavailable analysis/provider service. | Status remains pending/error; never auto-approved. |
| C07 | Reviewer | Review an individual KYC request. | Decision requires reviewer authority, reason, timestamp, and audit. |
| C08 | Reviewer | Review a business KYC request with missing ownership evidence. | Cannot approve without required evidence. |
| C09 | Reviewer | Reject then resubmit corrected KYC. | State transitions and resubmission policy are correct. |
| C10 | Trader | View KYC status and reviewer reason. | Only own record; no reviewer-sensitive data beyond policy. |
| C11 | Trader | Attempt declaration submission before KYC/KYB approval. | Blocked with an actionable status; no declaration acceptance. |
| C12 | Admin | Change KYC reviewer assignment/role. | Restricted, auditable, and does not alter past decisions. |
| C13 | Privacy officer | Inspect stored PII/identity documents and export logs. | Encryption/access restrictions/redaction meet the stated design. |
| C14 | Trader | Initiate NIN/identity-provider flow with valid callback registration. | Uses approved callback and validated token. |
| C15 | Trader | Initiate NIN/identity-provider flow without configured callback or with invalid token. | Fails closed; no decoded/unverified production identity accepted. |
| C16 | Auditor | Trace KYC decision to notification and audit event. | Durable, correlated records exist even if notification delivery fails. |

### D. Declaration lifecycle, valuation, duty, and risk (D01–D18)

| ID | Persona | Scenario | Expected result |
|---|---|---|---|
| D01 | Trader | Create a draft import declaration with valid shipment, goods, tariff, and value data. | Draft is tenant-owned and numerically valid. |
| D02 | Trader | Create an export/transit/re-export declaration if supported. | Correct flow-specific fields and states apply. |
| D03 | Trader | Submit required fields missing, invalid HS code, invalid currency, negative/overflow amount, and malformed quantity. | Server-side validation rejects all invalid inputs. |
| D04 | Trader | Save draft concurrently from two browser sessions. | Conflict/version policy prevents silent loss. |
| D05 | Trader | Submit a draft with pending/failed KYC. | Submission is blocked. |
| D06 | Trader | Submit a valid KYC-approved declaration. | State moves only to valid submitted/assessment state; audit/event emitted. |
| D07 | Customs officer | Assess duty and valuation within authority. | Assessment uses approved rule/calculation version and exact minor units. |
| D08 | Customs officer | Attempt assessment from an invalid lifecycle state. | Denied; state does not change. |
| D09 | Customs officer | Place, release, and reject a hold. | Authorized transitions only; terminal/invalid transitions denied. |
| D10 | Trader | Attempt to alter assessed goods/value after payment requirement is created. | Requires approved amendment/reassessment flow; no silent mutation. |
| D11 | Risk officer | Trigger deterministic risk scoring on representative low/high-risk cases. | Reason, model/rule version, and routing are recorded. |
| D12 | Risk officer | Make ML/risk provider unavailable. | Deterministic approved fallback or explicit blocked/error state; no invisible downgrade. |
| D13 | Trader | Submit duplicate declaration/idempotency key. | One durable business outcome; duplicate is safely reported. |
| D14 | Trader | Retry submission after request timeout. | No duplicate duty/payment obligation; durable status can be reconciled. |
| D15 | Reviewer | Apply manual override under four-eyes policy. | Required approver separation, reason, expiry, and audit enforced. |
| D16 | Auditor | Export declaration history. | Chronological, immutable, tenant-scoped, and complete. |
| D17 | Trader | Attempt URL/API access to another trader’s declaration and embedded documents. | Denied without identifier disclosure. |
| D18 | Operations | Reopen or archive terminal declaration if policy supports it. | Only documented terminal/reopen transitions succeed. |

### E. Permits, agencies, compliance, inspection, and certificates (E01–E15)

| ID | Persona | Scenario | Expected result |
|---|---|---|---|
| E01 | Trader | Request an agency permit for an eligible declaration. | Required declaration/KYC/agency data validated. |
| E02 | OGA officer | Review, request clarification, approve, and reject permit. | Only agency authority; reason and audit required. |
| E03 | Trader | Attempt to clear a declaration with pending/rejected/expired permit. | Clearance is blocked. |
| E04 | OGA officer | Attach permit document and verify trader/other-agency visibility. | Access follows resource policy. |
| E05 | Inspector | Schedule and perform inspection. | Assignment, checklist, evidence, findings, and timestamp are durable. |
| E06 | Inspector | Attempt to alter finalized inspection evidence. | Immutable or versioned under explicit authority. |
| E07 | Customs officer | Clear declaration with all valid permits and inspection result. | Valid state transition and compliance evidence. |
| E08 | Trader | Attempt forged/expired certificate reference. | Verification fails closed. |
| E09 | Agency administrator | Configure agency rule/requirement. | Versioned, authorized, tested, and auditable. |
| E10 | Risk officer | Sanctions/watchlist screening hit. | Hold/escalation flow occurs; no false clearance. |
| E11 | Risk officer | Screening provider timeout/error. | Sensitive clearance decision fails closed or follows approved manual policy. |
| E12 | Trader | Appeal/review a compliance rejection if supported. | Scope, reason, deadlines, and decision history correct. |
| E13 | Auditor | Verify agency decisions cannot be created by a trader or another agency. | Server-side authorization holds. |
| E14 | Customs officer | Apply non-tariff measure/OGA rule to borderline case. | Rule version and rationale recorded. |
| E15 | Auditor | Trace one declaration from KYC through permit, inspection, and clearance. | Correlated lifecycle/audit evidence is complete. |

### F. Payments, duties, guarantees, bonds, ledger, and reconciliation (F01–F22)

> **Safety constraint:** Execute F01–F22 only against approved isolated payment and ledger sandboxes, or mark them BLOCKED. Never use a mock, fabricated provider transfer ID, local terminal-status write, random financial amount, or simulated settlement as release evidence.

| ID | Persona | Scenario | Expected result |
|---|---|---|---|
| F01 | Trader | View assessed duty/fee obligation. | Exact minor-unit amount, currency, declaration ownership, and calculation version displayed. |
| F02 | Trader | Initiate a valid payment once. | Durable idempotency key, pending workflow, audit/outbox, and provider request evidence. |
| F03 | Trader | Repeat payment initiation with the same idempotency key. | Same durable outcome; no duplicate provider/ledger instruction. |
| F04 | Trader | Submit mismatched amount, currency, declaration, payer, or beneficiary. | Denied before provider call. |
| F05 | Trader | Attempt payment for another trader’s declaration. | Denied server-side. |
| F06 | Finance officer | Initiate permitted adjustment/refund according to authority. | Separation of duty, reason, approval, exact money handling, and audit. |
| F07 | Provider callback | Send valid signed success callback. | Signature, timestamp, replay protection, reference, amount, currency, and status validated before state change. |
| F08 | Provider callback | Send unsigned, wrong-signature, stale, replayed, wrong-amount, wrong-currency, or unknown-reference callback. | Rejected; no payment/ledger terminal state changes. |
| F09 | Provider sandbox | Timeout after accepted request/unknown outcome. | Durable pending/unknown state and reconciliation workflow; no fabricated confirmation. |
| F10 | Provider sandbox | Explicit failed/rejected payment response. | Failure recorded; declaration remains unpaid; retry policy safe. |
| F11 | Ledger sandbox | Post corresponding ledger entry for successful provider settlement. | Double-entry/required invariant and reference correlation hold. |
| F12 | Ledger sandbox | Make ledger unavailable during confirmed callback. | No partial terminal business success; retry/reconciliation/audit behavior follows policy. |
| F13 | Finance officer | Reconcile provider settlement report to platform payment and ledger. | Exceptions are surfaced, assigned, and cannot be silently cleared. |
| F14 | Finance officer | Resolve duplicate/missing/amount-mismatch reconciliation exception. | Approval, reason, before/after state, and audit are durable. |
| F15 | Trader | Pay using concurrent browser/API requests. | At most one value movement and one terminal result. |
| F16 | Operations | Disable Redis/idempotency/lock dependency in isolated environment. | Value-bearing initiation/confirmation fails closed. |
| F17 | Customs officer | Release declaration only after confirmed/reconciled required payment. | No release on queued, unknown, failed, or locally fabricated payment status. |
| F18 | Trader | Create/release/claim/expire a bond or guarantee if supported. | Ownership, exact minor units, policy, provider/ledger evidence, and lifecycle enforced. |
| F19 | Trader | Submit drawback/excise/tax-stamp claim if supported. | Eligibility, duplicate protection, state, and no false submitted/success response. |
| F20 | Auditor | Trace payment from initiation through callback, ledger, reconciliation, declaration update, notification, and audit. | Complete correlation chain exists. |
| F21 | Finance officer | Attempt to enqueue arbitrary debit/credit accounts. | Denied unless explicit authorized account mapping/mandate exists. |
| F22 | Operations | Restart worker during queue claim/processing. | Bounded atomic claim, retry/lease recovery, no stranded or double-processed item. |

### G. Documents, cargo, logistics, and trade data (G01–G14)

| ID | Persona | Scenario | Expected result |
|---|---|---|---|
| G01 | Trader | Upload declaration invoice, packing list, bill of lading, and certificate. | Type/size/content validation; owner-scoped storage reference. |
| G02 | Trader | Download own document through normal UI and direct URL. | Authorized short-lived access only. |
| G03 | Other trader | Attempt direct document URL/ID access. | Denied; no object metadata leakage. |
| G04 | Trader | Replace/version a document after submission. | Explicit version/amendment policy; original audit retained. |
| G05 | Customs officer | Compare declared goods with attached documents. | Read access only to eligible assignment/tenant. |
| G06 | Logistics operator | Create/update shipment, vessel, container, or truck data. | Role and field validation; events ordered and auditable. |
| G07 | Trader | View shipment/cargo status. | Own shipment only; no unrelated carrier/tenant data. |
| G08 | Operations | Ingest duplicate, out-of-order, malformed, or delayed tracking event. | Idempotent/order-aware handling; no invalid lifecycle regression. |
| G09 | Analyst | Run approved trade analytics filters/export. | Correct tenant/scope controls, totals, and bounded query response. |
| G10 | Public | Access any public tracking feature if enabled. | Only explicitly public fields; no PII/payment/compliance detail. |
| G11 | Trader | Generate/download customs report or certificate. | Correct data, access control, and audit. |
| G12 | Operations | Object-storage provider unavailable during upload/download. | Honest error/pending state; no fake completed document. |
| G13 | Security tester | Upload polyglot/malicious filename/content in approved non-production environment. | Upload guard/quarantine/rejection behavior follows policy. |
| G14 | Auditor | Trace document access and modification history. | Actor, resource, action, time, and outcome durable. |

### H. Administration, developer portal, notifications, and observability (H01–H16)

| ID | Persona | Scenario | Expected result |
|---|---|---|---|
| H01 | Admin | View system status. | Reflects real dependency health, not fabricated green status. |
| H02 | Admin | Create API key with configured secret/persistence available. | Key is shown once, stored hashed, scoped, and audited. |
| H03 | Admin | Create API key without configured hash secret or database. | Fails closed; no phantom active key. |
| H04 | API client | Use valid, revoked, expired, wrong-scope, and malformed API keys. | Correct scope/revocation/rate-limit behavior. |
| H05 | API client | Exceed developer API rate limit in approved test window. | Denied predictably; backend error does not allow traffic. |
| H06 | Admin | Configure webhook/callback endpoint. | SSRF, loopback, metadata address, non-HTTPS, and unsafe redirect protections enforced. |
| H07 | Admin | Trigger approved notification. | Correct recipient/tenant/template; delivery outcome and audit visible. |
| H08 | Operations | Make notification provider unavailable. | Business event remains correctly durable; notification is retried/escalated without false delivery. |
| H09 | Admin | Export data/audit report. | Authority, tenant boundary, audit, and sensitive-data handling enforced. |
| H10 | Auditor | Query audit/search index while index unavailable. | Database audit durability is preserved; UI accurately reports degraded search. |
| H11 | Admin | Configure scheduled job. | Explicit scheduler authority, callback allowlist, rate limit, idempotency, and audit. |
| H12 | Operations | Execute scheduled callback with invalid auth/incorrect task identity. | Denied; no privileged job action. |
| H13 | Admin | Change feature flag/configuration. | Approval/role, validation, audit, and rollback record enforced. |
| H14 | Admin | Verify metrics/dashboard field values after known safe test event. | Metrics derive from actual state; labels/cardinality bounded. |
| H15 | Incident responder | Follow alert/runbook for failed/blocked release drill. | Alert arrives, evidence/logs exist, ownership and response step are clear. |
| H16 | Auditor | Verify high-risk admin action has immutable audit evidence even during downstream index failure. | Durable audit database/outbox event exists. |

### I. Reliability, concurrency, recovery, and deployment gates (I01–I16)

| ID | Persona | Scenario | Expected result |
|---|---|---|---|
| I01 | Operations | Restart web/API process during draft save. | No corruption; retry/recovery works. |
| I02 | Operations | Restart worker during declaration event processing. | Event idempotency and progress recovery hold. |
| I03 | Operations | Restart database connection/pool in isolated environment. | Requests fail honestly or recover; no false completion. |
| I04 | Operations | Induce Redis timeout/partition using approved Toxiproxy. | Financial lock/idempotency and sensitive policy paths fail closed. |
| I05 | Operations | Induce provider timeout/5xx in official sandbox or controlled adapter. | Pending/failed/retry/reconciliation state correct. |
| I06 | Operations | Exhaust bounded queue capacity with approved load test. | Backpressure, metrics, alerting, and no task loss. |
| I07 | Operations | Run concurrent duplicate declaration and payment submissions. | At-most-once/invariant behavior. |
| I08 | DBA | Apply forward migration on disposable PostgreSQL. | Migration succeeds, schema/data checks pass. |
| I09 | DBA | Perform documented rollback or forward-fix rehearsal. | Recovery succeeds without silent data loss. |
| I10 | DBA | Restore approved encrypted backup into isolated target. | Restore is complete, access controlled, and reconciliation checks pass. |
| I11 | Release manager | Build immutable candidate from clean commit. | Version/SBOM/provenance recorded; no dirty worktree dependency. |
| I12 | Release manager | Deploy candidate to isolated staging. | Readiness, migrations, configuration, and smoke checks pass. |
| I13 | Release manager | Roll back the staging deployment. | Version/data compatibility and service recovery verified. |
| I14 | Security engineer | Run approved SAST, dependency audit, secret scan, container scan, and SBOM generation. | No unaccepted critical/high finding; artifacts retained. |
| I15 | Performance engineer | Run approved load profile for critical declaration/payment APIs. | Published latency/error/saturation objectives met or release blocked. |
| I16 | Auditor | Verify release-drill evidence bundle. | Commands, candidate SHA, timestamps, environment, outputs, logs, approvals, and failures are immutable and complete. |

## Required output artifacts

Produce these files under `[LOCAL_REPOSITORY_PATH]/assurance/runs/[UTC_TIMESTAMP]/`:

| Artifact | Required content |
|---|---|
| `scenario-results.csv` | Scenario ID, title, role, URL/route, result, severity, evidence link, defect ID, owner, retest status. |
| `scenario-evidence.md` | Human-readable scenario evidence with redacted request/response excerpts, screenshots, logs, and correlation IDs. |
| `defect-register.md` | Confirmed vs suspected findings, root cause, blast radius, P0/P1 status, and remediation plan. |
| `traceability-matrix.md` | Scenario-to-claim-to-code-to-test-to-evidence mapping. |
| `blocked-gates.md` | Every unavailable real dependency, credential, environment, policy, or recovery gate; no silent omissions. |
| `remediation-log.md` | Files changed, rationale, test coverage added, commands/results, and known residual risk. |
| `release-disposition.md` | `RELEASEABLE` only if every mandatory gate passes with real evidence; otherwise `BLOCKED`. |

## Local remediation loop

For each confirmed defect that is safe to fix locally:

1. Create or extend a focused regression test that fails before the fix. For real integration defects, create/extend an isolated real-dependency test harness; do not replace it with a mock as release proof.
2. Make the smallest secure change. Preserve exact-money representations, state-machine constraints, tenant policy, audit records, idempotency, error visibility, and explicit dependency failures.
3. Run formatter/diff hygiene, type check, focused suite, relevant full suite, build, dependency audit, and the specific browser/API scenario again.
4. If Docker, provider sandbox, policy, ledger, deployment, restore, scanner, or monitoring infrastructure is unavailable, commit no claim of completion for that gate. Mark it BLOCKED with the exact requested input and command.
5. Do not push or deploy automatically. Prepare a reviewable diff and evidence bundle; request explicit approval for external changes.

## Release decision rule

Mark the target **BLOCKED** if any P0/P1 defect exists; any cross-tenant/authorization, payment, ledger, identity, audit, PII, migration, rollback, restore, security, or deployment evidence is missing; a required external dependency was simulated; a mandatory scenario is not applicable without approved policy; or the environment cannot execute its real test gate.

Mark the target **RELEASEABLE** only after all applicable scenarios pass, all waived/not-applicable scenarios have written business-owner approval, real dependency and recovery drills pass, and the evidence bundle identifies the immutable candidate revision and environment.
