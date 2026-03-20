CREATE TYPE "public"."onboarding_step" AS ENUM('company_profile', 'kyc_documents', 'bank_account', 'test_declaration', 'aeo_eligibility');--> statement-breakpoint
CREATE TYPE "public"."onboarding_step_status" AS ENUM('pending', 'in_progress', 'completed', 'skipped');--> statement-breakpoint
CREATE TABLE "onboarding_progress" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"current_step" "onboarding_step" DEFAULT 'company_profile' NOT NULL,
	"overall_status" varchar(32) DEFAULT 'in_progress' NOT NULL,
	"completed_at" timestamp,
	"step_data" json DEFAULT '{}'::json NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "onboarding_progress" ADD CONSTRAINT "onboarding_progress_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_onboarding_user_id" ON "onboarding_progress" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_onboarding_status" ON "onboarding_progress" USING btree ("overall_status");