-- Phase 33: live maritime intelligence — AIS vessel positions, sanctions
-- screening ledger, and AI daily port briefs. Hand-written, precedent 0083.
-- NO seed rows.

CREATE TABLE IF NOT EXISTS "ais_vessel_positions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "mmsi" text NOT NULL,
  "ship_name" text,
  "lat" double precision NOT NULL,
  "lon" double precision NOT NULL,
  "sog" double precision,
  "cog" double precision,
  "nav_status" text,
  "last_seen_at" timestamptz DEFAULT now() NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "ais_vessel_positions_mmsi_unique" UNIQUE ("mmsi")
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_ais_vessel_positions_last_seen" ON "ais_vessel_positions" ("last_seen_at");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "sanctions_screenings" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "declaration_id" integer NOT NULL REFERENCES "declarations"("id"),
  "subject_name" text NOT NULL,
  "subject_type" text NOT NULL DEFAULT 'trader',
  "match_count" integer DEFAULT 0 NOT NULL,
  "top_score" double precision,
  "datasets" jsonb,
  "status" text DEFAULT 'clear' NOT NULL,
  "screened_at" timestamptz DEFAULT now() NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_sanctions_screenings_declaration" ON "sanctions_screenings" ("declaration_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_sanctions_screenings_status" ON "sanctions_screenings" ("status");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "intel_briefs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "port" text NOT NULL,
  "period" text NOT NULL,
  "content" text NOT NULL,
  "generated_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "intel_briefs_port_period_unique" UNIQUE ("port", "period")
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_intel_briefs_port" ON "intel_briefs" ("port");
