CREATE TYPE "public"."document_vault_access" AS ENUM('private', 'shared_with_customs', 'shared_with_oga', 'public');--> statement-breakpoint
CREATE TYPE "public"."document_vault_category" AS ENUM('commercial_invoice', 'bill_of_lading', 'packing_list', 'certificate_of_origin', 'phytosanitary_cert', 'import_permit', 'export_permit', 'insurance_cert', 'customs_bond', 'kyc_identity', 'kyc_business', 'aeo_supporting', 'post_clearance', 'correspondence', 'other');--> statement-breakpoint
CREATE TYPE "public"."document_vault_status" AS ENUM('active', 'revoked', 'expired');--> statement-breakpoint
ALTER TYPE "public"."audit_entity" ADD VALUE 'aeo_application';--> statement-breakpoint
ALTER TYPE "public"."audit_entity" ADD VALUE 'kyc_verification';--> statement-breakpoint
CREATE TABLE "document_vault" (
	"id" serial PRIMARY KEY NOT NULL,
	"owner_id" integer NOT NULL,
	"declaration_id" integer,
	"file_key" varchar(512) NOT NULL,
	"url" text NOT NULL,
	"filename" varchar(255) NOT NULL,
	"mime_type" varchar(128) NOT NULL,
	"size_bytes" bigint NOT NULL,
	"category" "document_vault_category" NOT NULL,
	"access_level" "document_vault_access" DEFAULT 'private' NOT NULL,
	"status" "document_vault_status" DEFAULT 'active' NOT NULL,
	"description" text,
	"revoked_by" integer,
	"revoked_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "document_vault" ADD CONSTRAINT "document_vault_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_vault" ADD CONSTRAINT "document_vault_declaration_id_declarations_id_fk" FOREIGN KEY ("declaration_id") REFERENCES "public"."declarations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_vault" ADD CONSTRAINT "document_vault_revoked_by_users_id_fk" FOREIGN KEY ("revoked_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_dv_owner_id" ON "document_vault" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "idx_dv_declaration_id" ON "document_vault" USING btree ("declaration_id");--> statement-breakpoint
CREATE INDEX "idx_dv_status" ON "document_vault" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_dv_category" ON "document_vault" USING btree ("category");--> statement-breakpoint
CREATE INDEX "idx_dv_owner_status" ON "document_vault" USING btree ("owner_id","status");--> statement-breakpoint
CREATE INDEX "idx_decl_trader_status" ON "declarations" USING btree ("trader_id","status");--> statement-breakpoint
CREATE INDEX "idx_decl_submitted_at" ON "declarations" USING btree ("submitted_at");--> statement-breakpoint
CREATE INDEX "idx_decl_risk_lane_status" ON "declarations" USING btree ("risk_lane","status");--> statement-breakpoint
CREATE INDEX "idx_decl_assigned_officer" ON "declarations" USING btree ("assigned_officer_id");