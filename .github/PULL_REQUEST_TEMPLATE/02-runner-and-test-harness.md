# PR-B — Dedicated runner and disposable PostgreSQL harness

## Change purpose

Describe the runner image, registration, Compose, harness, or test-isolation change. This PR must **not** switch repository workflows to self-hosted labels; that activation belongs in PR-C after the staged-host proof succeeds.

## Runtime boundary

| Question | Response |
| --- | --- |
| Dedicated host / environment |  |
| Trusted repositories permitted |  |
| Docker socket exposure and rationale |  |
| Host-networking requirement and rationale |  |
| Runner mode: persistent or ephemeral |  |
| Test database address, database name, and port |  |
| Artifact and log retention location |  |

## Required evidence

- [ ] Dockerfile package versions and runner archive checksum are reviewed.
- [ ] Runner executes as a non-root user; only documented capabilities and mounts are present.
- [ ] Registration/removal scripts pass shell syntax checks and never print or persist registration tokens.
- [ ] Compose validator passes.
- [ ] `docker compose version`, Docker client access, Node, pnpm, Python, Go, and Rust are verified on the staged host.
- [ ] PostgreSQL harness starts a fresh PostgreSQL 16 service, waits for health, migrates, seeds, runs a focused suite, and tears down on success and failure.
- [ ] The harness cannot target a production database or a shared developer database.
- [ ] Test container, volume, and temporary secret cleanup are demonstrated.

## Reviewer sign-off

| Reviewer role | Name | Required sign-off |
| --- | --- | --- |
| Platform/SRE owner |  | I confirm the host, runner labels, images, and cleanup controls are deployable. |
| Security owner |  | I accept the trusted-code boundary, Docker-socket exposure, host networking, and secret handling. |
| Database owner |  | I confirm PostgreSQL isolation, migration, seed, and destruction behavior. |
| QA/automation owner |  | I confirm the harness supplies reproducible test evidence. |

## Merge gate

- [ ] A staged-host run has produced the required validation evidence.
- [ ] No workflow `runs-on` change is included in this PR.
- [ ] Platform, security, database, and QA approvals are recorded.
- [ ] Rollback is documented as stopping/removing the runner container and retaining no token or test data.
