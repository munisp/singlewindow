CREATE TABLE "tenant_branding" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"platform_name" varchar(128) DEFAULT 'TradeGateway' NOT NULL,
	"logo_url" text,
	"favicon_url" text,
	"primary_color" varchar(16) DEFAULT '#0A1628',
	"accent_color" varchar(16) DEFAULT '#D4A017',
	"support_email" varchar(255),
	"support_phone" varchar(64),
	"footer_text" text,
	"custom_css" text,
	"login_banner_url" text,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"updated_by" integer,
	CONSTRAINT "tenant_branding_tenant_id_unique" UNIQUE("tenant_id")
);
--> statement-breakpoint
ALTER TABLE "tenant_branding" ADD CONSTRAINT "tenant_branding_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenant_branding" ADD CONSTRAINT "tenant_branding_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_tenant_branding_tenant_id" ON "tenant_branding" USING btree ("tenant_id");