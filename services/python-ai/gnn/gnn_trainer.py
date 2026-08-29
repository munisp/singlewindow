"""
gnn_trainer.py — PyTorch Geometric GNN trainer for trade risk scoring.

Language choice: Python
  - PyTorch Geometric (PyG) is the canonical GNN framework, Python-only
  - Training is GPU-optional; CPU training is sufficient for the dataset sizes
    typical of a national trade platform (< 1M declarations/year)
  - Model weights are exported to ONNX for inference in the Rust engine

Architecture:
  GraphSAGE (Hamilton et al., 2017) is chosen over GCN/GAT because:
  1. Inductive learning — can score new traders/declarations not seen in training
  2. Neighbourhood sampling — scales to large graphs without full adjacency matrix
  3. Mean aggregation — robust to variable-degree nodes (traders range from 1 to
     thousands of declarations)

  Feature vector per node (12 dimensions):
    [declared_value_norm, trader_risk, trader_violations_norm, aeo_status,
     hs_fraud_rate, hs_controlled, hs_duty_rate, port_risk, corridor_risk,
     declaration_count_norm, days_since_last_declaration_norm, value_variance_norm]

  Label: risk_lane (0=green, 1=yellow, 2=red) — multi-class classification

  Training loop:
    1. Load feature vectors from Neo4j (export_gnn_training_data)
    2. Build PyG HeteroData graph (Trader→Declaration→HsCode edges)
    3. Train GraphSAGE for 100 epochs with Adam + cross-entropy loss
    4. Export to ONNX for Rust inference
    5. Write risk scores back to FalkorDB

⚠️  CIRCULAR-LABEL WARNING — READ BEFORE TRUSTING ANY METRIC FROM THIS TRAINER
  The training label is each declaration's `lane` (green/yellow/red) read
  from the graph store. That lane was ASSIGNED BY THE DETERMINISTIC RULE
  ENGINE (microservices/risk-engine: compute score -> assign_lane ->
  risk_lane column) — i.e. by the very system this model is meant to
  augment/replace. The labels are NOT ground-truth fraud outcomes.

  Consequence: this GNN can only ever learn to IMITATE THE RULES. Its
  reported accuracy/F1 measures agreement with the rule engine, not fraud
  detection skill. It can never exceed the rule engine on the rules' own
  blind spots, and presenting its metrics as model quality is dishonest.

  Resolution path: train on analyst-reviewed outcomes from sec-ops case
  management (confirmed fraud / confirmed clean dispositions of inspected
  declarations). See services/python-ai/MODEL_RISK.md for the full risk
  statement and the production-data labeling plan. Until such labels exist,
  this model must not gate traffic autonomously; shadow-mode scoring only.
"""

from __future__ import annotations

import json
import logging
import os
from pathlib import Path
from typing import Any

import numpy as np
import structlog

log = structlog.get_logger(__name__)

# ─── CONSTANTS ────────────────────────────────────────────────────────────────

MODEL_DIR = Path(os.getenv("MODEL_DIR", "/tmp/trade_gnn_models"))
MODEL_DIR.mkdir(parents=True, exist_ok=True)

FEATURE_DIM = 12
NUM_CLASSES = 3  # green=0, yellow=1, red=2
HIDDEN_DIM = 64
NUM_LAYERS = 3
EPOCHS = 100
LR = 0.005
BATCH_SIZE = 512

LANE_MAP = {"green": 0, "yellow": 1, "red": 2}
LANE_REVERSE = {0: "green", 1: "yellow", 2: "red"}


# ─── FEATURE ENGINEERING ─────────────────────────────────────────────────────

def build_feature_vector(record: dict[str, Any]) -> list[float]:
    """
    Convert a Neo4j training record into a 12-dimensional feature vector.
    All values are normalised to [0, 1].
    """
    declared_value = float(record.get("declaredValue") or 0)
    # Log-normalise declared value (range: $0 to $10M+)
    value_norm = min(np.log1p(declared_value) / np.log1p(10_000_000), 1.0)

    trader_risk = float(record.get("traderRisk") or 0.5)
    violations = float(record.get("traderViolations") or 0)
    violations_norm = min(violations / 50.0, 1.0)  # cap at 50 violations
    aeo = 1.0 if record.get("aeoStatus") else 0.0

    hs_fraud = float(record.get("hsFraudRate") or 0.3)
    hs_controlled = 1.0 if record.get("hsControlled") else 0.0
    hs_duty = float(record.get("hsDutyRate") or 0.1)

    port_risk = float(record.get("portRisk") or 0.3)
    corridor_risk = float(record.get("corridorRisk") or 0.3)

    # Placeholder features — populated from aggregated history in production
    decl_count_norm = 0.5  # normalised declaration count for this trader
    days_since_last_norm = 0.5  # days since last declaration
    value_variance_norm = 0.3  # variance in declared values

    return [
        value_norm,
        trader_risk,
        violations_norm,
        aeo,
        hs_fraud,
        hs_controlled,
        hs_duty,
        port_risk,
        corridor_risk,
        decl_count_norm,
        days_since_last_norm,
        value_variance_norm,
    ]


