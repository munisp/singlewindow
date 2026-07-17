CREATE TABLE "aeo_renewal_documents" (
	"id" serial PRIMARY KEY NOT NULL,
	"renewal_id" integer NOT NULL,
	"doc_type" varchar(64) NOT NULL,
	"label" varchar(255) NOT NULL,
	"required" boolean DEFAULT true NOT NULL,
	"uploaded_at" timestamp,
	"file_url" text,
	"file_key" text,
	"status" varchar(32) DEFAULT 'pending' NOT NULL,
	"review_notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "export_schedule_deliveries" (
	"id" serial PRIMARY KEY NOT NULL,
	"schedule_id" integer NOT NULL,
	"delivered_at" timestamp DEFAULT now() NOT NULL,
	"row_count" integer DEFAULT 0 NOT NULL,
	"file_size_bytes" integer DEFAULT 0 NOT NULL,
	"status" varchar(32) DEFAULT 'success' NOT NULL,
	"error_message" text,
	"notification_id" integer
);
--> statement-breakpoint
CREATE TABLE "sanctions_batch_conflicts" (
	"id" serial PRIMARY KEY NOT NULL,
	"batch_id" integer NOT NULL,
	"row_index" integer NOT NULL,
	"entity_name" varchar(255) NOT NULL,
	"entity_type" varchar(64),
	"existing_id" integer,
	"incoming_data" json NOT NULL,
	"existing_data" json,
	"resolution" varchar(32),
	"resolved_by" integer,
	"resolved_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "idx_ard_renewal" ON "aeo_renewal_documents" USING btree ("renewal_id");--> statement-breakpoint
CREATE INDEX "idx_ard_status" ON "aeo_renewal_documents" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_esd_schedule" ON "export_schedule_deliveries" USING btree ("schedule_id");--> statement-breakpoint
CREATE INDEX "idx_esd_delivered_at" ON "export_schedule_deliveries" USING btree ("delivered_at");--> statement-breakpoint
CREATE INDEX "idx_sbc_batch" ON "sanctions_batch_conflicts" USING btree ("batch_id");--> statement-breakpoint
CREATE INDEX "idx_sbc_resolution" ON "sanctions_batch_conflicts" USING btree ("resolution");