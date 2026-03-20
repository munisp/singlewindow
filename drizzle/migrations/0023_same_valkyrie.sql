CREATE TABLE "compliance_email_delivery_log" (
	"id" serial PRIMARY KEY NOT NULL,
	"triggered_at" timestamp DEFAULT now() NOT NULL,
	"triggered_by" varchar(64) DEFAULT 'cron' NOT NULL,
	"date_label" varchar(16) NOT NULL,
	"row_count" integer NOT NULL,
	"recipient_count" integer NOT NULL,
	"recipients" text NOT NULL,
	"success" boolean NOT NULL,
	"error_message" text,
	"duration_ms" integer
);
--> statement-breakpoint
CREATE INDEX "idx_cedl_triggered_at" ON "compliance_email_delivery_log" USING btree ("triggered_at");--> statement-breakpoint
CREATE INDEX "idx_cedl_success" ON "compliance_email_delivery_log" USING btree ("success");