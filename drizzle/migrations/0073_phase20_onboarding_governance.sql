-- Phase 20 stakeholder-onboarding governance (hand-written, precedent 0069-0072)
-- GAP 1: maker-checker role grants (role_requests)
-- GAP 4: maker-checker elevated API scope grants (api_scope_requests)
-- GAP 9: user account lifecycle status (active/suspended/offboarded)

CREATE TYPE "user_status" AS ENUM ('active', 'suspended', 'offboarded');
--> statement-breakpoint
CREATE TYPE "role_request_status" AS ENUM ('pending', 'approved', 'rejected');
--> statement-breakpoint
CREATE TYPE "api_scope_request_status" AS ENUM ('pending', 'approved', 'rejected');
--> statement-breakpoint

ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "status" "user_status" DEFAULT 'active' NOT NULL;
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "role_requests" (
  "id" serial PRIMARY KEY NOT NULL,
  "user_id" integer NOT NULL REFERENCES "users"("id"),
  "requested_role" "user_role" NOT NULL,
  "status" "role_request_status" DEFAULT 'pending' NOT NULL,
  "reason" text,
  "reviewed_by" integer REFERENCES "users"("id"),
  "reviewed_at" timestamp,
  "review_note" text,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_role_requests_user_id" ON "role_requests" ("user_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_role_requests_status" ON "role_requests" ("status");
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "api_scope_requests" (
  "id" serial PRIMARY KEY NOT NULL,
  "api_key_id" integer NOT NULL REFERENCES "api_keys"("id"),
  "user_id" integer NOT NULL REFERENCES "users"("id"),
  "scope" varchar(64) NOT NULL,
  "status" "api_scope_request_status" DEFAULT 'pending' NOT NULL,
  "reason" text,
  "reviewed_by" integer REFERENCES "users"("id"),
  "reviewed_at" timestamp,
  "review_note" text,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_api_scope_requests_key" ON "api_scope_requests" ("api_key_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_api_scope_requests_status" ON "api_scope_requests" ("status");
