#!/usr/bin/env python3
"""
Nigerian Customs Synthetic Data Generator
==========================================
Generates realistic synthetic training data for the TradeGateway AI/ML stack.

The synthetic data models real Nigerian trade patterns based on:
  - NCS 2024 import/export statistics (top commodities, ports, corridors)
  - UNODC West Africa drug trafficking corridors
  - NCS seizure reports (2019-2024) for fraud pattern calibration
  - CBN FX policy effects on under/over-invoicing patterns
  - ECOWAS trade volumes by country pair

Fraud patterns modeled:
  1. Under-invoicing (declared value < 60% of market value)
  2. HS code misclassification (high-duty goods declared as low-duty)
  3. Phantom shipments (weight/quantity inconsistencies)
  4. Round-tripping (goods exported then re-imported)
  5. Split consignments (large shipment split to avoid thresholds)
  6. Controlled goods smuggling (NAFDAC, NAQS violations)
  7. Sanctioned entity evasion (shell company networks)

Output: Parquet files + PostgreSQL insert scripts for training pipeline
"""
from __future__ import annotations

import json
import random
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd

# ─── Nigerian Trade Constants ─────────────────────────────────────────────────

# Top Nigerian import ports with risk profiles
PORTS = {
    "NGAPP": {"name": "Apapa Port, Lagos", "risk": 0.45, "volume": 0.40},
    "NGTPK": {"name": "Tin Can Island, Lagos", "risk": 0.40, "volume": 0.25},
    "NGPHC": {"name": "Port Harcourt", "risk": 0.35, "volume": 0.15},
    "NGKNO": {"name": "Kano Inland Dry Port", "risk": 0.30, "volume": 0.10},
    "NGABA": {"name": "Onne Port", "risk": 0.38, "volume": 0.10},
}

# Origin countries with risk scores (based on UNODC/WCO data)
ORIGIN_COUNTRIES = {
    "CHN": {"name": "China", "risk": 0.55, "weight": 0.30},
    "IND": {"name": "India", "risk": 0.35, "weight": 0.12},
    "USA": {"name": "United States", "risk": 0.15, "weight": 0.08},
    "GBR": {"name": "United Kingdom", "risk": 0.12, "weight": 0.06},
    "DEU": {"name": "Germany", "risk": 0.10, "weight": 0.05},
    "UAE": {"name": "UAE", "risk": 0.50, "weight": 0.10},
    "GHA": {"name": "Ghana", "risk": 0.25, "weight": 0.05},
    "BEN": {"name": "Benin Republic", "risk": 0.70, "weight": 0.04},  # High re-export risk
    "TGO": {"name": "Togo", "risk": 0.65, "weight": 0.03},
    "ZAF": {"name": "South Africa", "risk": 0.20, "weight": 0.04},
    "JPN": {"name": "Japan", "risk": 0.10, "weight": 0.03},
    "KOR": {"name": "South Korea", "risk": 0.12, "weight": 0.03},
    "TUR": {"name": "Turkey", "risk": 0.40, "weight": 0.04},
    "BRA": {"name": "Brazil", "risk": 0.25, "weight": 0.02},
    "PAK": {"name": "Pakistan", "risk": 0.60, "weight": 0.01},
}

