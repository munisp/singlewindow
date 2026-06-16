ALTER TABLE "cep_alerts" ADD COLUMN "suppressed_until" timestamp;--> statement-breakpoint
ALTER TABLE "cep_alerts" ADD COLUMN "suppressed_by" integer;--> statement-breakpoint
ALTER TABLE "cep_patterns" ADD COLUMN "daily_alert_threshold" integer;--> statement-breakpoint
ALTER TABLE "cep_alerts" ADD CONSTRAINT "cep_alerts_suppressed_by_users_id_fk" FOREIGN KEY ("suppressed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;