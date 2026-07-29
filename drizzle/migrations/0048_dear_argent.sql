CREATE TYPE "public"."domain_verification_outcome" AS ENUM('success', 'failure', 'error');--> statement-breakpoint
CREATE TABLE "domain_verification_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"domain" varchar(253) NOT NULL,
	"outcome" "domain_verification_outcome" NOT NULL,
	"error_code" varchar(64),
	"detail" varchar(512),
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "domain_verification_events" ADD CONSTRAINT "domain_verification_events_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_dve_tenant_id" ON "domain_verification_events" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "idx_dve_domain" ON "domain_verification_events" USING btree ("domain");--> statement-breakpoint
CREATE INDEX "idx_dve_created_at" ON "domain_verification_events" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "idx_dve_outcome" ON "domain_verification_events" USING btree ("outcome");