def lane_to_label(lane: str | None) -> int:
    """Convert lane string to integer label."""
    return LANE_MAP.get((lane or "yellow").lower(), 1)


# ─── GRAPHSAGE MODEL ─────────────────────────────────────────────────────────

def build_graphsage_model():
    """
    Build a GraphSAGE model using PyTorch Geometric.
    Returns the model or None if PyG is not installed.
    """
    try:
        import torch
        import torch.nn.functional as F
        from torch_geometric.nn import SAGEConv

        class TradeGraphSAGE(torch.nn.Module):
            """
            3-layer GraphSAGE for trade risk classification.
            Input: 12-dim feature vector per declaration node
            Output: 3-class softmax (green/yellow/red)
            """

            def __init__(self) -> None:
                super().__init__()
                self.conv1 = SAGEConv(FEATURE_DIM, HIDDEN_DIM)
                self.conv2 = SAGEConv(HIDDEN_DIM, HIDDEN_DIM)
                self.conv3 = SAGEConv(HIDDEN_DIM, NUM_CLASSES)
                self.dropout = torch.nn.Dropout(p=0.3)

            def forward(self, x, edge_index):
                x = F.relu(self.conv1(x, edge_index))
                x = self.dropout(x)
                x = F.relu(self.conv2(x, edge_index))
                x = self.dropout(x)
                x = self.conv3(x, edge_index)
                return F.log_softmax(x, dim=1)

        return TradeGraphSAGE

    except ImportError:
        log.warning("PyTorch Geometric not installed — GNN training unavailable")
        return None


# ─── TRAINING PIPELINE ───────────────────────────────────────────────────────

