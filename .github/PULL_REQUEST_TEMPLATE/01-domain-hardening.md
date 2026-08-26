# PR-A — P0 domain hardening: declarations, KYC, and lifecycle rules

## Change purpose

Describe the business invariant this change protects. State whether it changes persisted declaration status behavior, KYC/KYB eligibility, authorization, audit records, notifications, or tests only.

## In scope

- [ ] Declaration creation, submission, status transition, document, certificate, assignment, bulk-action, or export behavior is identified.
- [ ] KYC/KYB decision behavior is identified.
- [ ] Every changed persisted status is present in `drizzle/schema.ts` and the business-rule transition graph.
- [ ] Every changed authorization rule identifies owner, officer, administrator, and cross-tenant behavior.

## Required evidence

- [ ] Focused Vitest command and result are attached.
- [ ] Clean PostgreSQL harness command and result are attached when persistence changes.
- [ ] Success, validation failure, dependency failure, unauthorized, and cross-tenant scenarios are covered.
- [ ] State-transition tests include the new allowed and forbidden action/state combinations.
- [ ] Audit/event/notification side effects are asserted or explicitly documented as out of scope.
- [ ] Focused V8 branch coverage for changed P0 procedures is attached and does not regress the approved baseline.
- [ ] TypeScript check passes.

## Data and migration review

- [ ] No migration is required.
- [ ] A forward-only migration is included, reviewed, and tested against a clean database.
- [ ] Backfill, rollback, compatibility, and tenant isolation implications are documented.

## Reviewer sign-off

| Reviewer role | Name | Required sign-off |
| --- | --- | --- |
| Trade-domain owner |  | I confirm the lifecycle and customs-business rules are correct. |
| QA/automation owner |  | I confirm the tests exercise the declared positive, negative, and failure paths. |
| Security/authorization owner |  | I confirm tenant/role access and audit behavior do not regress. |
| Database owner, if schema changes |  | I confirm migration safety, constraints, and rollback/recovery plan. |

## Merge gate

- [ ] All required checks pass.
- [ ] At least one trade-domain and one QA/automation approval are recorded.
- [ ] Security approval is recorded for authorization, PII, document, or audit changes.
- [ ] The PR description links the P0 roadmap work item, coverage baseline/delta, and any follow-up issue.
