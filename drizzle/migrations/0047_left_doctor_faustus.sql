ALTER TABLE "coraza_waf_rules" ADD COLUMN "crs_version" varchar(32);--> statement-breakpoint
ALTER TABLE "coraza_waf_rules" ADD COLUMN "paranoia_level" integer DEFAULT 1;--> statement-breakpoint
ALTER TABLE "coraza_waf_rules" ADD COLUMN "tags" text;--> statement-breakpoint
ALTER TABLE "coraza_waf_rules" ADD COLUMN "phase" integer DEFAULT 2;--> statement-breakpoint
ALTER TABLE "coraza_waf_rules" ADD COLUMN "action" varchar(16) DEFAULT 'block';--> statement-breakpoint
ALTER TABLE "coraza_waf_rules" ADD COLUMN "imported_at" timestamp;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "domain_verification_fail_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "domain_last_failed_at" timestamp;