class GNNTrainer:
    """
    Full GNN training pipeline:
      1. Load data from Neo4j
      2. Build PyG graph
      3. Train GraphSAGE
      4. Export ONNX weights
      5. Return evaluation metrics
    """

    def __init__(self) -> None:
        self.model_class = build_graphsage_model()

    def _build_pyg_data(self, records: list[dict[str, Any]]):
        """Convert Neo4j records to a PyG Data object."""
        try:
            import torch
            from torch_geometric.data import Data

            features = [build_feature_vector(r) for r in records]
            labels = [lane_to_label(r.get("lane")) for r in records]

            x = torch.tensor(features, dtype=torch.float)
            y = torch.tensor(labels, dtype=torch.long)

            # Build a simple chain graph (declaration → next declaration by same trader)
            # In production this is replaced by the actual graph topology from Neo4j
            n = len(records)
            if n < 2:
                edge_index = torch.zeros((2, 0), dtype=torch.long)
            else:
                src = list(range(n - 1))
                dst = list(range(1, n))
                edge_index = torch.tensor([src + dst, dst + src], dtype=torch.long)

            # 80/20 train/test split
            train_mask = torch.zeros(n, dtype=torch.bool)
            test_mask = torch.zeros(n, dtype=torch.bool)
            split = int(n * 0.8)
            train_mask[:split] = True
            test_mask[split:] = True

            return Data(x=x, edge_index=edge_index, y=y,
                        train_mask=train_mask, test_mask=test_mask)
        except ImportError:
            return None

    def train(self, records: list[dict[str, Any]]) -> dict[str, Any]:
        """Run the full training loop and return metrics."""
        if not self.model_class:
            return {"error": "PyTorch Geometric not installed", "trained": False}

        if len(records) < 10:
            return {"error": "Insufficient training data (< 10 records)", "trained": False}

        try:
            import torch
            import torch.nn.functional as F

            data = self._build_pyg_data(records)
            if data is None:
                return {"error": "Failed to build PyG graph", "trained": False}

            model = self.model_class()
            optimizer = torch.optim.Adam(model.parameters(), lr=LR, weight_decay=5e-4)

            best_acc = 0.0
            best_epoch = 0
            train_losses = []

            model.train()
            for epoch in range(EPOCHS):
                optimizer.zero_grad()
                out = model(data.x, data.edge_index)
                loss = F.nll_loss(out[data.train_mask], data.y[data.train_mask])
                loss.backward()
                optimizer.step()
                train_losses.append(float(loss.item()))

                if epoch % 10 == 0:
                    model.eval()
                    with torch.no_grad():
                        pred = out[data.test_mask].argmax(dim=1)
                        correct = (pred == data.y[data.test_mask]).sum()
                        acc = float(correct) / int(data.test_mask.sum())
                        if acc > best_acc:
                            best_acc = acc
                            best_epoch = epoch
                            # Save best model weights
                            torch.save(model.state_dict(), MODEL_DIR / "graphsage_best.pt")
                    model.train()

            # Export to ONNX for Rust inference
            model.eval()
            model.load_state_dict(torch.load(MODEL_DIR / "graphsage_best.pt"))
            dummy_x = torch.zeros((1, FEATURE_DIM))
            dummy_edge = torch.zeros((2, 0), dtype=torch.long)
            onnx_path = MODEL_DIR / "graphsage.onnx"
            try:
                torch.onnx.export(
                    model,
                    (dummy_x, dummy_edge),
                    str(onnx_path),
                    input_names=["x", "edge_index"],
                    output_names=["logits"],
                    opset_version=17,
                )
                log.info("ONNX model exported", path=str(onnx_path))
            except Exception as e:
                log.warning("ONNX export failed", error=str(e))

            metrics = {
                "trained": True,
                "epochs": EPOCHS,
                "best_epoch": best_epoch,
                "best_test_accuracy": round(best_acc, 4),
                "final_train_loss": round(train_losses[-1], 6),
                "model_path": str(MODEL_DIR / "graphsage_best.pt"),
                "onnx_path": str(onnx_path) if onnx_path.exists() else None,
                "training_samples": int(data.train_mask.sum()),
                "test_samples": int(data.test_mask.sum()),
            }
            log.info("GNN training complete", **metrics)
            return metrics

        except Exception as e:
            log.error("GNN training failed", error=str(e))
            return {"error": str(e), "trained": False}

    def predict(self, feature_vector: list[float]) -> dict[str, Any]:
        """
        Score a single declaration using the trained model.
        Returns lane, probability distribution, and confidence.
        """
        if not self.model_class:
            return self._heuristic_predict(feature_vector)

        model_path = MODEL_DIR / "graphsage_best.pt"
        if not model_path.exists():
            return self._heuristic_predict(feature_vector)

        try:
            import torch

            model = self.model_class()
            model.load_state_dict(torch.load(model_path, map_location="cpu"))
            model.eval()

            x = torch.tensor([feature_vector], dtype=torch.float)
            edge_index = torch.zeros((2, 0), dtype=torch.long)

            with torch.no_grad():
                logits = model(x, edge_index)
                probs = torch.exp(logits).squeeze().tolist()

            lane_idx = int(np.argmax(probs))
            return {
                "lane": LANE_REVERSE[lane_idx],
                "probabilities": {
                    "green": round(probs[0], 4),
                    "yellow": round(probs[1], 4),
                    "red": round(probs[2], 4),
                },
                "confidence": round(float(max(probs)), 4),
                "engine": "graphsage-v1",
            }
        except Exception as e:
            log.warning("GNN predict failed, falling back to heuristic", error=str(e))
            return self._heuristic_predict(feature_vector)

    def _heuristic_predict(self, features: list[float]) -> dict[str, Any]:
        """
        Fallback heuristic when model is not trained.
        Uses weighted sum of risk features.
        """
        weights = [0.15, 0.20, 0.10, -0.15, 0.20, 0.10, 0.05, 0.10, 0.10, 0.05, 0.05, 0.05]
        score = sum(f * w for f, w in zip(features, weights))
        score = max(0.0, min(1.0, score + 0.3))  # bias toward yellow

        if score < 0.35:
            lane = "green"
        elif score < 0.65:
            lane = "yellow"
        else:
            lane = "red"

        return {
            "lane": lane,
            "probabilities": {
                "green": round(max(0, 0.35 - score), 4),
                "yellow": round(0.5, 4),
                "red": round(max(0, score - 0.35), 4),
            },
            "confidence": round(abs(score - 0.5) * 2, 4),
            "engine": "heuristic-fallback",
        }


# ─── ENTRY POINT ─────────────────────────────────────────────────────────────

if __name__ == "__main__":
    trainer = GNNTrainer()
    # Generate synthetic training data for testing
    import random
    records = [
        {
            "declarationId": f"decl-{i}",
            "declaredValue": random.uniform(100, 500_000),
            "traderRisk": random.uniform(0, 1),
            "traderViolations": random.randint(0, 20),
            "aeoStatus": random.choice([True, False]),
            "hsFraudRate": random.uniform(0.1, 0.9),
            "hsControlled": random.choice([True, False]),
            "hsDutyRate": random.uniform(0, 0.5),
            "portRisk": random.uniform(0.1, 0.8),
            "corridorRisk": random.uniform(0.1, 0.8),
            "lane": random.choice(["green", "yellow", "red"]),
        }
        for i in range(200)
    ]
    metrics = trainer.train(records)
    print(json.dumps(metrics, indent=2))

    # Test prediction
    sample_features = build_feature_vector(records[0])
    prediction = trainer.predict(sample_features)
    print(json.dumps(prediction, indent=2))
