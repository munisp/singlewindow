CREATE TABLE "system_heartbeat_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(128) NOT NULL,
	"task_uid" varchar(65),
	"cron_expression" varchar(64) NOT NULL,
	"callback_path" varchar(256) NOT NULL,
	"description" varchar(512),
	"is_enabled" boolean DEFAULT true NOT NULL,
	"last_executed_at" timestamp,
	"next_execution_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "system_heartbeat_jobs_name_unique" UNIQUE("name"),
	CONSTRAINT "system_heartbeat_jobs_task_uid_unique" UNIQUE("task_uid")
);
