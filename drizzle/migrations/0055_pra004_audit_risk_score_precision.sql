-- PRA-004 (Phase 9): audit_tasks.risk_score holds 0-100 risk scores
-- (selectForAudit thresholds 40/70; zod input 0..100). The column was
-- numeric(5,4) — max 9.9999 — so any score >= 10 failed at insert time
-- (SQLSTATE 22003). Widen to numeric(7,4) to match the live range.

ALTER TABLE "audit_tasks"
  ALTER COLUMN "risk_score" TYPE numeric(7,4);
--> statement-breakpoint
