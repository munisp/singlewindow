"""
temporal_middleware.py — Temporal workflow client for Python AI services.

Python AI services interact with Temporal as:
  - Activity workers: Execute ML inference activities within Go-orchestrated workflows
  - Workflow starters: Launch model retraining workflows on schedule

Activities registered by Python AI services:
  - risk-ai:           RiskScoringActivity (ML risk score computation)
  - hs-classifier:     HSClassificationActivity (BERT-based HS code prediction)
  - sanctions-service: SanctionsScreeningActivity (fuzzy name matching)
  - anomaly-detection: AnomalyDetectionActivity (Isolation Forest / LSTM)
  - gnn-risk:          GNNRiskPropagationActivity (graph neural network scoring)
"""
import logging
import os
from typing import Any, Dict, Optional

logger = logging.getLogger(__name__)


class TemporalMiddleware:
    """
    Temporal client wrapper for Python AI services.
    Uses the temporalio Python SDK.
    """

    def __init__(self, service_name: str):
        self.service_name = service_name
        self.host_port = os.getenv("TEMPORAL_HOST_PORT", "temporal:7233")
        self.namespace = os.getenv("TEMPORAL_NAMESPACE", "tradegateway")
        self._client = None

    async def connect(self):
        """Connect to the Temporal server. Call once on service startup."""
        try:
            from temporalio.client import Client
            self._client = await Client.connect(
                self.host_port,
                namespace=self.namespace,
            )
            logger.info(
                f"[{self.service_name}] Temporal client connected: "
                f"{self.host_port}/{self.namespace}"
            )
        except Exception as e:
            logger.warning(f"[{self.service_name}] Temporal connect failed (non-fatal): {e}")

    async def start_model_retraining_workflow(
        self,
        model_name: str,
        dataset_path: str,
        hyperparams: Optional[Dict[str, Any]] = None,
    ) -> Optional[str]:
        """
        Start a model retraining workflow in Temporal.
        Returns the workflow run ID on success.
        """
        if not self._client:
            logger.warning(f"[{self.service_name}] Temporal not connected, skipping workflow start")
            return None
        try:
            from temporalio.client import WorkflowHandle
            handle = await self._client.start_workflow(
                "ModelRetrainingWorkflow",
                args=[{
                    "model_name": model_name,
                    "service_name": self.service_name,
                    "dataset_path": dataset_path,
                    "hyperparams": hyperparams or {},
                }],
                id=f"retrain-{model_name}-{self.service_name}",
                task_queue=f"{self.service_name}-retraining",
            )
            logger.info(
                f"[{self.service_name}] Model retraining workflow started: "
                f"model={model_name} run_id={handle.run_id}"
            )
            return handle.run_id
        except Exception as e:
            logger.warning(f"[{self.service_name}] Failed to start retraining workflow: {e}")
            return None

    async def create_worker(self, task_queue: str, workflows: list, activities: list):
        """
        Create and return a Temporal worker for the given task queue.
        Register workflow and activity classes before running.
        """
        if not self._client:
            logger.warning(f"[{self.service_name}] Temporal not connected, worker not created")
            return None
        try:
            from temporalio.worker import Worker
            worker = Worker(
                self._client,
                task_queue=task_queue,
                workflows=workflows,
                activities=activities,
            )
            logger.info(
                f"[{self.service_name}] Temporal worker created: "
                f"task_queue={task_queue} activities={len(activities)}"
            )
            return worker
        except Exception as e:
            logger.warning(f"[{self.service_name}] Failed to create Temporal worker: {e}")
            return None

    async def signal_workflow(self, workflow_id: str, signal_name: str, payload: Any):
        """Send a signal to a running workflow."""
        if not self._client:
            return
        try:
            handle = self._client.get_workflow_handle(workflow_id)
            await handle.signal(signal_name, payload)
            logger.info(
                f"[{self.service_name}] Temporal signal sent: "
                f"workflow={workflow_id} signal={signal_name}"
            )
        except Exception as e:
            logger.warning(f"[{self.service_name}] Temporal signal failed: {e}")
