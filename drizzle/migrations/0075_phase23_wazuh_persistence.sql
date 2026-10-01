-- Phase 23 (C1): wazuh-svc PostgreSQL persistence. Replaces the in-memory
-- map store + fabricated seed data in services/go/wazuh-svc/cmd/main.go
-- (seedStore() removed). Hand-written, precedent 0073/0074.
-- NO seed rows: tables start EMPTY and the Go service fails closed (refuses
-- to start) without DATABASE_URL — fabricated data is never served again.

CREATE TABLE IF NOT EXISTS "wazuh_agents" (
  "id" varchar(64) PRIMARY KEY NOT NULL,
  "name" varchar(255) NOT NULL,
  "ip" varchar(45),
  "status" varchar(32) DEFAULT 'never_connected' NOT NULL,
  "last_seen" timestamp,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_wazuh_agents_status" ON "wazuh_agents" ("status");
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "wazuh_alerts" (
  "id" varchar(64) PRIMARY KEY NOT NULL,
  "rule_id" integer NOT NULL,
  "level" integer DEFAULT 0 NOT NULL,
  "description" text NOT NULL,
  "agent_id" varchar(64),
  "data" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_wazuh_alerts_agent_id" ON "wazuh_alerts" ("agent_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_wazuh_alerts_level" ON "wazuh_alerts" ("level");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_wazuh_alerts_created_at" ON "wazuh_alerts" ("created_at");
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "wazuh_playbooks" (
  "id" varchar(64) PRIMARY KEY NOT NULL,
  "name" varchar(255) NOT NULL,
  "description" text,
  "trigger_condition" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "actions" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "enabled" boolean DEFAULT false NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_wazuh_playbooks_enabled" ON "wazuh_playbooks" ("enabled");
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "wazuh_playbook_executions" (
  "id" varchar(64) PRIMARY KEY NOT NULL,
  "playbook_id" varchar(64) NOT NULL REFERENCES "wazuh_playbooks"("id"),
  "alert_id" varchar(64),
  "status" varchar(32) DEFAULT 'RUNNING' NOT NULL,
  "started_at" timestamp DEFAULT now() NOT NULL,
  "completed_at" timestamp,
  "result" text,
  "created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_wazuh_exec_playbook_id" ON "wazuh_playbook_executions" ("playbook_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_wazuh_exec_alert_id" ON "wazuh_playbook_executions" ("alert_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_wazuh_exec_status" ON "wazuh_playbook_executions" ("status");
