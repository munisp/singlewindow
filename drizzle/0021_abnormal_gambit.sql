CREATE TYPE "public"."aeo_renewal_status" AS ENUM('pending', 'approved', 'rejected');--> statement-breakpoint
CREATE TABLE "aeo_renewal_requests" (
	"id" serial PRIMARY KEY NOT NULL,
	"application_id" integer NOT NULL,
	"trader_id" integer NOT NULL,
	"status" "aeo_renewal_status" DEFAULT 'pending' NOT NULL,
	"requested_at" timestamp DEFAULT now() NOT NULL,
	"processed_at" timestamp,
	"processed_by" integer,
	"notes" text
);
--> statement-breakpoint
ALTER TABLE "aeo_renewal_requests" ADD CONSTRAINT "aeo_renewal_requests_application_id_aeo_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."aeo_applications"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "aeo_renewal_requests" ADD CONSTRAINT "aeo_renewal_requests_trader_id_users_id_fk" FOREIGN KEY ("trader_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "aeo_renewal_requests" ADD CONSTRAINT "aeo_renewal_requests_processed_by_users_id_fk" FOREIGN KEY ("processed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_aeo_renewal_app_id" ON "aeo_renewal_requests" USING btree ("application_id");--> statement-breakpoint
CREATE INDEX "idx_aeo_renewal_trader_id" ON "aeo_renewal_requests" USING btree ("trader_id");