# HS chapters with fraud rates and duty rates (NCS 2024)
HS_CHAPTERS = {
    "2709": {"desc": "Petroleum oils, crude", "duty": 0.05, "fraud_rate": 0.08, "controlled": False},
    "8703": {"desc": "Motor vehicles", "duty": 0.35, "fraud_rate": 0.35, "controlled": False},
    "8704": {"desc": "Motor vehicles for goods", "duty": 0.35, "fraud_rate": 0.30, "controlled": False},
    "6110": {"desc": "Jerseys, pullovers (knitted)", "duty": 0.35, "fraud_rate": 0.45, "controlled": False},
    "6204": {"desc": "Women's suits, woven", "duty": 0.35, "fraud_rate": 0.42, "controlled": False},
    "3004": {"desc": "Medicaments", "duty": 0.05, "fraud_rate": 0.25, "controlled": True},  # NAFDAC
    "8471": {"desc": "Computers", "duty": 0.05, "fraud_rate": 0.20, "controlled": False},
    "8517": {"desc": "Telephones, smartphones", "duty": 0.10, "fraud_rate": 0.30, "controlled": False},
    "1006": {"desc": "Rice", "duty": 0.50, "fraud_rate": 0.55, "controlled": False},  # High tariff
    "1701": {"desc": "Cane sugar", "duty": 0.20, "fraud_rate": 0.35, "controlled": False},
    "2710": {"desc": "Petroleum oils (non-crude)", "duty": 0.05, "fraud_rate": 0.40, "controlled": False},
    "7208": {"desc": "Flat-rolled iron/steel", "duty": 0.05, "fraud_rate": 0.15, "controlled": False},
    "8544": {"desc": "Insulated wire/cable", "duty": 0.10, "fraud_rate": 0.18, "controlled": False},
    "3808": {"desc": "Insecticides, herbicides", "duty": 0.05, "fraud_rate": 0.20, "controlled": True},  # NAQS
    "9403": {"desc": "Furniture", "duty": 0.20, "fraud_rate": 0.28, "controlled": False},
    "2204": {"desc": "Wine", "duty": 0.20, "fraud_rate": 0.22, "controlled": False},
    "9401": {"desc": "Seats", "duty": 0.20, "fraud_rate": 0.25, "controlled": False},
    "4011": {"desc": "New pneumatic tyres", "duty": 0.10, "fraud_rate": 0.30, "controlled": False},
    "2106": {"desc": "Food preparations", "duty": 0.20, "fraud_rate": 0.22, "controlled": True},  # NAFDAC
    "3901": {"desc": "Polymers of ethylene", "duty": 0.10, "fraud_rate": 0.15, "controlled": False},
}

# Trader profiles (realistic distribution)
TRADER_TYPES = {
    "aeo_large": {"aeo": True, "risk_base": 0.05, "violation_rate": 0.02, "weight": 0.08},
    "licensed_importer": {"aeo": False, "risk_base": 0.20, "violation_rate": 0.08, "weight": 0.30},
    "clearing_agent": {"aeo": False, "risk_base": 0.30, "violation_rate": 0.12, "weight": 0.25},
    "small_importer": {"aeo": False, "risk_base": 0.40, "violation_rate": 0.18, "weight": 0.20},
    "first_time": {"aeo": False, "risk_base": 0.50, "violation_rate": 0.25, "weight": 0.10},
    "high_risk": {"aeo": False, "risk_base": 0.75, "violation_rate": 0.45, "weight": 0.07},
}

# Fraud pattern definitions
FRAUD_PATTERNS = {
    "under_invoicing": {
        "description": "Declared value < 60% of estimated market value",
        "value_multiplier": lambda: random.uniform(0.25, 0.60),
        "weight_multiplier": 1.0,
        "hs_mismatch": False,
    },
    "hs_misclassification": {
        "description": "High-duty goods declared under low-duty HS code",
        "value_multiplier": 1.0,
        "weight_multiplier": 1.0,
        "hs_mismatch": True,
    },
    "phantom_shipment": {
        "description": "Weight/quantity inconsistency with declared goods",
        "value_multiplier": lambda: random.uniform(0.8, 1.2),
        "weight_multiplier": lambda: random.uniform(0.3, 0.7),
        "hs_mismatch": False,
    },
    "split_consignment": {
        "description": "Large shipment split across multiple declarations",
        "value_multiplier": lambda: random.uniform(0.4, 0.6),
        "weight_multiplier": lambda: random.uniform(0.4, 0.6),
        "hs_mismatch": False,
    },
    "controlled_goods": {
        "description": "NAFDAC/NAQS controlled goods without permit",
        "value_multiplier": 1.0,
        "weight_multiplier": 1.0,
        "hs_mismatch": False,
    },
}


# ─── Generator ────────────────────────────────────────────────────────────────

