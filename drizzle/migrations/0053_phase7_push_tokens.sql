-- Phase-7 remediation (P0-5): device push tokens table.
-- The pushTokens router previously used a process-local Map as its primary
-- store and a MySQL-dialect upsert (ON DUPLICATE KEY UPDATE) against
-- PostgreSQL that always threw and was swallowed. The DB is now the
-- authoritative store. Idempotent — safe to apply where the table exists.
CREATE TABLE IF NOT EXISTS "push_tokens" (
  "id" serial PRIMARY KEY NOT NULL,
  "user_id" integer NOT NULL,
  "token" varchar(512) NOT NULL,
  "platform" varchar(16) NOT NULL,
  "registered_at" timestamp DEFAULT now() NOT NULL,
  "last_seen_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "push_tokens_user_platform_unique" UNIQUE ("user_id", "platform")
);
CREATE INDEX IF NOT EXISTS "idx_push_tokens_user" ON "push_tokens" ("user_id");
