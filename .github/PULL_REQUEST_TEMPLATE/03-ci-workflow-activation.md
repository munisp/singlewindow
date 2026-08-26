# PR-C — Activate self-hosted CI workflow and required pull-request checks

## Change purpose

Describe the workflow trigger, `runs-on` label, harness invocation, artifact, matrix, path-filter, or branch-protection change. Link the successful staged-host run that proves the exact runner labels are idle and capable.

## Precondition proof

| Required precondition | Evidence link or run ID |
| --- | --- |
| Runner is online with `self-hosted`, `linux`, `x64`, `docker`, and `singlewindow-ci` labels |  |
| Runner can execute Docker and Docker Compose v2 |  |
| Runner can pull required images and install/use pinned language toolchains |  |
| Disposable PostgreSQL harness succeeds |  |
| Redis/Toxiproxy test job succeeds |  |
| Go, Rust, TypeScript, and artifact jobs succeed on a staging branch |  |
| Queue latency and cleanup behavior meet the defined staging SLO |  |

## Workflow evidence

- [ ] Workflow YAML and repository-local validators pass.
- [ ] A manual dispatch on a non-protected branch succeeds.
- [ ] A normal pull request succeeds without relying on an existing workspace or database volume.
- [ ] The harness runs on every intended pull request and uploads test, coverage, and diagnostic artifacts.
- [ ] Failure paths use `if: always()` or equivalent artifact collection where required.
- [ ] Changed-path logic cannot skip a P0 declaration, payment, schema, runner, or harness change.
- [ ] Job labels match the registered runner exactly.
- [ ] No external action, mutable image tag, or unreviewed secret dependency was introduced.

## Branch-protection proposal

- [ ] Required check name(s) are listed.
- [ ] Required review count and code-owner paths are listed.
- [ ] Administrator bypass policy is documented.
- [ ] Break-glass procedure creates an auditable incident/change record.

## Reviewer sign-off

| Reviewer role | Name | Required sign-off |
| --- | --- | --- |
| Repository administrator |  | I confirm Actions settings and required-check policy are correct. |
| Platform/SRE owner |  | I confirm runner capacity, labels, artifacts, and cleanup behavior. |
| QA/automation owner |  | I confirm the workflow runs the intended tests and reports useful failures. |
| Security owner |  | I confirm secrets, permissions, trusted-code boundary, and bypass controls. |

## Merge gate

- [ ] The staged-host proof is linked above.
- [ ] One staging PR completed with the final workflow YAML.
- [ ] All four reviewer roles approved.
- [ ] Required branch checks are enabled only after this PR merges successfully.
