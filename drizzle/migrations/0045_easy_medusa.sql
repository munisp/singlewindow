CREATE TABLE "coraza_waf_rules" (
	"id" serial PRIMARY KEY NOT NULL,
	"rule_id" varchar(32) NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"severity" varchar(16) DEFAULT 'medium' NOT NULL,
	"category" varchar(64) DEFAULT 'OWASP-CRS' NOT NULL,
	"description" text,
	"disabled_by" integer,
	"disabled_at" timestamp,
	"enabled_by" integer,
	"enabled_at" timestamp,
	"change_reason" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "coraza_waf_rules_rule_id_unique" UNIQUE("rule_id")
);
--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "custom_domain" varchar(253);--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "domain_verified" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "domain_verified_at" timestamp;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "domain_verification_token" varchar(64);--> statement-breakpoint
ALTER TABLE "coraza_waf_rules" ADD CONSTRAINT "coraza_waf_rules_disabled_by_users_id_fk" FOREIGN KEY ("disabled_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coraza_waf_rules" ADD CONSTRAINT "coraza_waf_rules_enabled_by_users_id_fk" FOREIGN KEY ("enabled_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_coraza_rule_id" ON "coraza_waf_rules" USING btree ("rule_id");--> statement-breakpoint
CREATE INDEX "idx_coraza_enabled" ON "coraza_waf_rules" USING btree ("enabled");--> statement-breakpoint
CREATE INDEX "idx_coraza_severity" ON "coraza_waf_rules" USING btree ("severity");--> statement-breakpoint
CREATE INDEX "idx_coraza_category" ON "coraza_waf_rules" USING btree ("category");--> statement-breakpoint
ALTER TABLE "tenants" ADD CONSTRAINT "tenants_custom_domain_unique" UNIQUE("custom_domain");