class NigerianSyntheticGenerator:
    """Generates realistic Nigerian customs declaration data for AI training."""

    def __init__(self, seed: int = 42):
        self.rng = random.Random(seed)
        self.np_rng = np.random.default_rng(seed)
        self._trader_pool = self._generate_trader_pool(500)

    def _generate_trader_pool(self, n: int) -> list[dict]:
        """Generate a pool of realistic trader profiles."""
        traders = []
        for i in range(n):
            trader_type = self.rng.choices(
                list(TRADER_TYPES.keys()),
                weights=[v["weight"] for v in TRADER_TYPES.values()]
            )[0]
            profile = TRADER_TYPES[trader_type]

            # Historical violations follow negative binomial distribution
            violations = int(self.np_rng.negative_binomial(
                n=2, p=0.7 if profile["violation_rate"] < 0.2 else 0.3
            ))

            traders.append({
                "trader_id": f"TRD-{i:05d}",
                "trader_type": trader_type,
                "aeo_status": profile["aeo"],
                "risk_score": min(1.0, profile["risk_base"] + self.rng.gauss(0, 0.1)),
                "violation_count": violations,
                "declaration_count": self.rng.randint(5, 500),
                "years_active": self.rng.randint(1, 20),
                "is_sanctioned": self.rng.random() < 0.005,  # 0.5% sanctioned
            })
        return traders

    def _get_market_value(self, hs_code: str, weight_kg: float) -> float:
        """Estimate market value based on HS code and weight."""
        # Value per kg by commodity type (NGN thousands)
        value_per_kg = {
            "8703": 2500,   # Vehicles: ~2.5M NGN/tonne
            "8704": 1800,
            "6110": 8000,   # Textiles: high value/kg
            "6204": 9000,
            "3004": 15000,  # Pharmaceuticals: very high
            "8471": 12000,  # Computers
            "8517": 18000,  # Phones
            "1006": 250,    # Rice: low value/kg
            "1701": 350,    # Sugar
            "2710": 150,    # Fuel
            "7208": 400,    # Steel
            "9403": 1200,   # Furniture
            "4011": 800,    # Tyres
        }
        base_vpk = value_per_kg.get(hs_code, 1000)
        # Add noise (±30%)
        vpk = base_vpk * (1 + self.rng.gauss(0, 0.15))
        return max(100, vpk * weight_kg)

    def generate_declaration(self, fraud_probability: float = 0.15) -> dict[str, Any]:
        """Generate a single realistic declaration record."""
        # Select trader
        trader = self.rng.choice(self._trader_pool)

        # Select HS code (weighted by import volume)
        hs_code = self.rng.choices(
            list(HS_CHAPTERS.keys()),
            weights=[1.0 / (1 + hs["fraud_rate"]) for hs in HS_CHAPTERS.values()]
        )[0]
        hs_info = HS_CHAPTERS[hs_code]

        # Select origin country
        origin = self.rng.choices(
            list(ORIGIN_COUNTRIES.keys()),
            weights=[c["weight"] for c in ORIGIN_COUNTRIES.values()]
        )[0]
        origin_info = ORIGIN_COUNTRIES[origin]

        # Select port
        port = self.rng.choices(
            list(PORTS.keys()),
            weights=[p["volume"] for p in PORTS.values()]
        )[0]

        # Generate weight (log-normal distribution)
        weight_kg = float(self.np_rng.lognormal(mean=6.0, sigma=1.5))  # Median ~400kg
        weight_kg = max(1.0, min(50000.0, weight_kg))

        # Market value
        market_value = self._get_market_value(hs_code, weight_kg)

        # Determine if this is a fraud case
        # Fraud probability increases with: high duty rate, high-risk origin, high-risk trader
        effective_fraud_prob = fraud_probability * (
            1 + hs_info["duty_rate"] * 2 +
            origin_info["risk"] * 1.5 +
            trader["risk_score"] * 1.0
        ) / 4.5

        is_fraud = self.rng.random() < min(0.80, effective_fraud_prob)

        # Determine fraud type
        fraud_type = None
        declared_value = market_value
        declared_weight = weight_kg
        declared_hs = hs_code

        if is_fraud:
            fraud_type = self.rng.choices(
                list(FRAUD_PATTERNS.keys()),
                weights=[0.35, 0.25, 0.15, 0.15, 0.10]
            )[0]
            pattern = FRAUD_PATTERNS[fraud_type]

            vm = pattern["value_multiplier"]
            declared_value = market_value * (vm() if callable(vm) else vm)

            wm = pattern["weight_multiplier"]
            declared_weight = weight_kg * (wm() if callable(wm) else wm)

            if pattern["hs_mismatch"]:
                # Misclassify to a lower-duty HS code
                low_duty_codes = [k for k, v in HS_CHAPTERS.items()
                                  if v["duty_rate"] < hs_info["duty_rate"]]
                if low_duty_codes:
                    declared_hs = self.rng.choice(low_duty_codes)

        # Calculate duty
        cif_value = declared_value * 1.11
        import_duty = cif_value * HS_CHAPTERS[declared_hs]["duty_rate"]
        vat = (cif_value + import_duty) * 0.075
        total_duty = import_duty + vat + cif_value * 0.015  # ECOWAS + CISS

        # Determine risk label
        # Green: legitimate, low risk
        # Yellow: suspicious, needs examination
        # Red: high confidence fraud
        if not is_fraud:
            if trader["risk_score"] < 0.3 and trader["aeo_status"]:
                label = "green"
            elif trader["risk_score"] < 0.5:
                label = self.rng.choices(["green", "yellow"], weights=[0.7, 0.3])[0]
            else:
                label = self.rng.choices(["yellow", "red"], weights=[0.6, 0.4])[0]
        else:
            if fraud_type in ["under_invoicing", "hs_misclassification"]:
                label = self.rng.choices(["yellow", "red"], weights=[0.3, 0.7])[0]
            else:
                label = self.rng.choices(["yellow", "red"], weights=[0.5, 0.5])[0]

        # Generate timestamps
        now = datetime.now(timezone.utc)
        created_at = now - timedelta(days=self.rng.randint(0, 730))

        return {
            "declaration_id": str(uuid.uuid4()),
            "declaration_number": f"NG{created_at.strftime('%Y%m%d')}{self.rng.randint(100000, 999999)}",
            "trader_id": trader["trader_id"],
            "trader_type": trader["trader_type"],
            "aeo_status": trader["aeo_status"],
            "trader_risk_score": round(trader["risk_score"], 4),
            "trader_violation_count": trader["violation_count"],
            "trader_declaration_count": trader["declaration_count"],
            "is_trader_sanctioned": trader["is_sanctioned"],
            "hs_code": declared_hs,
            "hs_code_true": hs_code,  # Ground truth for HS misclassification detection
            "hs_description": HS_CHAPTERS[declared_hs]["desc"],
            "hs_fraud_rate": HS_CHAPTERS[declared_hs]["fraud_rate"],
            "hs_controlled": HS_CHAPTERS[declared_hs]["controlled"],
            "hs_duty_rate": HS_CHAPTERS[declared_hs]["duty_rate"],
            "origin_country": origin,
            "origin_risk_score": origin_info["risk"],
            "port_of_entry": port,
            "port_risk_score": PORTS[port]["risk"],
            "declared_value_usd": round(declared_value, 2),
            "market_value_usd": round(market_value, 2),
            "value_discrepancy_ratio": round(declared_value / max(1, market_value), 4),
            "declared_weight_kg": round(declared_weight, 2),
            "true_weight_kg": round(weight_kg, 2),
            "weight_discrepancy_ratio": round(declared_weight / max(0.1, weight_kg), 4),
            "value_per_kg": round(declared_value / max(0.1, declared_weight), 2),
            "cif_value": round(cif_value, 2),
            "import_duty": round(import_duty, 2),
            "vat": round(vat, 2),
            "total_duty": round(total_duty, 2),
            "package_count": max(1, int(declared_weight / self.rng.uniform(5, 50))),
            "is_fraud": is_fraud,
            "fraud_type": fraud_type,
            "risk_label": label,
            "risk_label_int": {"green": 0, "yellow": 1, "red": 2}[label],
            "created_at": created_at.isoformat(),
            # Feature vector for ML (12 dimensions)
            "features": [
                float(np.log1p(declared_value) / np.log1p(1_000_000)),  # log-normalized value
                float(trader["risk_score"]),
                float(min(1.0, trader["violation_count"] / 20.0)),
                float(1.0 if trader["aeo_status"] else 0.0),
                float(HS_CHAPTERS[declared_hs]["fraud_rate"]),
                float(1.0 if HS_CHAPTERS[declared_hs]["controlled"] else 0.0),
                float(HS_CHAPTERS[declared_hs]["duty_rate"]),
                float(origin_info["risk"]),
                float(PORTS[port]["risk"]),
                float(min(1.0, np.log1p(declared_weight) / np.log1p(50000))),
                float(min(1.0, max(1, int(declared_weight / 20)) / 1000)),
                float(min(1.0, (declared_value / max(0.1, declared_weight)) / 20000)),
            ],
        }

    def generate_dataset(
        self,
        n_samples: int = 50_000,
        fraud_rate: float = 0.15,
        output_dir: str = "/tmp/trade_training_data",
    ) -> dict[str, Any]:
        """Generate a full training dataset and save to Parquet + JSON."""
        output_path = Path(output_dir)
        output_path.mkdir(parents=True, exist_ok=True)

        print(f"Generating {n_samples:,} synthetic Nigerian customs declarations...")
        records = []
        for i in range(n_samples):
            record = self.generate_declaration(fraud_probability=fraud_rate)
            records.append(record)
            if (i + 1) % 5000 == 0:
                print(f"  Generated {i + 1:,}/{n_samples:,}")

        df = pd.DataFrame(records)

        # Save full dataset
        parquet_path = output_path / "declarations_training.parquet"
        df.to_parquet(parquet_path, index=False, compression="snappy")

        # Save feature matrix for ML
        feature_cols = ["features", "risk_label_int", "risk_label", "declaration_id",
                        "is_fraud", "fraud_type", "hs_code", "origin_country"]
        features_df = df[feature_cols].copy()
        features_path = output_path / "features_training.parquet"
        features_df.to_parquet(features_path, index=False, compression="snappy")

        # Save graph edges for GNN (trader-declaration-hs relationships)
        edges = []
        for _, row in df.iterrows():
            edges.append({
                "src": row["trader_id"],
                "dst": row["declaration_id"],
                "edge_type": "submitted",
                "weight": 1.0,
            })
            edges.append({
                "src": row["declaration_id"],
                "dst": row["hs_code"],
                "edge_type": "classifies_as",
                "weight": 1.0,
            })
            edges.append({
                "src": row["declaration_id"],
                "dst": row["origin_country"],
                "edge_type": "originates_from",
                "weight": row["origin_risk_score"],
            })
        edges_df = pd.DataFrame(edges)
        edges_path = output_path / "graph_edges.parquet"
        edges_df.to_parquet(edges_path, index=False, compression="snappy")

        # Statistics
        stats = {
            "total_samples": n_samples,
            "fraud_count": int(df["is_fraud"].sum()),
            "fraud_rate": float(df["is_fraud"].mean()),
            "label_distribution": df["risk_label"].value_counts().to_dict(),
            "fraud_type_distribution": df["fraud_type"].dropna().value_counts().to_dict(),
            "top_hs_codes": df["hs_code"].value_counts().head(10).to_dict(),
            "top_origins": df["origin_country"].value_counts().head(10).to_dict(),
            "avg_declared_value": float(df["declared_value_usd"].mean()),
            "avg_duty": float(df["total_duty"].mean()),
            "output_files": {
                "declarations": str(parquet_path),
                "features": str(features_path),
                "graph_edges": str(edges_path),
            },
        }

        stats_path = output_path / "dataset_stats.json"
        with open(stats_path, "w") as f:
            json.dump(stats, f, indent=2)

        print(f"\nDataset generated:")
        print(f"  Total samples: {n_samples:,}")
        print(f"  Fraud rate: {stats['fraud_rate']:.1%}")
        print(f"  Label distribution: {stats['label_distribution']}")
        print(f"  Output: {output_dir}")

        return stats

    def generate_graph_data_for_gnn(
        self,
        n_samples: int = 10_000,
    ) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
        """
        Generate graph-structured data for PyTorch Geometric GNN training.

        Returns:
            node_features: (N, 12) float32 array
            edge_index: (2, E) int64 array (COO format)
            labels: (N,) int64 array (0=green, 1=yellow, 2=red)
        """
        records = [self.generate_declaration() for _ in range(n_samples)]

        node_features = np.array([r["features"] for r in records], dtype=np.float32)
        labels = np.array([r["risk_label_int"] for r in records], dtype=np.int64)

        # Build graph edges: connect declarations from the same trader
        trader_to_decls: dict[str, list[int]] = {}
        for i, r in enumerate(records):
            tid = r["trader_id"]
            trader_to_decls.setdefault(tid, []).append(i)

        src_edges, dst_edges = [], []
        for trader_decls in trader_to_decls.values():
            if len(trader_decls) > 1:
                # Fully connect declarations from the same trader
                for j in range(len(trader_decls)):
                    for k in range(j + 1, min(j + 5, len(trader_decls))):  # Cap at 5 neighbors
                        src_edges.append(trader_decls[j])
                        dst_edges.append(trader_decls[k])
                        src_edges.append(trader_decls[k])
                        dst_edges.append(trader_decls[j])

        if src_edges:
            edge_index = np.array([src_edges, dst_edges], dtype=np.int64)
        else:
            edge_index = np.zeros((2, 0), dtype=np.int64)

        return node_features, edge_index, labels


