CREATE TABLE "kafka_event_log" (
	"id" serial PRIMARY KEY NOT NULL,
	"topic" varchar(256) NOT NULL,
	"event_type" varchar(128) NOT NULL,
	"aggregate_id" varchar(256) NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" varchar(32) DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_attempt_at" timestamp,
	"published_at" timestamp,
	"error_message" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "kyc_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"declaration_id" integer,
	"user_id" integer,
	"document_type" varchar(64) NOT NULL,
	"extracted_data" jsonb DEFAULT '{}'::jsonb,
	"risk_score" numeric(5, 4),
	"risk_level" varchar(32),
	"anomalies_detected" jsonb DEFAULT '[]'::jsonb,
	"ocr_confidence" numeric(5, 4),
	"processing_ms" integer,
	"status" varchar(32) DEFAULT 'completed' NOT NULL,
	"error_message" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "oga_permit_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"permit_id" integer NOT NULL,
	"declaration_id" integer,
	"agency_code" varchar(32) NOT NULL,
	"event_type" varchar(64) NOT NULL,
	"previous_status" varchar(32),
	"new_status" varchar(32) NOT NULL,
	"actor_id" integer,
	"actor_type" varchar(32) DEFAULT 'system',
	"remarks" text,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"kafka_offset" bigint,
	"kafka_partition" integer,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "kyc_events" ADD CONSTRAINT "kyc_events_declaration_id_declarations_id_fk" FOREIGN KEY ("declaration_id") REFERENCES "public"."declarations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kyc_events" ADD CONSTRAINT "kyc_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oga_permit_events" ADD CONSTRAINT "oga_permit_events_permit_id_oga_permits_id_fk" FOREIGN KEY ("permit_id") REFERENCES "public"."oga_permits"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oga_permit_events" ADD CONSTRAINT "oga_permit_events_declaration_id_declarations_id_fk" FOREIGN KEY ("declaration_id") REFERENCES "public"."declarations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oga_permit_events" ADD CONSTRAINT "oga_permit_events_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_kafka_log_topic" ON "kafka_event_log" USING btree ("topic");--> statement-breakpoint
CREATE INDEX "idx_kafka_log_status" ON "kafka_event_log" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_kafka_log_aggregate" ON "kafka_event_log" USING btree ("aggregate_id");--> statement-breakpoint
CREATE INDEX "idx_kafka_log_created" ON "kafka_event_log" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "idx_kyc_events_declaration" ON "kyc_events" USING btree ("declaration_id");--> statement-breakpoint
CREATE INDEX "idx_kyc_events_user" ON "kyc_events" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_kyc_events_risk_level" ON "kyc_events" USING btree ("risk_level");--> statement-breakpoint
CREATE INDEX "idx_kyc_events_created" ON "kyc_events" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "idx_oga_permit_events_permit" ON "oga_permit_events" USING btree ("permit_id");--> statement-breakpoint
CREATE INDEX "idx_oga_permit_events_declaration" ON "oga_permit_events" USING btree ("declaration_id");--> statement-breakpoint
CREATE INDEX "idx_oga_permit_events_agency" ON "oga_permit_events" USING btree ("agency_code");--> statement-breakpoint
CREATE INDEX "idx_oga_permit_events_type" ON "oga_permit_events" USING btree ("event_type");--> statement-breakpoint
CREATE INDEX "idx_oga_permit_events_created" ON "oga_permit_events" USING btree ("created_at");