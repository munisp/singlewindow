-- Phase 23 (C3): persist opencti-svc threat actors (previously an in-memory
-- map seeded with fabricated intel on every boot). Indicators persist to the
-- EXISTING threat_intel_feeds table (migration 0049 era); actors need their
-- own table. Hand-written, precedent 0069-0074. NO seed rows — the service
-- must never plant fabricated threat intelligence.

CREATE TABLE IF NOT EXISTS "threat_intel_actors" (
  "id" varchar(128) PRIMARY KEY NOT NULL,
  "name" varchar(255) NOT NULL,
  "actor_type" varchar(64),
  "aliases" jsonb DEFAULT '[]'::jsonb,
  "motivation" jsonb DEFAULT '[]'::jsonb,
  "sophistication" varchar(64),
  "description" text,
  "first_seen" timestamp DEFAULT now() NOT NULL,
  "last_seen" timestamp DEFAULT now() NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_threat_intel_actors_name" ON "threat_intel_actors" ("name");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_threat_intel_actors_type" ON "threat_intel_actors" ("actor_type");
