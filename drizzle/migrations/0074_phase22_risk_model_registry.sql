-- Phase 22: risk model registry (hand-written, precedent 0069-0073)
-- Moves the champion/challenger/archived model registry off the removed
-- module-level mutable MODEL_REGISTRY_DATA array in server/routers/riskModel.ts
-- into Postgres. Seed rows preserve the previously hardcoded API contract.

CREATE TABLE IF NOT EXISTS "risk_model_registry" (
  "id" serial PRIMARY KEY NOT NULL,
  "version_id" varchar(64) NOT NULL,
  "version" varchar(32) NOT NULL,
  "algorithm" varchar(64) NOT NULL,
  "accuracy" real,
  "f1_score" real,
  "precision" real,
  "recall" real,
  "auc_roc" real,
  "training_samples" integer,
  "status" varchar(16) DEFAULT 'challenger' NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "promoted_at" timestamp
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uq_risk_model_registry_version_id" ON "risk_model_registry" ("version_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_risk_model_registry_status" ON "risk_model_registry" ("status");
--> statement-breakpoint
-- Seed the previously hardcoded registry rows so getModelVersions /
-- getModelMetrics keep their response contract after the move to Postgres.
INSERT INTO "risk_model_registry" ("version_id", "version", "algorithm", "accuracy", "f1_score", "precision", "recall", "auc_roc", "training_samples", "status", "created_at", "promoted_at") VALUES
  ('a1b2c3d4e5f6', 'v1.0.0', 'GradientBoosting', 0.812, 0.798, 0.821, 0.776, 0.871, 50000, 'archived', '2024-06-01T00:00:00Z', '2024-07-01T00:00:00Z'),
  ('b2c3d4e5f6a1', 'v1.1.0', 'GradientBoosting', 0.841, 0.829, 0.848, 0.811, 0.893, 75000, 'archived', '2024-09-01T00:00:00Z', '2024-10-01T00:00:00Z'),
  ('c3d4e5f6a1b2', 'v2.0.0', 'XGBoost', 0.878, 0.864, 0.882, 0.847, 0.921, 120000, 'archived', '2025-01-01T00:00:00Z', '2025-02-01T00:00:00Z'),
  ('d4e5f6a1b2c3', 'v2.1.0', 'XGBoost', 0.891, 0.879, 0.894, 0.865, 0.934, 150000, 'champion', '2025-06-01T00:00:00Z', '2025-07-01T00:00:00Z'),
  ('e5f6a1b2c3d4', 'v3.0.0-beta', 'LightGBM', 0.903, 0.891, 0.908, 0.875, 0.948, 200000, 'challenger', '2025-12-01T00:00:00Z', NULL)
ON CONFLICT ("version_id") DO NOTHING;
