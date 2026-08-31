-- PRA-096 (Phase 9): vessel_tracking_events provenance + idempotency columns
-- for the geoVesselProjection consumer (vessels.events, envelope v1.0).

ALTER TABLE "vessel_tracking_events"
  ADD COLUMN IF NOT EXISTS "source_event_id" varchar(64),
  ADD COLUMN IF NOT EXISTS "position_report_id" varchar(64),
  ADD COLUMN IF NOT EXISTS "source_kid" varchar(96);

-- Partial unique index: replays of the same verified envelope are no-ops;
-- legacy rows (NULL source_event_id) are unaffected.
CREATE UNIQUE INDEX IF NOT EXISTS "uq_vte_source_event_id"
  ON "vessel_tracking_events" ("source_event_id")
  WHERE "source_event_id" IS NOT NULL;
--> statement-breakpoint
