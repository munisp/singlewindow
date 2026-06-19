CREATE TYPE "public"."asean_sw_message_type" AS ENUM('CUSCAR', 'CUSRES', 'CUSDEC', 'IFTMIN', 'IFTSTA', 'COPARN', 'COARRI');--> statement-breakpoint
CREATE TYPE "public"."audit_finding_type" AS ENUM('undervaluation', 'misclassification', 'origin_mismatch', 'quantity_discrepancy', 'prohibited_goods', 'documentation_fraud', 'duty_evasion', 'no_finding');--> statement-breakpoint
CREATE TYPE "public"."audit_selection_reason" AS ENUM('risk_score_high', 'random_sample', 'trader_tier_review', 'value_threshold', 'hs_chapter_sensitive', 'repeat_offender', 'post_green_lane');--> statement-breakpoint
CREATE TYPE "public"."audit_task_status" AS ENUM('pending', 'assigned', 'in_progress', 'findings_submitted', 'closed', 'appealed');--> statement-breakpoint
CREATE TYPE "public"."free_zone_operation_type" AS ENUM('admission', 'manufacturing', 're_export', 'destruction', 'transfer');--> statement-breakpoint
CREATE TYPE "public"."sla_escalation_status" AS ENUM('open', 'acknowledged', 'resolved', 'escalated');--> statement-breakpoint
CREATE TYPE "public"."soc_incident_severity" AS ENUM('low', 'medium', 'high', 'critical');--> statement-breakpoint
CREATE TYPE "public"."soc_incident_status" AS ENUM('open', 'investigating', 'contained', 'resolved', 'closed');--> statement-breakpoint
CREATE TYPE "public"."temporal_workflow_status" AS ENUM('RUNNING', 'COMPLETED', 'FAILED', 'TIMED_OUT', 'CANCELLED');--> statement-breakpoint
CREATE TYPE "public"."threat_intel_severity" AS ENUM('info', 'low', 'medium', 'high', 'critical');--> statement-breakpoint
CREATE TABLE "asean_sw_messages" (
	"id" serial PRIMARY KEY NOT NULL,
	"message_id" varchar(128) NOT NULL,
	"message_type" "asean_sw_message_type" NOT NULL,
	"sender_country" varchar(3) NOT NULL,
	"receiver_country" varchar(3) NOT NULL,
	"declaration_id" integer,
	"payload" jsonb NOT NULL,
	"status" varchar(32) DEFAULT 'sent' NOT NULL,
	"sent_at" timestamp DEFAULT now() NOT NULL,
	"acknowledged_at" timestamp,
	"error_message" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "asean_sw_messages_message_id_unique" UNIQUE("message_id")
);
--> statement-breakpoint
CREATE TABLE "audit_findings" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"audit_task_id" varchar(64) NOT NULL,
	"finding_type" "audit_finding_type" NOT NULL,
	"description" text NOT NULL,
	"amount_usd" numeric(18, 2) DEFAULT '0',
	"evidence_url" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_tasks" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"declaration_id" varchar(64) NOT NULL,
	"declarant_name" varchar(255) NOT NULL,
	"hs_code" varchar(20),
	"declared_value_usd" numeric(18, 2) NOT NULL,
	"duty_paid_usd" numeric(18, 2) NOT NULL,
	"selection_reason" "audit_selection_reason" NOT NULL,
	"risk_score" numeric(5, 4) NOT NULL,
	"status" "audit_task_status" DEFAULT 'pending' NOT NULL,
	"assigned_officer_id" varchar(64),
	"assigned_officer_name" varchar(255),
	"due_at" timestamp NOT NULL,
	"duty_discrepancy_usd" numeric(18, 2) DEFAULT '0',
	"appeal_notes" text DEFAULT '',
	"created_at" timestamp DEFAULT now() NOT NULL,
	"closed_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "cen_messages" (
	"id" serial PRIMARY KEY NOT NULL,
	"message_ref" varchar(128) NOT NULL,
	"message_type" varchar(64) NOT NULL,
	"origin_country" varchar(3) NOT NULL,
	"target_country" varchar(3),
	"subject" varchar(255),
	"body" text,
	"attachments" jsonb DEFAULT '[]'::jsonb,
	"priority" varchar(16) DEFAULT 'normal',
	"status" varchar(32) DEFAULT 'sent' NOT NULL,
	"related_declarations" jsonb DEFAULT '[]'::jsonb,
	"sent_at" timestamp DEFAULT now() NOT NULL,
	"acknowledged_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "cen_messages_message_ref_unique" UNIQUE("message_ref")
);
--> statement-breakpoint
CREATE TABLE "free_zone_operations" (
	"id" serial PRIMARY KEY NOT NULL,
	"operation_number" varchar(64) NOT NULL,
	"operation_type" "free_zone_operation_type" NOT NULL,
	"zone_id" varchar(64) NOT NULL,
	"zone_name" varchar(255),
	"trader_id" integer,
	"declaration_id" integer,
	"goods_description" text,
	"quantity_kg" numeric(12, 3),
	"value_usd" numeric(18, 2),
	"status" varchar(32) DEFAULT 'pending' NOT NULL,
	"approved_by" integer,
	"approved_at" timestamp,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "free_zone_operations_operation_number_unique" UNIQUE("operation_number")
);
--> statement-breakpoint
CREATE TABLE "knowledge_graph_edges" (
	"id" serial PRIMARY KEY NOT NULL,
	"source_node_id" varchar(128) NOT NULL,
	"target_node_id" varchar(128) NOT NULL,
	"edge_type" varchar(64) NOT NULL,
	"weight" numeric(8, 4) DEFAULT '1.0',
	"properties" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "knowledge_graph_nodes" (
	"id" serial PRIMARY KEY NOT NULL,
	"node_id" varchar(128) NOT NULL,
	"node_type" varchar(64) NOT NULL,
	"label" varchar(255) NOT NULL,
	"properties" jsonb DEFAULT '{}'::jsonb,
	"risk_score" numeric(5, 4),
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "knowledge_graph_nodes_node_id_unique" UNIQUE("node_id")
);
--> statement-breakpoint
CREATE TABLE "nl_query_history" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"query" text NOT NULL,
	"sql" text,
	"result_count" integer,
	"execution_ms" integer,
	"success" boolean DEFAULT true NOT NULL,
	"error_message" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "officer_workload_snapshots" (
	"id" serial PRIMARY KEY NOT NULL,
	"officer_id" integer NOT NULL,
	"snapshot_date" timestamp DEFAULT now() NOT NULL,
	"pending_declarations" integer DEFAULT 0 NOT NULL,
	"completed_today" integer DEFAULT 0 NOT NULL,
	"avg_clearance_hours" numeric(8, 2),
	"sla_breach_count" integer DEFAULT 0 NOT NULL,
	"capacity_pct" integer DEFAULT 0
);
--> statement-breakpoint
CREATE TABLE "risk_model_configs" (
	"id" serial PRIMARY KEY NOT NULL,
	"model_name" varchar(128) NOT NULL,
	"version" varchar(32) NOT NULL,
	"feature_weights" jsonb NOT NULL,
	"thresholds" jsonb NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"last_trained_at" timestamp,
	"accuracy" numeric(5, 4),
	"f1_score" numeric(5, 4),
	"created_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "risk_model_configs_model_name_unique" UNIQUE("model_name")
);
--> statement-breakpoint
CREATE TABLE "sla_escalations" (
	"id" serial PRIMARY KEY NOT NULL,
	"declaration_id" integer,
	"declaration_number" varchar(64),
	"escalation_level" integer DEFAULT 1 NOT NULL,
	"breach_type" varchar(64) NOT NULL,
	"breach_hours" numeric(8, 2),
	"status" "sla_escalation_status" DEFAULT 'open' NOT NULL,
	"assigned_to" integer,
	"resolved_at" timestamp,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "soc_incidents" (
	"id" serial PRIMARY KEY NOT NULL,
	"incident_number" varchar(64) NOT NULL,
	"title" varchar(255) NOT NULL,
	"description" text,
	"severity" "soc_incident_severity" DEFAULT 'medium' NOT NULL,
	"status" "soc_incident_status" DEFAULT 'open' NOT NULL,
	"assigned_to" integer,
	"affected_systems" jsonb DEFAULT '[]'::jsonb,
	"iocs" jsonb DEFAULT '[]'::jsonb,
	"timeline" jsonb DEFAULT '[]'::jsonb,
	"resolved_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "soc_incidents_incident_number_unique" UNIQUE("incident_number")
);
--> statement-breakpoint
CREATE TABLE "stream_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"topic" varchar(128) NOT NULL,
	"partition_key" varchar(128),
	"event_type" varchar(64) NOT NULL,
	"payload" jsonb NOT NULL,
	"source" varchar(128),
	"correlation_id" varchar(128),
	"processed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "temporal_workflows" (
	"id" serial PRIMARY KEY NOT NULL,
	"workflow_id" varchar(255) NOT NULL,
	"run_id" varchar(255) NOT NULL,
	"workflow_type" varchar(128) NOT NULL,
	"declaration_id" integer,
	"status" "temporal_workflow_status" DEFAULT 'RUNNING' NOT NULL,
	"start_time" timestamp DEFAULT now() NOT NULL,
	"close_time" timestamp,
	"current_step" varchar(128),
	"steps" jsonb DEFAULT '[]'::jsonb,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "temporal_workflows_workflow_id_unique" UNIQUE("workflow_id")
);
--> statement-breakpoint
CREATE TABLE "threat_intel_feeds" (
	"id" serial PRIMARY KEY NOT NULL,
	"feed_source" varchar(128) NOT NULL,
	"indicator_type" varchar(64) NOT NULL,
	"indicator_value" text NOT NULL,
	"severity" "threat_intel_severity" DEFAULT 'medium' NOT NULL,
	"description" text,
	"tags" jsonb DEFAULT '[]'::jsonb,
	"first_seen" timestamp DEFAULT now() NOT NULL,
	"last_seen" timestamp DEFAULT now() NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"related_declarations" jsonb DEFAULT '[]'::jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "asean_sw_messages" ADD CONSTRAINT "asean_sw_messages_declaration_id_declarations_id_fk" FOREIGN KEY ("declaration_id") REFERENCES "public"."declarations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_findings" ADD CONSTRAINT "audit_findings_audit_task_id_audit_tasks_id_fk" FOREIGN KEY ("audit_task_id") REFERENCES "public"."audit_tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "free_zone_operations" ADD CONSTRAINT "free_zone_operations_trader_id_users_id_fk" FOREIGN KEY ("trader_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "free_zone_operations" ADD CONSTRAINT "free_zone_operations_declaration_id_declarations_id_fk" FOREIGN KEY ("declaration_id") REFERENCES "public"."declarations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "free_zone_operations" ADD CONSTRAINT "free_zone_operations_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_graph_edges" ADD CONSTRAINT "knowledge_graph_edges_source_node_id_knowledge_graph_nodes_node_id_fk" FOREIGN KEY ("source_node_id") REFERENCES "public"."knowledge_graph_nodes"("node_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_graph_edges" ADD CONSTRAINT "knowledge_graph_edges_target_node_id_knowledge_graph_nodes_node_id_fk" FOREIGN KEY ("target_node_id") REFERENCES "public"."knowledge_graph_nodes"("node_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nl_query_history" ADD CONSTRAINT "nl_query_history_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "officer_workload_snapshots" ADD CONSTRAINT "officer_workload_snapshots_officer_id_users_id_fk" FOREIGN KEY ("officer_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "risk_model_configs" ADD CONSTRAINT "risk_model_configs_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sla_escalations" ADD CONSTRAINT "sla_escalations_declaration_id_declarations_id_fk" FOREIGN KEY ("declaration_id") REFERENCES "public"."declarations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sla_escalations" ADD CONSTRAINT "sla_escalations_assigned_to_users_id_fk" FOREIGN KEY ("assigned_to") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "soc_incidents" ADD CONSTRAINT "soc_incidents_assigned_to_users_id_fk" FOREIGN KEY ("assigned_to") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_asean_sw_type" ON "asean_sw_messages" USING btree ("message_type");--> statement-breakpoint
CREATE INDEX "idx_asean_sw_decl" ON "asean_sw_messages" USING btree ("declaration_id");--> statement-breakpoint
CREATE INDEX "idx_asean_sw_sent" ON "asean_sw_messages" USING btree ("sent_at");--> statement-breakpoint
CREATE INDEX "idx_audit_findings_task" ON "audit_findings" USING btree ("audit_task_id");--> statement-breakpoint
CREATE INDEX "idx_audit_tasks_status" ON "audit_tasks" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_audit_tasks_decl" ON "audit_tasks" USING btree ("declaration_id");--> statement-breakpoint
CREATE INDEX "idx_audit_tasks_created" ON "audit_tasks" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "idx_cen_messages_type" ON "cen_messages" USING btree ("message_type");--> statement-breakpoint
CREATE INDEX "idx_cen_messages_origin" ON "cen_messages" USING btree ("origin_country");--> statement-breakpoint
CREATE INDEX "idx_cen_messages_sent" ON "cen_messages" USING btree ("sent_at");--> statement-breakpoint
CREATE INDEX "idx_free_zone_ops_type" ON "free_zone_operations" USING btree ("operation_type");--> statement-breakpoint
CREATE INDEX "idx_free_zone_ops_zone" ON "free_zone_operations" USING btree ("zone_id");--> statement-breakpoint
CREATE INDEX "idx_free_zone_ops_trader" ON "free_zone_operations" USING btree ("trader_id");--> statement-breakpoint
CREATE INDEX "idx_free_zone_ops_created" ON "free_zone_operations" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "idx_kg_edges_source" ON "knowledge_graph_edges" USING btree ("source_node_id");--> statement-breakpoint
CREATE INDEX "idx_kg_edges_target" ON "knowledge_graph_edges" USING btree ("target_node_id");--> statement-breakpoint
CREATE INDEX "idx_kg_edges_type" ON "knowledge_graph_edges" USING btree ("edge_type");--> statement-breakpoint
CREATE INDEX "idx_kg_nodes_type" ON "knowledge_graph_nodes" USING btree ("node_type");--> statement-breakpoint
CREATE INDEX "idx_kg_nodes_label" ON "knowledge_graph_nodes" USING btree ("label");--> statement-breakpoint
CREATE INDEX "idx_nl_query_user" ON "nl_query_history" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_nl_query_created" ON "nl_query_history" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "idx_officer_workload_officer" ON "officer_workload_snapshots" USING btree ("officer_id");--> statement-breakpoint
CREATE INDEX "idx_officer_workload_date" ON "officer_workload_snapshots" USING btree ("snapshot_date");--> statement-breakpoint
CREATE INDEX "idx_risk_model_active" ON "risk_model_configs" USING btree ("is_active");--> statement-breakpoint
CREATE INDEX "idx_risk_model_name" ON "risk_model_configs" USING btree ("model_name");--> statement-breakpoint
CREATE INDEX "idx_sla_esc_status" ON "sla_escalations" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_sla_esc_decl" ON "sla_escalations" USING btree ("declaration_id");--> statement-breakpoint
CREATE INDEX "idx_sla_esc_created" ON "sla_escalations" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "idx_soc_incidents_status" ON "soc_incidents" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_soc_incidents_severity" ON "soc_incidents" USING btree ("severity");--> statement-breakpoint
CREATE INDEX "idx_soc_incidents_created" ON "soc_incidents" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "idx_stream_events_topic" ON "stream_events" USING btree ("topic");--> statement-breakpoint
CREATE INDEX "idx_stream_events_type" ON "stream_events" USING btree ("event_type");--> statement-breakpoint
CREATE INDEX "idx_stream_events_created" ON "stream_events" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "idx_stream_events_correlation" ON "stream_events" USING btree ("correlation_id");--> statement-breakpoint
CREATE INDEX "idx_temporal_wf_decl" ON "temporal_workflows" USING btree ("declaration_id");--> statement-breakpoint
CREATE INDEX "idx_temporal_wf_status" ON "temporal_workflows" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_temporal_wf_type" ON "temporal_workflows" USING btree ("workflow_type");--> statement-breakpoint
CREATE INDEX "idx_threat_intel_source" ON "threat_intel_feeds" USING btree ("feed_source");--> statement-breakpoint
CREATE INDEX "idx_threat_intel_severity" ON "threat_intel_feeds" USING btree ("severity");--> statement-breakpoint
CREATE INDEX "idx_threat_intel_active" ON "threat_intel_feeds" USING btree ("is_active");