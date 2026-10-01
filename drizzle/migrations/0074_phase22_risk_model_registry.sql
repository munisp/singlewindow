-- Phase 22: persist the risk-model registry (previously the in-memory
-- MODEL_REGISTRY_DATA / AB_TESTS_DATA arrays in server/routers/riskModel.ts).
-- Hand-written, precedent 0069-0073. Seeds carry over the exact rows the
-- in-memory registry served so response shapes are unchanged.

CREATE TABLE IF NOT EXISTS "risk_model_versions" (
  "id" serial PRIMARY KEY NOT NULL,
  "version_id" varchar(64) NOT NULL,
  "version" varchar(32) NOT NULL,
  "algorithm" varchar(64) NOT NULL,
  "accuracy" real DEFAULT 0 NOT NULL,
  "f1_score" real DEFAULT 0 NOT NULL,
  "precision" real DEFAULT 0 NOT NULL,
  "recall" real DEFAULT 0 NOT NULL,
  "auc_roc" real DEFAULT 0 NOT NULL,
  "training_samples" integer DEFAULT 0 NOT NULL,
  "status" varchar(16) DEFAULT 'archived' NOT NULL,
  "promoted_at" timestamp,
  "created_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "risk_model_versions_version_id_unique" UNIQUE("version_id")
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_rmv_status" ON "risk_model_versions" ("status");
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "risk_model_ab_tests" (
  "id" serial PRIMARY KEY NOT NULL,
  "test_id" varchar(64) NOT NULL,
  "champion_version" varchar(32) NOT NULL,
  "challenger_version" varchar(32) NOT NULL,
  "traffic_split_pct" integer DEFAULT 10 NOT NULL,
  "status" varchar(16) DEFAULT 'running' NOT NULL,
  "started_at" timestamp DEFAULT now() NOT NULL,
  "champion_accuracy" real DEFAULT 0 NOT NULL,
  "challenger_accuracy" real DEFAULT 0 NOT NULL,
  "champion_requests" integer DEFAULT 0 NOT NULL,
  "challenger_requests" integer DEFAULT 0 NOT NULL,
  "winner" varchar(16),
  "created_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "risk_model_ab_tests_test_id_unique" UNIQUE("test_id")
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_rmat_status" ON "risk_model_ab_tests" ("status");
--> statement-breakpoint

-- Seed rows: the exact data the in-memory registry served (Sprint 51).
INSERT INTO "risk_model_versions"
  ("version_id", "version", "algorithm", "accuracy", "f1_score", "precision", "recall", "auc_roc", "training_samples", "status", "created_at", "promoted_at")
VALUES
  ('a1b2c3d4e5f6', 'v1.0.0', 'GradientBoosting', 0.812, 0.798, 0.821, 0.776, 0.871, 50000, 'archived', '2024-06-01T00:00:00Z', '2024-07-01T00:00:00Z'),
  ('b2c3d4e5f6a1', 'v1.1.0', 'GradientBoosting', 0.841, 0.829, 0.848, 0.811, 0.893, 75000, 'archived', '2024-09-01T00:00:00Z', '2024-10-01T00:00:00Z'),
  ('c3d4e5f6a1b2', 'v2.0.0', 'XGBoost', 0.878, 0.864, 0.882, 0.847, 0.921, 120000, 'archived', '2025-01-01T00:00:00Z', '2025-02-01T00:00:00Z'),
  ('d4e5f6a1b2c3', 'v2.1.0', 'XGBoost', 0.891, 0.879, 0.894, 0.865, 0.934, 150000, 'champion', '2025-06-01T00:00:00Z', '2025-07-01T00:00:00Z'),
  ('e5f6a1b2c3d4', 'v3.0.0-beta', 'LightGBM', 0.903, 0.891, 0.908, 0.875, 0.948, 200000, 'challenger', '2025-12-01T00:00:00Z', NULL)
ON CONFLICT ("version_id") DO NOTHING;
--> statement-breakpoint

INSERT INTO "risk_model_ab_tests"
  ("test_id", "champion_version", "challenger_version", "traffic_split_pct", "status", "started_at", "champion_accuracy", "challenger_accuracy", "champion_requests", "challenger_requests", "winner")
VALUES
  ('ab-2025-q4-001', 'v2.1.0', 'v3.0.0-beta', 10, 'running', '2026-01-01T00:00:00Z', 0.891, 0.903, 45230, 5025, NULL)
ON CONFLICT ("test_id") DO NOTHING;
