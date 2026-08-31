# MODEL_RISK.md — TradeGateway AI/ML Model Risk Register

Scope: all trainers and training-time pipelines under `services/python-ai/`
(`gnn/gnn_trainer.py`, `gnn/fraud_gnn.py`, `risk/risk_scorer.py`,
`training/continuous_training_pipeline.py`) and the models they produce.

## R1 — Circular training labels (CRITICAL, affects every trainer here)

**What.** No trainer in this repository is trained on ground-truth fraud
outcomes. The labels are:

| Source | Used by | Why it is circular / not ground truth |
|---|---|---|
| `risk_lane` column (PostgreSQL → graph store) | `gnn_trainer.py`, `fraud_gnn.py` (fine-tune), `risk_scorer.py` (production path) | Assigned by the **deterministic rule engine** (`microservices/risk-engine`: `compute_risk_score` → `assign_lane` → `risk_lane`) — the very system these models are meant to augment or replace. |
| Declaration `status` (`map_status_to_label`) | `continuous_training_pipeline.py` | Operational routing outcome; rule-RED declarations are the ones routed to inspection and flagged/seized, so status is downstream of rule output. Marginally less circular, still not independent ground truth. |
| `NigerianSyntheticGenerator` scenario labels | all trainers (synthetic augmentation / initial training) | Labels assigned from the *injected* fraud scenario per hand-written generator heuristics — the model learns the generator's assumptions, not reality. |

**Why it matters.** A model trained on rule-engine outputs can only ever
**learn to imitate the rules**. Its evaluation metrics (accuracy, F1,
AUC) measure *agreement with the heuristics*, not fraud-detection skill:

- It can never discover fraud patterns the rules miss — those patterns are
  unlabeled (or mislabeled) in the training data.
- Validation is not independent: train and test labels come from the same
  rule function, so cross-validation inflates confidence.
- Any "promote when F1 > threshold" automation gated on these labels is
  meaningless and risks displacing a transparent rule engine with an opaque
  imitator that has learned the rules' errors as well as their successes.

**Interim controls (mandatory until real labels exist).**

1. Models trained on these labels must run in **shadow mode only**: they
   may score and log, but must not gate, block, or auto-route traffic.
2. Deterministic rules remain the first line of defence; ML output is
   advisory and must be labeled as such in every API response.
3. Automatic promotion thresholds in `continuous_training_pipeline.py` and
   `fraud_gnn.py` must stay disabled.
4. Any metric reported from these trainers must carry the caveat
   "measures agreement with rule-engine heuristics, not fraud outcomes".

**Resolution path — production-data labeling.**

The durable fix is **analyst-reviewed outcomes from sec-ops case
management**:

1. Every declaration routed to inspection (rule lane or shadow-ML flag)
   produces a case in the sec-ops case-management system.
2. Analysts close each case with a disposition: `CONFIRMED_FRAUD` /
   `CONFIRMED_CLEAN` / `INCONCLUSIVE`, plus fraud typology where known.
3. Dispositions are written to a **dedicated label store** (separate table
   from `risk_lane`, e.g. `declaration_outcome_labels` with
   `declaration_id, disposition, analyst_id, closed_at, case_id`) —
   never overwriting the rule lane, so label provenance stays auditable.
4. Trainers join features to `declaration_outcome_labels` and must refuse
   to train (or loudly warn) when the label source is `risk_lane`.
5. Only models validated on a held-out set of analyst-reviewed labels may
   be promoted beyond shadow mode, via the real MLflow registry with the
   metrics logged on the training run.

## R2 — Synthetic-data drift

Synthetic data (`NigerianSyntheticGenerator`) encodes assumptions about
Nigerian trade fraud that may not match the deployment country's traffic.
Use synthetic data for pipeline smoke-testing and cold-start only; never
report its evaluation numbers as production readiness.

## R3 — Unwired serving paths

The trainers above export artefacts (ONNX/joblib) but are not wired to a
serving path in this repo. Serving-side honesty controls that DO exist:

- `services/python/ray-risk-scorer` serves a real ONNX model via
  onnxruntime **only** when `RISK_MODEL_PATH` is configured; otherwise it
  reports `NO_MODEL_DEPLOYED` and scores rules-only.
- `services/python/ray-risk-svc` reads the real MLflow registry
  (`MLFLOW_TRACKING_URI`) or fails closed with `REGISTRY_UNAVAILABLE`.
- `services/python/payment-risk-scorer` calls a real external inference
  endpoint (`ML_SCORING_URL`) or reports `ml_augmentation=UNAVAILABLE`.
- `services/python/insider-threat-svc` (real IsolationForest) is deployed
  via `infra/kubernetes/deployments/python-services.yaml` with a weekly
  retrain CronJob; it trains on behavioural features, not rule outputs.

Do not wire the circularly-trained GNN/ensemble artefacts into these
serving paths until R1 is resolved.
