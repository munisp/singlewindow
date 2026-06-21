CREATE TABLE "anomaly_detections" (
	"id" serial PRIMARY KEY NOT NULL,
	"rule_id" varchar(64) NOT NULL,
	"rule_name" varchar(255) NOT NULL,
	"user_id" integer,
	"session_id" varchar(255),
	"severity" varchar(16) NOT NULL,
	"anomaly_score" numeric(8, 6),
	"description" text NOT NULL,
	"recommended_action" text,
	"features" jsonb DEFAULT '{}'::jsonb,
	"is_acknowledged" boolean DEFAULT false NOT NULL,
	"acknowledged_by" integer,
	"acknowledged_at" timestamp,
	"linked_event_id" integer,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "insider_threat_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"event_type" varchar(64) NOT NULL,
	"tb_event_code" integer NOT NULL,
	"actor_id" integer,
	"actor_role" varchar(64),
	"target_entity_type" varchar(64),
	"target_entity_id" varchar(255),
	"action" varchar(255) NOT NULL,
	"description" text,
	"ip_address" varchar(64),
	"session_id" varchar(255),
	"chain_hash" varchar(64),
	"prev_chain_hash" varchar(64),
	"severity" varchar(16) DEFAULT 'LOW' NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "privileged_action_approvals" (
	"id" serial PRIMARY KEY NOT NULL,
	"approval_ref" varchar(128) NOT NULL,
	"requester_id" integer NOT NULL,
	"approver_id" integer,
	"action" varchar(255) NOT NULL,
	"entity_type" varchar(64) NOT NULL,
	"entity_id" varchar(255) NOT NULL,
	"description" text NOT NULL,
	"status" varchar(32) DEFAULT 'pending' NOT NULL,
	"approver_reason" text,
	"requested_at" timestamp DEFAULT now() NOT NULL,
	"resolved_at" timestamp,
	"expires_at" timestamp NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	CONSTRAINT "privileged_action_approvals_approval_ref_unique" UNIQUE("approval_ref")
);
--> statement-breakpoint
CREATE TABLE "session_audit_log" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer,
	"session_id" varchar(255) NOT NULL,
	"event_type" varchar(64) NOT NULL,
	"ip_address" varchar(64),
	"user_agent" varchar(512),
	"geo_location" varchar(128),
	"risk_score" numeric(5, 4) DEFAULT '0',
	"is_suspicious" boolean DEFAULT false NOT NULL,
	"suspicion_reason" text,
	"forced_by_user_id" integer,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "anomaly_detections" ADD CONSTRAINT "anomaly_detections_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "anomaly_detections" ADD CONSTRAINT "anomaly_detections_acknowledged_by_users_id_fk" FOREIGN KEY ("acknowledged_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "anomaly_detections" ADD CONSTRAINT "anomaly_detections_linked_event_id_insider_threat_events_id_fk" FOREIGN KEY ("linked_event_id") REFERENCES "public"."insider_threat_events"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "insider_threat_events" ADD CONSTRAINT "insider_threat_events_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "privileged_action_approvals" ADD CONSTRAINT "privileged_action_approvals_requester_id_users_id_fk" FOREIGN KEY ("requester_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "privileged_action_approvals" ADD CONSTRAINT "privileged_action_approvals_approver_id_users_id_fk" FOREIGN KEY ("approver_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_audit_log" ADD CONSTRAINT "session_audit_log_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_audit_log" ADD CONSTRAINT "session_audit_log_forced_by_user_id_users_id_fk" FOREIGN KEY ("forced_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_anomaly_user" ON "anomaly_detections" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_anomaly_severity" ON "anomaly_detections" USING btree ("severity");--> statement-breakpoint
CREATE INDEX "idx_anomaly_rule" ON "anomaly_detections" USING btree ("rule_id");--> statement-breakpoint
CREATE INDEX "idx_anomaly_acknowledged" ON "anomaly_detections" USING btree ("is_acknowledged");--> statement-breakpoint
CREATE INDEX "idx_anomaly_created" ON "anomaly_detections" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "idx_insider_events_actor" ON "insider_threat_events" USING btree ("actor_id");--> statement-breakpoint
CREATE INDEX "idx_insider_events_type" ON "insider_threat_events" USING btree ("event_type");--> statement-breakpoint
CREATE INDEX "idx_insider_events_severity" ON "insider_threat_events" USING btree ("severity");--> statement-breakpoint
CREATE INDEX "idx_insider_events_created" ON "insider_threat_events" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "idx_insider_events_session" ON "insider_threat_events" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "idx_paa_requester" ON "privileged_action_approvals" USING btree ("requester_id");--> statement-breakpoint
CREATE INDEX "idx_paa_status" ON "privileged_action_approvals" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_paa_expires" ON "privileged_action_approvals" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "idx_paa_ref" ON "privileged_action_approvals" USING btree ("approval_ref");--> statement-breakpoint
CREATE INDEX "idx_sal_user" ON "session_audit_log" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_sal_session" ON "session_audit_log" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "idx_sal_event_type" ON "session_audit_log" USING btree ("event_type");--> statement-breakpoint
CREATE INDEX "idx_sal_suspicious" ON "session_audit_log" USING btree ("is_suspicious");--> statement-breakpoint
CREATE INDEX "idx_sal_created" ON "session_audit_log" USING btree ("created_at");