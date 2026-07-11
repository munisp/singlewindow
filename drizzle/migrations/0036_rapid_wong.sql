CREATE TABLE "apisix_route_audit" (
	"id" serial PRIMARY KEY NOT NULL,
	"route_id" varchar(128) NOT NULL,
	"route_name" varchar(256),
	"operation" varchar(32) NOT NULL,
	"actor_id" integer,
	"previous_config" jsonb,
	"new_config" jsonb,
	"change_reason" text,
	"apisix_version" varchar(32),
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fluvio_topic_offsets" (
	"id" serial PRIMARY KEY NOT NULL,
	"topic" varchar(128) NOT NULL,
	"partition" integer DEFAULT 0 NOT NULL,
	"consumer_group" varchar(128) NOT NULL,
	"committed_offset" bigint DEFAULT 0 NOT NULL,
	"latest_offset" bigint DEFAULT 0 NOT NULL,
	"lag_count" bigint DEFAULT 0 NOT NULL,
	"is_healthy" boolean DEFAULT true NOT NULL,
	"last_updated_at" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "keycloak_sessions" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"session_id" varchar(128) NOT NULL,
	"realm_id" varchar(64) DEFAULT 'tradegateway' NOT NULL,
	"client_id" varchar(128),
	"ip_address" varchar(64),
	"user_agent" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"started_at" timestamp DEFAULT now() NOT NULL,
	"last_access_at" timestamp DEFAULT now() NOT NULL,
	"expires_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "keycloak_sessions_session_id_unique" UNIQUE("session_id")
);
--> statement-breakpoint
CREATE TABLE "lakehouse_jobs" (
	"id" serial PRIMARY KEY NOT NULL,
	"job_id" varchar(128) NOT NULL,
	"job_type" varchar(64) NOT NULL,
	"target_table" varchar(128) NOT NULL,
	"status" varchar(32) DEFAULT 'pending' NOT NULL,
	"rows_processed" bigint DEFAULT 0,
	"rows_written" bigint DEFAULT 0,
	"error_message" text,
	"spark_job_url" text,
	"started_at" timestamp,
	"completed_at" timestamp,
	"duration_ms" integer,
	"triggered_by" varchar(64) DEFAULT 'scheduler',
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "lakehouse_jobs_job_id_unique" UNIQUE("job_id")
);
--> statement-breakpoint
CREATE TABLE "open_appsec_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"event_id" varchar(128),
	"severity" varchar(16) NOT NULL,
	"attack_type" varchar(64) NOT NULL,
	"source_ip" varchar(64),
	"target_path" text,
	"http_method" varchar(16),
	"request_headers" jsonb DEFAULT '{}'::jsonb,
	"request_body" text,
	"action" varchar(32) DEFAULT 'block' NOT NULL,
	"confidence" integer,
	"waap_version" varchar(32),
	"is_acknowledged" boolean DEFAULT false NOT NULL,
	"acknowledged_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "open_appsec_events_event_id_unique" UNIQUE("event_id")
);
--> statement-breakpoint
CREATE TABLE "permify_audit_log" (
	"id" serial PRIMARY KEY NOT NULL,
	"actor_id" integer,
	"operation" varchar(32) NOT NULL,
	"entity" varchar(128) NOT NULL,
	"relation" varchar(128) NOT NULL,
	"subject" varchar(128) NOT NULL,
	"allowed" boolean,
	"schema_version" varchar(32),
	"snap_token" varchar(128),
	"latency_ms" integer,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "temporal_workflow_runs" (
	"id" serial PRIMARY KEY NOT NULL,
	"workflow_id" varchar(256) NOT NULL,
	"run_id" varchar(128) NOT NULL,
	"workflow_type" varchar(128) NOT NULL,
	"task_queue" varchar(128) NOT NULL,
	"status" varchar(32) NOT NULL,
	"declaration_id" integer,
	"input" jsonb DEFAULT '{}'::jsonb,
	"result" jsonb,
	"error_message" text,
	"started_at" timestamp DEFAULT now() NOT NULL,
	"closed_at" timestamp,
	"duration_ms" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "temporal_workflow_runs_run_id_unique" UNIQUE("run_id")
);
--> statement-breakpoint
ALTER TABLE "apisix_route_audit" ADD CONSTRAINT "apisix_route_audit_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "keycloak_sessions" ADD CONSTRAINT "keycloak_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "open_appsec_events" ADD CONSTRAINT "open_appsec_events_acknowledged_by_users_id_fk" FOREIGN KEY ("acknowledged_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "permify_audit_log" ADD CONSTRAINT "permify_audit_log_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "temporal_workflow_runs" ADD CONSTRAINT "temporal_workflow_runs_declaration_id_declarations_id_fk" FOREIGN KEY ("declaration_id") REFERENCES "public"."declarations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_apisix_audit_route" ON "apisix_route_audit" USING btree ("route_id");--> statement-breakpoint
CREATE INDEX "idx_apisix_audit_operation" ON "apisix_route_audit" USING btree ("operation");--> statement-breakpoint
CREATE INDEX "idx_apisix_audit_actor" ON "apisix_route_audit" USING btree ("actor_id");--> statement-breakpoint
CREATE INDEX "idx_apisix_audit_created" ON "apisix_route_audit" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "idx_fluvio_offsets_topic" ON "fluvio_topic_offsets" USING btree ("topic");--> statement-breakpoint
CREATE INDEX "idx_fluvio_offsets_group" ON "fluvio_topic_offsets" USING btree ("consumer_group");--> statement-breakpoint
CREATE INDEX "idx_fluvio_offsets_lag" ON "fluvio_topic_offsets" USING btree ("lag_count");--> statement-breakpoint
CREATE INDEX "idx_keycloak_sessions_user" ON "keycloak_sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_keycloak_sessions_session" ON "keycloak_sessions" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "idx_keycloak_sessions_active" ON "keycloak_sessions" USING btree ("is_active");--> statement-breakpoint
CREATE INDEX "idx_lakehouse_jobs_type" ON "lakehouse_jobs" USING btree ("job_type");--> statement-breakpoint
CREATE INDEX "idx_lakehouse_jobs_status" ON "lakehouse_jobs" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_lakehouse_jobs_target" ON "lakehouse_jobs" USING btree ("target_table");--> statement-breakpoint
CREATE INDEX "idx_lakehouse_jobs_created" ON "lakehouse_jobs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "idx_openappsec_severity" ON "open_appsec_events" USING btree ("severity");--> statement-breakpoint
CREATE INDEX "idx_openappsec_attack" ON "open_appsec_events" USING btree ("attack_type");--> statement-breakpoint
CREATE INDEX "idx_openappsec_ip" ON "open_appsec_events" USING btree ("source_ip");--> statement-breakpoint
CREATE INDEX "idx_openappsec_action" ON "open_appsec_events" USING btree ("action");--> statement-breakpoint
CREATE INDEX "idx_openappsec_created" ON "open_appsec_events" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "idx_permify_audit_actor" ON "permify_audit_log" USING btree ("actor_id");--> statement-breakpoint
CREATE INDEX "idx_permify_audit_entity" ON "permify_audit_log" USING btree ("entity");--> statement-breakpoint
CREATE INDEX "idx_permify_audit_operation" ON "permify_audit_log" USING btree ("operation");--> statement-breakpoint
CREATE INDEX "idx_permify_audit_created" ON "permify_audit_log" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "idx_temporal_runs_workflow" ON "temporal_workflow_runs" USING btree ("workflow_id");--> statement-breakpoint
CREATE INDEX "idx_temporal_runs_type" ON "temporal_workflow_runs" USING btree ("workflow_type");--> statement-breakpoint
CREATE INDEX "idx_temporal_runs_status" ON "temporal_workflow_runs" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_temporal_runs_declaration" ON "temporal_workflow_runs" USING btree ("declaration_id");--> statement-breakpoint
CREATE INDEX "idx_temporal_runs_started" ON "temporal_workflow_runs" USING btree ("started_at");