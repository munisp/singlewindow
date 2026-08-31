# insider-threat-svc — Deployment & Retrain Runbook

This is the platform's real, integrated ML service: an IsolationForest
anomaly detector (trainer + scorer) for insider-threat prevention, with
versioned model artefacts, shadow-model A/B, promotion and rollback.

## Deployment surface

| Artefact | Location |
|---|---|
| Container image | `tradegateway/insider-threat-svc` (see `Dockerfile` in this directory) |
| Deployment/Service/PDB/PVC | `infra/kubernetes/deployments/python-services.yaml` (section `insider-threat-svc`) |
| Retrain CronJob | `infra/kubernetes/deployments/insider-threat-retrain-cronjob.yaml` |
| Helm config keys | `infra/helm/tradegateway/templates/configmap.yaml` (`insider-threat-*`), values in `values.yaml` under `services.insiderThreat` |

Key properties:

- **Port**: 8093 (env `PORT`), metrics 9093.
- **Model store**: versioned joblib artefacts on PVC `insider-threat-models-pvc`
  mounted at `/app/models` (env `MODELS_DIR`). Single replica + `Recreate`
  strategy so only one writer touches the store.
- **Block threshold**: env `ANOMALY_BLOCK_THRESHOLD` (configmap key
  `insider-threat-block-threshold`, default 0.85). Scores at/above the
  threshold set `blocked=true` in `/detect` responses.
- **No model trained yet**: `/detect` uses the documented heuristic fallback
  and `/health` reports `model_loaded=false`. Nothing is fabricated.

## Retrain loop

Canonical loop in Kubernetes: CronJob `insider-threat-retrain`,
**Sundays 02:00 UTC** (`concurrencyPolicy: Forbid`).

1. The job runs inside the service image and calls
   `retrain_scheduler.run_nightly_retrain()`.
2. That fetches the last 30 days of `insider_threat_events` from PostgreSQL
   (`DATABASE_URL`); below `RETRAIN_MIN_EVENTS` (default 50) it skips and
   exits non-zero so the gap is visible in job history.
3. Events are POSTed to the service's `/train` endpoint, which trains a new
   IsolationForest, writes `isolation_forest_v<N>.joblib` to the PVC,
   atomically swaps the `current` artefact and hot-reloads in memory.

Manual trigger:

```sh
kubectl create job --from=cronjob/insider-threat-retrain \
  insider-threat-retrain-manual -n tradegateway
```

Single-process deployments (no k8s CronJob) may instead set
`RETRAIN_SCHEDULER_ENABLED=true` to run the same job nightly at 02:00 UTC
via the in-process APScheduler. Do not enable both.

## Promotion / rollback

- Shadow-model A/B stats: `GET /ab/stats`, `/ab/divergence`.
- Promote shadow → production: `POST /ab/promote` (audited in `/ab/promotions`).
- Rollback: `POST /ab/rollback` with `target_version` restores the versioned
  artefact from the PVC and hot-swaps it.

## Failure modes

| Symptom | Meaning | Action |
|---|---|---|
| `/health` `model_loaded=false` | No artefact on PVC | Trigger a retrain (see above) or restore a version via `/ab/rollback` |
| Retrain job exits 1 | < `RETRAIN_MIN_EVENTS` events or DB unreachable | Check event ingestion and `DATABASE_URL`; job is safe to re-run |
| `/detect` heuristic scores only | Model failed to load | Check pod logs for joblib load errors; roll back to a known-good version |