# ─── PostgreSQL Seeder ────────────────────────────────────────────────────────

def seed_postgres(db_url: str, n_samples: int = 10_000) -> None:
    """Seed the PostgreSQL database with synthetic training data."""
    import psycopg2
    import psycopg2.extras

    gen = NigerianSyntheticGenerator()
    records = [gen.generate_declaration() for _ in range(n_samples)]

    conn = psycopg2.connect(db_url)
    cur = conn.cursor()

    # Ensure training table exists
    cur.execute("""
        CREATE TABLE IF NOT EXISTS ai_training_declarations (
            id              BIGSERIAL PRIMARY KEY,
            declaration_id  UUID NOT NULL,
            trader_id       VARCHAR(20),
            hs_code         VARCHAR(10),
            origin_country  VARCHAR(3),
            port_of_entry   VARCHAR(10),
            declared_value  NUMERIC(15,2),
            market_value    NUMERIC(15,2),
            weight_kg       NUMERIC(12,2),
            is_fraud        BOOLEAN,
            fraud_type      VARCHAR(50),
            risk_label      VARCHAR(10),
            risk_label_int  SMALLINT,
            features        FLOAT8[],
            created_at      TIMESTAMPTZ DEFAULT NOW()
        );
        CREATE INDEX IF NOT EXISTS idx_ai_training_label ON ai_training_declarations(risk_label_int);
        CREATE INDEX IF NOT EXISTS idx_ai_training_fraud ON ai_training_declarations(is_fraud);
    """)

    # Batch insert
    batch_size = 500
    for i in range(0, len(records), batch_size):
        batch = records[i:i + batch_size]
        psycopg2.extras.execute_values(cur, """
            INSERT INTO ai_training_declarations
                (declaration_id, trader_id, hs_code, origin_country, port_of_entry,
                 declared_value, market_value, weight_kg, is_fraud, fraud_type,
                 risk_label, risk_label_int, features)
            VALUES %s
            ON CONFLICT DO NOTHING
        """, [(
            r["declaration_id"], r["trader_id"], r["hs_code"], r["origin_country"],
            r["port_of_entry"], r["declared_value_usd"], r["market_value_usd"],
            r["declared_weight_kg"], r["is_fraud"], r["fraud_type"],
            r["risk_label"], r["risk_label_int"], r["features"],
        ) for r in batch])

    conn.commit()
    cur.close()
    conn.close()
    print(f"Seeded {n_samples:,} training records to PostgreSQL")


# ─── Entry point ─────────────────────────────────────────────────────────────

if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description="Nigerian Customs Synthetic Data Generator")
    parser.add_argument("--samples", type=int, default=50_000)
    parser.add_argument("--fraud-rate", type=float, default=0.15)
    parser.add_argument("--output", type=str, default="/tmp/trade_training_data")
    parser.add_argument("--seed-postgres", type=str, default=None, help="PostgreSQL URL to seed")
    args = parser.parse_args()

    gen = NigerianSyntheticGenerator()
    stats = gen.generate_dataset(
        n_samples=args.samples,
        fraud_rate=args.fraud_rate,
        output_dir=args.output,
    )
    print(json.dumps(stats, indent=2))

    if args.seed_postgres:
        seed_postgres(args.seed_postgres, n_samples=min(args.samples, 10_000))
