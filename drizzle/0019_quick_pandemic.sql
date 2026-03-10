ALTER TYPE "public"."origin_cert_status" ADD VALUE 'revoked';--> statement-breakpoint
ALTER TABLE "origin_certificates" ADD COLUMN "revoked_at" timestamp;--> statement-breakpoint
ALTER TABLE "origin_certificates" ADD COLUMN "revoked_by" integer;--> statement-breakpoint
ALTER TABLE "origin_certificates" ADD COLUMN "revocation_reason" text;--> statement-breakpoint
ALTER TABLE "origin_certificates" ADD CONSTRAINT "origin_certificates_revoked_by_users_id_fk" FOREIGN KEY ("revoked_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;