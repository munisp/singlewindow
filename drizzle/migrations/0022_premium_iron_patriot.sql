CREATE TABLE "compliance_email_schedule" (
	"id" serial PRIMARY KEY NOT NULL,
	"recipient_email" varchar(256) NOT NULL,
	"recipient_name" varchar(256),
	"is_active" boolean DEFAULT true NOT NULL,
	"last_sent_at" timestamp,
	"last_sent_rows" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"created_by" integer
);
--> statement-breakpoint
ALTER TABLE "compliance_email_schedule" ADD CONSTRAINT "compliance_email_schedule_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;