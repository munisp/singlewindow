-- Phase 24: temporal-query-service reads the real workflow projection in
-- temporal_workflow_runs (the seeded in-memory demo store was deleted).
-- Additive only: projection columns for trace-level detail the query service
-- exposes (activity states, current step, risk lane, trader/declaration
-- references). No data changes.
ALTER TABLE temporal_workflow_runs ADD COLUMN IF NOT EXISTS declaration_ref varchar(64);
ALTER TABLE temporal_workflow_runs ADD COLUMN IF NOT EXISTS trader_ref varchar(256);
ALTER TABLE temporal_workflow_runs ADD COLUMN IF NOT EXISTS risk_lane varchar(16);
ALTER TABLE temporal_workflow_runs ADD COLUMN IF NOT EXISTS current_step integer;
ALTER TABLE temporal_workflow_runs ADD COLUMN IF NOT EXISTS total_steps integer;
ALTER TABLE temporal_workflow_runs ADD COLUMN IF NOT EXISTS activities jsonb;
CREATE INDEX IF NOT EXISTS idx_temporal_runs_declaration_ref ON temporal_workflow_runs (declaration_ref);
