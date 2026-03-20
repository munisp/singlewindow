ALTER TABLE "aeo_renewal_requests" ADD COLUMN "compliance_score_at_renewal" integer;--> statement-breakpoint
ALTER TABLE "compliance_email_schedule" ADD COLUMN "timezone" varchar(64) DEFAULT 'UTC' NOT NULL;--> statement-breakpoint
ALTER TABLE "compliance_email_schedule" ADD COLUMN "send_hour_local" integer DEFAULT 4 NOT NULL;