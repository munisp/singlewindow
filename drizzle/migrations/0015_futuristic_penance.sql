CREATE TABLE "tenant_keycloak_config" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"realm" varchar(64) NOT NULL,
	"client_id" varchar(128) NOT NULL,
	"client_secret" varchar(256),
	"discovery_url" varchar(512) NOT NULL,
	"role_mappings" json DEFAULT '{}'::json NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tenant_users" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"user_id" integer NOT NULL,
	"role" varchar(64) DEFAULT 'viewer' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tenants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(128) NOT NULL,
	"slug" varchar(64) NOT NULL,
	"country" varchar(3) NOT NULL,
	"contact_email" varchar(256) NOT NULL,
	"plan" varchar(32) DEFAULT 'standard' NOT NULL,
	"api_prefix" varchar(64) NOT NULL,
	"status" varchar(32) DEFAULT 'active' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "tenants_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
ALTER TABLE "tenant_keycloak_config" ADD CONSTRAINT "tenant_keycloak_config_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenant_users" ADD CONSTRAINT "tenant_users_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenant_users" ADD CONSTRAINT "tenant_users_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_tenant_kc_tenant_id" ON "tenant_keycloak_config" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "idx_tenant_users_tenant_id" ON "tenant_users" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "idx_tenant_users_user_id" ON "tenant_users" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_tenants_slug" ON "tenants" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "idx_tenants_country" ON "tenants" USING btree ("country");--> statement-breakpoint
CREATE INDEX "idx_tenants_status" ON "tenants" USING btree ("status");