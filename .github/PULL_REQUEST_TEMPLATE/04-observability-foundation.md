# PR-D — Observability foundation: metrics, dashboards, alerts, and durable logs

## Change purpose

Describe the Prometheus scrape/rule, Grafana dashboard, Alertmanager route, journald retention, Promtail **or** Fluent Bit, Loki, or runbook change. This PR establishes telemetry plumbing; it must not enable a production GitHub webhook or include production secrets.

## Architecture decisions

| Decision | Selected value | Rationale |
| --- | --- | --- |
| Host log agent | Promtail / Fluent Bit |  |
| Log store and tenant |  |  |
| Log retention and object-storage durability |  |  |
| Prometheus scrape interval |  |  |
| Alert receiver and escalation policy |  |  |
| Dashboard folder/datasource |  |  |
| Sensitive-data redaction method |  |  |

## Required evidence

- [ ] Only one agent tails the runner host journal; duplicate forwarding is not possible.
- [ ] Docker logs use the journald driver and the host journal is persistent.
- [ ] Agent positions/state use durable host storage; output retries are bounded and observable.
- [ ] Logs forward with TLS and the expected Loki tenant; credentials are injected at runtime.
- [ ] Token, authorization header, password, API key, and sensitive PII redaction rules are tested with representative samples.
- [ ] Prometheus YAML, alert rules, scrape fragments, and Grafana JSON parse successfully.
- [ ] `promtool check rules` has passed in the target Prometheus version.
- [ ] A staging dashboard shows queue, provisioning, host, Docker, cleanup, PostgreSQL harness, and log-heartbeat metrics.
- [ ] One controlled staging alert routes to the intended non-production receiver and is acknowledged.
- [ ] Metric labels are bounded; IDs, commit SHAs, raw error text, and tokens are not labels.

## Reviewer sign-off

| Reviewer role | Name | Required sign-off |
| --- | --- | --- |
| SRE/platform owner |  | I confirm scrape, storage, dashboards, and alert routing are operable. |
| Security/privacy owner |  | I confirm logging/redaction/retention controls protect secrets and PII. |
| Incident-management owner |  | I confirm alerts link to actionable runbooks and escalation policy. |
| QA/automation owner |  | I confirm staging alert and dashboard evidence is reproducible. |

## Merge gate

- [ ] Production endpoint, token, tenant credential, and webhook secret are absent from git.
- [ ] Staging proof is attached for scrape, dashboard, log search, alert delivery, and acknowledgment.
- [ ] The selected agent and retention choice are recorded in the platform operations inventory.
